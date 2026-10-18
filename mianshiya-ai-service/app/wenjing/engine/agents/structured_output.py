"""Typed LLM boundaries with bounded, error-informed repair attempts.

Follows Instructor's schema -> validation -> error feedback -> retry pattern:
https://github.com/567-labs/instructor/blob/main/docs/concepts/retrying.md
No provider switch or second agent runtime is required. Transport retries are
disabled here so they cannot multiply the validation-attempt budget.
"""
from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from pydantic import BaseModel, ValidationError

from app.wenjing.core.logging import get_logger
from app.wenjing.core.settings import get_settings

from .llm_client import ChatMessage

log = get_logger(__name__)


class StructuredOutputError(ValueError):
    """No valid response within the attempt/time budget (no raw output stored)."""

    def __init__(self, schema: str, attempts: int, reason: str) -> None:
        self.schema = schema
        self.attempts = attempts
        self.reason = reason
        super().__init__(f"structured_output_invalid schema={schema} attempts={attempts} reason={reason}")


def _parse_object(raw: str) -> dict[str, Any]:
    """Accept fences/preamble, but not arrays, null, scalars or duplicate keys."""
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate_json_key")
            result[key] = value
        return result

    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()
    decoder = json.JSONDecoder(object_pairs_hook=unique_object)
    try:
        value = decoder.decode(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        value = decoder.decode(text[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("expected_json_object")
    return value


def call_structured(
    messages: list[ChatMessage],
    *,
    schema: type[BaseModel],
    call: Callable[..., str],
    validation_retries: int | None = None,
    repair_json: Callable[[str], dict[str, Any]] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Return validated fields; raise to let the caller choose its own fallback.

    Only JSON/schema failures trigger repair. Network/auth failures propagate
    immediately to existing domain-specific fallbacks. A shared deadline reduces
    the request timeout on subsequent calls; it is not a claim that synchronous
    SDK calls can be interrupted at an exact wall-clock deadline.
    """
    settings = get_settings()
    retries = max(0, min(2, int(
        getattr(settings, "structured_output_max_retries", 1)
        if validation_retries is None else validation_retries
    )))
    budget = max(0.1, float(getattr(settings, "structured_output_timeout_seconds", 90.0)))
    deadline = time.monotonic() + budget
    schema_text = json.dumps(schema.model_json_schema(), ensure_ascii=False)
    instruction = (
        "Return exactly one JSON object matching this JSON Schema. Use actual JSON "
        "booleans, arrays and finite numbers, not strings standing in for those types. "
        "Do not omit required fields. JSON Schema:\n" + schema_text
    )
    history = list(messages)
    if history and history[0].role == "system":
        history[0] = replace(history[0], content=history[0].content + "\n\n" + instruction)
    else:
        history.insert(0, ChatMessage("system", instruction))
    options = {**kwargs, "json_mode": True, "max_retries": 0, "provider_max_retries": 0}
    requested_timeout = options.get("request_timeout")
    reason = "invalid_json"
    attempts = 0
    for attempt in range(retries + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            reason = "deadline_exhausted"
            break
        # Retain the role's existing per-request timeout when it is shorter.
        from .llm_client import _effective_request_timeout

        role_timeout = _effective_request_timeout(
            request_timeout=requested_timeout,
            agent_role=options.get("agent_role"),
            settings=settings,
        )
        options["request_timeout"] = min(float(role_timeout), remaining)
        attempts += 1
        raw = call(history, **options)
        try:
            try:
                payload = _parse_object(raw)
            except json.JSONDecodeError:
                # Resume parsing already supports closing a truncated JSON
                # prefix. Any recovered object must still pass the full schema.
                if repair_json is None:
                    raise
                payload = repair_json(raw)
            validated = schema.model_validate(payload)
            if attempts > 1:
                log.info("structured_output_repaired schema=%s attempts=%d", schema.__name__, attempts)
            return validated.model_dump(exclude_unset=True)
        except ValidationError as exc:
            reason = "schema_validation_failed"
            feedback = json.dumps(
                exc.errors(include_input=False, include_context=False, include_url=False),
                ensure_ascii=False,
            )[:4000]
        except (ValueError, TypeError, AttributeError):
            reason = "empty_output" if isinstance(raw, str) and not raw.strip() else "invalid_json"
            feedback = "Response must be a single valid JSON object, without duplicate keys."
        # Neither raw answers nor validation input values enter logs/exceptions.
        log.warning("structured_output_invalid schema=%s attempt=%d reason=%s",
                    schema.__name__, attempts, reason)
        if attempt < retries:
            history.extend([
                ChatMessage("assistant", str(raw)[:12000]),
                ChatMessage("user", "The previous output failed validation. Correct only its "
                            "format/types and return the complete JSON object. Validation errors:\n" + feedback),
            ])
    raise StructuredOutputError(schema.__name__, attempts, reason)
