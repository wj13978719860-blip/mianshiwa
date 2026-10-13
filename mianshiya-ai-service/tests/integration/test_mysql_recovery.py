"""可选真实集成测试；显式设置 AI_MYSQL_INTEGRATION=true 才连接数据库。"""
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(os.getenv("AI_MYSQL_INTEGRATION") != "true",
                                reason="Real MySQL integration is explicitly opt-in")


def worker(phase, thread, *, expected_exit=0):
    """凭证由环境传给子进程，不出现在命令行或输出中。"""
    path = Path(__file__).with_name("workflow_worker.py")
    result = subprocess.run([sys.executable, str(path), phase, thread],
                            capture_output=True, text=True, encoding="utf-8", timeout=40)
    assert result.returncode == expected_exit, result.stderr
    return json.loads(result.stdout) if expected_exit == 0 else None


def test_recovery_across_processes_and_storage_failure():
    """每一步都换进程，确认原题、失败状态和回答能从数据库重新读取。"""
    thread = "probe-" + str(uuid4())
    created = worker("create", thread)
    restored = worker("read", thread)
    assert created == restored
    assert restored["next"] == ["wait_answer"]
    assert restored["values"]["status"] == "waiting_answer"
    assert worker("transaction_failure", thread)["transaction_rollback_visible"]
    assert worker("read", thread) == restored
    assert worker("storage_failure", thread)["storage_failure_visible"]
    assert worker("read", thread) == restored
    completed = worker("resume", thread)
    assert completed == worker("read", thread)
    assert completed["next"] == []
    assert completed["values"]["answered_count"] == 1
    assert completed["values"]["answer"] == "线程池复用线程。\n  保留回答原文。"


def test_abrupt_exit_preserves_waiting_checkpoint():
    thread = "crash-" + str(uuid4())
    worker("create", thread)
    # 使用同一个图重新开始仅用于测试崩溃；正式业务不允许覆盖会话输入。
    worker("crash", thread, expected_exit=23)
    restored = worker("read", thread)
    assert restored["next"] == ["wait_answer"]
    assert worker("resume", thread)["values"]["answered_count"] == 1
