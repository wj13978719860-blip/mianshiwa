"""检索边界测试：验证独立召回、向量校验、隔离及错误传播。"""
import asyncio
import json

import httpx
import pytest

from app.knowledge.elasticsearch import (
    ElasticsearchKnowledgeStore, KnowledgeHit, KnowledgeSearchError, reciprocal_rank_fusion,
)


def test_rrf_retains_independent_keyword_match():
    """向量没召回的关键词文档仍进入融合结果，不限于向量候选集。"""
    keyword = KnowledgeHit("keyword", "1", "v1", "Redis", "关键词结果", 100)
    semantic = KnowledgeHit("semantic", "2", "v1", "缓存", "语义结果", 0.8)
    result = reciprocal_rank_fusion([keyword], [semantic], top_k=2)
    assert {hit.document_id for hit in result} == {"keyword", "semantic"}


@pytest.mark.parametrize("vector", [[1], [0, 0], [float("nan"), 1], [float("inf"), 1], [True, 1]])
def test_invalid_vectors_rejected_before_network(vector):
    async def run():
        async with httpx.AsyncClient(base_url="http://test", transport=httpx.MockTransport(
                lambda request: pytest.fail("Invalid vectors must not reach Elasticsearch"))) as client:
            store = ElasticsearchKnowledgeStore(client, index="mianshiwa-ai-test", dimensions=2)
            with pytest.raises(ValueError):
                await store.vector(vector)
    asyncio.run(run())


@pytest.mark.parametrize("index", ["question", "mianshiwa-ai-*", "../question", "_all"])
def test_business_index_and_wildcards_rejected(index):
    async def run():
        async with httpx.AsyncClient() as client:
            with pytest.raises(ValueError):
                ElasticsearchKnowledgeStore(client, index=index, dimensions=2)
    asyncio.run(run())


def test_hybrid_requests_two_independent_searches():
    queries = []
    def handler(request):
        query = json.loads(request.content)["query"]
        queries.append(query)
        doc_id = "vector" if "script_score" in query else "keyword"
        return httpx.Response(200, json={"timed_out": False, "_shards": {"failed": 0},
            "hits": {"hits": [{"_id": doc_id, "_score": 1, "_source": {
                "question_id": doc_id, "source_version": "v1", "title": "title", "text": "text"}}]}})
    async def run():
        async with httpx.AsyncClient(base_url="http://test", transport=httpx.MockTransport(handler)) as client:
            result = await ElasticsearchKnowledgeStore(
                client, index="mianshiwa-ai-test", dimensions=2).hybrid("线程池", [1, 0], top_k=2)
            assert {hit.document_id for hit in result} == {"vector", "keyword"}
    asyncio.run(run())
    assert len(queries) == 2


@pytest.mark.parametrize("body", [{"timed_out": True}, {"_shards": {"failed": 1}},
                                 {"hits": {"hits": [{"bad": "shape"}]}}])
def test_partial_or_invalid_results_fail_explicitly(body):
    async def run():
        async with httpx.AsyncClient(base_url="http://test", transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=body))) as client:
            with pytest.raises(KnowledgeSearchError):
                await ElasticsearchKnowledgeStore(
                    client, index="mianshiwa-ai-test", dimensions=2).bm25("Redis")
    asyncio.run(run())


def test_index_dimension_conflict_does_not_overwrite():
    async def run():
        def handler(request):
            assert request.method == "GET"
            return httpx.Response(200, json={"mianshiwa-ai-test": {
                "mappings": {"properties": {"embedding": {"type": "dense_vector", "dims": 3}}}}})
        async with httpx.AsyncClient(base_url="http://test", transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(KnowledgeSearchError):
                await ElasticsearchKnowledgeStore(
                    client, index="mianshiwa-ai-test", dimensions=2).initialize()
    asyncio.run(run())
