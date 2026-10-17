"""按登录用户读取跨场重点使用记录，只保存调度计数，不引入历史回答。"""
from __future__ import annotations

import hashlib
import re
from typing import Any

from sqlalchemy import select

from app.wenjing.core.logging import get_logger
from app.wenjing.models.base import get_session
from app.wenjing.models.interview_session import InterviewSession
from app.wenjing.models.strategy_learning import InterviewTurn

log = get_logger(__name__)


def focus_history_key(project_name: Any, label: Any) -> str:
    # 不依赖解析时的 f1/p1 顺序，用户重新解析或调整排序仍可匹配同一重点。
    parts = [re.sub(r"\s+", "", str(value or "").lower()) for value in (project_name, label)]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:24]


def load_focus_history(owner_user_id: int | None, current_session_id: str) -> dict[str, Any]:
    if owner_user_id is None:
        return {"status": "anonymous", "counts": {}}
    try:
        with get_session() as db:
            # 在 SQL 层限定所有者；只读取最近 200 条，不带回题干、回答或其他用户数据。
            rows = db.execute(
                select(InterviewTurn.resume_anchor_label, InterviewTurn.resume_project_id,
                       InterviewTurn.selection_artifacts, InterviewSession.setup_snapshot)
                .join(InterviewSession, InterviewSession.session_id == InterviewTurn.session_id)
                .where(InterviewSession.owner_user_id == owner_user_id,
                       InterviewSession.session_id != current_session_id)
                .order_by(InterviewTurn.created_at.desc(), InterviewTurn.id.desc()).limit(200)
            ).all()
        counts: dict[str, int] = {}
        for label, project_id, artifacts, snapshot in rows:
            anchor = (artifacts or {}).get("resume_anchor") or {}
            project_name = anchor.get("project_name")
            if not project_name:
                projects = ((snapshot or {}).get("candidate") or {}).get("resume_parsed", {}).get("projects", [])
                project_name = next((p.get("name") for p in projects
                                     if isinstance(p, dict) and str(p.get("id")) == str(project_id)), "")
            if not label or not project_name:
                continue
            key = focus_history_key(project_name, label)
            counts[key] = counts.get(key, 0) + 1
        return {"status": "loaded", "counts": counts, "sampled_turns": len(rows)}
    except Exception as exc:
        # 读取失败不影响开场，但必须留下可观察状态，不能假装已启用跨场轮换。
        log.warning("跨场重点记录读取失败，使用本场调度：%s", type(exc).__name__)
        return {"status": "unavailable", "counts": {}}
