from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.wenjing.adapters import anchor_vectors, es_client
from app.wenjing.core import settings as settings_module
from app.wenjing.engine.rag import vectorstore
from app.wenjing.models.session_anchor import SessionAnchorChunk
from tests.adapters._support import es_integration

pytestmark = es_integration

DIMS = 8
KB_PREFIX = "mianshiwa-ai-wenjing-it-kb"
ANCHOR_PREFIX = "mianshiwa-ai-wenjing-it-anchors"


@pytest.fixture()
def es(monkeypatch):
    url = os.environ.get("AI_ES_URL", "")
    assert url, "AI_ES_URL is required"
    monkeypatch.setenv("ELASTICSEARCH_URL", url)
    monkeypatch.setenv("ES_KNOWLEDGE_INDEX_PREFIX", KB_PREFIX)
    monkeypatch.setenv("ES_ANCHOR_INDEX_PREFIX", ANCHOR_PREFIX)
    monkeypatch.setenv("EMBEDDING_PROVIDER", "stub")
    monkeypatch.setenv("RESUME_RAG_EMBEDDING_DIMENSION", str(DIMS))
    settings_module.get_settings.cache_clear()
    es_client.reset_es_client()
    monkeypatch.setattr(vectorstore, "_singleton", None)
    client = es_client.get_es_client()
    _drop_indices(client)
    try:
        yield client
    finally:
        _drop_indices(client)
        es_client.reset_es_client()
        settings_module.get_settings.cache_clear()


def _drop_indices(client) -> None:  # noqa: ANN001
    client.request("DELETE", "/mianshiwa-ai-wenjing-it-*", ok=(200, 404))
    client._ready.clear()


def _vec(*head: float) -> list[float]:
    return [*head, *([0.0] * (DIMS - len(head)))]


def _db():
    engine = create_engine(
        "sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SessionAnchorChunk.__table__.create(engine)
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def _chunk(**overrides) -> SessionAnchorChunk:
    data = {
        "session_id": "sess_a",
        "source_type": "resume",
        "source_revision_id": "rev_1",
        "chunk_index": 0,
        "tier": "highlight",
        "text": "Redis Lua",
        "chunker_mode": "A",
        "embedding_model_version": "m@v1",
        "embedding": _vec(1.0),
        "expires_at": datetime.now(UTC) + timedelta(hours=1),
    }
    data.update(overrides)
    return SessionAnchorChunk(**data)


def _anchor_ids(client) -> set[str]:  # noqa: ANN001
    hits = client.search(anchor_vectors.anchor_index(), {"size": 100, "_source": False})
    return {hit["_id"] for hit in hits}


def test_knowledge_store_writes_and_searches_es(es) -> None:
    store = vectorstore.get_vectorstore()
    assert isinstance(store, vectorstore.ElasticsearchVectorStore)
    assert store.is_remote

    store.add(
        ["Redis 分布式锁 SETNX 过期时间", "MySQL 索引 B+ 树 回表"],
        [{"source": "redis.md"}, {"source": "mysql.md"}],
    )
    store.add(["Redis 分布式锁 SETNX 过期时间"], [{"source": "redis.md"}])

    assert store.count() == 2
    hits = store.similarity_search("Redis 分布式锁", k=2)
    assert hits[0].metadata["source"] == "redis.md"
    assert -1.0 <= hits[-1].score <= hits[0].score <= 1.0
    assert not store.is_degraded


def test_seed_kb_ingests_into_es(es, tmp_path) -> None:
    from app.wenjing.engine.rag.ingestion import _iter_documents, ingest_folder

    upstream = settings_module.get_settings().knowledge_dir
    assert ingest_folder(upstream) == len(_iter_documents(upstream))

    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "cache.md").write_text("Redis cache breakdown mutex", encoding="utf-8")
    (tmp_path / "notes" / "zh.md").write_text("缓存击穿 互斥锁 逻辑过期", encoding="utf-8")
    assert ingest_folder(tmp_path) == 2
    store = vectorstore.get_vectorstore()
    assert store.count() == 2
    assert store.similarity_search("Redis mutex", k=2)[0].metadata["source"] == "notes/cache.md"
    assert store.similarity_search("缓存击穿", k=1) == []
    assert not store.is_degraded


def test_anchor_vectors_round_trip_through_es(es) -> None:
    session_local = _db()
    with session_local() as db:
        db.add(_chunk(embedding=_vec(0.6, 0.8)))
        db.add(_chunk(chunk_index=1, embedding=_vec(1.0)))
        db.commit()

    assert _anchor_ids(es) == {"session-1", "session-2"}
    with session_local() as db:
        rows = db.scalars(select(SessionAnchorChunk).order_by(SessionAnchorChunk.id)).all()
        assert [row.embedding for row in rows] == [_vec(0.6, 0.8), _vec(1.0)]


def test_upstream_retriever_scores_anchors_hydrated_from_es(es, monkeypatch) -> None:
    from app.wenjing.services.resume_embedding import current_embedding_model_version
    from app.wenjing.services.session_anchor_retriever import retrieve_candidate_anchors

    monkeypatch.setattr(
        "app.wenjing.services.session_anchor_retriever.embed_query", lambda *_a, **_k: _vec(1.0)
    )
    version = current_embedding_model_version()
    session_local = _db()
    with session_local() as db:
        db.add(_chunk(text="sess_a Redis Lua coupon guard", embedding_model_version=version,
                      tech_keywords=["Redis"], dimensions_hint=["system_design"]))
        db.add(_chunk(session_id="sess_b", text="sess_b forbidden", embedding_model_version=version))
        db.commit()

    with session_local() as db:
        result = retrieve_candidate_anchors(
            session_id="sess_a",
            resume_revision_id="rev_1",
            self_intro_revision_id=None,
            dimension="system_design",
            seed={"scenario_brief": "Redis Lua consistency"},
            target_skills=["Redis"],
            rule_anchor=None,
            self_intro_profile={},
            db_session=db,
        )

    assert "sess_a Redis Lua coupon guard" in result.resume_block
    assert "forbidden" not in result.resume_block


def test_anchor_bulk_delete_and_rollback_clean_es(es) -> None:
    session_local = _db()
    with session_local() as db:
        db.add(_chunk())
        db.add(_chunk(session_id="sess_b"))
        db.commit()
    with session_local() as db:
        db.execute(delete(SessionAnchorChunk).where(SessionAnchorChunk.session_id == "sess_a"))
        db.commit()
    assert _anchor_ids(es) == {"session-2"}

    with session_local() as db:
        db.add(_chunk(session_id="sess_c"))
        db.flush()
        assert "session-3" in _anchor_ids(es)
        db.rollback()
    assert _anchor_ids(es) == {"session-2"}


def test_anchor_insert_rejects_wrong_dimension(es) -> None:
    session_local = _db()
    with session_local() as db:
        db.add(_chunk(embedding=[1.0, 0.0]))
        with pytest.raises(ValueError):
            db.flush()


def test_purge_expired_anchor_vectors(es) -> None:
    session_local = _db()
    with session_local() as db:
        db.add(_chunk(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        db.add(_chunk(chunk_index=1))
        db.commit()

    anchor_vectors.purge_expired_anchor_vectors()

    assert _anchor_ids(es) == {"session-2"}
