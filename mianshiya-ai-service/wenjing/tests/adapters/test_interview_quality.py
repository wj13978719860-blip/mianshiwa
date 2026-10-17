"""面试蛙业务回归：截图中的业务错配、换皮重复、追问漂移和跨用户隔离。"""
from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.wenjing.core.settings import get_settings
from app.wenjing.engine.agents import generator
from app.wenjing.engine.resume_plan import select_resume_anchor_with_schedule
from app.wenjing.services import interview_quality as quality
from app.wenjing.services import resume_focus_history as history_service


@pytest.fixture(autouse=True)
def enable_quality(monkeypatch):
    # 上游兼容回归可关闭新功能；本组必须显式启用，且所有模型调用都由测试控制。
    monkeypatch.setenv("ENABLE_INTERVIEW_QUALITY_GUARD", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _candidate():
    return {"resume_parsed": {
        "projects": [{"id": "p1", "name": "代维管理 B 端系统", "tech_stack": ["Redis", "EasyExcel"],
                      "achievements": ["实现分批导出", "实现 Redis 缓存"]}],
        "focus_areas": [
            {"id": "f1", "project_id": "p1", "label": "缓存可靠性", "skills": ["Redis"],
             "dimensions": ["technical_depth"], "priority": 1},
            {"id": "f2", "project_id": "p1", "label": "大批量数据导出", "skills": ["EasyExcel"],
             "dimensions": ["technical_depth"], "priority": 2},
        ],
    }}


def _select(candidate, history=None):
    return select_resume_anchor_with_schedule(
        candidate=candidate, job_spec={}, dimension="technical_depth", qa_history=history or [], turn_idx=0,
    )


def test_prior_sessions_rotate_focus_without_changing_resume_facts():
    candidate = _candidate()
    original = json.dumps(candidate["resume_parsed"], ensure_ascii=False)
    first = _select(candidate)
    key = history_service.focus_history_key("代维管理 B 端系统", "缓存可靠性")
    candidate["focus_history"] = {"status": "loaded", "counts": {key: 4}}
    second = _select(candidate)
    assert first["resume_anchor"]["focus_id"] == "f1"
    assert second["resume_anchor"]["focus_id"] == "f2"
    assert second["resume_anchor"]["tech_stack"] == ["EasyExcel"]
    assert second["resume_anchor"]["question_anchors"] == ["大批量数据导出"]
    assert json.dumps(candidate["resume_parsed"], ensure_ascii=False) == original
    assert second["scheduler"]["history_status"] == "loaded"


def test_current_session_unused_focus_precedes_cross_session_counts():
    candidate = _candidate()
    first = _select(candidate)["resume_anchor"]
    candidate["focus_history"] = {"counts": {
        history_service.focus_history_key("代维管理 B 端系统", "大批量数据导出"): 100}}
    assert _select(candidate, [{"resume_anchor": first}])["resume_anchor"]["focus_id"] == "f2"


def test_focus_key_is_stable_without_parser_ids():
    assert history_service.focus_history_key("项目 A", "SQL 调优") == history_service.focus_history_key("项目a", "sql调优")
    assert history_service.focus_history_key("项目 B", "SQL 调优") != history_service.focus_history_key("项目 A", "SQL 调优")


def test_history_query_is_owner_scoped_and_excludes_current_session(monkeypatch):
    from app.wenjing.models.interview_session import InterviewSession
    from app.wenjing.models.strategy_learning import InterviewTurn
    engine = create_engine("sqlite://")
    InterviewSession.__table__.create(engine)
    InterviewTurn.__table__.create(engine)
    with Session(engine) as db:
        for sid, owner in [("own", 1), ("other", 2), ("current", 1)]:
            db.add(InterviewSession(session_id=sid, trace_id=sid, owner_user_id=owner,
                                   setup_snapshot={"candidate": _candidate()}))
            db.add(InterviewTurn(session_id=sid, turn_idx=0, resume_anchor_label="缓存可靠性",
                                 resume_project_id="p1", question="敏感题干", answer="敏感回答"))
        db.commit()
    @contextmanager
    def session():
        with Session(engine) as db:
            yield db
    monkeypatch.setattr(history_service, "get_session", session)
    result = history_service.load_focus_history(1, "current")
    assert result["sampled_turns"] == 1
    assert list(result["counts"].values()) == [1]
    assert "敏感" not in json.dumps(result, ensure_ascii=False)
    assert history_service.load_focus_history(None, "current")["status"] == "anonymous"


def test_history_failure_is_observable(monkeypatch):
    monkeypatch.setattr(history_service, "get_session", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    assert history_service.load_focus_history(1, "current") == {"status": "unavailable", "counts": {}}


def _generate(history=None, refine=False, hints=None):
    return generator.generate_question(
        dimension="technical_depth", action={}, job_spec={"title": "Java 后端工程师"}, candidate=_candidate(),
        recent_qa=history or [], retrieval_block="", resume_anchor=_select(_candidate())["resume_anchor"],
        refine_mode=refine, contract_hints=hints or {}, target_skills=["Redis"],
    )


def test_bad_business_question_is_rewritten_with_matching_contract(monkeypatch):
    responses = iter([
        {"question": "你的代维管理系统如何防止订单积分重复发放？", "rubric_points": ["支付补偿"]},
        {"question": "缓存可靠性工作中，你用什么指标验收缓存命中率？",
         "rubric_points": ["命中率"], "proposed_contract": {"must_cover": ["命中率"], "acceptance_checks": ["说明测量方法"]}},
    ])
    monkeypatch.setattr(generator, "call_chat", lambda *_a, **_kw: json.dumps(next(responses), ensure_ascii=False))
    reviews = iter([
        {"accepted": False, "reason": "简历没有订单积分业务"}, {"accepted": True, "reason": "已有缓存事实"},
    ])
    monkeypatch.setattr(generator, "review_generated_question", lambda *_a, **_kw: next(reviews))
    result = _generate()
    assert "订单" not in result["question"]
    assert result["quality_rewrite"]
    assert result["proposed_contract"]["must_cover"] == ["命中率"]
    assert result["quality_review"]["status"] == "accepted"


def test_semantic_repeat_retry_is_bounded_and_fallback_has_new_topic(monkeypatch):
    calls = []
    def repeat(*args, **kwargs):
        calls.append(1)
        return json.dumps({"question": "Redis 整体不可用时怎么兜底？"})
    monkeypatch.setattr(generator, "call_chat", repeat)
    monkeypatch.setattr(generator, "review_generated_question", lambda *_a, **_kw: {"accepted": False, "reason": "同场重复"})
    result = _generate([{"question": "Redis 挂掉后哪个功能先失效，如何兜底？"}])
    assert len(calls) == 2
    assert "兜底" not in result["question"]
    assert result["quality_review"]["status"] == "evidence_fallback"
    assert result["proposed_contract"]["must_cover"] == ["验收方法", "具体证据"]


def test_review_unavailable_uses_evidence_not_unsafe_question(monkeypatch):
    monkeypatch.setattr(generator, "call_chat", lambda *_a, **_kw: '{"question":"你的系统如何扣款？"}')
    monkeypatch.setattr(generator, "review_generated_question", lambda *_a, **_kw: (_ for _ in ()).throw(TimeoutError()))
    result = _generate()
    assert "扣款" not in result["question"]
    assert result["quality_review"]["attempts"][0]["error_type"] == "TimeoutError"


def test_followup_only_targets_one_missing_point(monkeypatch):
    monkeypatch.setattr(generator, "call_chat", lambda *_a, **_kw: '{}')
    monkeypatch.setattr(generator, "review_generated_question", lambda *_a, **_kw: (_ for _ in ()).throw(TimeoutError()))
    history = [{"turn_idx": 3, "question": "Redis 故障时如何处理？", "evaluation": {"rubric_coverage": {"告警指标": "missing"}}}]
    result = _generate(history, True, {"missing_must_cover": ["告警指标", "故障演练"]})
    assert "只补充这一点：告警指标" in result["question"]
    assert "故障演练" not in result["question"]
    assert result["quality_review"]["source_turn_idx"] == 3
    assert result["proposed_contract"]["must_cover"] == ["告警指标", "具体实施细节或可验证证据"]


@pytest.mark.parametrize("verdict,expected", [
    ({"grounded": True, "duplicate": False, "focused_followup": True}, True),
    ({"grounded": False, "duplicate": False, "focused_followup": True}, False),
    ({"grounded": True, "duplicate": True, "focused_followup": True}, False),
    ({"grounded": True, "duplicate": False, "focused_followup": False}, False),
])
def test_quality_review_combines_fact_duplicate_and_followup_checks(monkeypatch, verdict, expected):
    monkeypatch.setattr(quality, "_review", lambda *_a, **_kw: {"contract_aligned": True, **verdict})
    assert quality.review_generated_question("问题", anchor={}, history=[], refine_mode=True, gap="指标")["accepted"] is expected


def test_invalid_review_does_not_pass_by_truthy_strings(monkeypatch):
    monkeypatch.setattr(quality, "_review", lambda *_a, **_kw: {"grounded": "false"})
    with pytest.raises(ValueError):
        quality.review_generated_question("问题", anchor={}, history=[], refine_mode=False, gap="")


def test_parser_retains_more_than_six_evidenced_focuses():
    from app.wenjing.services.resume_parser import normalise_resume_parsed_focus_areas
    parsed = {"focus_areas": [{"id": f"f{i}", "label": f"已证实重点{i}"} for i in range(12)]}
    assert len(normalise_resume_parsed_focus_areas(parsed)["focus_areas"]) == 12


def test_seed_fallback_does_not_claim_template_business_as_resume_fact():
    text = generator._seed_backed_fallback_question_text(
        question_seed_block="Scenario: 订单积分重复投递\nQuestion stem: 如何实现幂等？",
        dimension="technical_depth", resume_anchor={"project_name": "代维管理系统"},
        self_intro_profile={}, target_skills=["Redis"],
    )
    assert "独立的假设场景题" in text
    assert "代维管理系统" not in text


def _seed(variant_id, rank=1):
    from app.wenjing.services.question_selector import QuestionCandidate
    return QuestionCandidate(
        seed_id=variant_id.split(".")[0], variant_id=variant_id, seed_version=1, variant_version=1,
        rank=rank, match_score=30, match_reasons=[], injected=False, title="场景", dimension="technical_depth",
        seed_priority=1, variant_priority=1, skill_tags=["redis"], direction_tags=[], role_tags=["java_backend"],
        rubric={"must_cover": ["幂等"], "minimum_bar": "说明幂等实现"}, intent="opening", difficulty="standard",
        scenario_brief="订单积分重复投递", question_stem="如何幂等？", prompt_template="说明实现",
        scenario_skill_tags=["redis"], resume_anchor_hints=[], failure_categories=[], rubric_additions=[],
        expected_signals=[], anti_patterns=[], good_answer_hints=[],
    )


@pytest.mark.parametrize("decision,expected", [(None, False), ("cache.good", True), ("unknown", False)])
def test_selection_only_injects_grounded_known_candidate(monkeypatch, decision, expected):
    from app.wenjing.engine.workflow.nodes import ask_question as ask
    from app.wenjing.services.question_selector import QuestionSelectionResult
    candidates = [_seed("payment.bad"), _seed("cache.good", 2)]
    monkeypatch.setattr(ask, "select_question_candidates", lambda **_kw: QuestionSelectionResult(candidates))
    monkeypatch.setattr(ask, "review_seed_candidates", lambda *_a, **_kw: {"variant_id": decision, "reason": "业务匹配"})
    monkeypatch.setattr(ask, "record_question_usages", lambda **_kw: None)
    ctx = {"dimension": "technical_depth", "resume_anchor": _select(_candidate())["resume_anchor"],
           "target_skills": ["Redis"], "contract_core_mode": "locked", "contract_acceptance_mode": "reviewed_append"}
    state = {"session_id": "test", "candidate": _candidate(), "job_spec": {"level": "mid"}, "runtime_config": {}}
    ask._step_select_structured_question(state, ctx, probe_intent="evidence_probe")
    assert ctx["structured_primary_seed_hit"] is expected
    injected = [item for item in ctx["question_items"] if item["injected"]]
    assert [item["variant_id"] for item in injected] == (["cache.good"] if expected else [])
    if not expected:
        assert not ctx.get("locked_core_contract")
        assert not ctx.get("question_seed_block")


def test_followup_does_not_inject_new_seed_or_call_seed_reviewer(monkeypatch):
    from app.wenjing.engine.workflow.nodes import ask_question as ask
    from app.wenjing.services.question_selector import QuestionSelectionResult
    monkeypatch.setattr(ask, "select_question_candidates", lambda **_kw: QuestionSelectionResult([_seed("payment.bad")]))
    monkeypatch.setattr(ask, "review_seed_candidates", lambda *_a, **_kw: pytest.fail("追问不应重新审核新种子"))
    monkeypatch.setattr(ask, "record_question_usages", lambda **_kw: None)
    ctx = {"dimension": "technical_depth", "resume_anchor": {}, "target_skills": ["Redis"]}
    ask._step_select_structured_question({"refine_mode": True, "runtime_config": {}}, ctx, probe_intent=None)
    assert not ctx["structured_primary_seed_hit"]
    assert ctx["seed_grounding"]["status"] == "followup_uses_parent"


def test_refine_node_keeps_parent_anchor_and_skills(monkeypatch):
    from app.wenjing.engine.workflow.nodes import ask_question as ask
    parent_anchor = _select(_candidate())["resume_anchor"]
    captured = []
    def run(_plan, _state, ctx, **kwargs):
        if kwargs.get("include_kinds"):
            return
        captured.append(dict(ctx))
        ctx["question_payload"] = {
            "question": "继续上一题，请补充故障告警阈值的测量方法。", "dimension": "technical_depth",
            "proposed_contract": {"must_cover": ["告警阈值"], "acceptance_checks": ["说明测量方法"],
                                  "minimum_bar": "说明阈值", "bar_level": "standard"},
        }
        ctx["proposed_contract"] = ctx["question_payload"]["proposed_contract"]
        ctx["contract"] = ctx["proposed_contract"]
    monkeypatch.setattr(ask, "_run_plan", run)
    monkeypatch.setattr(ask, "get_tracer", lambda: SimpleNamespace(trace_node_event=lambda *_a, **_kw: None))
    state = {"session_id": "test", "candidate": _candidate(), "job_spec": {}, "refine_mode": True,
             "current_dimension": "technical_depth", "dimensions": ["technical_depth"],
             "runtime_config": {}, "qa_history": [{"turn_idx": 0, "resume_anchor": parent_anchor,
                                                      "target_skills": ["Redis"], "question": "缓存故障时怎么办？"}],
             "selected_action": {"id": "plan_adaptive"}, "turn_idx": 1, "formal_turn_idx": 1}
    out = ask.ask_question_node(state)
    assert captured[0]["resume_anchor"] == parent_anchor
    assert captured[0]["target_skills"] == ["Redis"]
    assert out["current_question"]["selection_artifacts"]["anchor_scheduler"]["source_turn_idx"] == 0


def test_quality_rewrite_clears_seed_contract_and_usage(monkeypatch):
    from app.wenjing.engine.workflow.nodes import ask_question as ask
    records = []
    monkeypatch.setattr(ask, "generate_question", lambda **_kw: {
        "question": "如何测量导出的内存峰值？", "quality_rewrite": True,
        "proposed_contract": {"must_cover": ["内存峰值"], "acceptance_checks": ["说明测量方法"]},
    })
    monkeypatch.setattr(ask, "record_question_usages", lambda **kwargs: records.extend(kwargs["candidates"]))
    item = _seed("payment.bad").with_injected(True)
    ctx = {"dimension": "technical_depth", "question_candidates": [item], "question_items": [item.as_artifact()],
           "contract_hints": {"question_seed": {"rubric": {"must_cover": ["支付"]}}},
           "locked_core_contract": {"must_cover": ["支付"]}, "compiled_acceptance_checks": ["支付"],
           "reviewed_acceptance_checks": ["支付"], "structured_primary_seed_hit": True}
    ask._step_draft_question({"session_id": "test", "runtime_config": {}}, ctx)
    assert ctx["locked_core_contract"] is None
    assert not ctx["compiled_acceptance_checks"]
    assert not ctx["reviewed_acceptance_checks"]
    assert "question_seed" not in ctx["contract_hints"]
    assert not ctx["question_items"][0]["injected"]
    assert not records[0].injected


def test_api_start_overwrites_client_history_with_authenticated_owner(monkeypatch):
    from app.wenjing.api.v1 import interview as api
    from fastapi import HTTPException
    from starlette.requests import Request
    calls = []
    monkeypatch.setattr(api, "_current_user_from_request", lambda _req: SimpleNamespace(id=17))
    monkeypatch.setattr(api, "load_focus_history", lambda owner, sid: calls.append((owner, sid)) or {"status": "loaded", "counts": {}})
    monkeypatch.setattr(api, "get_session_manager", lambda: SimpleNamespace(session_exists=lambda _sid: True))
    request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1)})
    req = api.StartSessionRequest.model_validate({"candidate": {"name": "测试候选人", **_candidate()}, "job_spec": {"title": "Java", "level": "mid"}})
    with pytest.raises(HTTPException) as error:
        api.start_session(req, request)
    assert error.value.status_code == 409
    assert calls[0][0] == 17


def test_deepseek_thinking_switch_is_only_sent_when_requested(monkeypatch):
    from app.wenjing.engine.agents import llm_client
    calls = []
    monkeypatch.setattr(llm_client, "_call_openai_compatible", lambda *_a, **kw: calls.append(kw) or ("{}", {}))
    llm_client._call_deepseek([], "deepseek-flash", 0, 100, True, thinking_enabled=False)
    llm_client._call_deepseek([], "deepseek-flash", 0, 100, True)
    assert calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "extra_body" not in calls[1]


def test_quality_reviewer_has_bounded_timeout_and_retries(monkeypatch):
    captured = []
    monkeypatch.setattr(quality, "call_chat", lambda *_a, **kw: captured.append(kw) or '{}')
    quality._review("检查", {})
    assert captured[0]["request_timeout"] == 15
    assert captured[0]["max_retries"] == 0
    assert captured[0]["provider_max_retries"] == 0
    assert captured[0]["thinking_enabled"] is False


def test_good_question_with_unrelated_scoring_contract_is_rejected(monkeypatch):
    monkeypatch.setattr(quality, "_review", lambda *_a, **kw: {
        "grounded": True, "duplicate": False, "focused_followup": True, "contract_aligned": False})
    assert not quality.review_generated_question("导出怎样控制内存？", anchor={}, history=[], refine_mode=False,
                                                 gap="", contract={"must_cover": ["支付补偿"]})["accepted"]
