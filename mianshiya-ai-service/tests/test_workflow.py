"""最小图契约测试；只在安装 workflow 验证依赖的环境中运行。"""
import pytest

pytest.importorskip("langgraph", reason="Install requirements-workflow.txt for workflow tests")

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from app.interview.checkpoints import MysqlCheckpointConfig
from app.interview.recovery_probe import build_recovery_probe


def test_interrupt_resume_preserves_original_answer():
    """等待时有确定题目，恢复后的回答原文和完成状态都能读取。"""
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "test-session"}}
    graph = build_recovery_probe(saver)
    result = graph.invoke({"session_id": "test-session"}, config)
    assert result["__interrupt__"][0].value["question_id"] == "recovery-probe-question"
    assert graph.get_state(config).next == ("wait_answer",)
    # 重新构建图模拟引擎对象更换；跨进程与真实数据库另做集成验收。
    graph = build_recovery_probe(saver)
    graph.invoke(Command(resume="线程池复用线程。\n  保留回答原文。"), config)
    state = graph.get_state(config)
    assert not state.next
    assert state.values["status"] == "completed"
    assert state.values["answered_count"] == 1
    assert state.values["answer"] == "线程池复用线程。\n  保留回答原文。"
    # 空推进已完成图不应再次增加计数；这不等于已实现业务 commandId 幂等。
    graph.invoke(None, config)
    assert graph.get_state(config).values["answered_count"] == 1


def test_missing_or_business_database_rejected(monkeypatch):
    """配置错误应失败，不允许误用业务库或悄悄回退到内存。"""
    monkeypatch.setenv("AI_MYSQL_DATABASE", "mianshiya")
    monkeypatch.setenv("AI_MYSQL_USER", "test")
    monkeypatch.setenv("AI_MYSQL_PASSWORD", "test-only")
    with pytest.raises(ValueError):
        MysqlCheckpointConfig.from_env()


def test_password_not_in_configuration_repr():
    assert "test-secret" not in repr(MysqlCheckpointConfig("mianshiwa_ai_test", "test", "test-secret"))
