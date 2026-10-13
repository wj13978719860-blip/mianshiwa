"""第一期挂到面试蛙 AI 服务下的问镜子应用。

只包含面试与账户会话列表两个上游路由；注册登录、管理端、语音不对外。
外层 ``app.main`` 负责内部 Token 校验，并以 ``/internal/wenjing`` 前缀挂载。
启动与关闭沿用上游 ``app.wenjing.main`` 的同名流程（建表、会话恢复、调度器）。
"""
from __future__ import annotations

from fastapi import FastAPI

from app.wenjing.adapters.anchor_vectors import require_anchor_store
from app.wenjing.adapters.gateway_auth import GatewayClientMiddleware
from app.wenjing.core.request_context import install_request_context_middleware
from app.wenjing.core.settings import get_settings

MOUNT_PATH = "/internal/wenjing"
_SCHEDULERS = (
    "scheduler",
    "decay_scheduler",
    "dream_scheduler",
    "strategy_promotion_scheduler",
    "drift_maintenance_scheduler",
    "privacy_cleanup_scheduler",
)


def create_gateway_app() -> FastAPI:
    from app.wenjing.api.v1 import account as account_api
    from app.wenjing.api.v1 import interview as interview_api

    app = FastAPI(title="问镜", docs_url=None, redoc_url=None, openapi_url=None)
    install_request_context_middleware(app)
    app.include_router(account_api.router)
    app.include_router(interview_api.router)
    app.add_middleware(GatewayClientMiddleware, path_prefix="")
    for attr in _SCHEDULERS:
        setattr(app.state, attr, None)
    return app


def startup(app: FastAPI) -> None:
    from app.wenjing.main import _run_startup

    settings = get_settings()
    if settings.app_env == "prod":
        require_anchor_store()
    _run_startup(app, settings)


def shutdown(app: FastAPI) -> None:
    from app.wenjing.main import _run_shutdown

    _run_shutdown(app)
