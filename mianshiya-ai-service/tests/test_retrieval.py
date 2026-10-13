"""检索接入测试：验证供应商协议、快照隔离及错向量显式失败。"""
import asyncio
import json

import httpx
import pytest

from app.knowledge.retrieval import EmbeddingGateway, InterviewRetriever, RetrievalSettings
from app.model import ModelFailure


def test_embedding_reorders_indices_and_requests_dimensions():
    def handler(request):
        body = json.loads(request.content)
        assert body == {"model": "text-embedding-v3", "input": ["Java", "MySQL"], "dimensions": 2, "encoding_format": "float"}
        return httpx.Response(200, json={"data": [
            {"index": 1, "embedding": [0, 1]}, {"index": 0, "embedding": [1, 0]}]})
    async def run():
        gateway = EmbeddingGateway(RetrievalSettings(dimensions=2, api_key="test"), httpx.MockTransport(handler))
        try:
            assert await gateway.embed(["Java", "MySQL"]) == [[1, 0], [0, 1]]
        finally:
            await gateway.close()
    asyncio.run(run())


@pytest.mark.parametrize("data", [
    [{"index": 0, "embedding": [1]}], [{"index": 0, "embedding": [0, 0]}],
    [{"index": 0, "embedding": [True, 1]}], [{"index": 1, "embedding": [1, 0]}],
    [{"index": 0, "embedding": [1, 0]}, {"index": 0, "embedding": [0, 1]}]])
def test_invalid_provider_vectors_fail(data):
    async def run():
        gateway = EmbeddingGateway(RetrievalSettings(dimensions=2, api_key="test"),
            httpx.MockTransport(lambda _: httpx.Response(200, json={"data": data})))
        try:
            with pytest.raises(ModelFailure, match="EMBEDDING_PROTOCOL_ERROR"):
                await gateway.embed(["Java"])
        finally:
            await gateway.close()
    asyncio.run(run())


def test_session_snapshot_filter_and_cache_upgrade():
    """已有BM25快照升级向量；两个召回均只允许本场未使用的文档。"""
    question = {"id": "1", "sourceVersion": "v1", "title": "索引", "content": "MySQL索引", "referenceAnswer": "B+树"}
    writes, filters, embeddings = [], [], []
    config = RetrievalSettings(mode="hybrid", dimensions=2, api_key="test")
    async def run():
        def embedding_handler(request):
            inputs = json.loads(request.content)["input"]
            embeddings.extend(inputs)
            return httpx.Response(200, json={"data": [{"index": i, "embedding": [1, 0]} for i in range(len(inputs))]})
        def es_handler(request):
            path = request.url.path
            if path.endswith("_mapping"):
                return httpx.Response(200, json={config.index: {"mappings": {"properties": {
                    "embedding": {"type": "dense_vector", "dims": 2}}}}})
            if path.endswith("_mget"):
                assert request.url.params["_source"] == "embedding"
                assert set(json.loads(request.content)) == {"ids"}
                return httpx.Response(200, json={"docs": [{"_id": key, "found": True, "_source": {}}]})
            if "/_doc/" in path:
                writes.append(json.loads(request.content))
                return httpx.Response(200, json={"result": "updated"})
            if path.endswith("_refresh"):
                return httpx.Response(200, json={})
            query = json.loads(request.content)["query"]
            filters.append(query.get("script_score", {}).get("query", query)["bool"]["filter"])
            return httpx.Response(200, json={"hits": {"hits": [{"_id": key, "_score": 1,
                "_source": {"question_id": "1", "source_version": "v1", "title": "索引", "text": "B+树"}}]}})
        retriever = InterviewRetriever(config, es_transport=httpx.MockTransport(es_handler),
            embedding_transport=httpx.MockTransport(embedding_handler))
        key = retriever.document_id(question)
        assert key != retriever.document_id({**question, "referenceAnswer": "新版答案"})
        try:
            pool, trace = await retriever.retrieve([question], "MySQL", [])
            assert pool == [question] and trace["mode"] == "hybrid"
            assert trace["hits"][0]["sourceVersion"] == "v1"
        finally:
            await retriever.close()
        assert len(filters) == 2
        assert all({"ids": {"values": [key]}} in f for f in filters)
        assert writes[0]["embedding"] == [1, 0]
        assert len(embeddings) == 2
    asyncio.run(run())


def test_hybrid_without_key_rejected(monkeypatch):
    monkeypatch.setenv("AI_RETRIEVAL_MODE", "hybrid")
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="EMBEDDING_API_KEY"):
        RetrievalSettings.from_env()
