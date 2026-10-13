"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  Alert,
  Button,
  Dropdown,
  Flex,
  message,
  notification,
  Pagination,
  Segmented,
  Select,
  Space,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from "@ant-design/icons";

import type { RootState } from "@/stores";
import {
  deleteSession,
  getReport,
  getSessionMetadata,
  resumeSession,
} from "@/wenjing/lib/api/interview";
import { getAccountInterviewSessions } from "@/wenjing/lib/api/account";
import type { AccountInterviewSession } from "@/wenjing/lib/api/types";
import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  SORT_FIELD_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type SortDirection,
  type SortField,
  type StatusFilterOption,
} from "@/wenjing/lib/constants";
import {
  getHistory,
  mergeServerEntryMetadata,
  removeEntry,
  upsertEntry,
  type InterviewHistoryEntry,
} from "@/wenjing/lib/storage/interviewHistory";
import {
  getSetupDrafts,
  removeSetupDraft,
  type SetupDraft,
} from "@/wenjing/lib/storage/setupDrafts";
import { ProgressChart } from "./history/ProgressChart";
import {
  AnonymousHistorySection,
  DeleteSessionModal,
  EmptyState,
  FilteredEmptyState,
  HistoryCard,
  SetupDraftSection,
  SkeletonList,
} from "./history/HistoryParts";
import {
  compactDimensionScores,
  compareScoreEntries,
  describeDeleteSessionResult,
  mapBackendStatusToLocal,
  splitAccountAndLocalHistory,
  type DisplayHistoryEntry,
} from "./history/utils";

const { Text } = Typography;

const EMPTY_DISPLAY_ENTRIES: DisplayHistoryEntry[] = [];
const PAGE_SIZE = 10;

export default function HistoryList() {
  const loginUser = useSelector((s: RootState) => s.loginUser);
  const [localEntries, setLocalEntries] = useState<InterviewHistoryEntry[] | null>(null);
  const [accountSessions, setAccountSessions] = useState<AccountInterviewSession[]>([]);
  const [setupDrafts, setSetupDrafts] = useState<SetupDraft[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<DisplayHistoryEntry | null>(null);
  const [activeFilter, setActiveFilter] = useState<StatusFilterOption["id"]>("all");
  const [activeSortField, setActiveSortField] =
    useState<SortField>(DEFAULT_SORT_FIELD);
  const [activeSortDirection, setActiveSortDirection] =
    useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const [page, setPage] = useState(1);

  // 网关注入的 owner_user_id 以账号会话为准；没有账号会话时退回面试蛙登录用户 id。
  const currentUserId = useMemo<number | null>(() => {
    const fromAccount = accountSessions.find(
      (session) => typeof session.owner_user_id === "number",
    )?.owner_user_id;
    if (typeof fromAccount === "number") return fromAccount;
    const loginId = Number(loginUser?.id);
    return Number.isFinite(loginId) && loginId > 0 ? loginId : null;
  }, [accountSessions, loginUser?.id]);

  const reload = useCallback(() => {
    setLocalEntries(getHistory());
    setSetupDrafts(getSetupDrafts());
  }, []);

  const refreshAccountSessions = useCallback(async () => {
    setAccountLoading(true);
    try {
      const response = await getAccountInterviewSessions({ limit: 100 });
      setAccountSessions(response.sessions);
      for (const session of response.sessions) {
        mergeServerEntryMetadata({
          sessionId: session.session_id,
          createdAt: session.created_at ?? undefined,
          updatedAt: session.updated_at ?? undefined,
          jdTitle: session.job_title,
          candidateName: session.candidate_name,
          jobLevel: session.job_level,
          status: mapBackendStatusToLocal(session.status),
          overallScore: session.overall_score ?? undefined,
          dimensionScores: session.dimension_scores,
          growthSignal: session.growth_signal,
          overallVerdict: session.overall_verdict,
          ownerUserId: session.owner_user_id,
          ownerClaimedAt: session.owner_claimed_at,
        });
      }
      setLocalEntries(getHistory());
    } catch {
      setAccountSessions([]);
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith("mianshiwa:interview:user:") || e.key === "interviewHistory" || e.key === "setupDrafts") {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => reload(), 500);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [reload]);

  useEffect(() => {
    void refreshAccountSessions();
  }, [refreshAccountSessions]);

  useEffect(() => {
    if (!localEntries) return;
    const targets = localEntries.filter((entry) => !entry.updatedAt);
    if (targets.length === 0) return;

    let cancelled = false;
    void (async () => {
      let changed = false;
      await Promise.all(
        targets.map(async (entry) => {
          try {
            const meta = await getSessionMetadata(entry.sessionId);
            const merged = mergeServerEntryMetadata({
              sessionId: entry.sessionId,
              createdAt: meta.created_at,
              updatedAt: meta.updated_at,
              jdTitle: meta.job_title,
              candidateName: meta.candidate_name,
              jobLevel: meta.job_level,
              status: mapBackendStatusToLocal(meta.status),
              overallScore: meta.overall_score ?? undefined,
              dimensionScores: meta.dimension_scores,
              growthSignal: meta.growth_signal,
              overallVerdict: meta.overall_verdict,
            });
            if (merged) changed = true;
          } catch {
            // Keep the local fallback when a historical row cannot be refreshed.
          }
        }),
      );
      if (!cancelled && changed) {
        reload();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [localEntries, reload]);

  const splitHistory = useMemo(
    () =>
      localEntries
        ? splitAccountAndLocalHistory({
            accountSessions,
            localEntries,
            currentUserId,
          })
        : null,
    [accountSessions, localEntries, currentUserId],
  );
  const entries = splitHistory?.primaryEntries ?? null;
  const anonymousEntries = splitHistory?.anonymousEntries ?? EMPTY_DISPLAY_ENTRIES;
  const hiddenOtherAccountCount = splitHistory?.hiddenOtherAccountCount ?? 0;

  const runningCount = useMemo(
    () => (entries ?? []).filter((e) => e.status === "running").length,
    [entries],
  );

  const filteredAndSorted = useMemo(() => {
    let list = entries ?? [];
    if (activeFilter !== "all") {
      list = list.filter((e) => e.status === activeFilter);
    }
    const dir = activeSortDirection === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (activeSortField) {
        case "overallScore":
          return compareScoreEntries(a, b, activeSortDirection);
        case "lastVisitedAt":
          return dir * a.lastVisitedAt.localeCompare(b.lastVisitedAt);
        case "createdAt":
        default:
          return dir * a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [entries, activeFilter, activeSortField, activeSortDirection]);

  useEffect(() => {
    setPage(1);
  }, [activeFilter, activeSortField, activeSortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedEntries = filteredAndSorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const handleRemoveLocal = useCallback(
    (sessionId: string) => {
      removeEntry(sessionId);
      reload();
      message.success("已从我的列表中移除");
    },
    [reload],
  );

  const handleRemoveSetupDraft = useCallback(
    (draftId: string) => {
      removeSetupDraft(draftId);
      reload();
      message.success("已放弃草稿");
    },
    [reload],
  );

  const handleDeleteData = useCallback(
    async () => {
      if (!deleteTarget) return;
      const sessionId = deleteTarget.sessionId;
      setDeletingSessionId(sessionId);
      try {
        const result = await deleteSession(sessionId);
        removeEntry(sessionId);
        setAccountSessions((sessions) =>
          sessions.filter((session) => session.session_id !== sessionId),
        );
        setDeleteTarget(null);
        reload();
        notification.success({
          message: result.deleted ? "面试数据已删除" : "服务端数据未找到",
          description: describeDeleteSessionResult(result),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "请稍后再试";
        notification.error({
          message: "删除数据失败",
          description: msg,
        });
      } finally {
        setDeletingSessionId(null);
      }
    },
    [deleteTarget, reload],
  );

  const handleRefresh = useCallback(async () => {
    if (!entries) return;
    const targets = entries.filter((e) => e.status === "running");
    if (targets.length === 0) {
      message.info("当前没有进行中的面试");
      return;
    }

    setRefreshing(true);
    let updated = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (entry) => {
        try {
          const r = await resumeSession(entry.sessionId);
          const next = mapBackendStatusToLocal(r.status);
          if (next === "done") {
            // Pull the report so we can persist the score for the card.
            try {
              const rep = await getReport(entry.sessionId);
              upsertEntry({
                sessionId: entry.sessionId,
                createdAt: rep.created_at ?? r.created_at ?? undefined,
                updatedAt: rep.updated_at ?? r.updated_at ?? undefined,
                status: "done",
                overallScore:
                  typeof rep.final_report?.overall_score === "number"
                    ? rep.final_report.overall_score
                    : undefined,
                growthSignal:
                  typeof rep.final_report?.growth_signal === "string"
                    ? rep.final_report.growth_signal
                    : undefined,
                dimensionScores: compactDimensionScores(
                  rep.final_report?.dimension_scores,
                ),
                maxTurns:
                  typeof r.max_turns === "number" ? r.max_turns : undefined,
                overallVerdict:
                  typeof rep.final_report?.overall_verdict === "string"
                    ? rep.final_report.overall_verdict
                    : undefined,
              });
            } catch {
              upsertEntry({
                sessionId: entry.sessionId,
                createdAt: r.created_at ?? undefined,
                updatedAt: r.updated_at ?? undefined,
                status: "done",
              });
            }
            updated += 1;
          } else if (next === "cancelled") {
            upsertEntry({
              sessionId: entry.sessionId,
              createdAt: r.created_at ?? undefined,
              updatedAt: r.updated_at ?? undefined,
              status: "cancelled",
            });
            updated += 1;
          } else {
            upsertEntry({
              sessionId: entry.sessionId,
              createdAt: r.created_at ?? undefined,
              updatedAt: r.updated_at ?? undefined,
              maxTurns: typeof r.max_turns === "number" ? r.max_turns : undefined,
            });
          }
        } catch {
          failed += 1;
        }
      }),
    );
    reload();
    setRefreshing(false);
    if (failed === 0) {
      notification.success({
        message: "状态已更新",
        description: updated > 0 ? `刷新了 ${updated} 条记录。` : "暂无变化。",
      });
    } else {
      notification.warning({
        message: "已尝试更新",
        description: `成功 ${updated} 条，${failed} 条暂时无法获取，可稍后再试。`,
      });
    }
  }, [entries, reload]);

  const exportEntry = useCallback((entry: DisplayHistoryEntry) => {
    const safeEntry = { ...entry };
    delete safeEntry.sessionToken;
    delete safeEntry.sessionTokenExpiresAt;
    delete safeEntry.recoveryToken;
    delete safeEntry.recoveryTokenExpiresAt;
    const dataStr =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(safeEntry, null, 2));
    const dlAnchorElem = document.createElement("a");
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `interview_${entry.sessionId}.json`);
    dlAnchorElem.click();
  }, []);

  if (entries === null) {
    return <SkeletonList />;
  }

  if (
    entries.length === 0 &&
    anonymousEntries.length === 0 &&
    setupDrafts.length === 0 &&
    hiddenOtherAccountCount === 0
  ) {
    return <EmptyState />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <DeleteSessionModal
        entry={deleteTarget}
        deleting={deleteTarget !== null && deletingSessionId === deleteTarget.sessionId}
        onCancel={() => {
          if (deletingSessionId === null) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleDeleteData}
      />

      {setupDrafts.length > 0 && (
        <SetupDraftSection drafts={setupDrafts} onRemoveDraft={handleRemoveSetupDraft} />
      )}

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {entries.length > 0 && <ProgressChart entries={entries} />}

        {hiddenOtherAccountCount > 0 && (
          <Alert
            type="info"
            showIcon
            message={`本机还有 ${hiddenOtherAccountCount} 条属于其他账号的记录，请切换到对应账号查看。`}
          />
        )}

        <Flex wrap="wrap" align="center" justify="space-between" gap={12}>
          <Text type="secondary">
            共 {entries.length} 场面试
            {" · "}
            <Text type="success">当前显示账号记录</Text>
            {accountLoading && (
              <>
                {" · "}
                <Text>同步中</Text>
              </>
            )}
            {runningCount > 0 && (
              <>
                {" · "}
                <Text type="warning">{runningCount} 场进行中</Text>
              </>
            )}
            {activeFilter !== "all" && (
              <>
                {" · "}
                <Text>筛选后 {filteredAndSorted.length} 条</Text>
              </>
            )}
          </Text>
          <Button
            size="small"
            icon={<ReloadOutlined spin={refreshing} />}
            onClick={handleRefresh}
            disabled={refreshing || runningCount === 0}
            aria-label={
              runningCount === 0 ? "当前没有进行中的面试" : "同步进行中面试的最新状态"
            }
          >
            刷新状态
          </Button>
        </Flex>

        <Alert
          type="warning"
          showIcon
          message="导出历史只包含面试记录，不会包含继续访问会话的临时凭证。"
        />

        <Flex wrap="wrap" align="center" justify="space-between" gap={8}>
          <Segmented
            size="small"
            value={activeFilter}
            onChange={(value) => setActiveFilter(value as StatusFilterOption["id"])}
            options={STATUS_FILTER_OPTIONS.map((opt) => ({ label: opt.label, value: opt.id }))}
          />
          <Space size={6}>
            <Select
              size="small"
              value={activeSortField}
              onChange={(value) => setActiveSortField(value)}
              aria-label="排序方式"
              style={{ minWidth: 120 }}
              options={SORT_FIELD_OPTIONS.map((opt) => ({ label: opt.label, value: opt.field }))}
            />
            <Button
              size="small"
              icon={
                activeSortDirection === "desc" ? (
                  <SortDescendingOutlined />
                ) : (
                  <SortAscendingOutlined />
                )
              }
              onClick={() =>
                setActiveSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
              }
              aria-label={
                activeSortDirection === "desc"
                  ? "当前为降序，点击改为升序"
                  : "当前为升序，点击改为降序"
              }
            >
              {activeSortDirection === "desc" ? "降序" : "升序"}
            </Button>
          </Space>
        </Flex>
      </Space>

      {filteredAndSorted.length === 0 && activeFilter !== "all" ? (
        <FilteredEmptyState onClear={() => setActiveFilter("all")} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {pagedEntries.map((entry) => (
            <Dropdown
              key={entry.sessionId}
              trigger={["contextMenu"]}
              menu={{
                items: [
                  { key: "copy", label: "复制会话 ID" },
                  { key: "export", label: "导出这条记录（不含凭证）" },
                ],
                onClick: ({ key }) => {
                  if (key === "copy") {
                    void navigator.clipboard?.writeText(entry.sessionId);
                    message.success("已复制 Session ID");
                  } else if (key === "export") {
                    exportEntry(entry);
                  }
                },
              }}
            >
              <div>
                <HistoryCard
                  entry={entry}
                  deleting={deletingSessionId === entry.sessionId}
                  canRemoveLocal={entry.source === "local_anonymous"}
                  canDeleteData={entry.source === "account" || entry.source === "local_owned"}
                  onRemoveLocal={handleRemoveLocal}
                  onDeleteData={setDeleteTarget}
                />
              </div>
            </Dropdown>
          ))}
          {filteredAndSorted.length > PAGE_SIZE && (
            <Flex justify="center">
              <Pagination
                size="small"
                current={currentPage}
                pageSize={PAGE_SIZE}
                total={filteredAndSorted.length}
                showSizeChanger={false}
                onChange={setPage}
              />
            </Flex>
          )}
        </Space>
      )}

      {anonymousEntries.length > 0 && (
        <AnonymousHistorySection
          entries={anonymousEntries}
          deletingSessionId={deletingSessionId}
          onRemoveLocal={handleRemoveLocal}
          onDeleteData={setDeleteTarget}
        />
      )}
    </Space>
  );
}
