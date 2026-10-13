from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from app.wenjing.adapters.gateway_auth import shadow_user
from app.wenjing.models.base import get_session
from app.wenjing.models.interview_session import InterviewSession

TOKEN = "test-credential"
BASE = "/internal/wenjing/api/v1"


class FakeRegistry:
    def __init__(self, _settings):  # noqa: ANN001
        self.ready = False
        self.state = "unknown"

    async def start(self) -> None:
        self.ready = True
        self.state = "registered"

    async def close(self) -> None:
        self.ready = False


@pytest.fixture()
def client():
    app = create_app(Settings(token=TOKEN, wenjing_enabled=True), FakeRegistry)
    with TestClient(app) as c:
        yield c


def _headers(owner: str | None = None) -> dict[str, str]:
    headers = {"X-AI-Service-Token": TOKEN, "X-Request-Id": str(uuid4())}
    if owner is not None:
        headers["X-Owner-Id"] = owner
    return headers


def test_wenjing_routes_require_internal_token(client) -> None:
    response = client.get(f"{BASE}/interview/dimensions", headers={"X-Request-Id": str(uuid4())})

    assert response.status_code == 401
    assert response.json()["error"] == "UNAUTHORIZED"


def test_wenjing_routes_are_mounted_behind_token(client) -> None:
    response = client.get(f"{BASE}/interview/dimensions", headers=_headers())

    assert response.status_code == 200


def test_account_sessions_use_gateway_owner(client) -> None:
    assert client.get(f"{BASE}/account/interview-sessions", headers=_headers()).status_code == 401

    response = client.get(f"{BASE}/account/interview-sessions", headers=_headers("1001"))

    assert response.status_code == 200
    assert response.json()["sessions"] == []


def test_session_access_is_scoped_to_gateway_owner(client) -> None:
    owner = shadow_user("2001")
    session_id = f"sess_{uuid4().hex[:12]}"
    with get_session() as db:
        db.add(InterviewSession(session_id=session_id, trace_id="t", owner_user_id=int(owner.id)))

    other = client.get(f"{BASE}/interview/sessions/{session_id}/metadata", headers=_headers("2002"))
    mine = client.get(f"{BASE}/interview/sessions/{session_id}/metadata", headers=_headers("2001"))
    listed = client.get(f"{BASE}/account/interview-sessions", headers=_headers("2001"))

    assert other.status_code == 403
    assert mine.status_code == 200
    assert [item["session_id"] for item in listed.json()["sessions"]] == [session_id]


def test_invalid_owner_header_is_anonymous(client) -> None:
    response = client.get(f"{BASE}/account/interview-sessions", headers=_headers("1 OR 1=1"))

    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/auth/login", "/admin/sessions", "/llm/test"])
def test_phase_one_does_not_expose_auth_admin_or_llm(client, path) -> None:
    response = client.post(f"{BASE}{path}", headers=_headers("1001"), json={})

    assert response.status_code in {404, 405}
