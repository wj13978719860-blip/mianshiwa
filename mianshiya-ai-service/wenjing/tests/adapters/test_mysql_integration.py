from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from sqlalchemy import inspect, select, text

from app.wenjing.adapters import mysql as mysql_adapter
from app.wenjing.core import settings as settings_module
from app.wenjing.models import base
from tests.adapters._support import TEST_DATABASE, mysql_integration

pytestmark = mysql_integration


@pytest.fixture()
def mysql_engine(monkeypatch):
    monkeypatch.setenv("WENJING_MYSQL_DATABASE", TEST_DATABASE)
    config = mysql_adapter.MysqlConfig.from_env()
    assert config is not None, "AI_MYSQL_USER is required"
    monkeypatch.setenv("DATABASE_URL", config.url())
    settings_module.get_settings.cache_clear()
    monkeypatch.setattr(base, "_engine", None)
    engine = base.get_engine()
    assert engine.dialect.name == "mysql"
    _drop_all(engine)
    try:
        yield engine
    finally:
        _drop_all(engine)
        engine.dispose()
        settings_module.get_settings.cache_clear()


def _drop_all(engine) -> None:  # noqa: ANN001
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for name in inspect(conn).get_table_names():
            conn.execute(text(f"DROP TABLE `{name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))


def test_init_db_creates_all_upstream_tables_idempotently(mysql_engine) -> None:
    base.init_db()
    base.init_db()

    tables = set(inspect(mysql_engine).get_table_names())
    assert set(base.Base.metadata.tables) <= tables
    assert {"session_anchor_chunks", "resume_anchor_cache_chunks"} <= tables
    with mysql_engine.connect() as conn:
        collations = dict(
            conn.execute(
                text(
                    "SELECT table_name, table_collation FROM information_schema.tables "
                    "WHERE table_schema = DATABASE()"
                )
            ).all()
        )
    assert {collations[name] for name in base.Base.metadata.tables} == {"utf8mb4_bin"}


def test_upgrade_schema_adds_missing_columns(mysql_engine) -> None:
    base.init_db()
    with mysql_engine.begin() as conn:
        conn.execute(text("ALTER TABLE interview_sessions DROP COLUMN setup_snapshot"))
        conn.execute(text("ALTER TABLE question_variants DROP COLUMN reviewed_acceptance_checks"))

    base.init_db()

    columns = {c["name"] for c in inspect(mysql_engine).get_columns("interview_sessions")}
    assert "setup_snapshot" in columns
    variants = {c["name"] for c in inspect(mysql_engine).get_columns("question_variants")}
    assert "reviewed_acceptance_checks" in variants


def test_datetime_float_and_case_sensitive_semantics(mysql_engine) -> None:
    from app.wenjing.models.interview_session import InterviewSession
    from app.wenjing.models.outcome_record import OutcomeRecord

    base.init_db()
    claimed = datetime(2026, 10, 13, 20, 30, 15, 123456, tzinfo=timezone(timedelta(hours=8)))
    with base.get_session() as db:
        db.add(InterviewSession(session_id="Sess_A", trace_id="t1", owner_claimed_at=claimed))
        db.add(InterviewSession(session_id="sess_a", trace_id="t2"))
    with base.get_session() as db:
        row = db.get(InterviewSession, "Sess_A")
        assert row.owner_claimed_at == claimed
        assert row.owner_claimed_at.tzinfo is not None
        assert row.created_at.tzinfo is not None
        found = db.scalars(select(InterviewSession.trace_id).where(InterviewSession.session_id == "sess_a")).all()
        assert found == ["t2"]

    columns = {c["name"]: c for c in inspect(mysql_engine).get_columns(OutcomeRecord.__tablename__)}
    assert columns["helpful_score"]["type"].__class__.__name__ == "DOUBLE"


def test_anchor_rows_round_trip_on_mysql(mysql_engine, monkeypatch) -> None:
    from app.wenjing.adapters import es_client
    from app.wenjing.models.session_anchor import SessionAnchorChunk

    monkeypatch.setattr(es_client, "get_es_client", lambda: None)
    monkeypatch.setattr("app.wenjing.adapters.anchor_vectors.get_es_client", lambda: None)
    base.init_db()
    with base.get_session() as db:
        db.add(
            SessionAnchorChunk(
                session_id="sess_a",
                source_type="resume",
                source_revision_id="rev_1",
                chunk_index=0,
                tier="highlight",
                text="Redis Lua",
                chunker_mode="A",
                embedding_model_version="m@v1",
                embedding=[0.5, 0.5],
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
    with base.get_session() as db:
        row = db.scalars(select(SessionAnchorChunk)).one()
        assert row.embedding == [0.5, 0.5]
        assert row.expires_at.tzinfo is not None


def test_resume_artifact_is_consumed_once_on_mysql(mysql_engine) -> None:
    from app.wenjing.services.resume_parse_artifacts import (
        consume_resume_parse_artifact,
        create_resume_parse_artifact,
    )

    base.init_db()
    artifact = create_resume_parse_artifact(text="Java Redis", parsed={"skills": ["Java"]}, filename="r.txt")
    assert artifact is not None

    first = consume_resume_parse_artifact(artifact.artifact_id)
    second = consume_resume_parse_artifact(artifact.artifact_id)

    assert first is not None and first.parsed == {"skills": ["Java"]}
    assert first.consumed_at is not None
    assert second is None


def test_mysql_saver_round_trip(monkeypatch) -> None:
    from langgraph.checkpoint.base import empty_checkpoint

    monkeypatch.setenv("WENJING_MYSQL_DATABASE", TEST_DATABASE)
    mysql_adapter.reset_mysql_saver()
    saver = mysql_adapter.mysql_saver()
    try:
        config = {"configurable": {"thread_id": "wenjing-it", "checkpoint_ns": ""}}
        checkpoint = empty_checkpoint()
        stored = saver.put(config, checkpoint, {"source": "input", "step": 0}, {})
        got = saver.get_tuple(stored)
        assert got is not None
        assert got.checkpoint["id"] == checkpoint["id"]
        saver.delete_thread("wenjing-it")
        assert saver.get_tuple(config) is None
    finally:
        mysql_adapter.reset_mysql_saver()
