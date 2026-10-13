/**
 * 第一期不开放浏览器自带模型配置：Java 网关会拒绝携带 llm_config 的请求，
 * 因此 buildLLMPayload 恒为 undefined。错误分类函数与上游逐字一致。
 */
import { ApiError } from "@/wenjing/lib/api/client";
import type { LLMErrorKind as ApiLLMErrorKind } from "@/wenjing/lib/api/types";

export type LLMErrorKind = ApiLLMErrorKind;

export function buildLLMPayload(): undefined {
  return undefined;
}
function inferLLMErrorKindFromText(text: string): LLMErrorKind {
  const blob = text.toLowerCase();
  if (
    [
      "invalid api key",
      "api key invalid",
      "incorrect api key",
      "authentication",
      "unauthorized",
      "forbidden",
      "permission denied",
      "not authorized",
      "401",
      "403",
    ].some((token) => blob.includes(token))
  ) {
    return "auth";
  }
  if (
    ["quota", "insufficient_quota", "billing", "balance", "credit", "credits"].some(
      (token) => blob.includes(token),
    )
  ) {
    return "quota";
  }
  if (
    ["rate limit", "ratelimit", "too many requests", "429"].some((token) =>
      blob.includes(token),
    )
  ) {
    return "rate_limit";
  }
  if (["timeout", "timed out"].some((token) => blob.includes(token))) {
    return "timeout";
  }
  if (
    [
      "network",
      "connection",
      "failed to fetch",
      "fetch",
      "dns",
      "socket",
      "reset by peer",
      "service unavailable",
      "gateway",
      "502",
      "503",
      "504",
    ].some((token) => blob.includes(token))
  ) {
    return "network";
  }
  if (
    [
      "base_url",
      "base url",
      "requires a base_url",
      "unsupported provider",
      "openai package is required",
      "anthropic package is required",
      "malformed",
      "bad request",
    ].some((token) => blob.includes(token))
  ) {
    return "misconfig";
  }
  return "unknown";
}

export function inferLLMErrorKind(error: unknown): LLMErrorKind {
  if (error instanceof ApiError) {
    const body = error.body as
      | {
          error_kind?: unknown;
          errorKind?: unknown;
          detail?: unknown;
        }
      | undefined;
    const bodyDetail =
      body && typeof body === "object" && "detail" in body
        ? (body.detail as
            | { error_kind?: unknown; errorKind?: unknown; error?: unknown }
            | string
            | undefined)
        : undefined;
    const fromBody =
      body && typeof body === "object"
        ? (body.error_kind ??
          body.errorKind ??
          (bodyDetail && typeof bodyDetail === "object"
            ? (bodyDetail.error_kind ?? bodyDetail.errorKind)
            : undefined))
        : undefined;
    if (typeof fromBody === "string") {
      const normalized = fromBody.trim();
      if (
        normalized === "auth" ||
        normalized === "quota" ||
        normalized === "rate_limit" ||
        normalized === "timeout" ||
        normalized === "network" ||
        normalized === "misconfig" ||
        normalized === "unknown"
      ) {
        return normalized;
      }
    }
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status === 429) return "rate_limit";
    if (error.status === 408 || error.status === 504) return "timeout";
    if (error.status === 422) return "misconfig";
    if (error.status >= 500) return "network";
    const detail =
      body && typeof body === "object" && typeof body.detail === "string"
        ? body.detail
        : bodyDetail &&
            typeof bodyDetail === "object" &&
            typeof bodyDetail.error === "string"
          ? bodyDetail.error
        : error.message;
    return inferLLMErrorKindFromText(detail);
  }
  if (error instanceof Error) {
    return inferLLMErrorKindFromText(`${error.name}: ${error.message}`);
  }
  return inferLLMErrorKindFromText(String(error));
}
