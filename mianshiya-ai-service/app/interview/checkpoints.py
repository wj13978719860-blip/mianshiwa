"""MySQL 检查点配置与连接，凭证只从环境变量读取。"""
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass, field

import pymysql
from langgraph.checkpoint.mysql.pymysql import PyMySQLSaver


@dataclass(frozen=True)
class MysqlCheckpointConfig:
    """独立 AI 库连接参数；不在日志或对象 repr 中暴露密码。"""
    database: str
    user: str
    password: str = field(repr=False)
    host: str = "127.0.0.1"
    port: int = 3306

    @classmethod
    def from_env(cls):
        """没有完整配置时明确失败，不回退到内存检查点。"""
        database = os.getenv("AI_MYSQL_DATABASE", "")
        user = os.getenv("AI_MYSQL_USER", "")
        password = os.getenv("AI_MYSQL_PASSWORD", "")
        port = int(os.getenv("AI_MYSQL_PORT", "3306"))
        # 只允许 AI 命名空间，避免检查点初始化误写原业务库。
        if not re.fullmatch(r"mianshiwa_ai_[a-z0-9_]+", database) or not user or not password:
            raise ValueError("Configure an independent AI MySQL database and credentials")
        if not 1 <= port <= 65535:
            raise ValueError("Invalid AI MySQL port")
        return cls(database, user, password, os.getenv("AI_MYSQL_HOST", "127.0.0.1"), port)

    def connect(self):
        """Saver 要求自动提交；这里只提交检查点，不承担业务表的事务。"""
        return pymysql.connect(
            host=self.host, port=self.port, user=self.user, password=self.password,
            database=self.database, charset="utf8mb4", autocommit=True,
            connect_timeout=5, read_timeout=10, write_timeout=10,
        )


@contextmanager
def mysql_checkpointer(config: MysqlCheckpointConfig, *, initialize: bool = False):
    """建立有界连接；建表需显式启用，存储异常直接传播给调用方。"""
    connection = config.connect()
    try:
        saver = PyMySQLSaver(connection)
        if initialize:
            saver.setup()
        yield saver
    finally:
        # 网络故障可能已经关闭连接；清理不能用“重复关闭”异常掩盖原始错误。
        if connection.open:
            connection.close()
