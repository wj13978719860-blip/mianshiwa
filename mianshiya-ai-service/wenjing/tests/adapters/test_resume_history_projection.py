"""验证面试恢复的正式轮次映射，使用独立内存库，不读取真实用户面试。"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.wenjing.models.base import Base
from app.wenjing.models.generation_trace import GenerationTrace
from app.wenjing.models.interview_session import InterviewSession
from app.wenjing.models.strategy_learning import InterviewTurn
from app.wenjing.services.session_replay import (
    _qa_turn_from_trace,
    _turn_payload,
    build_resume_history,
)


@pytest.fixture
def isolated_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            InterviewSession(
                session_id="history-regression",
                trace_id="history-regression-trace",
                status="interrupted",
            )
        )
        db.commit()
        yield db
    engine.dispose()


def _qa(idx: int) -> dict:
    return {"turn_idx": idx, "question": f"独立问题-{idx}", "answer": "相同短答案"}


def _trace(idx: int, *, pending: bool = False) -> GenerationTrace:
    # 模拟真实 evaluator：自我介绍占用 raw 第0轮，本轮只在 pending 中，
    # qa_history 仍是此前已完成的问答，快照计数则已经递增。
    current = _qa(idx)
    snapshot = {
        "formal_turn_idx": idx + 1,
        "qa_history": [_qa(previous) for previous in range(max(0, idx - 5), idx)],
    }
    if pending:
        snapshot["pending_qa_turn"] = current
    return GenerationTrace(
        session_id="history-regression",
        trace_id="history-regression-trace",
        turn_idx=idx + 1,
        node="evaluator",
        question=current["question"],
        answer=current["answer"],
        dimension="technical_depth",
        state_snapshot=snapshot,
        evaluation={"score": 8.0, "passed": True},
    )


@pytest.mark.parametrize("count", [3, 8])
def test_resume_preserves_each_question_after_third_and_eighth_answer(isolated_db, count):
    # 三题和八题是用户报告的触发点；Trace 单独补齐也不能覆盖相邻历史题目。
    isolated_db.add_all(_trace(idx) for idx in range(count))
    isolated_db.commit()
    history = build_resume_history(isolated_db, "history-regression")
    assert [item["turn_idx"] for item in history] == list(range(count))
    assert [item["question"] for item in history] == [f"独立问题-{idx}" for idx in range(count)]
    assert len({item["question"] for item in history}) == count


@pytest.mark.parametrize("count", [3, 8])
def test_resume_prefers_facts_and_backfills_missing_trace_with_cutoff(isolated_db, count):
    for idx in range(count):
        trace = _trace(idx)
        if idx < count - 2:
            # 同一编号故意设置不同 Trace 文本，证明事实表不会被旧快照覆盖。
            trace.question = f"旧快照问题-{idx}"
            isolated_db.add(
                InterviewTurn(
                    session_id="history-regression",
                    turn_idx=idx,
                    question=f"独立问题-{idx}",
                    answer="事实表答案",
                    dimension="technical_depth",
                )
            )
        isolated_db.add(trace)
    isolated_db.commit()
    history = build_resume_history(
        isolated_db, "history-regression", before_formal_turn_idx=count - 1
    )
    assert [item["turn_idx"] for item in history] == list(range(count - 1))
    assert [item["question"] for item in history] == [f"独立问题-{idx}" for idx in range(count - 1)]
    assert history[0]["answer"] == "事实表答案"


def test_pending_turn_is_matched_before_prior_history_and_raw_offset():
    trace = _trace(7, pending=True)
    pending = trace.state_snapshot["pending_qa_turn"]
    pending["evaluation"] = {"rationale": "只属于第八题"}
    assert _qa_turn_from_trace(trace) == pending
    payload = _turn_payload(trace)
    assert payload["turn_idx"] == 7
    assert payload["question"] == "独立问题-7"


def test_same_answers_never_match_a_different_question():
    trace = _trace(2)
    assert _qa_turn_from_trace(trace) == {}
    assert _turn_payload(trace)["turn_idx"] == 2
    # 旧 Trace 没有正式计数也不能依靠相同答案借用上一题。
    del trace.state_snapshot["formal_turn_idx"]
    assert _qa_turn_from_trace(trace) == {}


def test_repeated_question_and_answer_use_formal_index_not_latest_history():
    trace = _trace(2)
    trace.question = "重复问句"
    trace.state_snapshot["qa_history"] = [
        {"turn_idx": idx, "question": "重复问句", "answer": trace.answer}
        for idx in (0, 1, 2, 3)
    ]
    assert _qa_turn_from_trace(trace)["turn_idx"] == 2
    del trace.state_snapshot["formal_turn_idx"]
    assert _qa_turn_from_trace(trace) == {}


def test_legacy_trace_matches_complete_question_and_answer():
    trace = _trace(2)
    trace.state_snapshot = {"qa_history": [_qa(1), _qa(2)]}
    assert _qa_turn_from_trace(trace)["turn_idx"] == 2
    assert _turn_payload(trace)["turn_idx"] == 2
