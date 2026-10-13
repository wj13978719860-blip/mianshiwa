"""网关身份：Java 校验 Sa-Token 登录后，通过内部 Token 调用并注入 ``X-Owner-Id``。

上游会话归属是本地 ``users.id``（INTEGER），面试蛙用户 id 是 Java 侧长整型，
因此每个 ownerId 对应一个无密码的本地影子用户，``owner_user_id`` 保存影子用户 id。
注册、登录、Cookie 会话不再对外开放。
"""
from __future__ import annotations

import re

from fastapi import Request
from sqlalchemy.exc import IntegrityError

from app.wenjing.core.settings import get_settings
from app.wenjing.models.auth import USER_ROLE_USER, User
from app.wenjing.models.base import get_session as get_db_session

_OWNER_RE = re.compile(r"[0-9]{1,20}")
_EMAIL_DOMAIN = "gateway.mianshiwa.internal"
SHADOW_PASSWORD_HASH = "!gateway"


def _owner_header() -> str:
    return str(getattr(get_settings(), "gateway_owner_header", "") or "X-Owner-Id")


def gateway_owner_id(request: Request) -> str | None:
    raw = request.headers.get(_owner_header())
    if raw is None:
        return None
    value = raw.strip()
    return value if _OWNER_RE.fullmatch(value) else None


def shadow_email(owner_id: str) -> str:
    return f"owner-{owner_id}@{_EMAIL_DOMAIN}"


def owner_id_from_user(user: User | None) -> str | None:
    email = str(getattr(user, "email", "") or "")
    prefix, _, domain = email.partition("@")
    if domain != _EMAIL_DOMAIN or not prefix.startswith("owner-"):
        return None
    return prefix.removeprefix("owner-")


def shadow_user(owner_id: str) -> User:
    email = shadow_email(owner_id)
    for _ in range(2):
        try:
            with get_db_session() as db:
                user = db.query(User).filter(User.email == email).one_or_none()
                if user is None:
                    user = User(email=email, password_hash=SHADOW_PASSWORD_HASH, role=USER_ROLE_USER)
                    db.add(user)
                    db.flush()
                return user
        except IntegrityError:
            # 并发首访时另一请求已建好同一影子用户，重新读取即可。
            continue
    raise RuntimeError("shadow user unavailable")


class GatewayClientMiddleware:
    """把 ASGI client 改写为 ownerId，使上游按客户端计数的限流按用户生效。"""

    def __init__(self, app, *, path_prefix: str):  # noqa: ANN001
        self.app = app
        self.path_prefix = path_prefix

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope["type"] in {"http", "websocket"} and scope.get("path", "").startswith(self.path_prefix):
            header = _owner_header().lower().encode("latin-1")
            for key, value in scope.get("headers", []):
                if key == header and _OWNER_RE.fullmatch(value.decode("latin-1").strip()):
                    scope = {**scope, "client": (f"owner:{value.decode('latin-1').strip()}", 0)}
                    break
        await self.app(scope, receive, send)
