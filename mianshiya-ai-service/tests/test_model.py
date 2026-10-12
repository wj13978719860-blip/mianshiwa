"""模型接入回归：模拟供应商 HTTP，验证契约、预算、脱敏和并发，不消耗真实额度。"""
import asyncio
import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.model import ModelGateway, ModelFailure
from app.settings import Settings
from test_contract import FakeRegistry, headers


def settings():
    """全为测试值，不能连接真实供应商。"""
    return Settings(token="test-credential", model_enabled=True, model_base_url="https://model.test/v1",
                    model_api_key="test-provider-secret", model_name="test-model")


def test_real_model_route_and_stub_remain_separate():
    requests = []
    def provider(request):
        requests.append(request)
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-provider-secret"
        body = json.loads(request.content)
        assert body["model"] == "test-model" and body["stream"] is False
        assert body["max_tokens"] == 512
        return httpx.Response(200, json={"choices":[{"message":{"content":"真实协议测试回答"}}]})
    with TestClient(create_app(settings(), FakeRegistry, httpx.MockTransport(provider))) as client:
        h = headers()
        response = client.post("/internal/v1/model/probe", json={"message":"什么是索引？"}, headers=h)
        assert response.status_code == 200
        assert response.json() == {"requestId":h["X-Request-Id"], "service":"mianshiya-ai-service",
                                   "mode":"model", "model":"test-model", "reply":"真实协议测试回答"}
        assert response.headers["X-Request-Id"] == h["X-Request-Id"]
        assert client.post("/internal/v1/probe",json={"message":"hi"},headers=h).json()["mode"] == "stub"
        assert len(requests) == 1


@pytest.mark.parametrize("status,expected_http,kind", [(401,502,"MODEL_AUTH_FAILED"),
    (429,503,"MODEL_RATE_LIMITED"), (404,502,"MODEL_REQUEST_REJECTED"),
    (500,502,"MODEL_UPSTREAM_ERROR"), (302,502,"MODEL_UPSTREAM_ERROR")])
def test_provider_failure_is_redacted_and_not_retried(status, expected_http, kind):
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(status, text="test-provider-secret private provider response", headers={"Location":"https://other.test"})
    with TestClient(create_app(settings(), FakeRegistry, httpx.MockTransport(provider))) as client:
        response = client.post("/internal/v1/model/probe",json={"message":"hi"},headers=headers())
        assert response.status_code == expected_http and response.json()["error"] == kind
        assert "test-provider-secret" not in response.text
        assert len(calls) == 1


@pytest.mark.parametrize("body", [b'{}', b'{"choices":[]}', b'not-json',
    b'{"choices":[{"message":{"content":" "}}]}',
    b'{"choices":[{"message":{"content":5}}]}'])
def test_invalid_provider_response(body):
    with TestClient(create_app(settings(), FakeRegistry, httpx.MockTransport(lambda r: httpx.Response(200,content=body)))) as client:
        response = client.post("/internal/v1/model/probe",json={"message":"hi"},headers=headers())
        assert response.status_code == 502 and response.json()["error"] == "MODEL_PROTOCOL_ERROR"


def test_authorization_and_validation_precede_paid_request():
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(500)
    with TestClient(create_app(settings(), FakeRegistry, httpx.MockTransport(provider))) as client:
        assert client.post("/internal/v1/model/probe",content=b'\xff').status_code == 401
        assert client.post("/internal/v1/model/probe",content=b'\xff',headers={**headers(),"Content-Type":"application/json"}).status_code == 422
        assert client.post("/internal/v1/model/probe",json={"message":"hi","model":"override"},headers=headers()).status_code == 422
        assert calls == []


def test_disabled_model_preserves_communication_probe():
    with TestClient(create_app(Settings(token="test-credential"),FakeRegistry)) as client:
        assert client.post("/internal/v1/model/probe",json={"message":"hi"},headers=headers()).json()["error"] == "MODEL_NOT_CONFIGURED"
        assert client.post("/internal/v1/probe",json={"message":"hi"},headers=headers()).status_code == 200


def test_total_timeout_and_busy_do_not_leak_slots():
    async def scenario():
        entered = asyncio.Event()
        calls = []
        async def provider(request):
            calls.append(request)
            entered.set()
            await asyncio.sleep(2)
            return httpx.Response(200)
        config = replace(settings(),model_timeout_seconds=1,model_concurrency=1)
        gateway = ModelGateway(config,httpx.MockTransport(provider))
        try:
            first = asyncio.create_task(gateway.complete("hi"))
            await entered.wait()
            with pytest.raises(ModelFailure) as busy:
                await gateway.complete("second")
            assert busy.value.kind == "MODEL_BUSY"
            with pytest.raises(ModelFailure) as timeout:
                await first
            assert timeout.value.kind == "MODEL_TIMEOUT"
            assert not gateway.slots.locked() and len(calls) == 1
        finally:
            await gateway.close()
    asyncio.run(scenario())


def test_invalid_model_configuration_hides_key():
    for url in ("", "file:///tmp/model", "https://secret@model.test", "https://model.test?key=secret"):
        with pytest.raises(RuntimeError) as exc:
            replace(settings(),model_base_url=url).validate_model()
        assert "test-provider-secret" not in str(exc.value)
