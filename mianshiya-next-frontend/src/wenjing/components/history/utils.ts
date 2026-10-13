import type {
  AccountInterviewSession,
  DeleteSessionResponse,
} from "@/wenjing/lib/api/types";
import {
  jobLevelShortLabel,
  mapPollStatusToLocal,
  verdictShortLabel,
} from "@/wenjing/lib/constants";
import type { InterviewHistoryEntry } from "@/wenjing/lib/storage/interviewHistory";
import type { SetupDraft } from "@/wenjing/lib/storage/setupDrafts";

export type HistoryEntrySource = "account" | "local_anonymous" | "local_owned";
export type DisplayHistoryEntry = InterviewHistoryEntry & {
  source: HistoryEntrySource;
};
export type SplitHistoryResult = {
  primaryEntries: DisplayHistoryEntry[];
  anonymousEntries: DisplayHistoryEntry[];
  hiddenOtherAccountCount: number;
};

export const jobLevelLabel = jobLevelShortLabel;
export const formatVerdictShort = verdictShortLabel;
export const mapBackendStatusToLocal = mapPollStatusToLocal;

export function setupDraftStatusLabel(status: SetupDraft["status"]): string {
  switch (status) {
    case "parsing":
      return "解析中";
    case "ready":
      return "已解析待确认";
    case "basic_ready":
      return "基础解析待确认";
    case "failed":
      return "解析失败";
    case "expired":
      return "已过期";
    default:
      return "准备中";
  }
}

export function compareScoreEntries(
  a: InterviewHistoryEntry,
  b: InterviewHistoryEntry,
  direction: "asc" | "desc",
): number {
  const hasAScore = typeof a.overallScore === "number";
  const hasBScore = typeof b.overallScore === "number";
  if (hasAScore !== hasBScore) return hasAScore ? -1 : 1;
  if (hasAScore && hasBScore && a.overallScore !== b.overallScore) {
    return direction === "asc"
      ? a.overallScore! - b.overallScore!
      : b.overallScore! - a.overallScore!;
  }
  return b.lastVisitedAt.localeCompare(a.lastVisitedAt);
}

export function describeDeleteSessionResult(result: DeleteSessionResponse): string {
  const sessionsDeleted = result.sessions_deleted;
  const tracesDeleted = result.traces_deleted;
  const outcomesDeleted = result.outcomes_deleted;
  if (!result.deleted) {
    return result.checkpoint_deleted
      ? "服务端没有找到可删除的数据；已清理运行恢复状态，并从本机列表移除。"
      : "服务端没有找到可删除的数据；已从本机列表移除。";
  }

  const checkpointText =
    result.checkpoint_deleted === false
      ? "运行恢复状态暂未清理。"
      : result.checkpoint_deleted
        ? "运行恢复状态已清理。"
        : "";
  return `服务端已删除：会话 ${sessionsDeleted} 条、Trace ${tracesDeleted} 条、结果 ${outcomesDeleted} 条。${checkpointText}`;
}

export function historyTimeSummary(entry: InterviewHistoryEntry): string {
  const accessLabel = entry.status === "running" ? "最近继续" : "最近访问";
  const createdLabel = entry.updatedAt ? "创建于" : "加入列表";
  const createdText = entry.updatedAt
    ? formatDateTimeShort(entry.createdAt)
    : formatRelative(entry.createdAt);
  return `${accessLabel} ${formatRelative(entry.lastVisitedAt)} · ${createdLabel} ${createdText}`;
}

export function compactDimensionScores(
  scores: unknown,
): Record<string, number> | undefined {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [dimension, value] of Object.entries(scores)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const score = (value as { score?: unknown }).score;
    if (typeof score === "number" && Number.isFinite(score)) {
      out[dimension] = score;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function splitAccountAndLocalHistory({
  accountSessions,
  localEntries,
  currentUserId,
}: {
  accountSessions: AccountInterviewSession[];
  localEntries: InterviewHistoryEntry[];
  currentUserId: number | null;
}): SplitHistoryResult {
  const primarySessionIds = new Set<string>();
  const primaryEntries: DisplayHistoryEntry[] = [];
  const anonymousEntries: DisplayHistoryEntry[] = [];
  let hiddenOtherAccountCount = 0;

  for (const session of accountSessions) {
    primarySessionIds.add(session.session_id);
    primaryEntries.push(accountSessionToEntry(session));
  }

  for (const localEntry of localEntries) {
    if (
      typeof localEntry.ownerUserId === "number" &&
      localEntry.ownerUserId !== currentUserId
    ) {
      hiddenOtherAccountCount += 1;
      continue;
    }
    if (primarySessionIds.has(localEntry.sessionId)) {
      continue;
    }
    if (!localEntry.ownerUserId) {
      const anonymousEntry: DisplayHistoryEntry = {
        ...localEntry,
        source: "local_anonymous",
      };
      if (currentUserId === null) {
        primarySessionIds.add(localEntry.sessionId);
        primaryEntries.push(anonymousEntry);
      } else {
        anonymousEntries.push(anonymousEntry);
      }
      continue;
    }
    primarySessionIds.add(localEntry.sessionId);
    primaryEntries.push({
      ...localEntry,
      source: "local_owned",
    });
  }

  primaryEntries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  anonymousEntries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { primaryEntries, anonymousEntries, hiddenOtherAccountCount };
}

function accountSessionToEntry(session: AccountInterviewSession): DisplayHistoryEntry {
  const now = new Date().toISOString();
  const createdAt = session.created_at ?? session.updated_at ?? now;
  const updatedAt = session.updated_at ?? undefined;
  const dimensionScores = session.dimension_scores ?? undefined;
  return {
    source: "account",
    sessionId: session.session_id,
    ownerUserId: session.owner_user_id,
    ownerClaimedAt: session.owner_claimed_at ?? undefined,
    jdTitle: session.job_title?.trim() || "未命名面试",
    candidateName: session.candidate_name ?? undefined,
    jobLevel: session.job_level ?? undefined,
    rubricDimensions: dimensionScores ? Object.keys(dimensionScores) : undefined,
    createdAt,
    updatedAt,
    lastVisitedAt: updatedAt ?? createdAt,
    status: mapBackendStatusToLocal(session.status),
    overallScore: session.overall_score ?? undefined,
    dimensionScores,
    growthSignal: session.growth_signal ?? undefined,
    overallVerdict: session.overall_verdict ?? undefined,
  };
}

export function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知时间";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString();
}

export function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知时间";
  const now = new Date();
  return d.toLocaleString(undefined, {
    ...(d.getFullYear() !== now.getFullYear()
      ? { year: "numeric" as const }
      : {}),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "未知时间";
  return d.toLocaleString();
}
