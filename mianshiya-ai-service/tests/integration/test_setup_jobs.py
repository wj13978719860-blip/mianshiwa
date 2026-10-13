"""真实 MySQL 解析任务验收：持久化、重复受理、用户隔离和原始资料清理。"""
import asyncio
import json
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pymysql.cursors import DictCursor

from app.interview.contracts import SetupJobRequest
from app.interview.service import InterviewService, InterviewFailure

pytestmark = pytest.mark.skipif(os.getenv("AI_MYSQL_INTEGRATION") != "true", reason="Explicit MySQL integration only")


def test_setup_task_persists_result_and_cleans_source():
    class Gateway:
        settings = SimpleNamespace(model_timeout_seconds=5)
        calls = 0
        async def chat(self, messages, **kwargs):
            self.calls += 1
            assert kwargs == {"max_tokens": 8192, "json_mode": True}
            return json.dumps({"summary": "Java 应届生", "skills": ["Java"], "projects": [], "concerns": []}, ensure_ascii=False)

    async def run():
        gateway = Gateway(); service = InterviewService(gateway)
        await service.start()
        identifier = uuid4()
        try:
            body = SetupJobRequest(commandId=identifier, ownerId="999990000000000001", kind="resume",
                                   directionId="java_backend", text="Java 应届生，暂无项目经历。")
            first = service.setup_jobs.create(body)
            assert first["id"] == service.setup_jobs.create(body)["id"]
            with pytest.raises(InterviewFailure):
                service.setup_jobs.get(str(identifier), "999990000000000002")
            with pytest.raises(InterviewFailure):
                service.setup_jobs.create(body.model_copy(update={"text": "不同正文"}))
            for _ in range(100):
                result = service.setup_jobs.get(str(identifier), body.ownerId)
                if result["status"] not in {"queued", "running"}: break
                await asyncio.sleep(0.05)
            assert result["status"] == "succeeded" and result["result"]["skills"] == ["Java"]
            assert gateway.calls == 1
            connection = service.database.connect()
            try:
                with connection.cursor(DictCursor) as cursor:
                    cursor.execute("SELECT payload FROM interview_setup_jobs WHERE id=%s", (str(identifier),))
                    assert json.loads(cursor.fetchone()["payload"]) == {}
            finally:
                connection.close()
        finally:
            await service.close()
            connection = service.database.connect()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM interview_setup_jobs WHERE id=%s AND owner_id=%s", (str(identifier), "999990000000000001"))
            finally:
                connection.close()
    asyncio.run(run())
