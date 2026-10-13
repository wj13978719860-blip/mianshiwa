"""Record a candidate-initiated skip without scoring the answer."""
from __future__ import annotations

from typing import Any

from app.wenjing.core.logging import get_logger
from app.wenjing.engine.workflow.depth_followup import (
    DEPTH_FOLLOWUP_PHASE,
    sanitize_depth_followup_metadata,
)
from app.wenjing.engine.workflow.state import InterviewState
from app.wenjing.models import get_session
from app.wenjing.services.question_selector import build_question_history_selection_artifacts
from app.wenjing.services.strategy_learning_facts import upsert_interview_turn

log = get_logger(__name__)


def _next_dimension(
    dimensions: list[str],
    status: dict[str, str],
    current: str | None,
) -> tuple[str | None, dict[str, str]]:
    if not dimensions:
        return current, status
    next_status = dict(status)
    if current and next_status.get(current) == "active":
        next_status[current] = "pending"
    for dim in dimensions:
        if dim != current and next_status.get(dim) in {None, "pending"}:
            next_status[dim] = "active"
            return dim, next_status
    return current, next_status


def skip_question_node(state: InterviewState) -> dict[str, Any]:
    turn_idx = int(state.get("turn_idx", 0))
    formal_turn_idx = int(state.get("formal_turn_idx", turn_idx))
    budget = max(0, int(state.get("turn_budget_remaining", 0)) - 1)
    question = state.get("current_question") or {}
    dimension = str(
        question.get("dimension") or state.get("current_dimension") or "unknown"
    )
    is_self_intro = question.get("question_type") == "self_intro"
    next_formal_turn_idx = formal_turn_idx if is_self_intro else formal_turn_idx + 1
    skip_reason = state.get("skip_reason")
    dimensions = list(state.get("dimensions") or [])
    next_dimension, next_status = _next_dimension(
        dimensions,
        dict(state.get("dimension_status") or {}),
        None if is_self_intro else dimension,
    )

    qa_entry = {
        "turn_idx": formal_turn_idx,
        "dimension": dimension,
        "question": question.get("question", ""),
        "answer": "",
        "answer_intent": "skipped",
        "skip_reason": skip_reason,
        "evaluation": {
            "score": None,
            "passed": False,
            "strengths": [],
            "weaknesses": ["本题已跳过"],
            "rationale": "候选人选择先跳过本题，本轮不纳入评分。",
            "skipped": True,
        },
        "current_question": question,
    }
    depth_followup = sanitize_depth_followup_metadata(question.get("depth_followup"))
    if question.get("phase") == DEPTH_FOLLOWUP_PHASE or depth_followup:
        qa_entry["phase"] = DEPTH_FOLLOWUP_PHASE
        if depth_followup:
            qa_entry["depth_followup"] = depth_followup
    history_selection_artifacts = build_question_history_selection_artifacts(question)
    if history_selection_artifacts:
        qa_entry["selection_artifacts"] = history_selection_artifacts

    # 回放优先读取事实表，跳题也必须留下原题干；空答案和空分数不能冒充作答。
    # 自我介绍不属于正式题，不能占用正式第 0 轮的唯一键。
    session_id = str(state.get("session_id") or "")
    if session_id and not is_self_intro:
        anchor = question.get("resume_anchor") or {}
        if not isinstance(anchor, dict):
            anchor = {}
        with get_session() as session:
            upsert_interview_turn(
                session,
                session_id=session_id,
                turn_idx=formal_turn_idx,
                trace_id=state.get("trace_id"),
                dimension=dimension,
                job_level=(state.get("job_spec") or {}).get("level"),
                question=str(qa_entry["question"]),
                answer="",
                score=None,
                passed=None,
                evaluation=dict(qa_entry["evaluation"]),
                selection_artifacts=dict(qa_entry.get("selection_artifacts") or {}),
                resume_anchor_key=anchor.get("anchor_key"),
                resume_anchor_label=anchor.get("label") or anchor.get("project_name"),
                resume_project_id=anchor.get("project_id"),
                immediate_reward=None,
                delayed_reward=None,
            )

    log.info(
        "skip_question turn=%d formal=%d dimension=%s",
        turn_idx,
        formal_turn_idx,
        dimension,
    )
    return {
        "qa_history": [qa_entry],
        "messages": [
            {
                "role": "user",
                "turn_idx": turn_idx,
                "kind": "skip",
                "content": "跳过本题",
            },
        ],
        "current_answer": "",
        "current_answer_intent": "skipped",
        "current_question": {},
        "skip_reason": None,
        "turn_idx": turn_idx + 1,
        "formal_turn_idx": next_formal_turn_idx,
        "turn_budget_remaining": budget,
        "current_dimension": next_dimension or dimension,
        "dimension_status": next_status,
    }
