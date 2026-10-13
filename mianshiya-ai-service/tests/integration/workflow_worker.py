"""每次调用启动一个独立进程，用真实 MySQL 检验恢复而非内存假恢复。"""
import argparse
import json
import os
from uuid import uuid4

from langgraph.types import Command
from app.interview.checkpoints import MysqlCheckpointConfig, mysql_checkpointer
from app.interview.recovery_probe import build_recovery_probe


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["create", "read", "resume", "storage_failure", "transaction_failure", "crash"])
    parser.add_argument("thread")
    args = parser.parse_args()
    config = {"configurable": {"thread_id": args.thread}}
    with mysql_checkpointer(MysqlCheckpointConfig.from_env(), initialize=args.phase == "create") as saver:
        graph = build_recovery_probe(saver)
        if args.phase in {"create", "crash"}:
            graph.invoke({"session_id": args.thread}, config)
            if args.phase == "crash":
                # 非正常退出，不运行 finally；验证检查点不是靠退出时才落盘。
                os._exit(23)
        elif args.phase == "resume":
            graph.invoke(Command(resume="线程池复用线程。\n  保留回答原文。"), config)
        elif args.phase == "storage_failure":
            saver.conn.close()
            try:
                graph.invoke(Command(resume="此答案不应提交成功"), config)
            except Exception:
                print(json.dumps({"storage_failure_visible": True}))
                return
            raise AssertionError("Storage failure was silently ignored")
        elif args.phase == "transaction_failure":
            # 在真实事务里先写 blob，再故意让检查点 SQL 失败，检查是否完整回滚。
            saved = saver.get_tuple(config)
            checkpoint = dict(saved.checkpoint)
            checkpoint["id"] = str(uuid4())
            checkpoint["channel_values"] = dict(checkpoint["channel_values"], rollback_probe={"fixture": True})
            checkpoint["channel_versions"] = dict(checkpoint["channel_versions"], rollback_probe="999")
            with saver.conn.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM checkpoint_blobs WHERE thread_id=%s", (args.thread,))
                before = cursor.fetchone()[0]
            saver.UPSERT_CHECKPOINTS_SQL = "INSERT INTO missing_probe_table VALUES (" + ",".join(["%s"] * 7) + ")"
            failed = False
            try:
                saver.put(saved.config, checkpoint, {}, {"rollback_probe": "999"})
            except Exception:
                failed = True
            assert failed, "Checkpoint write failure was not propagated"
            with saver.conn.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM checkpoint_blobs WHERE thread_id=%s", (args.thread,))
                assert cursor.fetchone()[0] == before, "Checkpoint blob transaction did not roll back"
            print(json.dumps({"transaction_rollback_visible": True}))
            return
        state = graph.get_state(config)
        print(json.dumps({"values": state.values, "next": list(state.next)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
