"""AI 服务的 HTTP 入口：管理生命周期、认证、请求校验和健康检查。"""
import asyncio
import hmac
import logging
import re
import time
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from starlette.exceptions import HTTPException

from .registry import Registry
from .settings import Settings, wenjing_enabled_from_env
from .model import ModelGateway, ModelFailure

log = logging.getLogger(__name__)
PROBE_PATH = "/internal/v1/probe"
MODEL_PATH = "/internal/v1/model/probe"
INTERNAL_PATHS = {PROBE_PATH, MODEL_PATH}
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")


class ProbeRequest(BaseModel):
    """请求正文只接受 message 字符串；禁止额外字段和数字转字符串。"""
    model_config = ConfigDict(extra="forbid")
    message: StrictStr = Field(min_length=1, max_length=256)

    @field_validator("message")
    @classmethod
    def nonblank(cls, value):
        # 长度限制还不能拒绝全空格，因此补充空白判断。
        if not value.strip():
            raise ValueError("message must not be blank")
        return value


class ProbeResponse(BaseModel):
    """固定探测响应；stub 表示只验证通信，没有调用真实模型。"""
    requestId: str
    service: str
    version: str = "0.1.0"
    mode: str = "stub"
    reply: str = "AI service is reachable"


def create_app(settings: Settings | None = None, registry_factory=Registry, model_transport=None):
    """创建应用；允许测试注入假注册器，使契约测试不需要真的启动 Nacos。"""
    @asynccontextmanager
    async def lifespan(app):
        # lifespan 是 FastAPI 的启动/退出钩子：yield 前注册，yield 后处理退出清理。
        # 注册放在这里而非模块导入阶段，避免导入测试代码就产生网络连接。
        config = settings or Settings.from_env()
        registry = registry_factory(config)
        app.state.settings = config
        app.state.registry = registry
        # 模型连接池不在健康检查中发付费请求；测试可注入 HTTP 传输模拟供应商。
        gateway = ModelGateway(config, transport=model_transport)
        app.state.model = gateway
        wenjing_started = False
        try:
            if wenjing is not None:
                # 上游启动流程是同步的（建表、恢复中断会话），放到线程里避免阻塞事件循环。
                await asyncio.to_thread(wenjing_gateway.startup, wenjing)
                wenjing_started = True
            # 首次注册完成后，应用才开始接收 HTTP 请求。
            await registry.start()
            yield
        finally:
            try:
                if wenjing_started:
                    await asyncio.to_thread(wenjing_gateway.shutdown, wenjing)
            finally:
                try:
                    await gateway.close()
                finally:
                    await registry.close()

    # 这是内部服务，默认关闭 Swagger/OpenAPI；公开入口由 Java 提供。
    app = FastAPI(title="面试蛙 AI 服务", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    wenjing_enabled = settings.wenjing_enabled if settings is not None else wenjing_enabled_from_env()
    wenjing = wenjing_gateway = None
    if wenjing_enabled:
        # 问镜子应用挂在内部路径下，统一受下面的内部 Token 校验保护。
        from .wenjing.adapters import gateway_app as wenjing_gateway
        wenjing = wenjing_gateway.create_gateway_app()
        app.mount(wenjing_gateway.MOUNT_PATH, wenjing)

    def is_internal(path):
        return path in INTERNAL_PATHS or path.startswith("/internal/wenjing/")

    def error(request, status, kind, message):
        """统一错误结构，只返回排错需要的信息，不返回内部配置或凭证。"""
        return JSONResponse(status_code=status, content={
            "requestId": request.state.request_id, "error": kind, "message": message})

    @app.middleware("http")
    async def probe_boundary(request: Request, call_next):
        """中间件先于接口执行：生成追踪标识 → 验证凭证 → 校验标识/就绪 → 处理请求。"""
        if not is_internal(request.url.path):
            return await call_next(request)
        # 非法标识也生成替代 UUID，使错误响应仍然可以被追踪；合法标识统一为小写。
        incoming = request.headers.get("X-Request-Id", "")
        valid_id = bool(UUID_PATTERN.fullmatch(incoming))
        request.state.request_id = str(UUID(incoming)) if valid_id else str(uuid4())
        start = time.monotonic()
        token = request.headers.get("X-AI-Service-Token", "")
        # 安全比较降低计时差异；认证优先于正文校验，错误凭证不进入业务处理。
        if not hmac.compare_digest(token.encode(), app.state.settings.token.encode()):
            response = error(request, 401, "UNAUTHORIZED", "Invalid service credential")
        elif not valid_id:
            response = error(request, 422, "INVALID_REQUEST", "A UUID request identifier is required")
        elif not app.state.registry.ready:
            response = error(request, 503, "SERVICE_NOT_READY", "Service is stopping or not ready")
        else:
            try:
                # 进入 FastAPI 路由，此时 Pydantic 才会校验 JSON 正文。
                response = await call_next(request)
            except Exception as exc:
                log.error("probe failed requestId=%s type=%s", request.state.request_id, type(exc).__name__)
                response = error(request, 500, "INTERNAL_ERROR", "Internal service error")
        # 成功和失败都带相同的请求标识；不在日志中输出凭证或完整请求正文。
        response.headers["X-Request-Id"] = request.state.request_id
        log.info("probe requestId=%s service=%s status=%s elapsedMs=%d", request.state.request_id,
                 app.state.settings.service, response.status_code, (time.monotonic() - start) * 1000)
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, _exc):
        # 屏蔽 Pydantic 的原始错误详情，统一映射为内部契约错误。
        return error(request, 422, "INVALID_REQUEST", "Invalid request body")

    @app.exception_handler(HTTPException)
    async def body_parse_error(request, exc):
        # 无效 UTF-8 等正文解析错误会被 FastAPI 转成 HTTP 400，而非上面的校验异常。
        # 只在探测路径将其统一为 422，保证错误正文也携带相同的请求标识。
        if is_internal(request.url.path) and exc.status_code == 400:
            return error(request, 422, "INVALID_REQUEST", "Invalid request body")
        # 其他路径的 404、方法不允许等错误沿用框架行为，避免扩大本次修复范围。
        return await http_exception_handler(request, exc)

    @app.get("/health/live")
    async def live():
        """存活检查：只说明进程能响应，不进行远程 Nacos 查询。"""
        return {"status": "alive"}

    @app.get("/health/ready")
    async def ready():
        """就绪检查：业务可用性与注册状态分开，Nacos 断开不直接让业务变为不可用。"""
        registry = app.state.registry
        usable = registry.ready
        return JSONResponse(status_code=200 if usable else 503, content={
            "status": "ready" if usable else "not_ready", "registry": registry.state})

    @app.post(PROBE_PATH, response_model=ProbeResponse)
    async def probe(body: ProbeRequest, request: Request):
        # body 已被自动校验；本阶段只返回固定结果，后续真实 AI 能力应另行设计接口。
        return ProbeResponse(requestId=request.state.request_id, service=app.state.settings.service)

    @app.post(MODEL_PATH)
    async def model_probe(body: ProbeRequest, request: Request):
        """真实模型验收入口：复用认证及 256 字符校验，无历史记录、不保存用户回答。"""
        try:
            reply = await app.state.model.complete(body.message)
        except ModelFailure as exc:
            # 只记录稳定错误类型，不打印供应商异常、请求正文或 Authorization。
            log.warning("model requestId=%s type=%s", request.state.request_id, exc.kind)
            return error(request, exc.status, exc.kind, "Model request failed")
        return {"requestId": request.state.request_id, "service": app.state.settings.service,
                "mode": "model", "model": app.state.settings.model_name, "reply": reply}

    return app


# Uvicorn 通过 app.main:app 加载这里的应用对象，网络注册仍在 lifespan 中执行。
app = create_app()
