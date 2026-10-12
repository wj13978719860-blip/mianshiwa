"""OpenAI Chat Completions 协议适配器：只负责模型 HTTP 调用，不读取业务数据库。"""
import asyncio
import json
from dataclasses import dataclass

import httpx


@dataclass
class ModelFailure(Exception):
    """向 HTTP 层传递稳定错误类型；不携带供应商正文或凭证。"""
    kind: str
    status: int = 502


class ModelGateway:
    """复用异步连接池，限制并发和总时长；单次失败不重试，避免重复计费。"""
    def __init__(self, settings, transport=None):
        settings.validate_model()
        self.settings = settings
        self.slots = asyncio.Semaphore(settings.model_concurrency)
        # 不跟随重定向，不继承本机代理；内部 Key 只发给配置的模型地址。
        self.client = httpx.AsyncClient(trust_env=False, follow_redirects=False, transport=transport,
            timeout=httpx.Timeout(settings.model_timeout_seconds, connect=5),
            limits=httpx.Limits(max_connections=settings.model_concurrency,
                               max_keepalive_connections=settings.model_concurrency))

    async def close(self):
        """随 FastAPI 生命周期关闭连接池。"""
        await self.client.aclose()

    async def complete(self, message):
        """固定系统提示词和输出预算；测试入口不开放任意角色、工具或模型覆盖。"""
        config = self.settings
        if not config.model_enabled:
            raise ModelFailure("MODEL_NOT_CONFIGURED", 503)
        # 本服务单事件循环，检查与立即 acquire 之间不等待，超额请求直接拒绝。
        if self.slots.locked():
            raise ModelFailure("MODEL_BUSY", 503)
        async with self.slots:
            try:
                # 总预算包含连接、响应读取和解析，不能被零散分块无限延长。
                async with asyncio.timeout(config.model_timeout_seconds):
                    async with self.client.stream("POST", config.model_base_url + "/chat/completions",
                        headers={"Authorization": "Bearer " + config.model_api_key},
                        json={"model": config.model_name, "stream": False,
                              "max_tokens": config.model_max_tokens,
                              "messages": [{"role": "system", "content": "你是面试蛙的技术面试助手。请用中文简洁、准确地回答问题；不确定时说明不确定。"},
                                           {"role": "user", "content": message}]}) as response:
                        if response.status_code in {401, 403}:
                            raise ModelFailure("MODEL_AUTH_FAILED")
                        if response.status_code == 429:
                            raise ModelFailure("MODEL_RATE_LIMITED", 503)
                        if response.status_code in {400, 404, 422}:
                            # 例如模型名不支持或供应商参数不兼容，不做自动模型替换。
                            raise ModelFailure("MODEL_REQUEST_REJECTED")
                        if response.status_code != 200:
                            raise ModelFailure("MODEL_UPSTREAM_ERROR")
                        # 成功正文也设置上限，不接受供应商意外返回的超大内容。
                        chunks = bytearray()
                        async for chunk in response.aiter_bytes():
                            chunks.extend(chunk)
                            if len(chunks) > 1024 * 1024:
                                raise ModelFailure("MODEL_PROTOCOL_ERROR")
                        data = json.loads(chunks)
                        reply = data["choices"][0]["message"]["content"]
                        if not isinstance(reply, str) or not reply.strip() or len(reply) > 16384:
                            raise ModelFailure("MODEL_PROTOCOL_ERROR")
                        return reply
            except (TimeoutError, httpx.TimeoutException):
                raise ModelFailure("MODEL_TIMEOUT", 504) from None
            except httpx.HTTPError:
                raise ModelFailure("MODEL_UNAVAILABLE") from None
            except (ValueError, KeyError, IndexError, TypeError):
                raise ModelFailure("MODEL_PROTOCOL_ERROR") from None
