"""接口契约测试：验证认证、字段校验、请求追踪和就绪语义，无需真实 Nacos。"""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.settings import Settings


class FakeRegistry:
    """模拟注册器，仅保存状态；测试不会访问真实注册中心。"""
    def __init__(self, _settings):
        self.ready = False
        self.state = "unknown"

    async def start(self):
        self.ready = True
        self.state = "registered"

    async def close(self):
        self.ready = False


@pytest.fixture
def client():
    # with 会触发启动/退出生命周期，让每个测试都有独立且已就绪的应用。
    with TestClient(create_app(Settings(token="test-credential"), FakeRegistry)) as c:
        yield c


def headers():
    # 这是测试专用凭证，不是本机运行服务的真实凭证。
    return {"X-AI-Service-Token": "test-credential", "X-Request-Id": str(uuid4())}


def test_auth_precedes_invalid_json(client):
    """即使正文/UUID 都错误，也必须先拒绝无凭证请求，且不能回显凭证。"""
    r = client.post("/internal/v1/probe", content="{", headers={"X-Request-Id": "bad"})
    assert r.status_code == 401
    assert r.json()["requestId"] == r.headers["X-Request-Id"]
    assert "test-credential" not in r.text


@pytest.mark.parametrize("body", [{}, {"message": 1}, {"message": " "},
                                   {"message": "x" * 257}, {"message": "hi", "extra": True}])
def test_invalid_body(client, body):
    """参数化测试：分别拒绝字段缺失、非字符串、全空白、超长和多余字段。"""
    r = client.post("/internal/v1/probe", json=body, headers=headers())
    assert r.status_code == 422
    assert r.json()["error"] == "INVALID_REQUEST"


def test_request_id_and_unicode_boundary(client):
    """256 个 Emoji 应通过，且大写 UUID 应规范化为小写并贯穿响应。"""
    h = headers()
    h["X-Request-Id"] = h["X-Request-Id"].upper()
    r = client.post("/internal/v1/probe", json={"message": "🐸" * 256}, headers=h)
    assert r.status_code == 200
    assert r.json()["requestId"] == h["X-Request-Id"].lower() == r.headers["X-Request-Id"]
    assert r.json()["mode"] == "stub"


def test_registry_outage_does_not_disable_business(client):
    """注册中心失联不等于业务停机；只有 ready=false 才拒绝业务请求。"""
    client.app.state.registry.state = "disconnected"
    assert client.get("/health/ready").status_code == 200
    assert client.post("/internal/v1/probe", json={"message": "hi"}, headers=headers()).status_code == 200
    client.app.state.registry.ready = False
    assert client.get("/health/ready").status_code == 503
    assert client.post("/internal/v1/probe", json={"message": "hi"}, headers=headers()).status_code == 503


def test_missing_request_id(client):
    """凭证正确但没有 UUID 时返回 422，并生成替代标识供排错使用。"""
    r = client.post("/internal/v1/probe", json={"message": "hi"},
                    headers={"X-AI-Service-Token": "test-credential"})
    assert r.status_code == 422
    assert r.json()["requestId"] == r.headers["X-Request-Id"]


@pytest.mark.parametrize("body", [b"\xff", b'{"message":"\xe4"}'])
def test_invalid_encoding_uses_uniform_error(client, body):
    """无效 UTF-8 在字段校验之前就可能失败，仍须遵守 422 和统一错误体约定。"""
    h = {**headers(), "Content-Type": "application/json"}
    r = client.post("/internal/v1/probe", content=body, headers=h)
    assert r.status_code == 422
    assert r.json() == {"requestId": h["X-Request-Id"], "error": "INVALID_REQUEST",
                        "message": "Invalid request body"}
    assert r.json()["requestId"] == r.headers["X-Request-Id"]


def test_auth_precedes_invalid_encoding(client):
    """修复正文解析异常后，错误凭证仍应先返回 401，不能被 422 覆盖。"""
    h = {**headers(), "X-AI-Service-Token": "wrong", "Content-Type": "application/json"}
    r = client.post("/internal/v1/probe", content=b"\xff", headers=h)
    assert r.status_code == 401
    assert r.json()["error"] == "UNAUTHORIZED"
    assert r.json()["requestId"] == r.headers["X-Request-Id"] == h["X-Request-Id"]
    # 新异常处理器不应改变其他路径的默认错误行为。
    assert client.get("/not-an-endpoint").status_code == 404
