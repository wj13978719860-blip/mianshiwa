"""内部面试路由必须与探测接口一样经过认证和功能开关校验。"""
from uuid import uuid4
import pytest

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


class Registry:
    def __init__(self, settings):
        self.ready = False
        self.state = "unknown"
    async def start(self):
        self.ready = True
        self.state = "registered"
    async def close(self):
        self.ready = False


def test_interview_paths_require_internal_credential():
    with TestClient(create_app(Settings(token="test-only"), Registry)) as client:
        response = client.get("/internal/v1/interviews?ownerId=1", headers={"X-Request-Id": str(uuid4())})
        assert response.status_code == 401
        assert response.json()["error"] == "UNAUTHORIZED"


def test_disabled_interview_does_not_silently_use_memory_or_old_model():
    with TestClient(create_app(Settings(token="test-only"), Registry)) as client:
        response = client.get("/internal/v1/interviews?ownerId=1", headers={
            "X-AI-Service-Token": "test-only", "X-Request-Id": str(uuid4())})
        assert response.status_code == 503
        assert response.json()["error"] == "INTERVIEW_DISABLED"
        assert response.headers["X-Request-Id"] == response.json()["requestId"]


def test_interview_cannot_be_enabled_without_model(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "test-only")
    monkeypatch.setenv("OPENAI_MODEL_ENABLED", "false")
    monkeypatch.setenv("AI_INTERVIEW_ENABLED", "true")
    with pytest.raises(RuntimeError, match="configured model"):
        Settings.from_env()
