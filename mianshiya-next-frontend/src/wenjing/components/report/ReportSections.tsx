"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Card,
  Col,
  Collapse,
  Divider,
  Flex,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  AimOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  RiseOutlined,
  StarOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import ReactECharts from "echarts-for-react";

import type {
  FinalReport,
  RubricScore,
  ScoringCredibility,
  TraceHealth,
} from "@/wenjing/lib/api/types";
import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import { verdictShortLabel } from "@/wenjing/lib/constants/verdicts";
import {
  buildGrowthHints,
  buildLastSessionDelta,
  type GrowthHints as GrowthHintsType,
  type SessionDelta,
} from "@/wenjing/lib/sessionDelta";
import { getCompletedBefore, getHistory } from "@/wenjing/lib/storage/interviewHistory";
import { InfoTooltip } from "@/wenjing/components/shared";
import {
  asArray,
  asNumber,
  asRecord,
  asStringArray,
  compactDimensionScores,
  dimensionBadgeColor,
  dimensionBadgeMeta,
  dimensionScoreBreakdownLabel,
  dimensionScoreLabel,
  displayGrowthSignal,
  formatRate,
  hasDisplayableDimensionScore,
  isSystemFallbackText,
  translateReportText,
  verdictTagColor,
} from "./reportUtils";

const { Text, Paragraph, Title } = Typography;

const GREEN = "#52c41a";
const AMBER = "#faad14";

function useInViewOnce<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);
  return [ref, inView];
}

function AnimatedScore({ score, max = 10 }: { score: number; max?: number }) {
  const [displayed, setDisplayed] = useState(0);
  const [ref, inView] = useInViewOnce<HTMLSpanElement>();

  useEffect(() => {
    if (!inView) return;
    const duration = 800;
    const start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(score * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, score]);

  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
      {displayed.toFixed(1)}
      <span style={{ marginLeft: 4, fontSize: 16, fontWeight: 400, color: "rgba(0,0,0,0.45)" }}>
        /{max}
      </span>
    </span>
  );
}

function CoverageCautionBadge({ report }: { report: FinalReport }) {
  const warnings = asArray(report.coverage_warnings);
  if (warnings.length === 0) return null;

  return (
    <Tag color="warning" icon={<WarningOutlined />} style={{ marginInlineEnd: 0, display: "inline-flex", alignItems: "center" }}>
      <span>部分维度待确认</span>
      <InfoTooltip label="说明部分维度待确认">
        部分维度尚未完全通过或证据不足，详情见下方评分维度。
      </InfoTooltip>
    </Tag>
  );
}

export function Summary({ report }: { report: FinalReport }) {
  const verdict = displayGrowthSignal(report);

  return (
    <Card style={{ background: "linear-gradient(135deg, rgba(82,196,26,0.06), transparent 60%)" }}>
      <Flex justify="space-between" align="flex-start" gap={16} wrap="wrap">
        <div>
          <Space align="center" style={{ marginBottom: 8 }}>
            <span
              style={{
                display: "inline-flex",
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                background: "rgba(82,196,26,0.12)",
                color: GREEN,
              }}
            >
              <RiseOutlined />
            </span>
            <Title level={3} style={{ margin: 0 }}>
              面试报告
            </Title>
          </Space>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            基于面试全过程的追问、评分与复盘结果。
          </Paragraph>
        </div>
        <Flex vertical align="flex-end" gap={8}>
          <Flex wrap="wrap" justify="flex-end" gap={8}>
            {verdict && (
              <Tag color={verdictTagColor(verdict)} style={{ fontSize: 14, padding: "2px 12px", marginInlineEnd: 0 }}>
                {verdictShortLabel(verdict)}
              </Tag>
            )}
            <CoverageCautionBadge report={report} />
          </Flex>
          {typeof report.overall_score === "number" && (
            <span style={{ fontSize: 36, fontWeight: 700, fontFamily: "monospace", lineHeight: 1.2 }}>
              <AnimatedScore score={report.overall_score} />
            </span>
          )}
        </Flex>
      </Flex>
      {report.summary && (
        <>
          <Divider style={{ margin: "16px 0" }} />
          <Paragraph type="secondary" style={{ margin: 0, lineHeight: 1.8 }}>
            {translateReportText(report.summary)}
          </Paragraph>
        </>
      )}
    </Card>
  );
}

const FALLBACK_BANNER_THRESHOLD = 0.3;

export function FallbackVerdictBanner({ report }: { report: FinalReport }) {
  const total = typeof report.total_turns === "number" ? report.total_turns : 0;
  const fallbackCount =
    typeof report.evaluator_fallback_count === "number"
      ? report.evaluator_fallback_count
      : 0;
  if (total <= 0 || fallbackCount <= 0) return null;
  const ratio = fallbackCount / total;
  if (ratio < FALLBACK_BANNER_THRESHOLD) return null;

  const percent = Math.round(ratio * 100);
  return (
    <Alert
      type="warning"
      showIcon
      message={`评分仅供参考 · 本场约 ${percent}% 的回答走了保守评分路径`}
      description={
        <>
          评估模型当时不稳定，{fallbackCount} / {total}{" "}
          轮使用了兜底评分。整体分数可能偏保守，建议稍后重新练习一场以获得更准确的反馈。
        </>
      }
    />
  );
}

function deltaColor(delta: number): string | undefined {
  if (delta > 0) return "#389e0d";
  if (delta < 0) return "#d48806";
  return undefined;
}

export function LastSessionDelta({
  sessionId,
  report,
}: {
  sessionId: string;
  report: FinalReport;
}) {
  const [delta, setDelta] = useState<SessionDelta | null>(null);

  useEffect(() => {
    const previous = getCompletedBefore(sessionId);
    if (!previous) {
      setDelta(null);
      return;
    }
    setDelta(
      buildLastSessionDelta(
        {
          overallScore: report.overall_score,
          dimensionScores: compactDimensionScores(report.dimension_scores),
        },
        {
          overallScore: previous.overallScore,
          dimensionScores: previous.dimensionScores,
        },
      ),
    );
  }, [sessionId, report]);

  if (!delta) return null;

  return (
    <Card size="small" style={{ borderColor: "#b7eb8f", background: "#f6ffed" }}>
      <Space align="center" size={4} style={{ color: "#389e0d" }}>
        <RiseOutlined />
        <Text strong style={{ fontSize: 12, color: "#389e0d", letterSpacing: 1 }}>
          vs 上一次练习
        </Text>
        <InfoTooltip label="说明 vs 上一次练习">
          只基于当前浏览器保存的历史记录，比较本场和上一场完成面试的总分与维度分变化。
        </InfoTooltip>
      </Space>
      <Flex wrap="wrap" gap="4px 16px" style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(0,0,0,0.55)" }}>
        {delta.overall !== null && (
          <span>
            总分{" "}
            <span style={{ color: deltaColor(delta.overall) }}>
              {delta.overall > 0 ? "+" : ""}
              {delta.overall.toFixed(1)}
            </span>
          </span>
        )}
        {delta.dimensions.map((d) => (
          <span key={d.dimension}>
            {d.label}{" "}
            <span style={{ color: deltaColor(d.delta) }}>
              {d.delta > 0 ? "+" : ""}
              {d.delta.toFixed(1)}
            </span>
          </span>
        ))}
      </Flex>
    </Card>
  );
}

export function GrowthHints() {
  const [hints, setHints] = useState<GrowthHintsType | null>(null);

  useEffect(() => {
    try {
      const history = getHistory();
      setHints(buildGrowthHints(history));
    } catch {
      setHints(null);
    }
  }, []);

  if (!hints) return null;
  const hasWeak = hints.persistentWeak.length > 0;
  const hasImprove = hints.consecutiveImprove.length > 0;
  if (!hasWeak && !hasImprove) return null;

  return (
    <Card size="small">
      <Space align="center" size={4} style={{ marginBottom: 8 }}>
        <StarOutlined style={{ color: GREEN }} />
        <Text type="secondary" strong style={{ fontSize: 12, letterSpacing: 1 }}>
          跨场练习信号
        </Text>
        <InfoTooltip label="说明跨场练习信号">
          只基于当前浏览器保存的历史记录，识别最近三场里的持续薄弱项和连续提升项。
        </InfoTooltip>
      </Space>
      <Row gutter={[12, 12]}>
        {hasImprove && (
          <Col xs={24} md={12}>
            <div style={{ border: "1px solid #b7eb8f", background: "#f6ffed", borderRadius: 8, padding: 12 }}>
              <Text strong style={{ fontSize: 12, color: "#389e0d" }}>
                连续提升 · 保持节奏
              </Text>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 12 }}>
                {hints.consecutiveImprove.map((d) => (
                  <li key={d.dimension} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", color: "#389e0d" }}>+{d.delta.toFixed(1)}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {d.label}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          </Col>
        )}
        {hasWeak && (
          <Col xs={24} md={12}>
            <div style={{ border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, padding: 12 }}>
              <Text strong style={{ fontSize: 12, color: "#d48806" }}>
                持续薄弱 · 集中突破
              </Text>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: 12 }}>
                {hints.persistentWeak.map((d) => (
                  <li key={d.dimension} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: "monospace", color: "#d48806" }}>{d.delta.toFixed(1)}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {d.label}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          </Col>
        )}
      </Row>
    </Card>
  );
}

export function SelfIntroFocus({ selfIntro }: { selfIntro?: FinalReport["self_intro"] }) {
  const profile = selfIntro?.profile;
  if (!profile || typeof profile !== "object") return null;

  const summary =
    typeof profile.summary === "string" && profile.summary.trim()
      ? profile.summary.trim()
      : "";
  const groups = [
    {
      title: "强调项目",
      caption: "后续追问优先贴近这些经历",
      items: profile.emphasized_projects,
      icon: <AimOutlined />,
      color: "#1677ff",
      tagColor: "blue",
    },
    {
      title: "强调技能",
      caption: "候选人主动抛出的技术关键词",
      items: profile.emphasized_skills,
      icon: <CheckCircleOutlined />,
      color: "#389e0d",
      tagColor: "green",
    },
    {
      title: "希望展开",
      caption: "适合继续深挖的能力方向",
      items: profile.preferred_focus,
      icon: <RiseOutlined />,
      color: "#722ed1",
      tagColor: "purple",
    },
    {
      title: "需要澄清",
      caption: "开场信息不足或需核对的点",
      items: profile.clarification_targets,
      icon: <WarningOutlined />,
      color: "#d48806",
      tagColor: "gold",
    },
  ]
    .map((group) => ({
      ...group,
      items: Array.isArray(group.items)
        ? group.items.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
          )
        : [],
    }))
    .filter((group) => group.items.length > 0);

  if (!summary && groups.length === 0) return null;
  const shouldSpanLastGroup = groups.length % 2 === 1;

  return (
    <Card
      title={
        <Space>
          <StarOutlined style={{ color: GREEN }} />
          自我介绍重点
        </Space>
      }
    >
      {summary && (
        <div style={{ border: "1px solid #f0f0f0", background: "#fafafa", borderRadius: 8, padding: "12px 16px", marginBottom: groups.length > 0 ? 16 : 0 }}>
          <Text type="secondary" style={{ fontSize: 11, letterSpacing: 1 }}>
            开场摘要
          </Text>
          <Paragraph style={{ margin: "4px 0 0", lineHeight: 1.9 }}>{summary}</Paragraph>
        </div>
      )}
      {groups.length > 0 && (
        <Row gutter={[12, 12]}>
          {groups.map((group, idx) => (
            <Col key={group.title} xs={24} md={shouldSpanLastGroup && idx === groups.length - 1 ? 24 : 12}>
              <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, height: "100%" }}>
                <Flex gap={8} align="flex-start" style={{ marginBottom: 12 }}>
                  <span style={{ color: group.color }} aria-hidden="true">
                    {group.icon}
                  </span>
                  <div>
                    <Text strong style={{ fontSize: 12, color: group.color }}>
                      {group.title}
                    </Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {group.caption}
                      </Text>
                    </div>
                  </div>
                </Flex>
                <Flex wrap="wrap" gap={6}>
                  {group.items.map((item) => (
                    <Tag key={`${group.title}-${item}`} color={group.tagColor} style={{ marginInlineEnd: 0, whiteSpace: "normal" }}>
                      {item}
                    </Tag>
                  ))}
                </Flex>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}

type QualityMetric = {
  label: string;
  value: string;
  description: string;
  variant: "success" | "warn" | "outline";
};

function qualityMetricTone(variant: QualityMetric["variant"]) {
  if (variant === "success") {
    return { border: "#b7eb8f", bg: "#f6ffed", label: "#389e0d", tag: "success", highlight: "#389e0d" };
  }
  if (variant === "warn") {
    return { border: "#ffe58f", bg: "#fffbe6", label: "#d48806", tag: "warning", highlight: "#d48806" };
  }
  return { border: "#f0f0f0", bg: "#fafafa", label: "rgba(0,0,0,0.45)", tag: "default", highlight: "#1677ff" };
}

function splitMetricDescription(description: string): { lead: string; rest: string } {
  const colonIndex = description.indexOf("：");
  if (colonIndex < 0) {
    return { lead: "", rest: description };
  }
  return {
    lead: description.slice(0, colonIndex + 1),
    rest: description.slice(colonIndex + 1),
  };
}

function QualityMetricCard({ metric }: { metric: QualityMetric }) {
  const tone = qualityMetricTone(metric.variant);
  const description = splitMetricDescription(metric.description);

  return (
    <div style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 8, padding: 16, height: "100%" }}>
      <Flex justify="space-between" align="flex-start" gap={12} style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 11, letterSpacing: 2, color: tone.label }}>
          {metric.label}
        </Text>
        <Tag color={tone.tag} style={{ marginInlineEnd: 0, fontFamily: "monospace", fontSize: 11 }}>
          {metric.value}
        </Tag>
      </Flex>
      <Paragraph style={{ margin: 0, lineHeight: 1.8 }}>
        {description.lead && (
          <span style={{ fontWeight: 500, color: tone.highlight }}>{description.lead}</span>
        )}
        <Text type="secondary">{description.rest}</Text>
      </Paragraph>
    </div>
  );
}

function credibilityMetric(summary: ScoringCredibility): QualityMetric {
  const level = String(summary.credibility_level ?? "").toLowerCase();
  const value =
    level === "high"
      ? "信号充分"
      : level === "medium"
        ? "部分信号不足"
        : level === "low"
          ? "信号不足"
          : "基础评分";
  const forcedRefine = summary.verification_forced_refine ? "；复核曾触发强制修正" : "";

  return {
    label: "评分可信度",
    value,
    description:
      `fallback ${formatRate(summary.fallback_rate)}，` +
      `证据缺失 ${formatRate(summary.evidence_span_miss_rate)}，` +
      `检查未通过 ${formatRate(summary.contract_no_rate)}${forcedRefine}。`,
    variant: level === "high" ? "success" : level ? "warn" : "outline",
  };
}

function summarizeCoverageWarnings(coverageWarnings: unknown[]): string {
  const dimensions = coverageWarnings
    .map((item) => formatDimensionName(String(asRecord(item).dimension ?? "")))
    .filter((dimension) => dimension.trim().length > 0);
  if (dimensions.length === 0) {
    return "本场面试覆盖的能力维度已形成可读结论。";
  }
  const visible = dimensions.slice(0, 3);
  const suffix = dimensions.length > visible.length ? `等 ${dimensions.length} 项` : "";
  return `证据不足：${visible.join("、")}${suffix}。报告已按覆盖情况保守处理。`;
}

function formatCoverageWarningStatus(status: unknown): string {
  const value = String(status ?? "").trim();
  if (value === "pending") return "尚未追问到足够证据";
  if (value === "active") return "已追问，仍需要更多证据";
  if (value === "not_evaluated") return "尚未形成评分";
  if (value === "skipped") return "本轮已跳过";
  if (value === "evaluator_unavailable") return "评分暂时不可用";
  return value || "证据不足";
}

function summarizeVerification(verification: Record<string, unknown>): string {
  if (Object.keys(verification).length === 0) return "未记录";
  const verdict = verification.verdict ?? verification.result ?? "unknown";
  const confidence = asNumber(verification.confidence);
  return confidence === null
    ? String(verdict)
    : `${String(verdict)} · confidence=${confidence.toFixed(2)}`;
}

function DeveloperFact({
  label,
  code,
  description,
  value,
}: {
  label: string;
  code: string;
  description: string;
  value: string;
}) {
  return (
    <div style={{ border: "1px solid #f0f0f0", background: "#fff", borderRadius: 6, padding: 12, height: "100%" }}>
      <Flex wrap="wrap" align="center" gap="4px 8px">
        <Text strong>{label}</Text>
        <Text type="secondary" style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase" }}>
          {code}
        </Text>
      </Flex>
      <Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 12 }}>
        {description}
      </Paragraph>
      <div
        style={{
          marginTop: 12,
          border: "1px solid #f0f0f0",
          background: "#fafafa",
          borderRadius: 6,
          padding: "8px 10px",
          fontFamily: "monospace",
          fontSize: 11,
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function QualityCenter({
  report,
  traceHealth,
}: {
  report: FinalReport;
  traceHealth?: TraceHealth | null;
}) {
  const workflow = asRecord(report.workflow_artifacts);
  const contract = asRecord(report.contract_summary);
  const evidenceSummary = asRecord(report.evidence_summary);
  const credibilitySummary = report.credibility_summary;
  const coverageWarnings = asArray(report.coverage_warnings);
  const skillCoverage = asRecord(workflow.target_skill_coverage);
  const latestAction = asRecord(workflow.latest_selected_action);
  const latestVerification = asRecord(workflow.latest_verification);
  const policyIds = asStringArray(report.policy_ids);

  const dimensions = Object.values(report.dimension_scores ?? {});
  const passedDimensions = dimensions.filter((score) => score?.passed).length;
  const totalDimensions = dimensions.length;
  const contractTotal = asNumber(contract.total_checks) ?? 0;
  const contractYes = asNumber(contract.checks_yes) ?? 0;
  const contractPartial = asNumber(contract.checks_partial) ?? 0;
  const contractNo = asNumber(contract.checks_no) ?? 0;
  const evidenceTotal = asNumber(evidenceSummary.total_quotes) ?? 0;
  const evidenceMatched = asNumber(evidenceSummary.matched_quotes) ?? 0;
  const evidenceUnmatched = asNumber(evidenceSummary.unmatched_quotes) ?? 0;
  const skillCount = Object.keys(skillCoverage).length;
  const dimensionRows = Object.entries(report.dimension_scores ?? {}).map(([dimension, score]) => ({
    dimension,
    label: formatDimensionName(dimension),
    score,
    badge: dimensionBadgeMeta(score),
    scoreLabel: dimensionScoreLabel(score),
  }));
  const skillRows = Object.entries(skillCoverage)
    .map(([skill, count]) => ({ skill, count: asNumber(count) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 8);

  const coverageMetric: QualityMetric = {
    label: "能力覆盖",
    value:
      totalDimensions > 0
        ? `${passedDimensions}/${totalDimensions}`
        : coverageWarnings.length > 0
          ? `${coverageWarnings.length} 项待补`
          : "已记录",
    description:
      coverageWarnings.length > 0
        ? summarizeCoverageWarnings(coverageWarnings)
        : summarizeCoverageWarnings([]),
    variant: coverageWarnings.length > 0 ? "warn" : "success",
  };

  const personalizationMetric: QualityMetric = {
    label: "题目个性化",
    value: skillCount > 0 ? `${skillCount} 个技能点` : "基础个性化",
    description:
      skillCount > 0
        ? "问题围绕目标技能和你的回答动态调整。"
        : "当前报告未暴露详细技能覆盖，仍保留基础题目与评分证据。",
    variant: skillCount > 0 ? "success" : "outline",
  };

  const trustMetric: QualityMetric = (() => {
    if (traceHealth === "partial" || traceHealth === "missing") {
      return {
        label: "评分可信度",
        value: traceHealth === "missing" ? "记录缺失" : "流程未完整",
        description:
          traceHealth === "missing"
            ? "流程记录缺失，无法核验评分或学习节点；评分仅供参考。"
            : "流程记录未完整闭环，评分或学习节点存在缺口；评分仅供参考。",
        variant: "warn",
      };
    }
    if (credibilitySummary) {
      return credibilityMetric(credibilitySummary);
    }
    return {
      label: "评分可信度",
      value:
        contractTotal > 0
          ? `${contractYes + contractPartial}/${contractTotal}`
          : Object.keys(latestVerification).length > 0
            ? "已复核"
            : "基础评分",
      description:
        contractTotal > 0
          ? "评分检查项已有 yes / partial / no 归因，便于解释结论。"
          : "报告包含评分结果；更细的合同检查项需要后端继续补充。",
      variant: contractTotal > 0 && contractYes + contractPartial < contractTotal ? "warn" : "success",
    };
  })();
  const evidenceMetric: QualityMetric =
    evidenceTotal > 0
      ? {
          label: "评分依据",
          value: `${evidenceMatched}/${evidenceTotal}`,
          description:
            evidenceUnmatched > 0
              ? `评分所引用的回答片段中，${evidenceMatched} 条可回查到原始问答，${evidenceUnmatched} 条暂未匹配；评分仅供参考。`
              : `评分所引用的回答片段中，${evidenceMatched} 条可回查到原始问答。`,
          variant: evidenceUnmatched > 0 ? "warn" : "success",
        }
      : {
          label: "评分依据",
          value: "未生成引用",
          description:
            "本场报告尚未生成可回查的评分引用；分数仍会展示，建议结合问答记录一起判断。",
          variant: "warn",
        };
  const qualityMetrics = [coverageMetric, personalizationMetric, trustMetric, evidenceMetric];

  return (
    <Card
      title={
        <Space>
          <CheckCircleOutlined style={{ color: GREEN }} />
          面试质量中心
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        检查本场面试的能力覆盖、技能覆盖 Top、评分依据、证据可回溯与流程记录完整性。
      </Paragraph>
      <Row gutter={[12, 12]}>
        {qualityMetrics.map((metric) => (
          <Col key={metric.label} xs={24} md={12}>
            <QualityMetricCard metric={metric} />
          </Col>
        ))}
      </Row>

      {(coverageWarnings.length > 0 || skillRows.length > 0) && (
        <Row gutter={[16, 16]} style={{ marginTop: 20 }}>
          {coverageWarnings.length > 0 && (
            <Col xs={24} md={12}>
              <div style={{ border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, padding: 16, height: "100%" }}>
                <Text strong style={{ fontSize: 11, letterSpacing: 2, color: "#d48806" }}>
                  证据还不够的能力
                </Text>
                <Paragraph type="secondary" style={{ fontSize: 12, margin: "4px 0 16px" }}>
                  这些能力维度还没有足够回答证据，报告会更保守地看待相关结论。
                </Paragraph>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12 }}>
                  {coverageWarnings.slice(0, 4).map((item, idx) => {
                    const warning = asRecord(item);
                    const dimension = String(warning.dimension ?? `dim-${idx}`);
                    return (
                      <li
                        key={`${dimension}-${idx}`}
                        style={{ border: "1px solid #fff1b8", background: "#fff", borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {formatDimensionName(dimension)}：{formatCoverageWarningStatus(warning.status)}
                        </Text>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Col>
          )}
          {skillRows.length > 0 && (
            <Col xs={24} md={12}>
              <div style={{ border: "1px solid #bae0ff", background: "#f0f7ff", borderRadius: 8, padding: 16, height: "100%" }}>
                <Text strong style={{ fontSize: 11, letterSpacing: 2, color: "#1677ff", display: "block", marginBottom: 8 }}>
                  技能覆盖 Top
                </Text>
                <Flex wrap="wrap" gap={8}>
                  {skillRows.slice(0, 6).map((row) => (
                    <Tag key={row.skill} style={{ marginInlineEnd: 0, background: "#fff" }}>
                      {row.skill}
                      <span style={{ marginLeft: 6, fontFamily: "monospace", fontSize: 10, color: "#1677ff" }}>×{row.count}</span>
                    </Tag>
                  ))}
                </Flex>
              </div>
            </Col>
          )}
        </Row>
      )}

      {dimensionRows.length > 0 && (
        <div style={{ border: "1px solid #efdbff", background: "#f9f0ff", borderRadius: 8, padding: 16, marginTop: 20 }}>
          <Flex justify="space-between" align="center" gap={8} style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 11, letterSpacing: 2, color: "#722ed1" }}>
              维度覆盖明细
            </Text>
            <Tag color="purple" style={{ marginInlineEnd: 0, fontFamily: "monospace", fontSize: 10 }}>
              {totalDimensions} 个维度
            </Tag>
          </Flex>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
            展示各能力维度的评分结果，以及结论是否已有足够回答证据支撑。
          </Paragraph>
          <Row gutter={[8, 8]}>
            {dimensionRows.map((row) => (
              <Col key={row.dimension} xs={24} sm={12}>
                <div style={{ border: "1px solid #efdbff", background: "#fff", borderRadius: 6, padding: "8px 12px" }}>
                  <Flex justify="space-between" align="center" gap={8}>
                    <Text strong ellipsis style={{ fontSize: 14 }}>
                      {row.label}
                    </Text>
                    <Tag color={dimensionBadgeColor(row.badge.tone)} style={{ marginInlineEnd: 0 }}>
                      {row.badge.label}
                    </Tag>
                  </Flex>
                  <Text type="secondary" style={{ display: "block", marginTop: 8, fontFamily: "monospace", fontSize: 11 }}>
                    {row.scoreLabel}
                  </Text>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      )}

      <Collapse
        size="small"
        style={{ marginTop: 20 }}
        items={[
          {
            key: "dev",
            label: <Text type="secondary">查看开发者细节</Text>,
            children: (
              <>
                <Paragraph type="secondary" style={{ fontSize: 12 }}>
                  这些信息用于排查报告生成链路，包括评分合同检查、策略命中和最近一次流程动作。
                </Paragraph>
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={12}>
                    <DeveloperFact
                      label="评分检查项"
                      code="contract_checks"
                      description="合同检查项的通过分布，用来判断评分结论是否满足内部验收规则。"
                      value={
                        contractTotal > 0
                          ? `yes=${contractYes}, partial=${contractPartial}, no=${contractNo}, total=${contractTotal}`
                          : "未记录"
                      }
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <DeveloperFact
                      label="策略路径"
                      code="policy_ids"
                      description="本场追问和报告生成命中过的策略，用来复盘系统为什么这样选题。"
                      value={policyIds.length > 0 ? policyIds.join(", ") : "未记录"}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <DeveloperFact
                      label="最近策略动作"
                      code="latest_selected_action"
                      description="题目规划器最近一次选择的动作，常用于检查追问是否按预期切换。"
                      value={String(latestAction.id ?? "未记录")}
                    />
                  </Col>
                  <Col xs={24} md={12}>
                    <DeveloperFact
                      label="最近流程校验"
                      code="latest_verification"
                      description="最近一次流程校验摘要，用来定位评分、学习节点或 trace 是否缺失。"
                      value={summarizeVerification(latestVerification)}
                    />
                  </Col>
                </Row>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

export function DimensionRadar({ scores }: { scores?: Record<string, RubricScore> }) {
  if (!scores) return null;

  const scoredEntries = Object.entries(scores).filter(
    (entry): entry is [string, RubricScore & { score: number }] =>
      hasDisplayableDimensionScore(entry[1]),
  );
  if (scoredEntries.length < 3) return null;

  const data = scoredEntries.map(([dim, s]) => ({
    dimension: formatDimensionName(dim),
    score: s.score,
    fullMark: 10,
  }));
  const excludedEntries = Object.entries(scores)
    .filter((entry) => !hasDisplayableDimensionScore(entry[1]))
    .map(([dimension]) => ({
      dimension,
      label: formatDimensionName(dimension),
    }));
  const excludedPreview = excludedEntries.slice(0, 3);
  const excludedSuffix =
    excludedEntries.length > excludedPreview.length ? `等 ${excludedEntries.length} 项` : "";

  const option = {
    tooltip: {
      trigger: "item" as const,
      formatter: (params: { seriesIndex?: number; value?: unknown }) => {
        if (params.seriesIndex !== 0 || !Array.isArray(params.value)) return "";
        return data
          .map((d, i) => {
            const n = Number((params.value as unknown[])[i]);
            return `${d.dimension}：${Number.isFinite(n) ? `${n.toFixed(1)} / 10` : "-"}`;
          })
          .join("<br/>");
      },
    },
    radar: {
      center: ["50%", "52%"],
      radius: "68%",
      shape: "polygon" as const,
      indicator: data.map((d) => ({ name: d.dimension, max: d.fullMark, min: 0 })),
      axisName: { color: "rgba(0,0,0,0.65)", fontSize: 12, fontWeight: 500 },
      splitNumber: 5,
      splitLine: { lineStyle: { color: "rgba(0,0,0,0.12)" } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: "rgba(0,0,0,0.12)" } },
    },
    series: [
      {
        name: "得分",
        type: "radar" as const,
        data: [
          {
            value: data.map((d) => d.score),
            name: "得分",
            symbol: "circle",
            symbolSize: 8,
            itemStyle: { color: "#34d399", borderColor: "#fff", borderWidth: 2 },
            lineStyle: { color: "#34d399", width: 3 },
            areaStyle: { color: "rgba(52,211,153,0.24)" },
          },
        ],
      },
      {
        name: "满分",
        type: "radar" as const,
        silent: true,
        tooltip: { show: false },
        data: [
          {
            value: data.map((d) => d.fullMark),
            name: "满分",
            symbol: "none",
            lineStyle: { color: "rgba(0,0,0,0.42)", width: 1.25 },
            areaStyle: { opacity: 0 },
          },
        ],
      },
    ],
  };

  return (
    <Card
      title={
        <Space>
          <AimOutlined style={{ color: GREEN }} />
          能力雷达
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        只展示已完成有效评分的维度，满分 10 分。
      </Paragraph>
      <div style={{ margin: "0 auto", height: 360, width: "100%", maxWidth: 560 }}>
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge />
      </div>
      {excludedEntries.length > 0 && (
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, textAlign: "center", fontSize: 12 }}>
          <Text type="secondary">未纳入雷达：</Text>
          {excludedPreview.map((entry) => entry.label).join("、")}
          {excludedSuffix}
          <span>（暂无有效评分，详见下方评分维度）</span>
        </Paragraph>
      )}
    </Card>
  );
}

function AnimatedBar({ score, passed }: { score: number; passed?: boolean }) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  return (
    <div ref={ref}>
      <Progress
        percent={inView ? Math.max(0, Math.min(100, score * 10)) : 0}
        showInfo={false}
        strokeColor={passed ? GREEN : AMBER}
        size="small"
        style={{ margin: 0 }}
      />
    </div>
  );
}

export function DimensionScores({ scores }: { scores?: Record<string, RubricScore> }) {
  if (!scores || Object.keys(scores).length === 0) return null;

  const entries = Object.entries(scores);

  return (
    <Card
      title={
        <Space>
          <StarOutlined style={{ color: GREEN }} />
          评分维度
        </Space>
      }
    >
      {entries.map(([dim, s], i) => {
        const visibleWeaknesses = (s.weaknesses || []).filter((w) => !isSystemFallbackText(w));
        const rationale = isSystemFallbackText(s.rationale) ? "" : translateReportText(s.rationale);
        const badge = dimensionBadgeMeta(s);
        const scored = hasDisplayableDimensionScore(s);
        const breakdownLabel = dimensionScoreBreakdownLabel(s);

        return (
          <div key={dim}>
            <Flex justify="space-between" align="center">
              <Space size={8}>
                <Text strong>{formatDimensionName(dim)}</Text>
                <Tag
                  color={dimensionBadgeColor(badge.tone)}
                  icon={badge.tone === "success" ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
                >
                  {badge.label}
                </Tag>
              </Space>
              <Text style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
                {dimensionScoreLabel(s)}
              </Text>
            </Flex>
            {scored ? (
              <AnimatedBar score={s.score} passed={s.passed} />
            ) : (
              <Progress percent={0} showInfo={false} size="small" style={{ margin: 0 }} />
            )}
            {breakdownLabel && (
              <Text type="secondary" style={{ display: "block", fontSize: 11, opacity: 0.8 }}>
                {breakdownLabel}
              </Text>
            )}
            {rationale && (
              <Paragraph type="secondary" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.7 }}>
                {rationale}
              </Paragraph>
            )}
            {visibleWeaknesses.length > 0 && (
              <ul style={{ paddingLeft: 20, margin: "6px 0 0", fontSize: 12, color: "rgba(0,0,0,0.55)", lineHeight: 1.7 }}>
                {visibleWeaknesses.map((w, j) => (
                  <li key={j}>{translateReportText(w)}</li>
                ))}
              </ul>
            )}
            {i < entries.length - 1 && <Divider style={{ margin: "16px 0" }} />}
          </div>
        );
      })}
    </Card>
  );
}
