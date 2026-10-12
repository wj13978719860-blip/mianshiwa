"""命令行启动入口：python -m app 会执行本文件。"""
import logging
import uvicorn
from .settings import Settings

if __name__ == "__main__":
    # 先校验环境配置，再启动服务器；缺少凭证时不会开始监听。
    config = Settings.from_env()
    logging.basicConfig(level=config.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # 单 worker 避免重复注册同一实例；不启用 reload，退出时给正在处理的请求 5 秒收尾。
    uvicorn.run("app.main:app", host=config.host, port=config.port, workers=1,
                access_log=False, log_level=config.log_level.lower(), timeout_graceful_shutdown=5)
