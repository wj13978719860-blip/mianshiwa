"""核对并启用问镜自带数据，不连接原刷题题库、不输出私有凭证。

默认只读检查；--apply 导入结构化题目，并仅将上游允许的知识文档写入 ES。
本机运行：.runtime/ai-venv/Scripts/python.exe scripts/prepare-wenjing-data.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mianshiya-ai-service"))


def load_private_env() -> None:
    """与启动脚本一致：调用者显式指定的环境变量优先。"""
    path = ROOT / ".runtime" / "ai-service.env"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key, value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="导入数据；默认仅检查")
    args = parser.parse_args()
    load_private_env()
    from sqlalchemy import func, select
    from app.wenjing.core.settings import get_settings
    from app.wenjing.engine.rag.ingestion import _iter_documents
    from app.wenjing.engine.rag.vectorstore import get_vectorstore
    from app.wenjing.models import get_session
    from app.wenjing.models.question_bank import QuestionSeed, QuestionVariant
    from app.wenjing.services.question_seed_import import import_question_seed_dir

    settings = get_settings()
    knowledge = Path(settings.knowledge_dir)
    items = _iter_documents(knowledge)
    report = {
        "checkpoint": settings.checkpoint_backend,
        "vector_backend": settings.vector_backend,
        "embedding_model": settings.resume_rag_embedding_model,
        "embedding_dimensions": settings.resume_rag_embedding_dimension,
        "question_selector": settings.question_selector_mode,
        "seed_files": len(list((knowledge / "question_seeds").glob("*.yaml"))),
        "public_knowledge_chunks": len(items),
        "public_knowledge_sources": sorted({meta["source"] for _, meta in items}),
        "resume_cache": settings.resume_parse_cache_backend,
        "rate_limit": settings.rate_limit_backend,
    }
    with get_session() as db:
        if args.apply:
            # 原版导入器按 ID 和版本更新，不归档、不删除现存题目。
            report["import"] = asdict(import_question_seed_dir(knowledge / "question_seeds", session=db))
            db.flush()
        report["seeds"] = db.scalar(select(func.count()).select_from(QuestionSeed))
        report["variants"] = db.scalar(select(func.count()).select_from(QuestionVariant))
    store = get_vectorstore()
    if not store.is_remote or store.is_degraded:
        raise RuntimeError("知识库未连接真实向量库，不能将内存降级报告为入库成功")
    if args.apply and items:
        # 分批向量化，避免单次请求超过 Embedding 服务的批量限制。
        for start in range(0, len(items), 10):
            batch = items[start:start + 10]
            store.add([text for text, _ in batch], [meta for _, meta in batch])
            if store.is_degraded:
                raise RuntimeError("知识库入库失败；已完成批次可安全重试")
    report["es_knowledge_documents"] = store.count()
    report["public_knowledge_status"] = "available" if items else "no_upstream_documents"
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
