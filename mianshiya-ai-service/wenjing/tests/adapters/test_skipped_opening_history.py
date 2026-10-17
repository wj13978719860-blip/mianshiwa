"""开场跳过的回归：不能伪装成正式第一题，也不能消耗正式题预算。"""

from types import SimpleNamespace

from app.wenjing.api.v1.interview import (
    _checkpoint_qa_history_payload,
    _self_intro_history_payload,
)
from app.wenjing.engine.workflow.nodes.self_intro import SELF_INTRO_QUESTION
from app.wenjing.engine.workflow.nodes.skip_question import skip_question_node


def _opening():
    return {
        "question": SELF_INTRO_QUESTION,
        "question_type": "self_intro",
        "dimension": "communication",
    }


def test_skip_opening_preserves_formal_budget_and_completes_intro():
    update = skip_question_node({
        "turn_idx": 0,
        "formal_turn_idx": 0,
        "turn_budget_remaining": 3,
        "current_question": _opening(),
        "dimensions": ["technical_depth"],
        "dimension_status": {"technical_depth": "pending"},
    })
    assert update["intro_completed"] is True
    assert update["formal_turn_idx"] == 0
    assert update["turn_idx"] == 1
    assert update["turn_budget_remaining"] == 3
    assert update["qa_history"][0]["question_type"] == "self_intro"
    assert _checkpoint_qa_history_payload(update) == []
    opening = _self_intro_history_payload(None, "test", SimpleNamespace(), update)
    assert opening["question_type"] == "self_intro"
    assert opening["answer"] == "已跳过本题"


def test_legacy_skipped_opening_is_not_projected_as_first_formal_question():
    # 复现用户截图对应的旧 checkpoint：开场和正式第一题共用正式索引 0。
    legacy = {
        "qa_history": [
            {"turn_idx": 0, "question": SELF_INTRO_QUESTION, "answer": "",
             "answer_intent": "skipped", "current_question": _opening()},
            {"turn_idx": 0, "question": "如何定位线程池阻塞？", "answer": "检查线程栈",
             "current_question": {"question_type": "technical"}},
        ],
    }
    history = _checkpoint_qa_history_payload(legacy)
    opening = _self_intro_history_payload(None, "test", SimpleNamespace(), legacy)
    assert len(history) == 1
    assert history[0]["question"] == "如何定位线程池阻塞？"
    assert opening["turn_idx"] is None
    assert opening["question"] == SELF_INTRO_QUESTION
    assert opening["weaknesses"] == []


def test_formal_skip_still_consumes_one_turn():
    update = skip_question_node({
        "turn_idx": 1, "formal_turn_idx": 0, "turn_budget_remaining": 3,
        "current_question": {"question": "技术题", "question_type": "technical"},
    })
    assert update["formal_turn_idx"] == 1
    assert update["turn_budget_remaining"] == 2
    assert "intro_completed" not in update
