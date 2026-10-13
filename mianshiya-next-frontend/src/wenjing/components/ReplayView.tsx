"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Col, Collapse, Flex, Row, Skeleton, Space, Tag, Typography } from "antd";
import {
  AimOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CompassOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  ShoppingOutlined,
  TagsOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";

import { ApiError } from "@/wenjing/lib/api/client";
import { getReplay } from "@/wenjing/lib/api/interview";
import type { ReplayResponse, ReplayTurn, TrainingPlanStep } from "@/wenjing/lib/api/types";
import { DIMENSION_LABELS, formatDimensionName } from "@/wenjing/lib/constants/interview";
import { upsertEntry } from "@/wenjing/lib/storage/interviewHistory";
import { CollapsibleAnswerBubble, TrainingPlanSourceBadge } from "@/wenjing/components/shared";

const { Text, Paragraph } = Typography;

type ContextBasisTone = "selfIntro" | "resume" | "job";

const CONTEXT_BASIS_GROUP_META: Record<
  ContextBasisTone,
  { icon: React.ReactNode; border: string; bg: string; iconColor: string; iconBg: string }
> = {
  selfIntro: {
    icon: <UserOutlined />,
    border: "#b7eb8f",
    bg: "#f6ffed",
    iconColor: "#389e0d",
    iconBg: "rgba(82,196,26,0.12)",
  },
  resume: {
    icon: <FileTextOutlined />,
    border: "#91caff",
    bg: "#f0f7ff",
    iconColor: "#1677ff",
    iconBg: "rgba(22,119,255,0.1)",
  },
  job: {
    icon: <ShoppingOutlined />,
    border: "#d3adf7",
    bg: "#f9f0ff",
    iconColor: "#722ed1",
    iconBg: "rgba(114,46,209,0.1)",
  },
};

const QUESTION_BASIS_SOURCE_CHIPS = new Set(["来自自我介绍", "来自简历", "来自岗位要求", "上一轮追问"]);
const QUESTION_BASIS_DIMENSION_MARKER = "评分维度";
const QUESTION_BASIS_DIMENSION_LABELS = new Set(Object.values(DIMENSION_LABELS));

type Fetch =
  | { phase: "loading" }
  | { phase: "ready"; replay: ReplayResponse }
  | { phase: "error"; message: string };

export default function ReplayView({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<Fetch>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const replay = await getReplay(sessionId);
        if (!cancelled) {
          syncReplayHistory(sessionId, replay);
          setState({ phase: "ready", replay });
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: "error",
          message: friendlyReplayError(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (state.phase === "loading") {
    return (
      <Flex vertical gap={16}>
        <Skeleton active paragraph={{ rows: 2 }} />
        <Skeleton active paragraph={{ rows: 4 }} />
        <Skeleton active paragraph={{ rows: 3 }} />
      </Flex>
    );
  }

  if (state.phase === "error") {
    return (
      <Alert
        type="error"
        message="暂时无法打开训练回放"
        description={
          <Flex vertical gap={12} style={{ marginTop: 4 }}>
            <Text type="secondary">{state.message}</Text>
            <Space wrap>
              <Link href={`/interview/${sessionId}/report`}>
                <Button size="small">返回报告</Button>
              </Link>
              <Link href={`/interview/${sessionId}`}>
                <Button size="small" type="text">
                  返回面试页
                </Button>
              </Link>
            </Space>
          </Flex>
        }
      />
    );
  }

  const { replay } = state;
  const practiceHref = buildReplayPracticeHref(replay, sessionId);
  return (
    <Flex vertical gap={20}>
      <SummaryCard replay={replay} />
      <ContextBasisCard basis={replay.context_basis} />
      <TimelineCard turns={replay.timeline} />
      <TrainingPlanCard
        steps={replay.training_plan?.practice_plan ?? []}
        source={typeof replay.training_plan?.source === "string" ? replay.training_plan.source : undefined}
      />
      <Flex wrap="wrap" align="center" gap={8}>
        <Link href={`/interview/${sessionId}/report`}>
          <Button icon={<ArrowLeftOutlined />}>返回报告</Button>
        </Link>
        <Link href="/interview/setup">
          <Button type="primary" icon={<PlayCircleOutlined />} style={{ background: "#16a34a" }}>
            再练一场
          </Button>
        </Link>
        {practiceHref && (
          <Link href={practiceHref}>
            <Button type="primary" icon={<AimOutlined />} style={{ background: "#16a34a" }}>
              针对薄弱点专项练习
            </Button>
          </Link>
        )}
      </Flex>
    </Flex>
  );
}

function buildReplayPracticeHref(replay: ReplayResponse, sourceSessionId: string): string | null {
  const focus: string[] = [];
  const add = (dimension: unknown) => {
    if (typeof dimension !== "string" || !dimension.trim()) return;
    if (!focus.includes(dimension)) focus.push(dimension);
  };
  for (const weakness of replay.summary.priority_weaknesses ?? []) {
    add(weakness);
  }
  for (const turn of replay.timeline ?? []) {
    if (
      typeof turn.dimension === "string" &&
      (turn.passed === false || (typeof turn.score === "number" && turn.score < 7))
    ) {
      add(turn.dimension);
    }
  }
  if (focus.length === 0) return null;
  const params = new URLSearchParams();
  params.set("focus", focus.slice(0, 5).join(","));
  params.set("length", "short");
  if (replay.summary.job_title) params.set("job_title", replay.summary.job_title);
  if (replay.summary.job_level) params.set("job_level", String(replay.summary.job_level));
  params.set("resume_from", sourceSessionId);
  return `/interview/setup?${params.toString()}`;
}

function syncReplayHistory(sessionId: string, replay: ReplayResponse): void {
  upsertEntry({
    sessionId,
    createdAt: replay.created_at ?? undefined,
    updatedAt: replay.updated_at ?? undefined,
    status: "done",
    overallScore:
      typeof replay.summary.overall_score === "number" ? replay.summary.overall_score : undefined,
    growthSignal:
      typeof replay.summary.growth_signal === "string" ? replay.summary.growth_signal : undefined,
    overallVerdict:
      typeof replay.summary.overall_verdict === "string" ? replay.summary.overall_verdict : undefined,
  });
}

function SummaryCard({ replay }: { replay: ReplayResponse }) {
  const summary = replay.summary;
  const priorityGroups = groupReplayPriorityItems(summary.priority_items);
  const hasPriorityItems = priorityGroups.weakness.length > 0 || priorityGroups.coverage_limited.length > 0;
  return (
    <Card
      style={{ borderColor: "#b7eb8f", background: "#f6ffed" }}
      title={
        <Space>
          <RollbackOutlined style={{ color: "#52c41a" }} />
          本场训练回放
        </Space>
      }
    >
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}>
          <Metric label="岗位" value={summary.job_title || "未填写"} />
        </Col>
        <Col xs={24} sm={8}>
          <Metric label="轮次" value={`${summary.total_turns ?? replay.timeline.length} 轮`} />
        </Col>
        <Col xs={24} sm={8}>
          <Metric
            label="总分"
            value={typeof summary.overall_score === "number" ? summary.overall_score.toFixed(1) : "-"}
          />
        </Col>
        {hasPriorityItems ? (
          <Col span={24}>
            <Flex vertical gap={12}>
              <PriorityItemGroup title="薄弱点" items={priorityGroups.weakness} />
              <PriorityItemGroup title="补充证据" items={priorityGroups.coverage_limited} />
            </Flex>
          </Col>
        ) : (
          (summary.priority_weaknesses ?? []).length > 0 && (
            <Col span={24}>
              <Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
                优先补强
              </Text>
              <Flex wrap="wrap" gap={8}>
                {summary.priority_weaknesses?.map((item) => (
                  <Tag key={item} style={{ marginInlineEnd: 0 }}>
                    {item}
                  </Tag>
                ))}
              </Flex>
            </Col>
          )
        )}
      </Row>
    </Card>
  );
}

type ReplayPriorityItem = NonNullable<ReplayResponse["summary"]["priority_items"]>[number];

function groupReplayPriorityItems(items: ReplayResponse["summary"]["priority_items"]): {
  weakness: ReplayPriorityItem[];
  coverage_limited: ReplayPriorityItem[];
} {
  const groups = {
    weakness: [] as ReplayPriorityItem[],
    coverage_limited: [] as ReplayPriorityItem[],
  };
  for (const item of items ?? []) {
    if (item.category === "coverage_limited") {
      groups.coverage_limited.push(item);
    } else {
      groups.weakness.push(item);
    }
  }
  return groups;
}

function PriorityItemGroup({ title, items }: { title: string; items: ReplayPriorityItem[] }) {
  if (items.length === 0) return null;
  const isEvidence = title === "补充证据";
  return (
    <section>
      <div style={{ marginBottom: 8 }}>
        <Tag
          color={isEvidence ? "blue" : "green"}
          icon={isEvidence ? <FileTextOutlined /> : <AimOutlined />}
          style={{ fontWeight: 500 }}
        >
          {title}
        </Tag>
      </div>
      <Flex wrap="wrap" gap={8}>
        {items.map((priorityItem) => (
          <Tag key={`${priorityItem.category}-${priorityItem.display_text}`} style={{ marginInlineEnd: 0 }}>
            {priorityItem.display_text}
          </Tag>
        ))}
      </Flex>
    </section>
  );
}

function sectionLabelIcon(title: string): React.ReactNode {
  if (title === "你的回答") return <UserOutlined />;
  if (title === "评分依据") return <FileTextOutlined />;
  if (title === "亮点") return <CheckCircleOutlined />;
  if (title === "可提升") return <AimOutlined />;
  return <TagsOutlined />;
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <Tag icon={sectionLabelIcon(title)} style={{ fontWeight: 500, color: "rgba(0,0,0,0.6)" }}>
        {title}
      </Tag>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #f0f0f0", background: "#fff", borderRadius: 8, padding: 12, height: "100%" }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <div style={{ marginTop: 4, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function ContextBasisCard({ basis }: { basis?: ReplayResponse["context_basis"] }) {
  if (!basis) return null;
  const selfIntroRows = [
    { label: "项目线索", values: basis.self_intro?.emphasized_projects ?? [] },
    { label: "技能线索", values: basis.self_intro?.emphasized_skills ?? [] },
    { label: "关注方向", values: basis.self_intro?.preferred_focus ?? [] },
  ];
  const resumeRows = [
    { label: "项目线索", values: basis.resume?.projects ?? [] },
    { label: "重点方向", values: basis.resume?.focus_areas ?? [] },
    { label: "技能线索", values: basis.resume?.skills ?? [] },
  ];
  const dimensionLabel =
    basis.job_spec?.dimension_source_label === "默认评分标准" ? "评分维度（默认评分标准）" : "评分维度";
  const jobRows = [
    { label: "岗位技能", values: basis.job_spec?.required_skills ?? [] },
    {
      label: dimensionLabel,
      values: (basis.job_spec?.dimensions ?? []).map(formatDimension),
    },
  ];
  return (
    <Card styles={{ body: { padding: 0 } }}>
      <Collapse
        ghost
        expandIconPosition="end"
        items={[
          {
            key: "basis",
            label: (
              <div style={{ paddingRight: 8 }}>
                <Text strong style={{ fontSize: 16 }}>
                  {basis.title}
                </Text>
                <ContextBasisOverview basis={basis} />
              </div>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <ContextBasisGroup title="自我介绍" tone="selfIntro" rows={selfIntroRows} />
                <ContextBasisGroup title="简历" tone="resume" rows={resumeRows} />
                <ContextBasisGroup title="岗位要求" tone="job" rows={jobRows} />
              </Row>
            ),
          },
        ]}
      />
    </Card>
  );
}

function ContextBasisOverview({ basis }: { basis: NonNullable<ReplayResponse["context_basis"]> }) {
  return (
    <div style={{ marginTop: 12 }}>
      {basis.summary && (
        <Paragraph type="secondary" style={{ maxWidth: "72ch", marginBottom: basis.chips.length > 0 ? 12 : 0 }}>
          {basis.summary}
        </Paragraph>
      )}
      {basis.chips.length > 0 && (
        <Flex wrap="wrap" gap={6}>
          {basis.chips.map((chip) => (
            <Tag key={chip} style={{ marginInlineEnd: 0 }}>
              {chip}
            </Tag>
          ))}
        </Flex>
      )}
    </div>
  );
}

function ContextBasisGroup({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: ContextBasisTone;
  rows: Array<{ label: string; values: string[] }>;
}) {
  const visibleRows = rows.filter((row) => row.values.length > 0);
  if (visibleRows.length === 0) return null;
  const meta = CONTEXT_BASIS_GROUP_META[tone];
  return (
    <Col xs={24} md={8}>
      <div style={{ border: `1px solid ${meta.border}`, background: meta.bg, borderRadius: 6, padding: 12, height: "100%" }}>
        <Flex align="center" gap={8} style={{ marginBottom: 12 }}>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 24,
              height: 24,
              borderRadius: 6,
              background: meta.iconBg,
              color: meta.iconColor,
            }}
          >
            {meta.icon}
          </span>
          <Text strong>{title}</Text>
        </Flex>
        <Flex vertical gap={12}>
          {visibleRows.map((row) => (
            <ContextBasisRow key={row.label} label={row.label} values={row.values} />
          ))}
        </Flex>
      </div>
    </Col>
  );
}

function contextBasisRowIcon(label: string): React.ReactNode {
  if (label.includes("技能")) return <ToolOutlined />;
  if (label.includes("方向")) return <CompassOutlined />;
  if (label.includes("维度")) return <ApartmentOutlined />;
  return <TagsOutlined />;
}

function ContextBasisRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: "flex", gap: 6, marginBottom: 6 }}>
        {contextBasisRowIcon(label)}
        {label}
      </Text>
      <Flex wrap="wrap" gap={6}>
        {values.map((value) => (
          <Tag key={`${label}-${value}`} style={{ marginInlineEnd: 0, background: "#fff" }}>
            {value}
          </Tag>
        ))}
      </Flex>
    </div>
  );
}

function TimelineCard({ turns }: { turns: ReplayTurn[] }) {
  if (turns.length === 0) {
    return (
      <Card>
        <Text type="secondary">这场面试还没有可展示的逐轮记录，但最终报告仍可用于复盘。</Text>
      </Card>
    );
  }

  return (
    <Flex vertical gap={12}>
      {turns.map((turn, index) => (
        <Card
          key={`${turn.turn_idx}-${index}`}
          title={
            <Flex wrap="wrap" align="center" gap={8}>
              <span>第 {index + 1} 轮</span>
              {turn.dimension && <Tag style={{ marginInlineEnd: 0 }}>{formatDimension(turn.dimension)}</Tag>}
              {typeof turn.score === "number" && (
                <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                  {turn.score.toFixed(1)} 分
                </Tag>
              )}
              {turn.passed && <CheckCircleFilled style={{ color: "#52c41a" }} />}
            </Flex>
          }
        >
          <Flex vertical gap={16}>
            <Block title="问题" value={turn.question} />
            <QuestionBasisBlock
              basis={turn.question_basis}
              decisionBasis={turn.question_decision_basis}
              resumeAnchorLabel={turn.resume_anchor_label}
            />
            <AnchorFollowupNotice followup={turn.anchor_followup} resumeAnchorLabel={turn.resume_anchor_label} />
            {turn.answer && (
              <div>
                <SectionLabel title="你的回答" />
                <CollapsibleAnswerBubble
                  text={turn.answer}
                  label="你"
                  contentId={`replay-answer-content-${turn.turn_idx ?? index}`}
                />
              </div>
            )}
            <ScoringRationaleBlock rationale={turn.rationale} followupReason={turn.followup_reason} />
            <ListBlock title="亮点" values={turn.strengths ?? []} />
            <ListBlock
              title="可提升"
              values={turn.weaknesses ?? []}
              emptyText="本轮没有明确短板记录，可结合评分依据继续复盘。"
            />
            {turn.next_step && (
              <div style={{ border: "1px solid #b7eb8f", background: "#f6ffed", borderRadius: 8, padding: 12 }}>
                <Text strong style={{ fontSize: 12, color: "#389e0d", display: "flex", gap: 6, marginBottom: 4 }}>
                  <AimOutlined />
                  下一步练习
                </Text>
                <Text type="secondary">{turn.next_step}</Text>
              </div>
            )}
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}

function AnchorFollowupNotice({
  followup,
  resumeAnchorLabel,
}: {
  followup?: ReplayTurn["anchor_followup"];
  resumeAnchorLabel?: ReplayTurn["resume_anchor_label"];
}) {
  if (!followup) return null;
  if (followup.max_attempts < 2 || followup.attempt < 1) return null;
  const anchorLabel = String(resumeAnchorLabel || "").trim();
  return (
    <div>
      <Tag color="warning" icon={<BranchesOutlined />} style={{ whiteSpace: "normal", maxWidth: "100%" }}>
        {anchorLabel
          ? `简历锚点「${anchorLabel}」第 ${followup.attempt}/${followup.max_attempts} 轮追问`
          : `当前简历锚点第 ${followup.attempt}/${followup.max_attempts} 轮追问`}
      </Tag>
    </div>
  );
}

function QuestionBasisBlock({
  basis,
  decisionBasis,
  resumeAnchorLabel,
}: {
  basis?: ReplayTurn["question_basis"];
  decisionBasis?: ReplayTurn["question_decision_basis"];
  resumeAnchorLabel?: ReplayTurn["resume_anchor_label"];
}) {
  if (!basis && !decisionBasis) return null;
  const chipGroups = splitQuestionBasisChips(basis?.chips ?? []);
  const anchorLabel = String(resumeAnchorLabel || "").trim();
  const anchorChips = anchorLabel ? [anchorLabel] : [];
  const hasGroups = (basis?.chips.length ?? 0) > 0 || anchorChips.length > 0;
  const hasDecisionBasis = decisionBasis
    ? Boolean(
        decisionBasis.sources?.length || decisionBasis.target_skills?.length || decisionBasis.reason_codes?.length,
      )
    : false;
  return (
    <div style={{ border: "1px solid #91caff", background: "#f0f7ff", borderRadius: 6, padding: 12 }}>
      {basis && (
        <>
          <Text strong style={{ display: "block", fontSize: 12, color: "#1677ff", marginBottom: 4 }}>
            {basis.title}
          </Text>
          <Text type="secondary">{basis.summary}</Text>
        </>
      )}
      {hasGroups && (
        <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
          <QuestionBasisChipGroup label="依据来源" chips={chipGroups.sources} span={6} />
          <QuestionBasisChipGroup label="关联经历" chips={anchorChips} span={6} />
          <QuestionBasisChipGroup label="匹配维度" chips={chipGroups.dimensions} span={6} />
          <QuestionBasisChipGroup label="具体线索" chips={chipGroups.details} span={6} />
        </Row>
      )}
      {hasDecisionBasis && decisionBasis && <QuestionDecisionBasisDetails basis={decisionBasis} />}
    </div>
  );
}

function QuestionDecisionBasisDetails({
  basis,
}: {
  basis: NonNullable<ReplayTurn["question_decision_basis"]>;
}) {
  const sourceChips = (basis.sources ?? []).map(formatDecisionSource);
  const skillChips = (basis.target_skills ?? []).map(
    (skill) => `${skill.value} · ${formatTargetSkillSource(skill.source)}`,
  );
  const reasonChips = (basis.reason_codes ?? []).map(formatReasonCode);
  const rows = [
    { label: "来源", values: sourceChips },
    { label: "技能依据", values: skillChips },
    { label: "触发原因", values: reasonChips },
  ].filter((row) => row.values.length > 0);
  if (rows.length === 0) return null;
  return (
    <Collapse
      size="small"
      style={{ marginTop: 12, background: "rgba(255,255,255,0.6)" }}
      items={[
        {
          key: "decision",
          label: (
            <Text strong style={{ fontSize: 12, color: "#1677ff" }}>
              依据明细
            </Text>
          ),
          children: (
            <Row gutter={[8, 8]}>
              {rows.map((row) => (
                <QuestionBasisChipGroup key={row.label} label={row.label} chips={row.values} span={8} />
              ))}
            </Row>
          ),
        },
      ]}
    />
  );
}

function formatDecisionSource(source: string): string {
  if (source === "resume") return "简历";
  if (source === "self_intro") return "自我介绍";
  if (source === "job") return "岗位要求";
  if (source === "followup") return "上一轮追问";
  if (source === "question_seed") return "题库模板";
  if (source === "rag") return "知识检索";
  return "技能聚焦";
}

function formatTargetSkillSource(source: string): string {
  if (source === "job_spec") return "岗位要求";
  if (source === "resume_parse_audit") return "简历解析";
  if (source === ["resume", "anchor"].join("_")) return "关联经历";
  if (source === "self_intro") return "自我介绍";
  return "选题策略";
}

function formatReasonCode(code: string): string {
  if (code === "covers_target_skills") return "覆盖目标技能";
  if (code === "uses_resume_anchor") return "追问关联经历";
  if (code === "uses_self_intro_anchor") return "承接自我介绍";
  if (code === "followup_context") return "承接上一轮";
  if (code === "uses_question_seed") return "匹配题库模板";
  if (code === "uses_job_requirement") return "匹配岗位要求";
  return code;
}

function questionBasisGroupIcon(label: string): React.ReactNode {
  if (label === "依据来源") return <BranchesOutlined />;
  if (label === "关联经历") return <FileTextOutlined />;
  if (label === "匹配维度") return <ApartmentOutlined />;
  return <TagsOutlined />;
}

function QuestionBasisChipGroup({ label, chips, span }: { label: string; chips: string[]; span: number }) {
  if (chips.length === 0) return null;
  return (
    <Col xs={24} sm={span}>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 20,
            height: 20,
            borderRadius: 6,
            background: "rgba(22,119,255,0.1)",
            color: "#1677ff",
          }}
        >
          {questionBasisGroupIcon(label)}
        </span>
        {label}
      </Text>
      <Flex wrap="wrap" gap={6}>
        {chips.map((chip) => (
          <Tag key={`${label}-${chip}`} style={{ marginInlineEnd: 0, background: "#fff" }}>
            {chip}
          </Tag>
        ))}
      </Flex>
    </Col>
  );
}

function splitQuestionBasisChips(chips: string[]) {
  const groups = {
    sources: [] as string[],
    dimensions: [] as string[],
    details: [] as string[],
  };
  let nextChipIsDimension = false;
  for (const chip of chips) {
    if (QUESTION_BASIS_SOURCE_CHIPS.has(chip)) {
      groups.sources.push(chip);
      nextChipIsDimension = false;
      continue;
    }
    if (chip === QUESTION_BASIS_DIMENSION_MARKER) {
      nextChipIsDimension = true;
      continue;
    }
    if (nextChipIsDimension || QUESTION_BASIS_DIMENSION_LABELS.has(chip)) {
      groups.dimensions.push(chip);
      nextChipIsDimension = false;
      continue;
    }
    groups.details.push(chip);
    nextChipIsDimension = false;
  }
  return groups;
}

function TrainingPlanCard({ steps, source }: { steps: TrainingPlanStep[]; source: string | undefined }) {
  if (steps.length === 0) return null;
  return (
    <Card
      title={
        <Space>
          <span>后续练习任务</span>
          <TrainingPlanSourceBadge source={source} />
        </Space>
      }
    >
      <Flex vertical gap={8}>
        {steps.map((step, index) => (
          <div key={`${step.task}-${index}`} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
            <Text strong>{step.task}</Text>
            {step.rationale && (
              <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                {step.rationale}
              </Paragraph>
            )}
          </div>
        ))}
      </Flex>
    </Card>
  );
}

function Block({ title, value }: { title: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <SectionLabel title={title} />
      <Paragraph style={{ margin: 0, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{value}</Paragraph>
    </div>
  );
}

function ScoringRationaleBlock({
  rationale,
  followupReason,
}: {
  rationale?: string | null;
  followupReason?: ReplayTurn["followup_reason"];
}) {
  if (!rationale && !followupReason) return null;
  return (
    <div>
      <SectionLabel title="评分依据" />
      <Flex vertical gap={8}>
        {rationale && <Paragraph style={{ margin: 0, lineHeight: 1.8 }}>{rationale}</Paragraph>}
        {followupReason && (
          <div style={{ border: "1px solid #b7eb8f", background: "#f6ffed", borderRadius: 6, padding: 12 }}>
            <Text strong style={{ display: "block", fontSize: 12, color: "#389e0d", marginBottom: 4 }}>
              {followupReason.title}
            </Text>
            <Text type="secondary">{followupReason.summary}</Text>
            {followupReason.chips.length > 0 && (
              <Flex wrap="wrap" gap={6} style={{ marginTop: 8 }}>
                {followupReason.chips.map((chip) => (
                  <Tag key={chip} style={{ marginInlineEnd: 0 }}>
                    {chip}
                  </Tag>
                ))}
              </Flex>
            )}
          </div>
        )}
      </Flex>
    </div>
  );
}

function ListBlock({ title, values, emptyText }: { title: string; values: string[]; emptyText?: string }) {
  if (values.length === 0 && !emptyText) return null;
  return (
    <div>
      <SectionLabel title={title} />
      {values.length === 0 && emptyText ? (
        <Text type="secondary" italic>
          {emptyText}
        </Text>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20, color: "rgba(0,0,0,0.55)", lineHeight: 1.8 }}>
          {values.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDimension(id: string): string {
  return formatDimensionName(id);
}

function friendlyReplayError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return "训练回放会在面试完成后生成。可以先回到面试页继续答题。";
    }
    if (err.status === 401 || err.status === 403) {
      return "当前浏览器缺少这场面试的访问凭证。请从“我的面试”列表重新进入，或重新开始一场面试。";
    }
    if (err.status === 404) {
      return "没有找到这场面试的回放数据，可能已被删除或只保存在其他浏览器。";
    }
  }
  return err instanceof Error ? err.message : String(err);
}
