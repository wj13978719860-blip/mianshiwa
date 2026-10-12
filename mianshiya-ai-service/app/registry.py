"""封装 Nacos 注册生命周期，隔离 SDK 的版本差异和连接清理细节。"""
import asyncio
import logging
from contextlib import suppress

from v2.nacos import (ClientConfigBuilder, DeregisterInstanceParam,
                      GRPCConfig, NacosNamingService, RegisterInstanceParam)

from .settings import Settings

log = logging.getLogger(__name__)


class Registry:
    """SDK 负责保活与重连；本类负责注册确认、业务就绪状态和有界退出。"""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = None
        self.task = None
        # state 描述注册状态，ready 描述能否处理业务，两者不能混为一谈。
        self.state = "unknown"
        self.ready = False
        # 防止启动失败的清理与 lifespan 退出清理重复执行。
        self.closed = False

    async def start(self):
        """首次连接并注册成功后置为就绪；连接与注册等待最多 30 秒。"""
        s = self.settings
        (s.runtime / "logs").mkdir(parents=True, exist_ok=True)
        (s.runtime / "cache").mkdir(parents=True, exist_ok=True)
        # SDK 2.0.11 的 gRPC 代理不会把空 ID 自动转为 public，必须在这里统一。
        # 否则 Python 看似注册成功，Java 却在 public 空间查不到实例。
        namespace = s.namespace or "public"
        config = (ClientConfigBuilder().server_address(s.server).namespace_id(namespace)
                  .log_level(logging.WARNING).log_dir(str(s.runtime / "logs"))
                  .cache_dir(str(s.runtime / "cache"))
                  .grpc_config(GRPCConfig(grpc_timeout=2000)).build())
        # 先保存客户端对象，即使后续连接超时，也能关闭已经创建的后台连接/任务。
        self.client = NacosNamingService(config)
        try:
            async with asyncio.timeout(30):
                await self.client.grpc_client_proxy.start()
                if not await self._register():
                    raise RuntimeError("Nacos registration was rejected")
            self.state = "registered"
            self.ready = True
            # 检查在后台执行，不让健康接口的 HTTP 请求直接等待 Nacos 网络响应。
            self.task = asyncio.create_task(self._monitor(), name="registry-monitor")
            log.info("registry registered service=%s", s.service)
        # 启动取消也要清理，因此捕获包含取消异常的 BaseException，然后继续向外抛出。
        except BaseException:
            await self.close()
            raise

    async def _register(self):
        """注册实际可达的 IP/端口；临时实例在连接失效后由 Nacos 摘除。"""
        s = self.settings
        return await self.client.register_instance(RegisterInstanceParam(
            service_name=s.service, group_name=s.group, ip=s.register_ip, port=s.port,
            ephemeral=True, metadata={"version": "0.1.0", "mode": "stub"},
        ))

    async def _monitor(self):
        """确认本实例是否还在服务端；丢失时补注册，失联时只修改注册状态。"""
        s = self.settings
        delay = 5
        while True:
            await asyncio.sleep(delay)
            previous = self.state
            try:
                async with asyncio.timeout(3):
                    # SDK 的 get_service() 可能返回旧缓存，因此直接向服务端查询。
                    # 查询及可能的补注册合计最多等待 3 秒，避免监控任务一直卡住。
                    service = await self.client.grpc_client_proxy.query_instance_of_service(
                        s.service, s.group, "", False)
                    found = any(i.ip == s.register_ip and i.port == s.port and i.enabled
                                for i in service.hosts)
                    if not found and not await self._register():
                        raise RuntimeError("Instance missing")
                self.state = "registered"
                delay = 5
            except Exception:
                self.state = "disconnected"
                # 故障后降低检查频率，最多每 10 秒一次，防止不断重试占满资源。
                # 不改变 ready：注册中心不可用时，已有发现缓存仍可能调用本服务。
                delay = min(delay * 2, 10)
            if previous != self.state:
                log.info("registry state=%s service=%s", self.state, s.service)

    async def close(self):
        """停止接收业务，取消检查任务，尝试注销并关闭客户端，网络清理最多 5 秒。"""
        if self.closed:
            return
        self.closed = True
        self.ready = False
        if self.task:
            self.task.cancel()
            # 取消后台任务后等待它结束；这是预期退出，不把取消异常当作业务错误。
            with suppress(asyncio.CancelledError):
                await self.task
        if not self.client:
            return
        try:
            async with asyncio.timeout(5):
                try:
                    if self.state == "registered":
                        s = self.settings
                        await asyncio.wait_for(self.client.deregister_instance(DeregisterInstanceParam(
                            service_name=s.service, group_name=s.group,
                            ip=s.register_ip, port=s.port, ephemeral=True)), 2)
                finally:
                    # SDK 2.0.11 的 shutdown 错误地 await 了同步 stop()。
                    # 此处显式停止更新器并关闭 gRPC；升级 SDK 后需要重新核对这段适配。
                    self.client.service_info_updater.stop()
                    if self.client.grpc_client_proxy.rpc_client is not None:
                        await self.client.grpc_client_proxy.close_client()
        except Exception as exc:
            log.warning("registry cleanup incomplete type=%s", type(exc).__name__)
        self.state = "unknown"
