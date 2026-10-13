"""正式文本面试图测试：追问上限、跳过、提前结束、无效评价及恢复。"""
import json

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.interview.workflow import build_interview_graph
from app.model import ModelFailure


def initial(allow_followup=True):
    return {"setup": {"jobPosition": "Java 后端", "experience": "应届生", "difficulty": "基础",
                      "background": "", "jobDescription": "", "allowFollowup": allow_followup},
            "questions": [{"id": "1", "title": "线程池", "content": "线程池有什么作用？",
                           "referenceAnswer": "复用线程，限制并发", "sourceVersion": "v1"}],
            "main_index": 0, "turns": [], "status": "preparing"}


def evaluation(followup="请说明拒绝策略", evidence=None):
    return json.dumps({"accuracy": 80, "completeness": 60, "expression": 70,
                       "strengths": ["提到线程复用"], "improvements": ["补充并发控制"],
                       "evidence": ["复用线程"] if evidence is None else evidence, "followup": followup}, ensure_ascii=False)


def test_followup_limited_and_report_based_on_saved_answers():
    calls = []
    def chat(messages):
        calls.append(messages)
        return evaluation()
    graph = build_interview_graph(InMemorySaver(), chat)
    config = {"configurable": {"thread_id": "normal"}}
    graph.invoke(initial(), config)
    graph.invoke(Command(resume={"action": "answer", "answer": "复用线程"}), config)
    assert graph.get_state(config).values["current"]["kind"] == "followup"
    graph.invoke(Command(resume={"action": "answer", "answer": "复用线程，还需要拒绝策略。"}), config)
    state = graph.get_state(config).values
    assert state["status"] == "completed"
    assert len(calls) == 2 and len(state["turns"]) == 2
    assert state["report"]["score"] == 70
    assert state["report"]["answered"] == 2
    assert state["report"]["recommendations"] == ["补充并发控制"]


@pytest.mark.parametrize("action", ["skip", "end"])
def test_unanswered_session_has_no_fabricated_score(action):
    graph = build_interview_graph(InMemorySaver(), lambda messages: pytest.fail("Must not call model"))
    config = {"configurable": {"thread_id": action}}
    graph.invoke(initial(), config)
    graph.invoke(Command(resume={"action": action}), config)
    state = graph.get_state(config).values
    assert state["status"] == "completed"
    assert state["report"]["score"] is None
    assert state["report"]["answered"] == 0
    assert state["report"]["skipped"] == (1 if action == "skip" else 0)


def test_invalid_evidence_fails_and_resume_uses_same_original_answer():
    replies = iter([evaluation(evidence=["凭空捏造的引用"]), evaluation(followup="")])
    saver = InMemorySaver()
    graph = build_interview_graph(saver, lambda messages: next(replies))
    config = {"configurable": {"thread_id": "retry"}}
    graph.invoke(initial(False), config)
    with pytest.raises(ModelFailure):
        graph.invoke(Command(resume={"action": "answer", "answer": "复用线程\n原文"}), config)
    assert graph.get_state(config).values["turns"] == []
    # 恢复持久化的失败步骤，无需把答案再次塞到另一套聊天接口。
    build_interview_graph(saver, lambda messages: next(replies)).invoke(None, config)
    assert graph.get_state(config).values["turns"][0]["answer"] == "复用线程\n原文"


def test_followup_disabled_ends_after_main_question():
    graph = build_interview_graph(InMemorySaver(), lambda messages: evaluation())
    config = {"configurable": {"thread_id": "no-followup"}}
    graph.invoke(initial(False), config)
    graph.invoke(Command(resume={"action": "answer", "answer": "复用线程"}), config)
    assert graph.get_state(config).values["status"] == "completed"
