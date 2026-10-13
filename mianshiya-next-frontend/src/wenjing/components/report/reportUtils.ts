import { ApiError } from "@/wenjing/lib/api/client";
import type { FinalReport, LLMErrorKind, RubricScore } from "@/wenjing/lib/api/types";
import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import { verdictShortLabel, verdictTone } from "@/wenjing/lib/constants/verdicts";

export function isSystemFallbackText(value?: string | null): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  return [
    "evaluator llm unavailable",
    "evaluator llm failed",
    "conservative fallback",
    "评估模型暂时不可用",
    "保守兜底评价",
  ].some((marker) => lower.includes(marker.toLowerCase()));
}

export function translateReportText(value?: string | null): string {
  const text = String(value ?? "");
  if (!text) return text;

  const exact: Record<string, string> = {
    "Evaluator LLM failed before returning a score. The interview continues with a conservative fallback rather than dropping the session.":
      "评估模型暂时不可用，已先使用保守评价保留本轮回答。",
    "Evaluator LLM unavailable; using conservative fallback.":
      "评估模型暂时不可用，已使用保守兜底评价。",
    "Evaluator LLM unavailable.":
      "评估模型暂时不可用。",
    "Addresses the most repeated evaluator weakness.":
      "针对本次面试中反复出现的待改进项。",
    "Demonstrate improvement via a mock re-interview.":
      "通过一次模拟复盘面试验证改进效果。",
    "Internalise learnings via a production-grade project.":
      "在一个接近真实生产场景的项目中巩固改进。",
    "Identify the most pressing weak dimension.":
      "先识别当前最需要补强的能力维度。",
  };
  if (exact[text]) return exact[text];

  const flagged = text.match(/^Evaluator flagged this in (\d+) turn\(s\) for (.+)\.$/);
  if (flagged) {
    return `评估器在 ${flagged[1]} 轮「${formatDimensionName(flagged[2])}」中都标记了这个问题。`;
  }

  const drill = text.match(/^Run a targeted drill on '(.+)' in (.+)\.$/);
  if (drill) {
    return `围绕「${translateReportText(drill[1])}」做一次${formatDimensionName(drill[2])}专项练习。`;
  }

  const closeWeakness = text.match(/^Close the top-1 weakness in (.+)$/);
  if (closeWeakness) {
    return `完成「${formatDimensionName(closeWeakness[1])}」中最优先待改进项的补强。`;
  }

  const overall = text.match(/^Overall verdict: ([^@.]+)(?: @ ([^.\s]+))?\.?(?: Focus next on (.+)\.)?$/);
  if (overall) {
    const verdict = verdictShortLabel(overall[1].trim());
    const scoreValue = overall[2] ? Number(overall[2]) : null;
    const score =
      scoreValue !== null && Number.isFinite(scoreValue)
        ? `，总分 ${scoreValue.toFixed(2)}`
        : "";
    const focus = overall[3]
      ? `。下一阶段优先提升「${formatDimensionName(overall[3])}」。`
      : "。";
    return `综合结论：${verdict}${score}${focus}`;
  }

  return text;
}

export function isRunningReportError(err: unknown, message: string): boolean {
  return (
    (err instanceof ApiError && err.status === 409) ||
    message.startsWith("409")
  );
}

export function friendlyReportError(kind: LLMErrorKind | null): string {
  switch (kind) {
    case "auth":
      return "保存的模型密钥可能已过期、被撤销，或没有当前模型权限。更新密钥后再开始一场即可。";
    case "quota":
      return "当前模型配置的额度不足或余额耗尽。可以换一个 Key，或到厂商控制台检查余额。";
    case "rate_limit":
      return "模型服务暂时被限流了。稍后再试，或换一个额度更充足的 Key。";
    case "timeout":
    case "network":
      return "网络或模型服务暂时不稳定。这通常不是你的回答问题，稍后重试就好。";
    case "misconfig":
      return "模型名称、服务商或 Base URL 可能不匹配。检查 API 设置后再试。";
    default:
      return "面试过程中模型调用失败了。你可以查看技术细节，或调整 API 设置后重新开始。";
  }
}

export function llmErrorKindLabel(kind: LLMErrorKind | null | undefined): string {
  switch (kind) {
    case "auth":
      return "密钥失效或无权限";
    case "quota":
      return "额度不足或余额耗尽";
    case "rate_limit":
      return "请求太频繁";
    case "timeout":
      return "请求超时";
    case "network":
      return "网络或服务暂时不可用";
    case "misconfig":
      return "模型或 Base URL 配置有误";
    default:
      return "未知错误";
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatRate(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
}

export function reportGrowthSignal(report: FinalReport): string | undefined {
  const growthSignal =
    typeof report.growth_signal === "string" ? report.growth_signal : undefined;
  const overallVerdict =
    typeof report.overall_verdict === "string" ? report.overall_verdict : undefined;
  const internalVerdict =
    typeof report.verdict === "string" ? report.verdict : undefined;
  return growthSignal ?? overallVerdict ?? internalVerdict;
}

function scoreBasedGrowthSignal(report: FinalReport): string | undefined {
  const existingSignal = reportGrowthSignal(report);
  if (existingSignal === "cancelled" || report.cancelled === true) {
    return "cancelled";
  }

  const score = asNumber(report.overall_score);
  if (score === null) return undefined;

  const threshold = asNumber(report.quality_threshold) ?? 7.5;
  if (score >= threshold + 0.5) return "excellent";
  if (score >= threshold) return "target_met";
  if (score >= threshold - 1.5) return "near_target";
  return "needs_focus";
}

export function displayGrowthSignal(report: FinalReport): string | undefined {
  const scoreSignal = scoreBasedGrowthSignal(report);
  return scoreSignal ?? reportGrowthSignal(report);
}

export type AntTagColor = "success" | "warning" | "error" | "default";

export function verdictTagColor(v?: string): AntTagColor {
  const tone = verdictTone(v);
  if (tone === "positive") return "success";
  if (tone === "mixed") return "warning";
  if (tone === "negative") return "error";
  return "default";
}

export const DEFAULT_DIMENSION_QUALITY_THRESHOLD = 7.5;

function hasDimensionScoreEvidence(score: RubricScore): boolean {
  const hasRationale =
    typeof score.rationale === "string" && score.rationale.trim().length > 0;
  const hasWeakness =
    Array.isArray(score.weaknesses) &&
    score.weaknesses.some((item) => String(item ?? "").trim().length > 0);
  return hasRationale || hasWeakness;
}

export function hasDisplayableDimensionScore(
  score: RubricScore,
): score is RubricScore & { score: number } {
  if (typeof score.score !== "number" || !Number.isFinite(score.score)) {
    return false;
  }
  if (score.score_status === "scored") return true;
  if (score.score_status) return false;
  return score.score > 0 || hasDimensionScoreEvidence(score);
}

export function dimensionScoreLabel(score: RubricScore): string {
  if (hasDisplayableDimensionScore(score)) {
    return `${score.score.toFixed(1)} / 10`;
  }
  if (score.score_status === "skipped") return "已跳过";
  if (score.score_status === "evaluator_unavailable") return "评估失败";
  if (score.score_status === "not_evaluated") return "未评分";
  return "未评分";
}

export function dimensionScoreBreakdownLabel(score: RubricScore): string | null {
  const breakdown = score.score_breakdown;
  if (!breakdown) return null;
  const hasMultipleAnchors =
    typeof breakdown.anchor_count === "number" && breakdown.anchor_count > 1;
  if (!hasMultipleAnchors && !(breakdown.scored_turn_count > 1)) return null;
  if (hasMultipleAnchors) {
    const anchorValues = [
      breakdown.anchor_average_score,
      breakdown.best_anchor_score,
      breakdown.adopted_score,
    ];
    if (anchorValues.every((value) => Number.isFinite(value))) {
      return `本维度综合了 ${breakdown.anchor_count} 个简历锚点，锚点均值 ${breakdown.anchor_average_score!.toFixed(1)}，最佳锚点 ${breakdown.best_anchor_score!.toFixed(1)}；综合分 ${breakdown.adopted_score.toFixed(1)}。`;
    }
  }
  const values = [
    breakdown.latest_score,
    breakdown.best_score,
    breakdown.average_score,
    breakdown.adopted_score,
  ];
  if (!values.every((value) => Number.isFinite(value))) return null;
  return `本维度共评估 ${breakdown.scored_turn_count} 轮，最近 ${breakdown.latest_score.toFixed(1)}，最高 ${breakdown.best_score.toFixed(1)}，均值 ${breakdown.average_score.toFixed(1)}；综合分 ${breakdown.adopted_score.toFixed(1)}。`;
}

export type DimensionBadgeTone = "success" | "warning" | "muted";

export function dimensionBadgeMeta(score: RubricScore): {
  label: string;
  tone: DimensionBadgeTone;
} {
  if (hasDisplayableDimensionScore(score)) {
    if (score.coverage_status === "passed" || score.passed) {
      return { label: "通过", tone: "success" };
    }
    if (score.coverage_status === "coverage_limited") {
      return { label: "覆盖不足", tone: "warning" };
    }
    if (
      score.coverage_status === "below_threshold" ||
      score.score < DEFAULT_DIMENSION_QUALITY_THRESHOLD
    ) {
      return { label: "待提升", tone: "warning" };
    }
    return { label: "覆盖不足", tone: "warning" };
  }
  if (score.score_status === "skipped") {
    return { label: "已跳过", tone: "muted" };
  }
  if (score.score_status === "evaluator_unavailable") {
    return { label: "评估失败", tone: "warning" };
  }
  return { label: "未评分", tone: "muted" };
}

export function dimensionBadgeColor(tone: DimensionBadgeTone): AntTagColor {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  return "default";
}

export function compactDimensionScores(
  scores: FinalReport["dimension_scores"],
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [dimension, score] of Object.entries(scores ?? {})) {
    if (score && hasDisplayableDimensionScore(score)) {
      out[dimension] = score.score;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildWeakPracticeHref(report: FinalReport): string | null {
  const focus: string[] = [];
  const add = (dimension: unknown) => {
    if (typeof dimension !== "string" || !dimension.trim()) return;
    if (!focus.includes(dimension)) focus.push(dimension);
  };

  for (const weakness of report.training_plan?.priority_weaknesses ?? []) {
    add(weakness.dimension);
  }
  for (const [dimension, score] of Object.entries(report.dimension_scores ?? {})) {
    if (
      score &&
      hasDisplayableDimensionScore(score) &&
      (score.passed === false || score.score < 7)
    ) {
      add(dimension);
    }
  }
  for (const item of Array.isArray(report.coverage_warnings)
    ? report.coverage_warnings
    : []) {
    if (item && typeof item === "object") {
      add((item as { dimension?: unknown }).dimension);
    }
  }

  if (focus.length === 0) return null;
  const params = new URLSearchParams();
  params.set("focus", focus.slice(0, 5).join(","));
  params.set("length", "short");
  const jobTitle = typeof report.job_title === "string" ? report.job_title : "";
  const jobLevel = typeof report.job_level === "string" ? report.job_level : "";
  if (jobTitle) params.set("job_title", jobTitle);
  if (jobLevel) params.set("job_level", jobLevel);
  if (typeof report.session_id === "string" && report.session_id) {
    params.set("resume_from", report.session_id);
  }
  return `/interview/setup?${params.toString()}`;
}
