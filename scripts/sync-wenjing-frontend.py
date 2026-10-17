"""把上游问镜前端的数据层（lib/）同步到 mianshiya-next-frontend/src/wenjing/lib，只做机械改写。

用法：
    python scripts/sync-wenjing-frontend.py           # 同步（适配文件不覆盖）
    python scripts/sync-wenjing-frontend.py --check   # 校验非适配文件与上游逐字一致（改写后）

只同步第一期闭环用到的 API 客户端、轮询 hook、本地存储、常量与工具函数；
页面组件用 Ant Design 重写，不在这里同步。

机械改写规则：
    1. 路径别名 "@/lib/ -> "@/wenjing/lib/
    2. 去掉相对导入里的 .ts 后缀（本仓库未开启 allowImportingTsExtensions）
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / ".runtime" / "reference" / "Agentic_Interviewer" / "ai-interviewer" / "frontend" / "src"
TARGET = ROOT / "mianshiya-next-frontend" / "src" / "wenjing"

FILES = (
    "lib/api/client.ts",
    "lib/api/account.ts",
    "lib/api/trace.ts",
    "lib/hooks/useQuestionPoller.ts",
    "lib/constants/index.ts",
    "lib/constants/interview.ts",
    "lib/constants/job-levels.ts",
    "lib/constants/scores.ts",
    "lib/constants/storage-keys.ts",
    "lib/constants/verdicts.ts",
    "lib/sessionDelta.ts",
    "lib/resume-upload.ts",
    "lib/report-export.ts",
    "lib/job-template.ts",
)

# 本仓库维护的适配文件：同步时不覆盖，--check 时列出差异行数。
ADAPTED = {
    # 定向岗位面试的原始 JD 与确认状态是面试蛙适配，不能被上游覆盖。
    "lib/api/types.ts",
    # 回答幂等键使用上游接受的字符，保证网络重试不会变成重复提交。
    "lib/api/interview.ts",
    # 面试材料按面试蛙用户隔离，并在账号切换时清理，不能被上游同步覆盖。
    "lib/storage/interviewHistory.ts",
    "lib/storage/setupDrafts.ts",
    # API 基址改为 Java 网关 /api/ai/wenjing（会话 Cookie 由 Sa-Token 管理）。
    "lib/config.ts",
    # 第一期不允许浏览器自带模型配置（网关拒绝 llm_config），只保留错误分类。
    "lib/llm-config.ts",
}

_ALIAS_RE = re.compile(r"""(["'])@/lib/""")
_TS_EXT_RE = re.compile(r"""(from\s+["']\.{1,2}/[^"']+)\.ts(["'])""")


def _rewrite(text: str) -> str:
    text = _ALIAS_RE.sub(r"\1@/wenjing/lib/", text)
    return _TS_EXT_RE.sub(r"\1\2", text)


def _expected(rel: str) -> str:
    return _rewrite((UPSTREAM / rel).read_text(encoding="utf-8"))


def sync() -> int:
    for rel in FILES:
        dst = TARGET / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(_expected(rel), encoding="utf-8", newline="")
    kept = sum(1 for rel in ADAPTED if (TARGET / rel).exists())
    print(f"synced {len(FILES)} files, kept {kept} adapted files")
    return 0


def check() -> int:
    drift: list[str] = []
    for rel in FILES:
        dst = TARGET / rel
        if not dst.exists():
            drift.append(f"missing  {rel}")
        elif dst.read_text(encoding="utf-8") != _expected(rel):
            drift.append(f"modified {rel}")
    for rel in sorted(ADAPTED):
        dst = TARGET / rel
        if not dst.exists():
            drift.append(f"missing  {rel}")
            continue
        diff = difflib.unified_diff(
            _expected(rel).splitlines(), dst.read_text(encoding="utf-8").splitlines(), lineterm="", n=0
        )
        changed = sum(1 for line in diff if line[:1] in "+-" and line[:3] not in ("+++", "---"))
        print(f"adapted  {rel}  ({changed} lines differ)")
    lib = TARGET / "lib"
    known = set(FILES) | ADAPTED
    for path in lib.rglob("*") if lib.is_dir() else ():
        rel = path.relative_to(TARGET).as_posix()
        if path.is_file() and rel not in known and rel not in {"lib/storage/userStorage.ts", "lib/jd-setup.ts"}:
            drift.append(f"extra    {rel}")
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
