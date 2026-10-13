"""真实 ES 7.17 验证；测试向量只验证接口，不代表真实语义检索质量。"""
import asyncio
import os
from uuid import uuid4

import httpx
import pytest

from app.knowledge.elasticsearch import ElasticsearchKnowledgeStore

pytestmark = pytest.mark.skipif(os.getenv("AI_ES_INTEGRATION") != "true",
                                reason="Real Elasticsearch integration is explicitly opt-in")


def test_bm25_vector_and_hybrid_on_real_es():
    async def run():
        # 每次使用新建且可识别的测试索引，清理只针对该索引，不使用通配符。
        index = "mianshiwa-ai-probe-" + uuid4().hex
        async with httpx.AsyncClient(base_url=os.getenv("AI_ES_URL", "http://127.0.0.1:9201"),
                                     timeout=10, trust_env=False) as client:
            created = False
            try:
                info = await client.get("/")
                info.raise_for_status()
                assert info.json()["version"]["number"].startswith("7.17.")
                store = ElasticsearchKnowledgeStore(client, index=index, dimensions=3)
                await store.initialize()
                created = True
                await store.initialize()  # 再次初始化不覆盖已有数据。
                fixtures = [
                    ("pool", "线程池", "线程池复用线程并控制并发。", [1, 0, 0], True),
                    ("redis", "Redis 缓存", "Redis 支持缓存和过期策略。", [0, 1, 0], True),
                    ("transaction", "数据库事务", "事务支持隔离性。", [0, 0, 1], True),
                    ("disabled", "线程池", "禁用题不可召回。", [1, 0, 0], False),
                ]
                for doc_id, title, text, vector, enabled in fixtures:
                    await store.upsert(document_id=doc_id, question_id=doc_id,
                                       source_version="fixture-v1", title=title, text=text,
                                       embedding=vector, enabled=enabled)
                cache = await store.existing(['pool', 'missing'])
                assert cache == {'pool': True}
                refresh = await client.post(f"/{index}/_refresh")
                refresh.raise_for_status()
                assert {h.document_id for h in await store.hybrid('线程池', [0, 1, 0], top_k=3, document_ids=['pool'])} == {'pool'}
                assert (await store.bm25("线程池", top_k=1))[0].document_id == "pool"
                assert (await store.vector([0, 1, 0], top_k=1))[0].document_id == "redis"
                hybrid = await store.hybrid("线程池", [0, 1, 0], top_k=3)
                assert {"pool", "redis"} <= {hit.document_id for hit in hybrid}
                assert "disabled" not in {hit.document_id for hit in hybrid}
                assert all(hit.source_version == "fixture-v1" for hit in hybrid)
            finally:
                if created:
                    cleanup = await client.delete(f"/{index}")
                    cleanup.raise_for_status()
    asyncio.run(run())
