"""将会话冻结题库同步到独立 ES 索引，并用真实 DashScope 向量混合召回。"""
import asyncio
import hashlib
import json
import math
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from app.model import ModelFailure
from .elasticsearch import ElasticsearchKnowledgeStore, KnowledgeSearchError


@dataclass(frozen=True)
class RetrievalSettings:
    """检索配置独立于对话模型；绝不复用 DeepSeek 的 Key。"""
    mode: str = "off"
    es_url: str = "http://127.0.0.1:9201"
    index: str = "mianshiwa-ai-questions-v3-1024"
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "text-embedding-v3"
    dimensions: int = 1024
    api_key: str = field(default="", repr=False)

    @classmethod
    def from_env(cls):
        config = cls(mode=os.getenv("AI_RETRIEVAL_MODE", "off"),
            es_url=os.getenv("AI_ES_URL", "http://127.0.0.1:9201").rstrip("/"),
            index=os.getenv("AI_ES_KNOWLEDGE_INDEX", "mianshiwa-ai-questions-v3-1024"),
            base_url=os.getenv("EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/"),
            model=os.getenv("EMBEDDING_MODEL", "text-embedding-v3"),
            dimensions=int(os.getenv("EMBEDDING_DIMENSIONS", "1024")),
            api_key=os.getenv("EMBEDDING_API_KEY", ""))
        if config.mode not in {"off", "bm25", "hybrid"}:
            raise RuntimeError("Invalid AI_RETRIEVAL_MODE")
        for value in (config.es_url, config.base_url):
            url = urlsplit(value)
            if (url.scheme not in {"http", "https"} or not url.hostname or
                    url.username or url.password or url.query or url.fragment):
                raise RuntimeError("Invalid knowledge service URL")
        if config.mode == "hybrid" and not config.api_key.strip():
            raise RuntimeError("EMBEDDING_API_KEY is required for hybrid retrieval")
        if not config.model.strip() or not 1 <= config.dimensions <= 2048:
            raise RuntimeError("Invalid embedding model or dimensions")
        return config


class EmbeddingGateway:
    """兼容 OpenAI 的 Embeddings 协议；批量限10条，失败不自动重试计费。"""
    def __init__(self, config, transport=None):
        self.config = config
        self.client = httpx.AsyncClient(transport=transport, trust_env=False,
            follow_redirects=False, timeout=httpx.Timeout(30, connect=5))

    async def close(self):
        await self.client.aclose()

    async def embed(self, texts):
        if not self.config.api_key.strip():
            raise ModelFailure("EMBEDDING_NOT_CONFIGURED", 503)
        if not 1 <= len(texts) <= 10 or any(not isinstance(t, str) or not t.strip() or len(t) > 6000 for t in texts):
            raise ValueError("Invalid embedding input")
        try:
            async with asyncio.timeout(30):
                async with self.client.stream("POST", self.config.base_url + "/embeddings",
                    headers={"Authorization": "Bearer " + self.config.api_key},
                    json={"model": self.config.model, "input": texts,
                          "dimensions": self.config.dimensions, "encoding_format": "float"}) as response:
                    if response.status_code in {401, 403}:
                        raise ModelFailure("EMBEDDING_AUTH_FAILED")
                    if response.status_code == 429:
                        raise ModelFailure("EMBEDDING_RATE_LIMITED", 503)
                    if response.status_code != 200:
                        raise ModelFailure("EMBEDDING_UPSTREAM_ERROR")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 2 * 1024 * 1024:
                            raise ModelFailure("EMBEDDING_PROTOCOL_ERROR")
                    items = json.loads(body)["data"]
                    if len(items) != len(texts) or {x["index"] for x in items} != set(range(len(texts))):
                        raise ValueError("Invalid embedding indices")
                    vectors = [x["embedding"] for x in sorted(items, key=lambda x: x["index"])]
                    for vector in vectors:
                        if (not isinstance(vector, list) or len(vector) != self.config.dimensions or
                            any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector)
                            or not any(vector)):
                            raise ValueError("Invalid embedding vector")
                    return vectors
        except (TimeoutError, httpx.TimeoutException):
            raise ModelFailure("EMBEDDING_TIMEOUT", 504) from None
        except httpx.HTTPError:
            raise ModelFailure("EMBEDDING_UNAVAILABLE") from None
        except (ValueError, KeyError, TypeError):
            raise ModelFailure("EMBEDDING_PROTOCOL_ERROR") from None


class InterviewRetriever:
    """只索引 Java 已授权提供的题库快照，不索引简历、回答或其他用户资料。"""
    def __init__(self, config, *, es_transport=None, embedding_transport=None):
        self.config = config
        self.client = httpx.AsyncClient(base_url=config.es_url, transport=es_transport,
            trust_env=False, follow_redirects=False, timeout=10)
        self.store = ElasticsearchKnowledgeStore(self.client, index=config.index, dimensions=config.dimensions)
        self.embeddings = EmbeddingGateway(config, embedding_transport)

    async def close(self):
        await self.client.aclose()
        await self.embeddings.close()

    def document_id(self, question):
        # 内容、来源版本、模型与维度共同定位缓存，旧快照不会被新版答案覆盖。
        payload = json.dumps([question, self.config.model, self.config.dimensions],
                             ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()

    async def retrieve(self, questions, query, used_sources):
        try:
            # 总预算覆盖首次批量向量化和 ES 调用；图在线程桥接等待，不阻塞 HTTP。
            async with asyncio.timeout(180):
                await self.store.initialize()
                docs = {self.document_id(q): q for q in questions}
                existing = await self.store.existing(list(docs))
                pending = [key for key in docs if key not in existing or
                           (self.config.mode == "hybrid" and not existing[key])]
                for start in range(0, len(pending), 10):
                    batch = pending[start:start + 10]
                    # Embedding 输入明确截断到6000字符；ES仍保存完整参考知识。
                    texts = [(docs[key]["title"] + "\n" + docs[key]["content"] + "\n" + docs[key]["referenceAnswer"])[:6000] for key in batch]
                    vectors = await self.embeddings.embed(texts) if self.config.mode == "hybrid" else [None] * len(batch)
                    for key, vector in zip(batch, vectors):
                        q = docs[key]
                        await self.store.upsert(document_id=key, question_id=q["id"], source_version=q["sourceVersion"],
                            title=q["title"], text=q["content"] + "\n" + q["referenceAnswer"], embedding=vector)
                if pending:
                    await self.store.refresh()
                allowed = [key for key, q in docs.items() if q["id"] not in used_sources]
                if not allowed:
                    return [], {"mode": self.config.mode, "hits": []}
                if self.config.mode == "hybrid":
                    vector = (await self.embeddings.embed([query[:6000]]))[0]
                    hits = await self.store.hybrid(query, vector, top_k=20, document_ids=allowed)
                else:
                    hits = await self.store.bm25(query, top_k=20, document_ids=allowed)
                # 对ES响应再验证一次，题目/版本不一致时不能提供错误的评分参考。
                if any(hit.document_id not in allowed or hit.question_id != docs[hit.document_id]["id"] or
                       hit.source_version != docs[hit.document_id]["sourceVersion"] for hit in hits):
                    raise KnowledgeSearchError("Knowledge source differs from session snapshot")
                return [docs[hit.document_id] for hit in hits], {"mode": self.config.mode,
                    "hits": [{"documentId": h.document_id, "questionId": h.question_id,
                              "sourceVersion": h.source_version, "score": h.score} for h in hits]}
        except KnowledgeSearchError:
            raise ModelFailure("KNOWLEDGE_UNAVAILABLE") from None
        except TimeoutError:
            raise ModelFailure("KNOWLEDGE_TIMEOUT", 504) from None
