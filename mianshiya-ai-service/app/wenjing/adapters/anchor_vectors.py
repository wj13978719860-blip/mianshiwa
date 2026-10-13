"""候选人锚点向量存 ES，替代上游 pgvector 的 ``embedding`` 列。

MySQL 的 ``session_anchor_chunks`` / ``resume_anchor_cache_chunks`` 仍是锚点元数据的
唯一来源；ES 文档以 MySQL 行 id 为键，只存向量和过滤字段。业务代码继续读写
``row.embedding``：

- 插入：flush 后把本次新增行的向量批量写入 ES，失败则 flush 失败、事务回滚；
  事务最终回滚时删除本事务已写入的文档，避免行 id 复用后读到旧向量。
- 读取：首次访问时对同一 Session 中缺向量的同类行做一次 mget。
- 删除：实例删除和 ORM 批量 ``delete()`` 都在事务提交后删除对应 ES 文档。

未配置 ES 时（单测、本地 SQLite）向量按 Engine 存在进程内存里，语义等同上游把向量
存在同库列中；prod 启动时强制要求 ES（见 ``require_anchor_store``）。
"""
from __future__ import annotations

import threading
import weakref
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import ORMExecuteState, Session, object_session

from app.wenjing.adapters.es_client import ElasticsearchError, get_es_client, index_name, valid_vector
from app.wenjing.core.logging import get_logger
from app.wenjing.core.settings import get_settings

log = get_logger(__name__)

_VALUE_KEY = "_es_embedding"
_PENDING_WRITES = "_es_anchor_writes"
_PENDING_DELETES = "_es_anchor_deletes"
_WRITTEN = "_es_anchor_written"
_KIND_BY_CLASS: dict[type, str] = {}
_registered = threading.Lock()
_session_events_installed = False
_memory: weakref.WeakKeyDictionary[Engine, dict[str, list[float]]] = weakref.WeakKeyDictionary()
_memory_lock = threading.Lock()


def require_anchor_store() -> None:
    if get_es_client() is None:
        raise RuntimeError("elasticsearch_url is required for anchor vectors outside dev/test")


def _memory_store(bind: Any) -> dict[str, list[float]] | None:
    engine = getattr(bind, "engine", bind)
    if not isinstance(engine, Engine):
        return None
    with _memory_lock:
        return _memory.setdefault(engine, {})


def _session_memory(session: Session | None) -> dict[str, list[float]] | None:
    if session is None:
        return None
    try:
        return _memory_store(session.get_bind())
    except Exception:  # noqa: BLE001
        return None


def anchor_index() -> str:
    settings = get_settings()
    prefix = str(getattr(settings, "es_anchor_index_prefix", "") or "mianshiwa-ai-wenjing-anchors")
    return index_name(prefix, int(getattr(settings, "resume_rag_embedding_dimension", 1536) or 1536))


def _properties() -> dict[str, Any]:
    dims = int(get_settings().resume_rag_embedding_dimension or 1536)
    return {
        "kind": {"type": "keyword"},
        "row_id": {"type": "long"},
        "session_id": {"type": "keyword"},
        "cache_key": {"type": "keyword"},
        "source_type": {"type": "keyword"},
        "source_revision_id": {"type": "keyword"},
        "embedding_model_version": {"type": "keyword"},
        "expires_at": {"type": "date"},
        "embedding": {"type": "dense_vector", "dims": dims},
    }


def _client():
    client = get_es_client()
    if client is not None:
        client.ensure_index(anchor_index(), _properties())
    return client


def _doc_id(kind: str, row_id: Any) -> str:
    return f"{kind}-{int(row_id)}"


class EsVectorAttribute:
    """非映射属性：值缓存在实例上，缺失时从 ES 批量补齐。"""

    def __get__(self, obj, owner=None):  # noqa: ANN001
        if obj is None:
            return self
        if _VALUE_KEY not in obj.__dict__:
            _hydrate(obj)
        return obj.__dict__.get(_VALUE_KEY)

    def __set__(self, obj, value) -> None:  # noqa: ANN001
        obj.__dict__[_VALUE_KEY] = list(value) if value is not None else None


def _hydrate(obj: Any) -> None:
    cls = type(obj)
    kind = _KIND_BY_CLASS[cls]
    session = object_session(obj)
    candidates = [obj]
    if session is not None:
        candidates = [
            item
            for item in session.identity_map.values()
            if type(item) is cls and _VALUE_KEY not in item.__dict__
        ] or [obj]
    with_ids = [item for item in candidates if getattr(item, "id", None) is not None]
    for item in candidates:
        item.__dict__[_VALUE_KEY] = None
    if not with_ids:
        return
    if get_es_client() is None:
        store = _session_memory(session) or {}
        for item in with_ids:
            vector = store.get(_doc_id(kind, item.id))
            item.__dict__[_VALUE_KEY] = list(vector) if vector is not None else None
        return
    try:
        client = _client()
        if client is None:
            return
        docs = client.mget(anchor_index(), [_doc_id(kind, item.id) for item in with_ids], source=["embedding"])
    except (ElasticsearchError, ValueError) as e:
        log.warning("anchor vectors unavailable from elasticsearch: %s", e)
        return
    for item in with_ids:
        source = docs.get(_doc_id(kind, item.id))
        if source and isinstance(source.get("embedding"), list):
            item.__dict__[_VALUE_KEY] = [float(v) for v in source["embedding"]]


def _iso(value: Any) -> str | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _document(kind: str, target: Any, vector: list[float]) -> dict[str, Any]:
    return {
        "kind": kind,
        "row_id": int(target.id),
        "session_id": getattr(target, "session_id", None),
        "cache_key": getattr(target, "cache_key", None),
        "source_type": getattr(target, "source_type", None),
        "source_revision_id": getattr(target, "source_revision_id", None),
        "embedding_model_version": target.embedding_model_version,
        "expires_at": _iso(getattr(target, "expires_at", None)),
        "embedding": vector,
    }


def _after_insert(mapper, connection, target) -> None:  # noqa: ANN001
    vector = target.__dict__.get(_VALUE_KEY)
    session = object_session(target)
    if vector is None or session is None:
        return
    kind = _KIND_BY_CLASS[type(target)]
    if get_es_client() is None:
        store = _memory_store(connection)
        if store is not None:
            store[_doc_id(kind, target.id)] = list(vector)
        return
    dims = int(get_settings().resume_rag_embedding_dimension or 1536)
    checked = valid_vector(vector, dims)
    if checked is None:
        raise ValueError(f"anchor embedding must be a non-zero {dims}-dim finite vector")
    session.info.setdefault(_PENDING_WRITES, []).append((_doc_id(kind, target.id), _document(kind, target, checked)))


def _after_delete(mapper, connection, target) -> None:  # noqa: ANN001
    session = object_session(target)
    if session is not None and target.id is not None:
        kind = _KIND_BY_CLASS[type(target)]
        session.info.setdefault(_PENDING_DELETES, set()).add(_doc_id(kind, target.id))


def _after_flush_postexec(session: Session, flush_context) -> None:  # noqa: ANN001
    writes = session.info.pop(_PENDING_WRITES, None)
    if not writes:
        return
    client = _client()
    if client is not None:
        client.bulk_index(anchor_index(), writes)
        session.info.setdefault(_WRITTEN, set()).update(doc_id for doc_id, _ in writes)


def _do_orm_execute(state: ORMExecuteState) -> None:
    if not state.is_delete or state.bind_mapper is None:
        return
    cls = state.bind_mapper.class_
    kind = _KIND_BY_CLASS.get(cls)
    if kind is None:
        return
    query = select(cls.id)
    if state.statement.whereclause is not None:
        query = query.where(state.statement.whereclause)
    ids = state.session.execute(query).scalars().all()
    if ids:
        state.session.info.setdefault(_PENDING_DELETES, set()).update(_doc_id(kind, i) for i in ids)


def _after_commit(session: Session) -> None:
    session.info.pop(_WRITTEN, None)
    deletes = session.info.pop(_PENDING_DELETES, None)
    if not deletes:
        return
    if get_es_client() is None:
        store = _session_memory(session)
        for doc_id in deletes:
            if store is not None:
                store.pop(doc_id, None)
        return
    try:
        client = _client()
        if client is not None:
            client.delete_ids(anchor_index(), sorted(deletes))
    except (ElasticsearchError, ValueError) as e:
        # MySQL 行已删除，检索只按 MySQL 行取向量；残留文档由过期清理兜底。
        log.warning("anchor vector delete failed: %s", e)


def _after_transaction_end(session: Session, transaction) -> None:  # noqa: ANN001
    # 提交时 after_commit 已取走待删项；最外层事务结束仍有残留说明已回滚。
    if transaction.parent is not None or transaction.nested:
        return
    session.info.pop(_PENDING_WRITES, None)
    session.info.pop(_PENDING_DELETES, None)
    orphans = session.info.pop(_WRITTEN, None)
    if not orphans:
        return
    try:
        client = _client()
        if client is not None:
            client.delete_ids(anchor_index(), sorted(orphans))
    except (ElasticsearchError, ValueError) as e:
        log.warning("anchor vector rollback cleanup failed: %s", e)


def purge_expired_anchor_vectors(now: datetime | None = None) -> None:
    client = _client()
    if client is None:
        return
    cutoff = _iso(now or datetime.now(UTC))
    client.delete_by_query(anchor_index(), {"range": {"expires_at": {"lt": cutoff}}})


def register_anchor_model(cls: type, kind: str) -> None:
    """为锚点模型挂上 ES 向量属性和同步事件。"""
    global _session_events_installed
    with _registered:
        _KIND_BY_CLASS[cls] = kind
        event.listen(cls, "after_insert", _after_insert)
        event.listen(cls, "after_delete", _after_delete)
        if not _session_events_installed:
            event.listen(Session, "after_flush_postexec", _after_flush_postexec)
            event.listen(Session, "do_orm_execute", _do_orm_execute)
            event.listen(Session, "after_commit", _after_commit)
            event.listen(Session, "after_transaction_end", _after_transaction_end)
            _session_events_installed = True
