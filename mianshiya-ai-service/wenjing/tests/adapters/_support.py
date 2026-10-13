from __future__ import annotations

import os

import pytest

TEST_DATABASE = "mianshiwa_ai_wenjing_test"


def _enabled(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes"}


mysql_integration = pytest.mark.skipif(
    not _enabled("AI_MYSQL_INTEGRATION"), reason="set AI_MYSQL_INTEGRATION=1 to run"
)
es_integration = pytest.mark.skipif(
    not _enabled("AI_ES_INTEGRATION"), reason="set AI_ES_INTEGRATION=1 to run"
)
