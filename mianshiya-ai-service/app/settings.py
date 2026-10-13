"""集中读取环境变量，启动时校验配置，避免在各业务文件中散落配置读取逻辑。"""
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


def wenjing_enabled_from_env() -> bool:
    return os.getenv("WENJING_ENABLED", "false").lower() == "true"


@dataclass(frozen=True)
class Settings:
    """不可变配置对象；运行期间不修改，变更配置后需要重启服务。"""
    # repr=False 防止打印配置对象时意外暴露内部凭证。
    token: str = field(repr=False)
    # 监听地址用于接收请求；默认仅允许本机访问。
    host: str = "127.0.0.1"
    port: int = 8102
    # 服务名、空间和分组需要与 Java 发现配置一致。
    service: str = "mianshiya-ai-service"
    server: str = "127.0.0.1:8848"
    namespace: str = ""
    group: str = "DEFAULT_GROUP"
    # 告诉 Nacos 调用者应该连接哪个 IP；不是 0.0.0.0 这样的监听通配地址。
    register_ip: str = "127.0.0.1"
    log_level: str = "INFO"
    # 模型调用独立开关；关闭时仍可完成原来的服务通信探测。
    model_enabled: bool = False
    model_base_url: str = ""
    model_api_key: str = field(default="", repr=False)
    model_name: str = ""
    model_timeout_seconds: float = 30.0
    model_max_tokens: int = 512
    model_concurrency: int = 2
    # 独立面试功能开关；启用后必须有可持久化的 AI MySQL 库。
    interview_enabled: bool = False
    # 问镜面试（上游移植）开关；配置由 app.wenjing.core.settings 读取。
    wenjing_enabled: bool = False
    # 日志/SDK 缓存放在被 Git 忽略的运行目录，不混入源码。
    runtime: Path = field(default_factory=lambda: Path(__file__).resolve().parents[2] / ".runtime" / "ai")

    @classmethod
    def from_env(cls):
        """读取环境变量；缺少凭证或配置无效时直接失败，不带错误配置运行。"""
        token = os.environ.get("AI_SERVICE_TOKEN", "")
        if not token.strip():
            raise RuntimeError("AI_SERVICE_TOKEN is required")
        settings = cls(
            token=token,
            host=os.getenv("AI_HOST", "127.0.0.1"),
            port=int(os.getenv("AI_PORT", "8102")),
            service=os.getenv("AI_SERVICE_NAME", "mianshiya-ai-service"),
            server=os.getenv("NACOS_SERVER_ADDR", "127.0.0.1:8848"),
            namespace=os.getenv("NACOS_NAMESPACE", ""),
            group=os.getenv("NACOS_GROUP", "DEFAULT_GROUP"),
            register_ip=os.getenv("AI_REGISTER_IP", "127.0.0.1"),
            log_level=os.getenv("AI_LOG_LEVEL", "INFO").upper(),
            model_enabled=os.getenv("OPENAI_MODEL_ENABLED", "false").lower() == "true",
            model_base_url=os.getenv("OPENAI_BASE_URL", "").rstrip("/"),
            model_api_key=os.getenv("OPENAI_API_KEY", ""),
            model_name=os.getenv("OPENAI_MODEL", ""),
            model_timeout_seconds=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30")),
            model_max_tokens=int(os.getenv("OPENAI_MAX_TOKENS", "512")),
            model_concurrency=int(os.getenv("OPENAI_MAX_CONCURRENCY", "2")),
            interview_enabled=os.getenv("AI_INTERVIEW_ENABLED", "false").lower() == "true",
            wenjing_enabled=wenjing_enabled_from_env(),
        )
        # 监听端口必须合法，注册地址必须可被调用，日志级别必须是已知值。
        if not 1 <= settings.port <= 65535 or settings.register_ip in ("", "0.0.0.0", "::"):
            raise RuntimeError("Invalid AI registration address or port")
        if not all((settings.service.strip(), settings.server.strip(), settings.group.strip())):
            raise RuntimeError("Service name, Nacos address and group are required")
        if settings.log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise RuntimeError("Invalid AI_LOG_LEVEL")
        settings.validate_model()
        if settings.interview_enabled and not settings.model_enabled:
            raise RuntimeError("Enable a configured model before enabling interviews")
        return settings

    def validate_model(self):
        """启用时校验模型配置；错误信息不包含 URL、Key 等实际配置值。"""
        if not self.model_enabled:
            return
        url = urlsplit(self.model_base_url)
        if (url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password
                or url.query or url.fragment or not self.model_api_key.strip() or not self.model_name.strip()):
            raise RuntimeError("Valid OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL are required")
        if not (1 <= self.model_timeout_seconds <= 120 and 1 <= self.model_max_tokens <= 4096
                and 1 <= self.model_concurrency <= 16):
            raise RuntimeError("Invalid model timeout, output limit or concurrency")
