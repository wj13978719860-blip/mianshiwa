"""同步 Elasticsearch 7.17 客户端：上游 RAG 与锚点调用链均为同步函数。

只允许写 ``mianshiwa-ai-`` 前缀的独立索引，不接触面试蛙业务题库索引。
"""
from __future__ import annotations

import json
import math
import re
import threading
from typing import Any

import httpx

from app.wenjing.core.settings import get_settings

_INDEX_RE = re.compile(r"mianshiwa-ai-[a-z0-9][a-z0-9-]*")


class ElasticsearchError(RuntimeError):
    """对外只暴露操作类别，不带 ES 地址和请求正文。"""


def index_name(prefix: str, dimensions: int) -> str:
    name = f"{prefix}-{int(dimensions)}"
    if not _INDEX_RE.fullmatch(name):
        raise ValueError("Use an independent AI Elasticsearch index (mianshiwa-ai-*)")
    if not 1 <= int(dimensions) <= 2048:
        raise ValueError("ES 7.17 dense_vector dimensions must be between 1 and 2048")
    return name


def valid_vector(vector: Any, dimensions: int) -> list[float] | None:
    if not isinstance(vector, list | tuple) or len(vector) != dimensions:
        return None
    out: list[float] = []
    for value in vector:
        if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
            return None
        out.append(float(value))
    return out if any(out) else None


class EsClient:
    def __init__(self, base_url: str, *, timeout: float = 10.0, transport: httpx.BaseTransport | None = None):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout, connect=3.0),
            trust_env=False,
            follow_redirects=False,
            transport=transport,
        )
        self._ready: set[str] = set()
        self._lock = threading.Lock()

    def close(self) -> None:
        self._client.close()

    def request(self, method: str, path: str, *, ok: tuple[int, ...] = (200, 201), **kwargs) -> dict:
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as e:
            raise ElasticsearchError(f"elasticsearch {method} unavailable") from e
        if response.status_code not in ok:
            raise ElasticsearchError(f"elasticsearch {method} failed: HTTP {response.status_code}")
        try:
            return response.json() if response.content else {}
        except ValueError as e:
            raise ElasticsearchError("elasticsearch returned invalid JSON") from e

    def ensure_index(self, index: str, properties: dict[str, Any]) -> None:
        """首次使用时建索引；已有索引的向量维度不同则失败，不删除重建。"""
        if index in self._ready:
            return
        with self._lock:
            if index in self._ready:
                return
            try:
                existing = self._client.get(f"/{index}/_mapping")
            except httpx.HTTPError as e:
                raise ElasticsearchError("elasticsearch mapping unavailable") from e
            if existing.status_code == 200:
                current = existing.json()[index]["mappings"].get("properties", {})
                want = properties.get("embedding", {})
                have = current.get("embedding", {})
                if want and (have.get("type") != want.get("type") or have.get("dims") != want.get("dims")):
                    raise ElasticsearchError(f"index {index} embedding mapping differs")
            elif existing.status_code == 404:
                self.request(
                    "PUT",
                    f"/{index}",
                    ok=(200, 201),
                    json={"mappings": {"dynamic": "strict", "properties": properties}},
                )
            else:
                raise ElasticsearchError(f"cannot inspect index: HTTP {existing.status_code}")
            self._ready.add(index)

    def bulk_index(self, index: str, docs: list[tuple[str, dict[str, Any]]], *, refresh: bool = True) -> None:
        if not docs:
            return
        lines: list[str] = []
        for doc_id, source in docs:
            lines.append(json.dumps({"index": {"_index": index, "_id": doc_id}}))
            lines.append(json.dumps(source, ensure_ascii=False))
        body = "\n".join(lines) + "\n"
        data = self.request(
            "POST",
            "/_bulk",
            params={"refresh": "true" if refresh else "false"},
            content=body.encode("utf-8"),
            headers={"Content-Type": "application/x-ndjson"},
        )
        if data.get("errors"):
            raise ElasticsearchError("elasticsearch bulk index reported item errors")

    def mget(self, index: str, ids: list[str], *, source: list[str] | None = None) -> dict[str, dict]:
        if not ids:
            return {}
        params = {"_source": ",".join(source)} if source else None
        data = self.request("POST", f"/{index}/_mget", json={"ids": ids}, params=params)
        return {
            doc["_id"]: doc.get("_source") or {}
            for doc in data.get("docs", [])
            if doc.get("found")
        }

    def search(self, index: str, body: dict[str, Any]) -> list[dict]:
        data = self.request("POST", f"/{index}/_search", json=body)
        if data.get("timed_out") or data.get("_shards", {}).get("failed", 0):
            raise ElasticsearchError("elasticsearch returned incomplete search results")
        return list(data.get("hits", {}).get("hits", []))

    def count(self, index: str) -> int:
        return int(self.request("GET", f"/{index}/_count").get("count", 0))

    def delete_ids(self, index: str, ids: list[str]) -> None:
        if not ids:
            return
        self.delete_by_query(index, {"ids": {"values": ids}})

    def delete_by_query(self, index: str, query: dict[str, Any]) -> None:
        self.request(
            "POST",
            f"/{index}/_delete_by_query",
            ok=(200, 404),
            params={"refresh": "true", "conflicts": "proceed"},
            json={"query": query},
        )


_CLIENT: EsClient | None = None
_CLIENT_LOCK = threading.Lock()


def get_es_client() -> EsClient | None:
    """未配置 ES 地址时返回 None，由调用方决定降级还是失败。"""
    global _CLIENT
    url = str(getattr(get_settings(), "elasticsearch_url", "") or "").strip()
    if not url:
        return None
    if _CLIENT is None:
        with _CLIENT_LOCK:
            if _CLIENT is None:
                _CLIENT = EsClient(url)
    return _CLIENT


def reset_es_client() -> None:
    global _CLIENT
    with _CLIENT_LOCK:
        if _CLIENT is not None:
            _CLIENT.close()
        _CLIENT = None
