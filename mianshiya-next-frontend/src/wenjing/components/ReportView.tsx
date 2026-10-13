"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Collapse, Flex, Skeleton, Space, Spin, Typography } from "antd";

import { getReport } from "@/wenjing/lib/api/interview";
import type {
  FinalReport,
  GetReportResponse,
  LLMErrorKind,
  TraceHealth,
} from "@/wenjing/lib/api/types";
import { inferLLMErrorKind } from "@/wenjing/lib/llm-config";
import { upsertEntry } from "@/wenjing/lib/storage/interviewHistory";
import OutcomeFeedback from "./report/OutcomeFeedback";
import ReportActions from "./report/ReportActions";
import {
  DimensionRadar,
  DimensionScores,
  FallbackVerdictBanner,
  GrowthHints,
  LastSessionDelta,
  QualityCenter,
  SelfIntroFocus,
  Summary,
} from "./report/ReportSections";
import TrainingPlanCard from "./report/TrainingPlanCard";
import {
  buildWeakPracticeHref,
  compactDimensionScores,
  displayGrowthSignal,
  friendlyReportError,
  isRunningReportError,
  llmErrorKindLabel,
} from "./report/reportUtils";

type Fetch =
  | { phase: "loading" }
  | {
      phase: "ready";
      report: FinalReport | null;
      traceHealth: TraceHealth | null;
    }
  | { phase: "error"; message: string; errorKind: LLMErrorKind | null }
  | { phase: "running" };

export default function ReportView({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<Fetch>({ phase: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getReport(sessionId);
        if (cancelled) return;
        if (r.error) {
          upsertEntry({ sessionId, status: "failed" });
          setState({
            phase: "error",
            message: r.error,
            errorKind: r.error_kind ?? inferLLMErrorKind(r.error),
          });
          return;
        }
        setState({
          phase: "ready",
          report: r.final_report,
          traceHealth: r.trace_health ?? null,
        });
        if (r.final_report) {
          syncReportHistory(sessionId, r.final_report, r);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (isRunningReportError(err, msg)) {
          setState({ phase: "running" });
        } else {
          setState({
            phase: "error",
            message: msg,
            errorKind: inferLLMErrorKind(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, retryKey]);

  if (state.phase === "loading") {
    return (
      <Flex vertical gap={16}>
        <Skeleton.Input active style={{ width: 256, height: 32 }} />
        <Skeleton active paragraph={{ rows: 3 }} />
        <Skeleton active paragraph={{ rows: 2 }} />
      </Flex>
    );
  }

  if (state.phase === "error") {
    return (
      <Alert
        type="error"
        message="这场面试暂时没能生成报告"
        description={
          <Flex vertical gap={12} style={{ marginTop: 4 }}>
            <Typography.Text type="secondary">{friendlyReportError(state.errorKind)}</Typography.Text>
            <Space wrap>
              <Button
                size="small"
                onClick={() => {
                  setState({ phase: "loading" });
                  setRetryKey((k) => k + 1);
                }}
              >
                重新加载报告
              </Button>
              <Link href="/interview/setup">
                <Button size="small">重新开始一场</Button>
              </Link>
              <Link href={`/interview/${sessionId}`}>
                <Button size="small" type="text">
                  返回面试页
                </Button>
              </Link>
            </Space>
            <Collapse
              size="small"
              ghost
              items={[
                {
                  key: "detail",
                  label: (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      查看技术细节
                      {state.errorKind ? `：${llmErrorKindLabel(state.errorKind)}` : ""}
                    </Typography.Text>
                  ),
                  children: (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        borderRadius: 4,
                        background: "rgba(0,0,0,0.04)",
                        padding: 8,
                        fontFamily: "monospace",
                        fontSize: 11,
                      }}
                    >
                      {state.message}
                    </pre>
                  ),
                },
              ]}
            />
          </Flex>
        }
      />
    );
  }

  if (state.phase === "running") {
    return (
      <Card>
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">
            面试仍在进行中。返回会话：&nbsp;
            <Link href={`/interview/${sessionId}`}>继续面试</Link>
          </Typography.Text>
        </Space>
      </Card>
    );
  }

  const report = state.report;

  if (!report) {
    return (
      <Card>
        <Typography.Text type="secondary">此会话未生成报告。</Typography.Text>
      </Card>
    );
  }

  const weakPracticeHref = buildWeakPracticeHref({
    ...report,
    session_id: report.session_id ?? sessionId,
  });

  return (
    <Flex vertical gap={24}>
      <FallbackVerdictBanner report={report} />
      <Summary report={report} />
      <LastSessionDelta sessionId={sessionId} report={report} />
      <GrowthHints />
      <SelfIntroFocus selfIntro={report.self_intro} />
      <QualityCenter report={report} traceHealth={state.traceHealth} />
      <DimensionRadar scores={report.dimension_scores} />
      <DimensionScores scores={report.dimension_scores} />
      <TrainingPlanCard
        plan={report.training_plan}
        weakPracticeHref={weakPracticeHref}
        sourceSessionId={report.session_id ?? sessionId}
      />
      <OutcomeFeedback sessionId={sessionId} />
      <ReportActions sessionId={sessionId} report={report} weakPracticeHref={weakPracticeHref} />
    </Flex>
  );
}

function syncReportHistory(
  sessionId: string,
  report: FinalReport,
  metadata?: Pick<GetReportResponse, "created_at" | "updated_at">,
): void {
  const growthSignal = displayGrowthSignal(report);
  upsertEntry({
    sessionId,
    createdAt: metadata?.created_at ?? undefined,
    updatedAt: metadata?.updated_at ?? undefined,
    status: "done",
    overallScore: typeof report.overall_score === "number" ? report.overall_score : undefined,
    dimensionScores: compactDimensionScores(report.dimension_scores),
    growthSignal,
    overallVerdict: typeof report.overall_verdict === "string" ? report.overall_verdict : undefined,
  });
}
