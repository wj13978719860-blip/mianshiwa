"""持久化命令执行器：快速受理、后台推进、按用户隔离和重复请求防重。"""
import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from uuid import UUID, uuid5

import pymysql
from pymysql.cursors import DictCursor
from langgraph.types import Command

from app.model import ModelFailure
from .checkpoints import MysqlCheckpointConfig, mysql_checkpointer
from .workflow import build_interview_graph, make_report

log = logging.getLogger(__name__)


@dataclass
class InterviewFailure(Exception):
    """可向内部接口返回的业务失败，错误文本不包含模型正文或配置。"""
    message: str
    status: int = 409


class WorkerOwnershipLost(RuntimeError):
    """执行器独占连接丢失后停止写入，不自行重连冒充原执行者。"""


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


class InterviewService:
    """单实例执行器；不自动重放运行中断的模型调用，多实例部署暂不支持。"""
    def __init__(self, gateway, database=None):
        self.gateway = gateway
        self.database = database or MysqlCheckpointConfig.from_env()
        self.worker = None
        self.stopping = False
        self.ownership_connection = None
        from .setup import SetupJobs
        self.setup_jobs = SetupJobs(self.database)
        from app.knowledge.retrieval import InterviewRetriever, RetrievalSettings
        retrieval_config = RetrievalSettings.from_env()
        self.retriever = InterviewRetriever(retrieval_config) if retrieval_config.mode != "off" else None

    def acquire_worker(self):
        """启动前取得库级独占锁，防止重复启动在端口报错前就产生第二个执行器。"""
        connection = self.database.connect()
        lock_name = "mianshiwa-interview-" + hashlib.sha256(self.database.database.encode()).hexdigest()[:24]
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT GET_LOCK(%s,0)", (lock_name,))
                if cursor.fetchone()[0] != 1:
                    raise RuntimeError("Only one active interview worker per database is supported")
            self.ownership_connection = connection
        except Exception:
            connection.close()
            raise

    def ensure_worker(self):
        if self.ownership_connection:
            try:
                self.ownership_connection.ping(reconnect=False)
            except Exception:
                raise WorkerOwnershipLost("Interview worker ownership connection lost") from None

    def initialize(self):
        """只初始化独立 AI 库，关键建表失败直接阻止服务启动。"""
        self.setup_jobs.initialize()
        with mysql_checkpointer(self.database, initialize=True):
            pass
        connection = self.database.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute("""CREATE TABLE IF NOT EXISTS interview_sessions (
                    id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(20) NOT NULL,
                    status VARCHAR(32) NOT NULL, version BIGINT NOT NULL DEFAULT 0,
                    pending_command VARCHAR(36), summary JSON NOT NULL,
                    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                    INDEX owner_created(owner_id, created_at)) ENGINE=InnoDB""")
                cursor.execute("""CREATE TABLE IF NOT EXISTS interview_commands (
                    id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36) NOT NULL,
                    owner_id VARCHAR(20) NOT NULL, body_hash CHAR(64) NOT NULL,
                    payload JSON NOT NULL, action VARCHAR(16) NOT NULL, state VARCHAR(16) NOT NULL,
                    error_code VARCHAR(64),
                    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                    INDEX queue_state(state, created_at)) ENGINE=InnoDB""")
                # 启动时显式标记未知执行结果，禁止盲目自动重试产生重复费用。
                cursor.execute("""UPDATE interview_sessions s JOIN interview_commands c
                    ON s.pending_command=c.id SET s.status='failed', s.pending_command=NULL,
                    s.version=s.version+1, c.state='failed', c.error_code='EXECUTION_INTERRUPTED'
                    WHERE c.state='running'""")
        finally:
            connection.close()

    async def start(self):
        await asyncio.to_thread(self.acquire_worker)
        await asyncio.to_thread(self.initialize)
        self.loop = asyncio.get_running_loop()
        self.worker = asyncio.create_task(self._work())

    async def close(self):
        self.stopping = True
        if self.worker:
            # 等当前有界模型调用结束，之后停止领取命令，不中途关闭模型连接池。
            await self.worker
        if self.ownership_connection and self.ownership_connection.open:
            self.ownership_connection.close()
        if self.retriever:
            await self.retriever.close()

    def mark_interrupted(self):
        """仅在没有命令正在执行时调用，把未能提交结果的命令显式转成可处理失败。"""
        connection = self.database.connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute("""UPDATE interview_sessions s JOIN interview_commands c
                    ON s.pending_command=c.id SET s.status='failed', s.pending_command=NULL,
                    s.version=s.version+1, c.state='failed', c.error_code='EXECUTION_INTERRUPTED'
                    WHERE c.state='running'""")
                cursor.execute("UPDATE interview_setup_jobs SET state='failed',error_code='EXECUTION_INTERRUPTED',"
                               "message='解析中断，请重新提交',payload=JSON_OBJECT() WHERE state='running'")
        finally:
            connection.close()

    def _row(self, cursor, session_id, owner, *, lock=False):
        cursor.execute("SELECT * FROM interview_sessions WHERE id=%s AND owner_id=%s" +
                       (" FOR UPDATE" if lock else ""), (session_id, owner))
        row = cursor.fetchone()
        if row is None:
            raise InterviewFailure("面试不存在或无权访问", 404)
        return row

    @staticmethod
    def _view(row):
        result = decode(row["summary"])
        result.update({"id": row["id"], "version": row["version"], "status": row["status"],
                       "busy": row["pending_command"] is not None,
                       "createdAt": row["created_at"].isoformat(), "updatedAt": row["updated_at"].isoformat()})
        return result

    def get(self, session_id, owner):
        connection = self.database.connect()
        try:
            with connection.cursor(DictCursor) as cursor:
                row = self._row(cursor, session_id, owner)
                view = self._view(row)
                cursor.execute("SELECT error_code FROM interview_commands WHERE session_id=%s AND state='failed' "
                               "ORDER BY created_at DESC LIMIT 1", (session_id,))
                failed = cursor.fetchone()
                view["error"] = failed["error_code"] if row["status"] == "failed" and failed else None
                return view
        finally:
            connection.close()

    def list(self, owner):
        connection = self.database.connect()
        try:
            with connection.cursor(DictCursor) as cursor:
                cursor.execute("SELECT * FROM interview_sessions WHERE owner_id=%s ORDER BY created_at DESC LIMIT 30", (owner,))
                return [{key: view.get(key) for key in ("id", "settings", "status", "createdAt", "report", "version")}
                        for view in (self._view(row) for row in cursor.fetchall())]
        finally:
            connection.close()

    def _same_command(self, cursor, command_id, owner, fingerprint):
        cursor.execute("SELECT * FROM interview_commands WHERE id=%s", (command_id,))
        existing = cursor.fetchone()
        if existing:
            if existing["owner_id"] != owner or existing["body_hash"] != fingerprint:
                raise InterviewFailure("请求标识已被用于其他操作，请刷新后重试")
            return existing["session_id"]
        return None

    def create(self, body):
        payload = body.model_dump(mode="json")
        owner, command_id = payload["ownerId"], payload["commandId"]
        # 题目快照由 Java 构造；重复创建比较用户设置，不受后续题库编辑影响。
        fingerprint = hashlib.sha256(encode({k: v for k, v in payload.items()
                                            if k not in {"questions", "bankTitle"}}).encode()).hexdigest()
        session_id = str(uuid5(UUID(command_id), owner))
        connection = self.database.connect()
        try:
            connection.begin()
            with connection.cursor(DictCursor) as cursor:
                existing = self._same_command(cursor, command_id, owner, fingerprint)
                if not existing:
                    settings = {k: v for k, v in payload.items() if k not in {"commandId", "ownerId", "questions"}}
                    if settings.get("workflowVersion") == "v2":
                        from .setup import direction
                        try:
                            direction(settings["directionId"])
                            allowed = {d["id"] for d in direction(settings["directionId"])["dimension_catalog"]}
                            profile = settings.get("jobProfile")
                            if profile is None or not profile["dimensions"] or any(d not in allowed for d in profile["dimensions"]):
                                raise ValueError("请选择当前方向的考察维度")
                        except ValueError as exc:
                            raise InterviewFailure(str(exc), 422) from None
                        settings["maxQuestions"] = {"short": 5, "standard": 8, "deep": 12}[settings["depth"]]
                    else:
                        settings["maxQuestions"] = min(settings["maxQuestions"], len(payload["questions"]))
                    payload["maxQuestions"] = settings["maxQuestions"]
                    summary = {"settings": settings, "currentQuestion": None, "turns": [], "report": None,
                               "progress": {"mainIndex": 0, "total": settings["maxQuestions"]}}
                    cursor.execute("INSERT INTO interview_sessions(id,owner_id,status,pending_command,summary) "
                                   "VALUES(%s,%s,'preparing',%s,%s)", (session_id, owner, command_id, encode(summary)))
                    cursor.execute("INSERT INTO interview_commands(id,session_id,owner_id,body_hash,payload,action,state) "
                                   "VALUES(%s,%s,%s,%s,%s,'create','queued')",
                                   (command_id, session_id, owner, fingerprint, encode(payload)))
                else:
                    session_id = existing
            connection.commit()
        except pymysql.IntegrityError:
            connection.rollback()
            # 并发重复创建可能同时经过第一次查询；唯一约束后再次核对正文。
            with connection.cursor(DictCursor) as cursor:
                existing = self._same_command(cursor, command_id, owner, fingerprint)
                if not existing:
                    raise
                session_id = existing
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return self.get(session_id, owner)

    def submit(self, session_id, owner, body):
        payload = body.model_dump(mode="json")
        payload.update({"sessionId": session_id, "ownerId": owner})
        fingerprint = hashlib.sha256(encode(payload).encode()).hexdigest()
        connection = self.database.connect()
        try:
            connection.begin()
            with connection.cursor(DictCursor) as cursor:
                row = self._row(cursor, session_id, owner, lock=True)
                existing = self._same_command(cursor, payload["commandId"], owner, fingerprint)
                if not existing:
                    if row["pending_command"] or row["version"] != body.expectedVersion:
                        raise InterviewFailure("面试状态已变化，请刷新后操作")
                    if row["status"] == "completed":
                        raise InterviewFailure("面试已经结束")
                    if row["status"] not in {"waiting_answer", "failed"}:
                        raise InterviewFailure("当前状态不允许此操作")
                    if body.action == "retry" and row["status"] != "failed":
                        raise InterviewFailure("当前没有失败操作需要重试")
                    if row["status"] == "failed" and body.action not in {"retry", "end"}:
                        raise InterviewFailure("请先重试失败操作或结束面试")
                    current = decode(row["summary"]).get("currentQuestion")
                    if body.action in {"answer", "skip", "hint"} and (not current or body.questionId != current["id"]):
                        raise InterviewFailure("题目已变化，请刷新后回答")
                    if body.action == "hint" and (current.get("kind") == "self_intro" or len(current.get("hints", [])) >= 2
                            or decode(row["summary"]).get("settings", {}).get("workflowVersion") != "v2"):
                        raise InterviewFailure("当前题目不能继续请求提示")
                    if body.action == "answer" and not body.answer.strip():
                        raise InterviewFailure("请输入回答内容", 422)
                    cursor.execute("INSERT INTO interview_commands(id,session_id,owner_id,body_hash,payload,action,state) "
                                   "VALUES(%s,%s,%s,%s,%s,%s,'queued')", (payload["commandId"], session_id, owner,
                                   fingerprint, encode(payload), body.action))
                    cursor.execute("UPDATE interview_sessions SET status='processing',pending_command=%s WHERE id=%s",
                                   (payload["commandId"], session_id))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return self.get(session_id, owner)

    def _claim(self):
        connection = self.database.connect()
        try:
            connection.begin()
            with connection.cursor(DictCursor) as cursor:
                cursor.execute("SELECT * FROM interview_commands WHERE state='queued' ORDER BY created_at LIMIT 1 FOR UPDATE")
                command = cursor.fetchone()
                if command:
                    cursor.execute("UPDATE interview_commands SET state='running' WHERE id=%s", (command["id"],))
            connection.commit()
            return command
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _execute(self, command):
        payload = decode(command["payload"])
        config = {"configurable": {"thread_id": command["session_id"]}, "recursion_limit": 80}
        version = payload.get("workflowVersion", "v1")
        def chat(messages):
            call = self.gateway.chat(messages, max_tokens=4096) if version == "v2" else self.gateway.chat(messages)
            future = asyncio.run_coroutine_threadsafe(call, self.loop)
            return future.result(timeout=self.gateway.settings.model_timeout_seconds + 5)
        def retrieve(questions, query, used_sources):
            future = asyncio.run_coroutine_threadsafe(self.retriever.retrieve(questions, query, used_sources), self.loop)
            try:
                return future.result(timeout=185)
            except TimeoutError:
                future.cancel()
                raise ModelFailure("KNOWLEDGE_TIMEOUT", 504) from None
        retrieval = retrieve if self.retriever else None
        with mysql_checkpointer(self.database) as saver:
            # 老会话继续使用原图，v2 新会话显式加入自我介绍，不误恢复历史检查点。
            graph = build_interview_graph(saver, chat, version=payload.get("workflowVersion", "v1"), retrieve=retrieval)
            if command["action"] != "create":
                connection = self.database.connect()
                try:
                    with connection.cursor(DictCursor) as cursor:
                        row = self._row(cursor, command["session_id"], command["owner_id"])
                        version = decode(row["summary"]).get("settings", {}).get("workflowVersion", "v1")
                        graph = build_interview_graph(saver, chat, version=version, retrieve=retrieval)
                finally:
                    connection.close()
            def start_graph(initial_payload):
                # 创建命令本身保存完整题目快照，即使首个检查点写入前中断也可恢复。
                settings = {k: v for k, v in initial_payload.items() if k not in {"questions", "commandId", "ownerId"}}
                pool = initial_payload["questions"] if settings.get("workflowVersion") == "v2" else initial_payload["questions"][:initial_payload["maxQuestions"]]
                graph.invoke({"setup": settings, "questions": pool,
                              "main_index": 0, "turns": [], "status": "preparing"}, config)
            try:
                if command["action"] == "create":
                    start_graph(payload)
                elif command["action"] == "retry":
                    # 已失败节点由持久化图恢复；显式重试可能再次调用模型，不能承诺只计费一次。
                    if graph.get_state(config).values:
                        if version == "v2" and graph.get_state(config).next == ("verify",):
                            # 验证失败意味着评价输出需要重做，不能反复校验同一份错误引用。
                            graph.update_state(config, {"action": "answer"}, as_node="wait_answer")
                        graph.invoke(None, config)
                    else:
                        connection = self.database.connect()
                        try:
                            with connection.cursor(DictCursor) as cursor:
                                cursor.execute("SELECT payload FROM interview_commands WHERE session_id=%s AND owner_id=%s "
                                               "AND action='create' LIMIT 1", (command["session_id"], command["owner_id"]))
                                original = cursor.fetchone()
                                if original is None:
                                    raise RuntimeError("Initial interview command missing")
                                start_graph(decode(original["payload"]))
                        finally:
                            connection.close()
                elif command["action"] == "end" and graph.get_state(config).next != ("wait_answer",):
                    state = graph.get_state(config).values
                    if version == "v2":
                        # 结束失败会话也经过真实报告节点，不把本地摘要冒充完整报告。
                        graph.update_state(config, {"action": "end"}, as_node="wait_answer")
                        graph.invoke(None, config)
                    else:
                        graph.update_state(config, {"status": "completed", "report": make_report(state)}, as_node="report")
                else:
                    graph.invoke(Command(resume={"action": payload["action"], "answer": payload.get("answer", "")}), config)
                state = graph.get_state(config).values
                self._finish(command, state, None)
            except Exception as exc:
                kind = exc.kind if isinstance(exc, ModelFailure) else "EXECUTION_FAILED"
                log.warning("interview command=%s type=%s", command["id"], kind)
                # 尽量保留已提交的真实轮次；数据库不可用时由启动恢复扫描标记未知结果。
                state = graph.get_state(config).values
                self._finish(command, state, kind)

    def _finish(self, command, state, error):
        self.ensure_worker()
        settings = state.get("setup", {})
        summary = {"settings": settings, "currentQuestion": state.get("current"), "turns": state.get("turns", []),
                   "report": state.get("report"), "progress": {"mainIndex": state.get("main_index", 0),
                                                                  "total": settings.get("maxQuestions", len(state.get("questions", [])))},
                   "phase": state.get("phase"), "candidateProfile": state.get("candidate_profile")}
        connection = self.database.connect()
        try:
            connection.begin()
            with connection.cursor() as cursor:
                cursor.execute("UPDATE interview_sessions SET summary=%s,status=%s,version=version+1,pending_command=NULL "
                               "WHERE id=%s AND pending_command=%s", (encode(summary), "failed" if error else state["status"],
                                                                       command["session_id"], command["id"]))
                if cursor.rowcount != 1:
                    raise RuntimeError("Interview execution ownership changed")
                cursor.execute("UPDATE interview_commands SET state=%s,error_code=%s WHERE id=%s",
                               ("failed" if error else "succeeded", error, command["id"]))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    async def _work(self):
        recovery_required = False
        while not self.stopping:
            try:
                await asyncio.to_thread(self.ensure_worker)
                if recovery_required:
                    # 存储恢复后先处理上一条未确认命令，不把用户永久留在处理中。
                    await asyncio.to_thread(self.mark_interrupted)
                    recovery_required = False
                command = await asyncio.to_thread(self._claim)
                if command:
                    await asyncio.to_thread(self._execute, command)
                else:
                    job = await asyncio.to_thread(self.setup_jobs.claim)
                    if job:
                        def chat(messages):
                            future = asyncio.run_coroutine_threadsafe(
                                self.gateway.chat(messages, max_tokens=8192, json_mode=True), self.loop)
                            return future.result(timeout=self.gateway.settings.model_timeout_seconds + 5)
                        await asyncio.to_thread(self.setup_jobs.execute, job, chat, self.ensure_worker)
                    else:
                        await asyncio.sleep(0.4)
            except WorkerOwnershipLost:
                self.stopping = True
                log.error("interview worker ownership lost; restart required")
            except Exception:
                # 关键失败不伪装成成功；运行中命令留待显式恢复，不自动重放模型。
                log.error("interview worker persistence failure")
                recovery_required = True
                await asyncio.sleep(1)
