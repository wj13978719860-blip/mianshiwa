"""真实 MySQL 命令验收；模型使用假实现，验证隔离、防重和失败恢复。"""
import asyncio
import json
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.interview.contracts import InterviewCreate, InterviewCommand
from app.interview.service import InterviewService, InterviewFailure
from app.model import ModelFailure

pytestmark = pytest.mark.skipif(os.getenv("AI_MYSQL_INTEGRATION") != "true", reason="Explicit MySQL integration only")


class FakeGateway:
    """统计调用次数，证明重复命令不会重复触发评价。"""
    settings = SimpleNamespace(model_timeout_seconds=5)
    def __init__(self, fail_once=False):
        self.calls = 0
        self.fail_once = fail_once
    async def chat(self, messages):
        self.calls += 1
        if self.fail_once:
            self.fail_once = False
            raise ModelFailure("MODEL_UNAVAILABLE")
        return json.dumps({"accuracy": 80, "completeness": 60, "expression": 70,
                           "strengths": ["提到线程复用"], "improvements": ["补充并发控制"],
                           "evidence": ["复用线程"], "followup": ""}, ensure_ascii=False)


def create_body():
    return InterviewCreate(commandId=uuid4(), ownerId="999990000000000001", bankId="1", bankTitle="验证题库",
        jobPosition="Java 后端", experience="应届生", difficulty="基础", maxQuestions=1, allowFollowup=False,
        questions=[{"id": "1", "title": "线程池", "content": "线程池作用", "referenceAnswer": "复用线程",
                    "sourceVersion": "fixture-v1"}])


async def ready(service, session_id, owner):
    for _ in range(100):
        state = await asyncio.to_thread(service.get, session_id, owner)
        if not state["busy"]:
            return state
        await asyncio.sleep(0.05)
    raise AssertionError("Background interview did not complete within budget")


def test_commands_are_durable_idempotent_and_owner_isolated():
    async def run():
        gateway = FakeGateway()
        service = InterviewService(gateway)
        await service.start()
        try:
            body = create_body()
            created = await asyncio.to_thread(service.create, body)
            same = await asyncio.to_thread(service.create, body)
            assert created["id"] == same["id"]
            with pytest.raises(InterviewFailure):
                await asyncio.to_thread(service.get, created["id"], "999990000000000002")
            session = await ready(service, created["id"], body.ownerId)
            assert "referenceAnswer" not in str(session)
            answer = InterviewCommand(commandId=uuid4(), expectedVersion=session["version"],
                                      questionId=session["currentQuestion"]["id"], action="answer", answer="复用线程")
            await asyncio.gather(*(asyncio.to_thread(service.submit, session["id"], body.ownerId, answer) for _ in range(2)))
            result = await ready(service, session["id"], body.ownerId)
            assert result["status"] == "completed" and len(result["turns"]) == 1
            assert gateway.calls == 1
            replay = await asyncio.to_thread(service.submit, session["id"], body.ownerId, answer)
            assert replay["report"] == result["report"] and gateway.calls == 1
            conflicting = answer.model_copy(update={"answer": "另一份回答"})
            with pytest.raises(InterviewFailure):
                await asyncio.to_thread(service.submit, session["id"], body.ownerId, conflicting)
        finally:
            await service.close()
    asyncio.run(run())


def test_failed_evaluation_can_be_explicitly_retried():
    async def run():
        gateway = FakeGateway(fail_once=True)
        service = InterviewService(gateway)
        await service.start()
        try:
            body = create_body()
            created = await asyncio.to_thread(service.create, body)
            session = await ready(service, created["id"], body.ownerId)
            await asyncio.to_thread(service.submit, session["id"], body.ownerId, InterviewCommand(commandId=uuid4(),
                expectedVersion=session["version"], questionId=session["currentQuestion"]["id"], action="answer", answer="复用线程"))
            failed = await ready(service, session["id"], body.ownerId)
            assert failed["status"] == "failed" and failed["error"] == "MODEL_UNAVAILABLE"
            await asyncio.to_thread(service.submit, session["id"], body.ownerId, InterviewCommand(commandId=uuid4(),
                expectedVersion=failed["version"], action="retry"))
            result = await ready(service, session["id"], body.ownerId)
            assert result["status"] == "completed" and len(result["turns"]) == 1
            assert result["turns"][0]["answer"] == "复用线程" and gateway.calls == 2
        finally:
            await service.close()
    asyncio.run(run())


def test_creation_interrupted_before_first_checkpoint_can_be_recovered():
    async def run():
        gateway = FakeGateway()
        service = InterviewService(gateway)
        await asyncio.to_thread(service.initialize)
        body = create_body()
        created = await asyncio.to_thread(service.create, body)
        # 领取后尚未执行就模拟进程退出，下次启动必须显式标记失败。
        claimed = await asyncio.to_thread(service._claim)
        assert claimed["session_id"] == created["id"]
        await service.start()
        try:
            failed = await asyncio.to_thread(service.get, created["id"], body.ownerId)
            assert failed["status"] == "failed" and failed["currentQuestion"] is None
            await asyncio.to_thread(service.submit, created["id"], body.ownerId, InterviewCommand(commandId=uuid4(),
                expectedVersion=failed["version"], action="retry"))
            restored = await ready(service, created["id"], body.ownerId)
            assert restored["status"] == "waiting_answer" and restored["currentQuestion"]["id"] == "1"
            assert gateway.calls == 0
        finally:
            await service.close()
    asyncio.run(run())


def test_second_worker_rejected_before_it_can_reset_first_worker_state():
    async def run():
        first = InterviewService(FakeGateway())
        second = InterviewService(FakeGateway())
        await first.start()
        try:
            with pytest.raises(RuntimeError, match="one active"):
                await second.start()
            body = create_body()
            session = await asyncio.to_thread(first.create, body)
            restored = await ready(first, session["id"], body.ownerId)
            assert restored["status"] == "waiting_answer"
        finally:
            await second.close()
            await first.close()
    asyncio.run(run())
