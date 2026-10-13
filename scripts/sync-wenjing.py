"""把上游问镜后端同步到 mianshiya-ai-service，只做机械改写。

用法：
    python scripts/sync-wenjing.py           # 同步（适配文件不覆盖）
    python scripts/sync-wenjing.py --check   # 校验非适配文件与上游逐字一致（改写后）

目录映射（上游 ai-interviewer/backend 根 -> 本仓库）：
    backend/app/**        -> mianshiya-ai-service/app/wenjing/**
    backend/knowledge/**  -> mianshiya-ai-service/wenjing/knowledge/**
    backend/tests/**      -> mianshiya-ai-service/wenjing/tests/**

机械改写规则（仅此几条，其它内容逐字保留）：
    1. 包前缀 app. -> app.wenjing.（import 语句与字符串里的模块路径）
    2. app 包内 Path(__file__).resolve().parents[2] 指向上游 backend 根，
       改为 parents[3] / "wenjing"
    3. 测试里 parents[2] / "app" 指向上游包目录，改为 parents[3] / "app" / "wenjing"
"""

from __future__ import annotations

import argparse
import difflib
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / ".runtime" / "reference" / "Agentic_Interviewer" / "ai-interviewer" / "backend"
UPSTREAM_COMMIT = "0c64377b7758d3bf12ac51073d9b92246f1dc669"
SERVICE = ROOT / "mianshiya-ai-service"
PKG = SERVICE / "app" / "wenjing"
DATA = SERVICE / "wenjing"

# 适配层：MySQL / ES / MySQL checkpointer / 网关鉴权 / 配置。
# 这些文件由本仓库维护，同步时不会被覆盖，--check 时单独列出与上游的差异行数。
ADAPTED = {
    # PostgreSQL -> MySQL：engine URL、增量列 DDL、utf8mb4_bin 建表。
    "app/models/base.py",
    # pgvector 列 -> ES 锚点索引（adapters/anchor_vectors.py）。
    "app/models/session_anchor.py",
    "app/models/resume_anchor_cache.py",
    # PostgresSaver -> PyMySQLSaver。
    "app/engine/workflow/langgraph_workflow.py",
    # Chroma -> ES 知识库索引。
    "app/engine/rag/vectorstore.py",
    # Cookie 登录 -> Java 网关 X-Owner-Id。
    "app/services/user_auth.py",
    # 第一期不计次。
    "app/services/user_credits.py",
    # MySQL 不支持 UPDATE ... RETURNING。
    "app/services/resume_parse_artifacts.py",
    # 新增 mysql/ES/网关配置，并映射面试蛙已有环境变量。
    "app/core/settings.py",
    # 向量维度断言从 pgvector 列改为 ES 锚点索引。
    "tests/unit/test_session_anchor_chunk_model.py",
}

# 不同步的上游文件及原因，--check 时不报缺失。
EXCLUDED = {
    "tests/unit/test_resume_rag_rollout_docs.py": "校验上游 README/docs 的 pgvector 部署说明，本仓库部署文档不同",
    "tests/unit/test_skills_db_deployment_docs.py": "校验上游仓库根目录的部署文档，本仓库未引入",
}

# 本仓库新增、上游不存在的文件（按前缀），--check 时不报“多余文件”。
LOCAL_ONLY_PREFIXES = (
    "app/adapters/",
    "tests/adapters/",
)

SKIP_DIRS = {"__pycache__", ".pytest_cache", "webdemo"}
# 运行时生成的状态文件（上游同样不入库）。
SKIP_FILES = {".dream_state.json"}

_IMPORT_RE = re.compile(r"(?m)^(\s*)(from|import)\s+app(?=[\s.])")
_STRING_RE = re.compile(r"""(?<=["'])app\.(?!wenjing\.)""")
_APP_ROOT_RE = re.compile(r"Path\(__file__\)\.resolve\(\)\.parents\[2\]")
_TEST_APP_RE = re.compile(r"parents\[2\]\s*/\s*\"app\"")


def _rewrite(rel: str, text: str) -> str:
    text = _IMPORT_RE.sub(lambda m: f"{m.group(1)}{m.group(2)} app.wenjing", text)
    text = _STRING_RE.sub("app.wenjing.", text)
    if rel.startswith("app/"):
        text = _APP_ROOT_RE.sub('Path(__file__).resolve().parents[3] / "wenjing"', text)
    elif rel.startswith("tests/"):
        text = _TEST_APP_RE.sub('parents[3] / "app" / "wenjing"', text)
    return text


def _iter_upstream():
    for top in ("app", "knowledge", "tests"):
        base = UPSTREAM / top
        for path in sorted(base.rglob("*")):
            if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
                continue
            rel = path.relative_to(UPSTREAM).as_posix()
            if rel not in EXCLUDED:
                yield rel, path


def _target(rel: str) -> Path:
    top, _, rest = rel.partition("/")
    if top == "app":
        return PKG / rest
    return DATA / top / rest


def _expected(rel: str, src: Path) -> bytes:
    if src.suffix == ".py":
        return _rewrite(rel, src.read_text(encoding="utf-8")).encode("utf-8")
    return src.read_bytes()


def sync() -> int:
    copied = kept = 0
    for rel, src in _iter_upstream():
        dst = _target(rel)
        if rel in ADAPTED and dst.exists():
            kept += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix == ".py":
            dst.write_bytes(_expected(rel, src))
        else:
            shutil.copyfile(src, dst)
        copied += 1
    print(f"synced {copied} files, kept {kept} adapted files (upstream {UPSTREAM_COMMIT[:7]})")
    return 0


def check() -> int:
    drift: list[str] = []
    adapted: list[tuple[str, int]] = []
    upstream_rels = set()
    for rel, src in _iter_upstream():
        upstream_rels.add(rel)
        dst = _target(rel)
        if not dst.exists():
            drift.append(f"missing  {rel}")
            continue
        want = _expected(rel, src)
        have = dst.read_bytes()
        if rel in ADAPTED:
            diff = difflib.unified_diff(
                want.decode("utf-8").splitlines(), have.decode("utf-8").splitlines(), lineterm="", n=0
            )
            changed = sum(1 for line in diff if line[:1] in "+-" and line[:3] not in ("+++", "---"))
            adapted.append((rel, changed))
        elif want != have:
            drift.append(f"modified {rel}")
    for top, base in (("app", PKG), ("tests", DATA / "tests"), ("knowledge", DATA / "knowledge")):
        for path in base.rglob("*"):
            if not path.is_file() or path.name in SKIP_FILES or any(part in SKIP_DIRS for part in path.parts):
                continue
            rel = f"{top}/{path.relative_to(base).as_posix()}"
            if rel not in upstream_rels and not rel.startswith(LOCAL_ONLY_PREFIXES):
                drift.append(f"extra    {rel}")
    for rel, changed in adapted:
        print(f"adapted  {rel}  ({changed} lines differ)")
    for line in drift:
        print(line)
    print(f"{len(drift)} unexpected differences")
    return 1 if drift else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not UPSTREAM.is_dir():
        print(f"upstream not found: {UPSTREAM}", file=sys.stderr)
        return 2
    return check() if args.check else sync()


if __name__ == "__main__":
    raise SystemExit(main())
