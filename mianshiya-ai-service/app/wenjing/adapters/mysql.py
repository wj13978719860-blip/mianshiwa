"""MySQL 方言适配：替代上游的 PostgreSQL ORM 与 PostgresSaver。

上游模型使用通用 SQLAlchemy 类型，在 PostgreSQL 上有三处语义需要在 MySQL 上补齐：
``DateTime(timezone=True)`` 保留时区和微秒、``Float`` 为双精度、字符串比较区分大小写。
这里在方言层统一处理，不改动业务模型。
"""
from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote_plus

import pymysql
from sqlalchemy import Table
from sqlalchemy import types as sqltypes
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.dialects.mysql.base import MySQLDialect
from sqlalchemy.dialects.mysql.pymysql import MySQLDialect_pymysql
from sqlalchemy.ext.compiler import compiles

_DATABASE_RE = re.compile(r"mianshiwa_ai_[a-z0-9_]+")


class UtcDateTime(DATETIME):
    """aware datetime 统一按 UTC 存成 DATETIME(6)，读回时恢复 UTC 时区。"""

    def __init__(self, timezone: bool = False, fsp: int | None = None):
        super().__init__(timezone=timezone, fsp=6 if fsp is None else fsp)

    def bind_processor(self, dialect):  # noqa: ANN001
        parent = super().bind_processor(dialect)

        def process(value):  # noqa: ANN001
            if isinstance(value, datetime) and value.tzinfo is not None:
                value = value.astimezone(UTC).replace(tzinfo=None)
            return parent(value) if parent else value

        return process

    def result_processor(self, dialect, coltype):  # noqa: ANN001
        parent = super().result_processor(dialect, coltype)
        aware = bool(self.timezone)

        def process(value):  # noqa: ANN001
            if parent:
                value = parent(value)
            if aware and isinstance(value, datetime) and value.tzinfo is None:
                value = value.replace(tzinfo=UTC)
            return value

        return process


@compiles(sqltypes.DateTime, "mysql")
def _compile_datetime(type_, compiler, **kw):  # noqa: ANN001
    return "DATETIME(6)"


@compiles(sqltypes.Float, "mysql")
def _compile_float(type_, compiler, **kw):  # noqa: ANN001
    return "DOUBLE"


for _dialect in (MySQLDialect, MySQLDialect_pymysql):
    _dialect.colspecs = {**_dialect.colspecs, sqltypes.DateTime: UtcDateTime}


@dataclass(frozen=True)
class MysqlConfig:
    """问镜独立库；账号沿用 ``AI_MYSQL_*``，库名由 ``WENJING_MYSQL_DATABASE`` 指定。"""

    database: str
    user: str
    password: str = field(repr=False)
    host: str = "127.0.0.1"
    port: int = 3306

    @classmethod
    def from_env(cls) -> MysqlConfig | None:
        database = os.getenv("WENJING_MYSQL_DATABASE", "mianshiwa_ai_wenjing").strip()
        user = os.getenv("AI_MYSQL_USER", "").strip()
        if not user:
            return None
        if not _DATABASE_RE.fullmatch(database):
            raise ValueError("Configure an independent AI MySQL database (mianshiwa_ai_*)")
        port = int(os.getenv("AI_MYSQL_PORT", "3306"))
        if not 1 <= port <= 65535:
            raise ValueError("Invalid AI MySQL port")
        host = os.getenv("AI_MYSQL_HOST", "127.0.0.1").strip() or "127.0.0.1"
        return cls(database, user, os.getenv("AI_MYSQL_PASSWORD", ""), host, port)

    def url(self) -> str:
        return (
            f"mysql+pymysql://{quote_plus(self.user)}:{quote_plus(self.password)}@"
            f"{self.host}:{self.port}/{self.database}?charset=utf8mb4"
        )

    def connect(self):  # noqa: ANN201
        """checkpointer 要求自动提交。"""
        return pymysql.connect(
            host=self.host, port=self.port, user=self.user, password=self.password,
            database=self.database, charset="utf8mb4", autocommit=True,
            connect_timeout=5, read_timeout=30, write_timeout=30,
        )


def mysql_url_from_env() -> str:
    """未配置 ``AI_MYSQL_USER`` 时返回空串，由上游回退到 SQLite。"""
    config = MysqlConfig.from_env()
    return config.url() if config else ""


# generation_traces 等表的单行带几百 KB 的 JSON 快照，MySQL 8 排序时把 JSON 列放进
# sort buffer，默认 256KB 会报 1038 Out of sort memory（PostgreSQL 无此限制）。
# MySQL 8 按需分配 sort buffer，调大上限不会让空闲连接多占内存。
_SORT_BUFFER_BYTES = 16 * 1024 * 1024

# 上游按会话读取 trace 时 ORDER BY turn_idx, id；复合索引让这些查询不再排序。
_MYSQL_INDEXES = {
    "ix_generation_traces_session_turn_id": ("generation_traces", ("session_id", "turn_idx", "id")),
}


def engine_kwargs(url: str) -> dict[str, Any]:
    if url.startswith("mysql"):
        return {
            "pool_recycle": 1800,
            "pool_size": 10,
            "max_overflow": 10,
            "connect_args": {"init_command": f"SET SESSION sort_buffer_size = {_SORT_BUFFER_BYTES}"},
        }
    return {}


def ensure_mysql_indexes(eng: Any) -> None:
    """为 MySQL 补齐上游在 PostgreSQL 上不需要的复合索引（幂等）。"""
    with eng.begin() as conn:
        for name, (table, columns) in _MYSQL_INDEXES.items():
            exists = conn.exec_driver_sql(
                "SELECT 1 FROM information_schema.statistics "
                "WHERE table_schema = DATABASE() AND table_name = %s AND index_name = %s LIMIT 1",
                (table, name),
            ).first()
            if exists is None:
                conn.exec_driver_sql(f"CREATE INDEX {name} ON {table} ({', '.join(columns)})")


def prepare_mysql_tables(tables: list[Table]) -> None:
    """建表使用 utf8mb4_bin，保持与 PostgreSQL 相同的大小写敏感比较。"""
    for table in tables:
        table.dialect_kwargs.setdefault("mysql_charset", "utf8mb4")
        table.dialect_kwargs.setdefault("mysql_collate", "utf8mb4_bin")
        table.dialect_kwargs.setdefault("mysql_engine", "InnoDB")


_SQLITE_TO_MYSQL = (
    (re.compile(r"^DATETIME$"), "DATETIME(6) NULL"),
    (re.compile(r"^REAL$"), "DOUBLE NULL"),
    (re.compile(r"^JSON( DEFAULT .*)?$"), "JSON NULL"),
    (re.compile(r"^TEXT$"), "TEXT NULL"),
)


def mysql_upgrades(sqlite_upgrades: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """把上游 SQLite 的增量列 DDL 翻译成 MySQL 语法（JSON 列不支持字面量默认值）。"""
    out: dict[str, dict[str, str]] = {}
    for table, columns in sqlite_upgrades.items():
        translated: dict[str, str] = {}
        for name, ddl in columns.items():
            for pattern, replacement in _SQLITE_TO_MYSQL:
                if pattern.match(ddl):
                    ddl = replacement
                    break
            translated[name] = ddl
        out[table] = translated
    return out


_SAVER: Any | None = None
_SAVER_LOCK = threading.Lock()


def mysql_saver() -> Any:
    """进程级 PyMySQLSaver，底层用连接池，避免后台线程共用一条连接。"""
    global _SAVER
    if _SAVER is not None:
        return _SAVER
    with _SAVER_LOCK:
        if _SAVER is not None:
            return _SAVER
        from langgraph.checkpoint.mysql.pymysql import PyMySQLSaver
        from sqlalchemy.pool import QueuePool

        config = MysqlConfig.from_env()
        if config is None:
            raise ValueError("AI_MYSQL_USER is required for the mysql checkpointer")
        pool = QueuePool(
            config.connect,
            pool_size=5,
            max_overflow=5,
            recycle=1800,
            pre_ping=True,
            dialect=MySQLDialect_pymysql(),
        )
        saver = PyMySQLSaver(pool)
        saver.setup()
        _SAVER = saver
        return saver


def reset_mysql_saver() -> None:
    global _SAVER
    _SAVER = None
