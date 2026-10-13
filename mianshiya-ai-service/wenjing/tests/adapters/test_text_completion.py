"""验收文字面试收尾：不能把截断结果或跳题当作正常评分。"""
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.wenjing.engine.agents import coach, llm_client
from app.wenjing.engine.workflow.nodes import skip_question as skip_module
from app.wenjing.engine.workflow.nodes.experience_extractor import _extract_qa_patterns
from app.wenjing.models.strategy_learning import InterviewTurn
from app.wenjing.services.session_replay import _timeline_from_turn_facts


def test_truncated_json_is_not_returned_as_success():
    response = SimpleNamespace(choices=[SimpleNamespace(
        finish_reason="length", message=SimpleNamespace(content='{"partial":')
    )])
    with pytest.raises(llm_client.LLMOutputTruncated):
        llm_client._openai_response_content(response)
    response.choices[0].finish_reason = "stop"
    response.choices[0].message.content = '{"complete": true}'
    assert llm_client._openai_response_content(response) == '{"complete": true}'


def test_coach_uses_separate_output_budget_and_labels_truncation():
    with patch.object(coach, "get_settings", return_value=SimpleNamespace(coach_llm_max_tokens=7000)), \
         patch.object(coach, "call_chat", side_effect=llm_client.LLMOutputTruncated("budget")) as call:
        result = coach.build_training_plan(job_spec={}, candidate={}, final_report={}, qa_history=[])
    assert call.call_args.kwargs["max_tokens"] == 7000
    assert result["source"] == "fallback"
    assert result["fallback_reason"] == "output_truncated"


def test_skipped_turn_is_durable_unscored_and_idempotent(monkeypatch):
    # 使用真实唯一键和写入实现，验证重复执行不会新增两条回放记录。
    engine = create_engine("sqlite://")
    InterviewTurn.__table__.create(engine)

    @contextmanager
    def session_scope():
        with Session(engine) as session:
            yield session
            session.commit()

    monkeypatch.setattr(skip_module, "get_session", session_scope)
    state = {
        "session_id": "text-skip-test", "turn_idx": 2, "formal_turn_idx": 1,
        "turn_budget_remaining": 3, "dimensions": ["technical_depth"],
        "current_question": {"dimension": "technical_depth", "question": "原始第二题"},
        "skip_reason": "先跳过",
    }
    skip_module.skip_question_node(state)
    skip_module.skip_question_node(state)
    with Session(engine) as session:
        rows = list(session.scalars(select(InterviewTurn)))
        assert len(rows) == 1
        assert rows[0].turn_idx == 1
        assert rows[0].evaluation["skipped"] is True
        timeline = _timeline_from_turn_facts(session, "text-skip-test")
        assert timeline[0]["question"] == "原始第二题"
        assert timeline[0]["answer"] == ""
        assert timeline[0]["score"] is None
    # 自我介绍跳过不能覆盖第一道正式题。
    state["current_question"]["question_type"] = "self_intro"
    with patch.object(skip_module, "get_session", side_effect=AssertionError("intro must not persist")):
        skip_module.skip_question_node(state)
    engine.dispose()


def test_experience_learning_excludes_skips_missing_and_fallback_scores():
    # 只存在一个可靠分数时，不能把跳题/降级 0 分学成「能力上升」。
    history = [
        {"dimension": "technical_depth", "evaluation": {"score": None, "skipped": True}},
        {"dimension": "technical_depth", "evaluation": {}},
        {"dimension": "technical_depth", "evaluation": {"score": 0, "source": "fallback"}},
        {"dimension": "technical_depth", "evaluation": {"score": float("nan")}},
        {"dimension": "technical_depth", "evaluation": {"score": 9}},
    ]
    assert _extract_qa_patterns({"qa_history": history}) == []
