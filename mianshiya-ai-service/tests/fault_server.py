"""本地故障模拟服务：先停止真实 AI 服务，再运行本文件；不属于生产 HTTP 入口。"""
import argparse
import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.registry import Registry
from app.settings import Settings


def main():
    # 命令行选择故障类型，生产 app 中不提供这些开关。
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("delay", "bad-response", "auth", "refuse"), required=True)
    args = parser.parse_args()
    settings = Settings.from_env()
    # refuse 模式故意注册相邻未监听端口，使 Java 调用失败；先确认该端口无人使用。
    registration = replace(settings, port=settings.port + 1) if args.mode == "refuse" else settings
    # 每次实际收到探测请求都记一行，用于确认超时后有没有隐藏重试；不记录凭证/正文。
    trace = settings.runtime.parent / "ai-fault-requests.jsonl"
    trace.parent.mkdir(parents=True, exist_ok=True)
    trace.write_text("", encoding="utf-8")

    @asynccontextmanager
    async def lifespan(_app):
        # 像真实服务一样注册 Nacos，从而测试真实 Feign 发现调用，而不只是直接 HTTP。
        registry = Registry(registration)
        try:
            await registry.start()
            yield
        finally:
            await registry.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/ready")
    async def ready():
        # 测试启动器用此字段确认当前启动的是哪个故障模式。
        return {"mode": args.mode}

    @app.post("/internal/v1/probe")
    async def probe(request: Request):
        identifier = request.headers.get("X-Request-Id", "")
        with trace.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"requestId": identifier, "mode": args.mode}) + "\n")
        # 响应延迟 6 秒，大于 Java 默认 3 秒读取超时，用来验证超时与禁止重试。
        if args.mode == "delay":
            await asyncio.sleep(6)
        # 模拟 Python 拒绝内部凭证，检查 Java 是否记录独立的认证失败类别。
        if args.mode == "auth":
            return JSONResponse(status_code=401, content={"requestId": identifier, "error": "UNAUTHORIZED"},
                                headers={"X-Request-Id": identifier})
        # HTTP 200 但正文标识不匹配，检查 Java 是否按协议错误拒绝，而非返回成功。
        body_id = str(uuid4()) if args.mode == "bad-response" else identifier
        return JSONResponse(content={"requestId": body_id, "service": settings.service,
                            "version": "0.1.0", "mode": "stub", "reply": "test fixture"},
                            headers={"X-Request-Id": identifier})

    uvicorn.run(app, host=settings.host, port=settings.port, access_log=False, workers=1)


if __name__ == "__main__":
    main()
