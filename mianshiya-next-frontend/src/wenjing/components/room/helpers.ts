import type {
  LLMErrorKind,
  PollQuestion,
  PreviousTurnEvaluation,
  ResumeAnchor,
  ResumeHistoryTurn,
} from "@/wenjing/lib/api/types";
import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import type { AnswerInsight } from "./NextQuestionLoader";

export const ENCOURAGEMENTS = [
  "已收到回答，正在准备下一题。",
  "回答已提交，问镜正在整理追问。",
  "这一轮已记录，稍等片刻进入下一题。",
  "已保存本轮回答，继续保持节奏。",
  "提交成功，正在生成下一轮问题。",
];
export const ANSWER_MAX_LENGTH = 8000;

export type QaEntry = {
  turnIdx: number | null;
  formalTurnIdx?: number | null;
  displayTurnIdx?: number | null;
  questionType?: string;
  dimension?: string;
  resumeAnchor?: ResumeAnchor;
  question: string;
  answer: string | null;
  evaluation?: PreviousTurnEvaluation | null;
};

export function answerDraftKey(sessionId: string, turnIdx: number | null): string {
  return `interviewAnswerDraft:${sessionId}:${turnIdx ?? "pending"}`;
}

export function clearAnswerDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function isFallbackTurnEvaluation(evaluation: PreviousTurnEvaluation): boolean {
  return Boolean(evaluation.source === "fallback" || evaluation.fallback_reason);
}

export function hasDisplayableTurnFeedback(
  evaluation: PreviousTurnEvaluation | null | undefined,
): evaluation is PreviousTurnEvaluation {
  return Boolean(
    evaluation &&
      (isFallbackTurnEvaluation(evaluation) ||
        evaluation.strengths.length > 0 ||
        evaluation.weaknesses.length > 0),
  );
}

export function restoredTurnToQaEntry(turn: ResumeHistoryTurn): QaEntry | null {
  if (!turn.question && !turn.answer) return null;
  const isSelfIntro = turn.question_type === "self_intro";
  const turnIdx = typeof turn.turn_idx === "number" ? turn.turn_idx : null;
  return {
    turnIdx: isSelfIntro ? null : turnIdx,
    formalTurnIdx: isSelfIntro ? null : turnIdx,
    displayTurnIdx: isSelfIntro ? null : turnIdx,
    questionType: turn.question_type,
    dimension: turn.dimension ?? undefined,
    question: turn.question ?? "",
    answer: turn.answer ?? "",
    evaluation: resumeTurnEvaluation(turn),
  };
}

function resumeTurnEvaluation(turn: ResumeHistoryTurn): PreviousTurnEvaluation | null {
  const strengths = listStrings(turn.strengths);
  const weaknesses = listStrings(turn.weaknesses);
  const hasFeedback =
    typeof turn.score === "number" ||
    typeof turn.passed === "boolean" ||
    strengths.length > 0 ||
    weaknesses.length > 0;
  if (!hasFeedback) return null;
  return {
    turn_idx: turn.turn_idx,
    dimension: turn.dimension ?? null,
    score: typeof turn.score === "number" ? turn.score : null,
    passed: Boolean(turn.passed),
    strengths,
    weaknesses,
  };
}

function listStrings(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}

export function visibleTurnIdx(entry: QaEntry): number | null {
  if (typeof entry.displayTurnIdx === "number") return entry.displayTurnIdx;
  if (typeof entry.formalTurnIdx === "number") return entry.formalTurnIdx;
  return typeof entry.turnIdx === "number" ? entry.turnIdx : null;
}

export function latestAnsweredFormalTurnIdx(history: QaEntry[]): number | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.answer === null) continue;
    if (entry.questionType === "self_intro") continue;
    const idx = visibleTurnIdx(entry);
    if (typeof idx === "number") return idx;
  }
  return null;
}

export function clampVisibleFormalTurn(turn: number, maxTurns: number | null): number {
  if (typeof maxTurns === "number" && maxTurns > 0) {
    return Math.min(maxTurns, Math.max(0, turn));
  }
  return Math.max(0, turn);
}

export function answerInsightFromHistory(history: QaEntry[]): AnswerInsight | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const answer = entry.answer;
    if (!answer || answer === "已跳过本题") continue;
    const isOpeningTurn = entry.questionType === "self_intro";
    const dimensionId = isOpeningTurn ? null : entry.dimension;
    const dimensionLabel = isOpeningTurn
      ? null
      : entry.dimension
        ? formatDimensionName(entry.dimension)
        : null;
    if (isOpeningTurn || dimensionLabel) {
      return {
        dimensionId,
        dimensionLabel,
        isOpeningTurn,
      };
    }
  }
  return null;
}

export function filterRestoredHistoryForCurrentQuestion(
  entries: QaEntry[],
  currentTurnIdxForDisplay: number | null,
): QaEntry[] {
  if (typeof currentTurnIdxForDisplay !== "number") return entries;
  return entries.filter((entry) => {
    const entryTurnIdx = visibleTurnIdx(entry);
    return typeof entryTurnIdx !== "number" || entryTurnIdx < currentTurnIdxForDisplay;
  });
}

export function sameQaEntry(left: QaEntry, right: QaEntry): boolean {
  return (
    left.turnIdx === right.turnIdx &&
    left.question === right.question &&
    left.answer === right.answer
  );
}

export function qaEntryMatchesEvaluation(
  entry: QaEntry,
  evaluation: PreviousTurnEvaluation,
): boolean {
  if (entry.answer === null) return false;
  if (typeof evaluation.turn_idx !== "number") return false;
  if (!evaluation.dimension || !entry.dimension) return false;
  if (evaluation.dimension !== entry.dimension) {
    return false;
  }
  return entry.formalTurnIdx === evaluation.turn_idx || entry.turnIdx === evaluation.turn_idx;
}

export function phaseLabel(p: string): string {
  switch (p) {
    case "waiting_for_answer":
      return "等待回答";
    case "loading":
      return "思考中";
    case "completed":
      return "已完成";
    case "error":
      return "出错";
    case "cancelled":
      return "已取消";
    default:
      return "空闲";
  }
}

export function extractQuestion(q: PollQuestion): string {
  if (typeof q.question === "string") return q.question;
  const inner = (q as Record<string, unknown>).current_question;
  if (inner && typeof inner === "object" && "question" in (inner as Record<string, unknown>)) {
    const v = (inner as Record<string, unknown>).question;
    if (typeof v === "string") return v;
  }
  return JSON.stringify(q);
}

export function extractResumeAnchor(q: PollQuestion): ResumeAnchor | undefined {
  if (q.resume_anchor && typeof q.resume_anchor === "object") {
    return q.resume_anchor;
  }
  const inner = (q as Record<string, unknown>).current_question;
  if (inner && typeof inner === "object") {
    const v = (inner as Record<string, unknown>).resume_anchor;
    if (v && typeof v === "object") return v as ResumeAnchor;
  }
  return undefined;
}

export function extractQuestionType(q: PollQuestion): string | undefined {
  if (typeof q.question_type === "string") return q.question_type;
  const inner = (q as Record<string, unknown>).current_question;
  if (inner && typeof inner === "object") {
    const v = (inner as Record<string, unknown>).question_type;
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function extractFormalTurnIdx(q: PollQuestion): number | null {
  if (typeof q.formal_turn_idx === "number") return q.formal_turn_idx;
  const inner = (q as Record<string, unknown>).current_question;
  if (inner && typeof inner === "object") {
    const v = (inner as Record<string, unknown>).formal_turn_idx;
    if (typeof v === "number") return v;
  }
  return null;
}

export function isFinalFormalTurn({
  question,
  turnIdx,
  maxTurns,
}: {
  question: PollQuestion | null;
  turnIdx: number | null;
  maxTurns: number | null;
}): boolean {
  if (!question || typeof maxTurns !== "number" || maxTurns <= 0) return false;
  if (extractQuestionType(question) === "self_intro") return false;
  const formalTurnIdx = extractFormalTurnIdx(question);
  const currentTurn =
    formalTurnIdx !== null ? formalTurnIdx + 1 : turnIdx !== null ? turnIdx + 1 : 0;
  return currentTurn >= maxTurns;
}

export function resumeAnchorLabel(anchor?: ResumeAnchor): string {
  return anchor?.project_name || anchor?.label || "";
}

export function friendlyConnectionMessage(kind: LLMErrorKind | null, raw: string | null): string {
  switch (kind) {
    case "auth":
      return "保存的密钥可能已经失效、被撤销，或者没有当前模型的权限。去设置里更新一下 Key 再试。";
    case "quota":
      return "当前配置的额度不足或余额耗尽。换一个 Key，或者到厂商控制台检查余额。";
    case "rate_limit":
      return "请求太频繁了，稍后再试会更稳。";
    case "timeout":
      return "请求超时了，通常重试一下就好。";
    case "network":
      return "网络或服务暂时不稳定，检查一下网络后再点重试。";
    case "misconfig":
      return "有一项配置不完整或不匹配，请检查模型名称、服务商和 Base URL。";
    default:
      break;
  }
  if (!raw) return "稍等一下再试一次。";
  const lower = raw.toLowerCase();
  if (
    lower.includes("session not found") ||
    raw.includes("无法继续") ||
    raw.includes("重新开始一场面试")
  ) {
    return (
      "这场面试已经不在后端运行中，可能是后端重启、会话已结束，" +
      "或上一轮出题失败。请回到首页重新开始一场面试。"
    );
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "网络好像不太稳定。检查一下网络后再点重试。";
  }
  if (
    lower.startsWith("5") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503")
  ) {
    return "服务暂时有点忙不过来。稍等几秒再试一次就好。";
  }
  if (lower.includes("timeout")) {
    return "请求超时了。可以点重试再来一次。";
  }
  return "稍等一下再试一次。如果一直不行，记一下当前面试编号联系我们。";
}

export function friendlyAnswerError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("network") || lower.includes("fetch")) {
    return "网络似乎中断了，刚才的回答还没保存。检查网络后再提交一次试试。";
  }
  if (lower.includes("timeout")) {
    return "提交超时了。再来一次通常就能成功。";
  }
  return "刚才的回答没能成功提交，再试一次试试。";
}
