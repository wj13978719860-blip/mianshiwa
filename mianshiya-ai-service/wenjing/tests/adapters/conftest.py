from __future__ import annotations

import os
from pathlib import Path

# 集成测试凭证来自被 git 忽略的运行时 env 文件；只补齐未显式设置的变量。
_ENV_FILE = os.environ.get("WENJING_INTEGRATION_ENV_FILE", "")
_KEYS = ("AI_MYSQL_HOST", "AI_MYSQL_PORT", "AI_MYSQL_USER", "AI_MYSQL_PASSWORD", "AI_ES_URL")
if _ENV_FILE and Path(_ENV_FILE).is_file():
    for line in Path(_ENV_FILE).read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in _KEYS:
            os.environ.setdefault(key.strip(), value.strip().strip('"'))
