"""Malformed LLM output must not silently become a score or a decision."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.wenjing.engine.agents import evaluator_agent, guard, structured_output, verification
from app.wenjing.engine.agents.llm_client import ChatMessage
from app.wenjing.engine.agents.output_schemas import (
    ContractOutput, EvaluationOutput, GuardOutput, QuestionOutput,
    TrainingPlanOutput, VerificationOutput,
)
from app.wenjing.engine.agents.structured_output import StructuredOutputError, call_structured


@pytest.fixture(autouse=True)
def bounded_settings(monkeypatch):
    monkeypatch.setattr(structured_output, "get_settings", lambda: SimpleNamespace(
        structured_output_max_retries=1, structured_output_timeout_seconds=20,
        llm_request_timeout_seconds=10,
    ))


@pytest.mark.parametrize("bad_score", ["优秀", "8", None, True, -1, 11, float("nan"), float("inf")])
def test_invalid_scores_are_rejected(bad_score):
    with pytest.raises(ValidationError):
        EvaluationOutput.model_validate({"score": bad_score})


@pytest.mark.parametrize("bad", ["false", "true", 0, 1, None])
def test_decisions_require_actual_json_booleans(bad):
    with pytest.raises(ValidationError):
        GuardOutput.model_validate({"allowed": bad})
    with pytest.raises(ValidationError):
        EvaluationOutput.model_validate({"score": 8, "passed": bad})


@pytest.mark.parametrize("payload", [
    {"must_cover": "事务边界"},
    {"must_cover": ["幂等"], "acceptance_checks": "幂等"},
    {"must_cover": [1]},
    {},
])
def test_contract_lists_are_not_coerced_or_split(payload):
    with pytest.raises(ValidationError):
        ContractOutput.model_validate(payload)


@pytest.mark.parametrize("raw", [
    '```json\n{"score":8}\n```',
    'Here is the result: {"score":8}',
    '{"score":8}',
])
def test_valid_json_variants_keep_existing_compatibility(raw):
    result = call_structured([], schema=EvaluationOutput, call=lambda *_a, **_kw: raw)
    assert result == {"score": 8.0}


def test_validation_errors_are_sent_back_and_nested_retries_disabled():
    replies = iter(['{"score":"优秀"}', '{"score":8,"passed":true}'])
    calls = []
    original = [ChatMessage("system", "Grade the answer", cache_control="ephemeral"),
                ChatMessage("user", "answer")]

    def fake(messages, **kwargs):
        calls.append((list(messages), kwargs))
        return next(replies)

    result = call_structured(original, schema=EvaluationOutput, call=fake,
                             max_retries=9, provider_max_retries=9)
    assert result["score"] == 8
    assert len(calls) == 2
    assert "score" in calls[1][0][-1].content
    assert "float_type" in calls[1][0][-1].content
    assert all(kw["max_retries"] == kw["provider_max_retries"] == 0 for _, kw in calls)
    assert len(original) == 2
    assert original[0].content == "Grade the answer"
    assert calls[0][0][0].cache_control == "ephemeral"


@pytest.mark.parametrize("raw", ['[]', 'null', '"text"', '{}', '{"score":8,"score":2}', 'not JSON'])
def test_invalid_objects_exhaust_a_bounded_number_of_attempts(raw):
    calls = []
    with pytest.raises(StructuredOutputError) as exc:
        call_structured([], schema=EvaluationOutput, call=lambda *_a, **kw: calls.append(kw) or raw)
    assert exc.value.attempts == 2
    assert len(calls) == 2


def test_transport_failure_does_not_restart_validation_loop():
    calls = []

    def unavailable(*_a, **kw):
        calls.append(kw)
        raise TimeoutError("unavailable")

    with pytest.raises(TimeoutError):
        call_structured([], schema=EvaluationOutput, call=unavailable)
    assert len(calls) == 1


def test_shared_deadline_stops_additional_attempts(monkeypatch):
    ticks = iter([0, 0, 21])
    monkeypatch.setattr(structured_output.time, "monotonic", lambda: next(ticks))
    calls = []
    with pytest.raises(StructuredOutputError) as exc:
        call_structured([], schema=EvaluationOutput, call=lambda *_a, **kw: calls.append(kw) or '{}')
    assert exc.value.reason == "deadline_exhausted"
    assert len(calls) == 1
    assert calls[0]["request_timeout"] == 10


def test_output_and_validation_values_are_not_logged(caplog):
    secret = "private-answer-and-api-key"
    with pytest.raises(StructuredOutputError) as exc:
        call_structured([], schema=EvaluationOutput,
                        call=lambda *_a, **_kw: json.dumps({"score": secret}))
    assert secret not in caplog.text
    assert secret not in str(exc.value)


def _evaluate():
    return evaluator_agent.evaluate_answer(
        dimension="technical_depth", question="Q", rubric_points=["幂等"],
        answer="使用唯一约束", quality_threshold=7.5,
    )


def test_evaluator_retries_invalid_number_then_uses_real_score(monkeypatch):
    replies = iter(['{"score":"差"}', '{"score":3,"passed":false}'])
    monkeypatch.setattr(evaluator_agent, "call_chat", lambda *_a, **_kw: next(replies))
    result = _evaluate()
    assert result["score"] == 3
    assert result.get("source") != "fallback"


def test_invalid_score_never_becomes_a_fabricated_grade(monkeypatch):
    monkeypatch.setattr(evaluator_agent, "call_chat", lambda *_a, **_kw: '{"score":"差"}')
    result = _evaluate()
    assert result["score"] is None
    assert result["evaluation_status"] == "unavailable"
    assert result["fallback_reason"] == "structured_output_invalid"
    from app.wenjing.ml.rl.reward_fn import immediate_reward
    assert immediate_reward(evaluation=result) == 0


def test_invalid_evaluation_does_not_change_existing_score_or_status(monkeypatch):
    from app.wenjing.engine.workflow.nodes import evaluator as node
    from app.wenjing.engine.workflow.routers import _attempts_for_dimension

    monkeypatch.setattr(evaluator_agent, "call_chat", lambda *_a, **_kw: '{"score":"差"}')
    monkeypatch.setattr(node, "evaluate_answer", lambda **_kw: _evaluate())
    monkeypatch.setattr(node, "_persist_interview_turn_fact", lambda **_kw: None)
    state = {
        "session_id": "test", "trace_id": "test", "current_dimension": "technical_depth",
        "current_question": {"question": "Q", "dimension": "technical_depth"},
        "current_answer": "A", "qa_history": [], "scores_per_dim": {"technical_depth": 8},
        "dimension_status": {"technical_depth": "active"}, "turn_budget_remaining": 5,
    }
    result = node.evaluator_node(state)
    assert result["scores_per_dim"] == {"technical_depth": 8}
    assert result["dimension_status"] == {"technical_depth": "active"}
    qa = result["pending_qa_turn"]
    assert qa["evaluation"]["score"] is None
    assert _attempts_for_dimension({"qa_history": [qa]}, "technical_depth") == 0


@pytest.mark.parametrize("mode", ["llm", "shadow_contract", "hybrid", "contract"])
def test_fallback_cannot_acquire_a_grade_from_contract_scoring(mode):
    from app.wenjing.engine.contracts.contract_score import build_contract_score_shadow

    payload = {
        "source": "fallback", "score": None,
        "rubric_coverage": {"幂等": "partial"},
        "acceptance_check_result_items": [{
            "source": "reviewed", "severity": "core", "verdict": "partial",
            "result_present": True, "evidence": [],
        }],
    }
    fields = build_contract_score_shadow(payload, evaluator_score_mode=mode)
    assert fields["contract_score"] is None
    assert fields["final_score"] is None
    assert fields.get("score") is None


def test_guard_string_false_is_retried_not_treated_as_true(monkeypatch):
    replies = iter(['{"allowed":"false"}', '{"allowed":false}'])
    monkeypatch.setattr(guard, "call_chat", lambda *_a, **_kw: next(replies))
    result = guard.classify("text", target_kind="question")
    assert result.allowed is False
    assert result.llm_available is True


def test_malformed_verifier_cannot_overrule_the_evaluator(monkeypatch):
    monkeypatch.setattr(verification, "call_chat", lambda *_a, **_kw: '{"verdict":"fail","confidence":"high"}')
    result = verification.verify_answer(dimension="technical_depth", question="Q", answer="A",
                                         contract={}, evaluator_report={"passed": True})
    assert result["verifier_available"] is False
    assert result["confidence"] == 0


@pytest.mark.parametrize("schema,payload", [
    (QuestionOutput, {"question": " "}),
    (QuestionOutput, {"question": "Q", "proposed_contract": {"must_cover": "幂等"}}),
    (VerificationOutput, {"verdict": "fail", "confidence": 1.1}),
    (TrainingPlanOutput, {"practice_plan": [{"steps": "do this"}]}),
])
def test_other_decision_outputs_require_the_declared_shape(schema, payload):
    with pytest.raises(ValidationError):
        schema.model_validate(payload)
