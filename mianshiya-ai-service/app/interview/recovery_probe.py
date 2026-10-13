"""无模型调用的恢复试验：验证等待回答及跨进程恢复，不提供真实评分。"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt


class RecoveryState(TypedDict, total=False):
    """仅使用 JSON 基本类型，便于恢复及后续跨服务传输。"""
    session_id: str
    question_id: str
    question: str
    status: str
    answer: str
    answered_count: int


def build_recovery_probe(checkpointer):
    """生成最小三节点图；真实面试逻辑将在后续阶段单独接入。"""
    def ask_question(state: RecoveryState):
        return {"question_id": "recovery-probe-question", "question": "请说明线程池的作用。",
                "status": "waiting_answer", "answered_count": 0}

    def wait_answer(state: RecoveryState):
        # interrupt 将等待位置存入检查点；此时不占用 HTTP 请求等待用户输入。
        # 恢复时该节点会重新执行，因此中断之前不放收费调用或业务写入。
        answer = interrupt({"question_id": state["question_id"], "question": state["question"]})
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Answer must be nonblank text")
        return {"answer": answer}

    def finalize(state: RecoveryState):
        # 计数只用于验证恢复是否正确推进，不假装生成了 AI 评价。
        return {"status": "completed", "answered_count": state["answered_count"] + 1}

    graph = StateGraph(RecoveryState)
    graph.add_node("ask_question", ask_question)
    graph.add_node("wait_answer", wait_answer)
    graph.add_node("finalize", finalize)
    graph.add_edge(START, "ask_question")
    graph.add_edge("ask_question", "wait_answer")
    graph.add_edge("wait_answer", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile(checkpointer=checkpointer)
