"""ES 7.17 的 BM25 与 dense_vector 检索；Embedding 由调用方单独提供。"""
import asyncio
import math
import re
from dataclasses import dataclass

import httpx


class KnowledgeSearchError(RuntimeError):
    """对外仅暴露稳定错误，不泄露 ES 地址、请求正文及认证信息。"""


@dataclass(frozen=True)
class KnowledgeHit:
    """引擎内部检索结果，保留来源和版本用于后续引用及回放。"""
    document_id: str
    question_id: str
    source_version: str
    title: str
    text: str
    score: float


def reciprocal_rank_fusion(*rankings: list[KnowledgeHit], top_k: int):
    """按名次融合，避免直接相加量纲不同的 BM25 与余弦分数。"""
    totals: dict[str, float] = {}
    documents: dict[str, KnowledgeHit] = {}
    for ranking in rankings:
        seen = set()
        for rank, hit in enumerate(ranking, start=1):
            if hit.document_id in seen:
                continue
            seen.add(hit.document_id)
            totals[hit.document_id] = totals.get(hit.document_id, 0.0) + 1 / (60 + rank)
            documents[hit.document_id] = hit
    ordered = sorted(totals, key=lambda key: (-totals[key], key))[:top_k]
    return [KnowledgeHit(key, documents[key].question_id, documents[key].source_version,
                         documents[key].title, documents[key].text, totals[key]) for key in ordered]


class ElasticsearchKnowledgeStore:
    """复用既有 ES，通过客户端注入统一管理连接池和超时。"""
    def __init__(self, client: httpx.AsyncClient, *, index: str, dimensions: int):
        # 禁止通配符和原业务索引名，所有写入限于独立 AI 索引。
        if not re.fullmatch(r"mianshiwa-ai-[a-z0-9][a-z0-9-]*", index):
            raise ValueError("Use an independent AI Elasticsearch index")
        if not 1 <= dimensions <= 2048:
            raise ValueError("ES 7.17 dense_vector dimensions must be between 1 and 2048")
        self.client, self.index, self.dimensions = client, index, dimensions

    async def _request(self, method, path, **kwargs):
        try:
            response = await self.client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise KnowledgeSearchError("Elasticsearch knowledge operation failed") from None

    def _vector(self, vector):
        """拒绝错维度、NaN、无穷值和零向量，不自动截断或填充。"""
        if (len(vector) != self.dimensions or
                any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x)
                    for x in vector) or not any(x != 0 for x in vector)):
            raise ValueError("Invalid embedding vector")
        return list(vector)

    async def initialize(self):
        """显式初始化；已有索引的维度冲突时失败，绝不删除后重建。"""
        try:
            existing = await self.client.get(f"/{self.index}/_mapping")
            if existing.status_code == 200:
                properties = existing.json()[self.index]["mappings"]["properties"]
                vector_field = properties.get("embedding", {})
                if vector_field.get("type") != "dense_vector" or vector_field.get("dims") != self.dimensions:
                    raise KnowledgeSearchError("Knowledge index embedding mapping differs")
                return
            if existing.status_code != 404:
                raise KnowledgeSearchError("Cannot inspect knowledge index")
        except (httpx.HTTPError, ValueError, KeyError):
            raise KnowledgeSearchError("Cannot inspect knowledge index") from None
        # cjk 是 ES 内置分析器，适合先验证中文基础检索；后续再用题库样例评测专用分词。
        await self._request("PUT", f"/{self.index}", json={"mappings": {
            "dynamic": "strict", "properties": {
                "question_id": {"type": "keyword"}, "source_version": {"type": "keyword"},
                "title": {"type": "text", "analyzer": "cjk"},
                "text": {"type": "text", "analyzer": "cjk"},
                "enabled": {"type": "boolean"},
                "embedding": {"type": "dense_vector", "dims": self.dimensions},
            }}})

    async def upsert(self, *, document_id: str, question_id: str, source_version: str,
                     title: str, text: str, embedding: list[float] | None = None, enabled: bool = True):
        """同一文档 ID 覆盖写入，便于题库同步重试；不承担 Embedding 生成。"""
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", document_id):
            raise ValueError("Invalid knowledge document identifier")
        if not all(isinstance(value, str) and value.strip()
                   for value in (question_id, source_version, title, text)):
            raise ValueError("Knowledge document metadata is required")
        document = {
            "question_id": question_id, "source_version": source_version, "title": title,
            "text": text, "enabled": enabled}
        if embedding is not None:
            document["embedding"] = self._vector(embedding)
        await self._request("PUT", f"/{self.index}/_doc/{document_id}", json=document)

    async def existing(self, document_ids):
        """只读取缓存存在性和向量状态，不将整份参考答案带回调用方。"""
        data = await self._request("POST", f"/{self.index}/_mget", json={
            "ids": document_ids}, params={"_source": "embedding"})
        try:
            return {doc["_id"]: bool(doc.get("_source", {}).get("embedding"))
                    for doc in data["docs"] if doc.get("found")}
        except (KeyError, TypeError):
            raise KnowledgeSearchError("Invalid Elasticsearch cache response") from None

    async def refresh(self):
        """快照同步后显式刷新，使首轮出题立即可检索，不依赖固定等待。"""
        await self._request("POST", f"/{self.index}/_refresh")

    @staticmethod
    def _filters(document_ids):
        filters = [{"term": {"enabled": True}}]
        if document_ids is not None:
            filters.append({"ids": {"values": document_ids}})
        return filters

    @staticmethod
    def _limit(top_k):
        if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= 100:
            raise ValueError("top_k must be between 1 and 100")

    async def _search(self, query, top_k):
        self._limit(top_k)
        data = await self._request("POST", f"/{self.index}/_search", json={
            "size": top_k, "query": query, "_source": {"excludes": ["embedding"]}})
        # 超时或分片失败不应伪装成正常的空召回或完整结果。
        if data.get("timed_out") or data.get("_shards", {}).get("failed", 0):
            raise KnowledgeSearchError("Elasticsearch returned incomplete search results")
        try:
            return [KnowledgeHit(hit["_id"], hit["_source"]["question_id"],
                                 hit["_source"]["source_version"], hit["_source"]["title"],
                                 hit["_source"]["text"], float(hit["_score"]))
                    for hit in data["hits"]["hits"]]
        except (KeyError, TypeError, ValueError):
            raise KnowledgeSearchError("Invalid Elasticsearch knowledge response") from None

    async def bm25(self, query: str, *, top_k: int = 10, document_ids=None):
        """全文字段默认 BM25；标题权重高于正文，禁用文档不参与召回。"""
        if not isinstance(query, str) or not query.strip():
            raise ValueError("Search query must be nonblank text")
        return await self._search({"bool": {
            "filter": self._filters(document_ids), "must": [{"multi_match": {
                "query": query, "fields": ["title^4", "text"]}}]}}, top_k)

    async def vector(self, embedding: list[float], *, top_k: int = 10, document_ids=None):
        """7.17 使用精确脚本评分；成本随候选量增长，不能承诺近似 kNN 性能。"""
        return await self._search({"script_score": {
            "query": {"bool": {"filter": [*self._filters(document_ids),
                                              {"exists": {"field": "embedding"}}]}},
            "script": {"source": "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
                       "params": {"query_vector": self._vector(embedding)}}}}, top_k)

    async def hybrid(self, query: str, embedding: list[float], *, top_k: int = 5, document_ids=None):
        """关键词和向量独立召回，向量未召回的关键词结果仍可进入最终候选。"""
        self._limit(top_k)
        candidates = min(top_k * 4, 100)
        lexical, semantic = await asyncio.gather(
            self.bm25(query, top_k=candidates, document_ids=document_ids),
            self.vector(embedding, top_k=candidates, document_ids=document_ids))
        return reciprocal_rank_fusion(lexical, semantic, top_k=top_k)
