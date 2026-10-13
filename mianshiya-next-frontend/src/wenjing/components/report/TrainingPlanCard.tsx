"use client";

import React from "react";
import Link from "next/link";
import { Button, Card, Col, Flex, Row, Space, Tag, Typography } from "antd";
import {
  AimOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  RiseOutlined,
  StarOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import type { FinalReport } from "@/wenjing/lib/api/types";
import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import { TrainingPlanSourceBadge } from "@/wenjing/components/shared";
import { isSystemFallbackText, translateReportText } from "./reportUtils";

const { Text, Paragraph } = Typography;

const STYLES = {
  body: { fontSize: 13, fontWeight: 500, lineHeight: "20px", color: "rgba(0,0,0,0.8)", margin: 0 },
  analysisWrap: { marginTop: 8, borderRadius: 6, background: "#fafafa", padding: "8px 12px" },
  description: { marginTop: 4, marginBottom: 0, fontSize: 12, lineHeight: 1.7, color: "rgba(0,0,0,0.5)" },
  evidenceWrap: {
    marginTop: 8,
    borderRadius: 6,
    borderLeft: "2px solid #ffd666",
    background: "#fffbe6",
    padding: "8px 12px",
  },
  evidenceLabel: { display: "block", marginBottom: 4, fontSize: 10, fontWeight: 600, letterSpacing: 1, color: "#d48806" },
  evidence: { margin: 0, fontSize: 12, lineHeight: 1.7, color: "rgba(0,0,0,0.6)", fontStyle: "italic" },
} satisfies Record<string, React.CSSProperties>;

function TrainingPlanEvidence({ text }: { text: unknown }) {
  const content = String(text ?? "").trim();
  if (!content) return null;
  return (
    <div style={STYLES.evidenceWrap}>
      <span style={STYLES.evidenceLabel}>回答证据</span>
      <p style={STYLES.evidence}>{content}</p>
    </div>
  );
}

function TrainingPlanWeaknessAnalysis({ text }: { text: unknown }) {
  const content = translateReportText(String(text ?? "").trim());
  if (!content) return null;
  return (
    <div style={STYLES.analysisWrap}>
      <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px", marginBottom: 4 }}>
        不足分析
      </Tag>
      <p style={{ ...STYLES.description, marginTop: 0 }}>{content}</p>
    </div>
  );
}

function WeakPracticeButton({ href }: { href: string }) {
  return (
    <Link href={href}>
      <Button type="primary" icon={<AimOutlined />} style={{ background: "#16a34a" }}>
        针对本次弱项再来一场
      </Button>
    </Link>
  );
}

type PracticeExtras = { steps?: unknown; success_criteria?: unknown };

export default function TrainingPlanCard({
  plan,
  weakPracticeHref,
  sourceSessionId,
}: {
  plan?: FinalReport["training_plan"];
  weakPracticeHref?: string | null;
  sourceSessionId?: string | null;
}) {
  if (!plan) return null;
  const priorityWeaknesses = (plan.priority_weaknesses || []).filter(
    (w) => !isSystemFallbackText(w.focus) && !isSystemFallbackText(w.why_it_matters),
  );
  const practiceItems = (plan.practice_plan || []).filter(
    (p) => !isSystemFallbackText(p.task) && !isSystemFallbackText(p.rationale),
  );

  const diagnosis = (plan as { diagnosis?: unknown }).diagnosis as
    | { overall_readiness?: string; target_level_gap?: string; top_patterns?: string[]; evidence_refs?: string[] }
    | undefined;

  const planSource =
    typeof (plan as { source?: unknown }).source === "string"
      ? ((plan as { source?: string }).source as string)
      : undefined;

  return (
    <Card
      title={
        <Space>
          <AimOutlined style={{ color: "#52c41a" }} />
          <span>复盘训练计划</span>
          <TrainingPlanSourceBadge source={planSource} />
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: -4 }}>
        基于追问、评分与复盘结果，安排下一场针对性练习。
      </Paragraph>
      <Flex vertical gap={20}>
        {weakPracticeHref && (
          <div>
            <WeakPracticeButton href={weakPracticeHref} />
          </div>
        )}

        {diagnosis && (diagnosis.overall_readiness || diagnosis.target_level_gap) && (
          <section style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 16, background: "linear-gradient(135deg, rgba(22,119,255,0.05), transparent)" }}>
            <Space style={{ marginBottom: 8 }}>
              <StarOutlined style={{ color: "#1677ff" }} />
              <Text strong>能力诊断</Text>
            </Space>
            {diagnosis.overall_readiness && <p style={STYLES.body}>{diagnosis.overall_readiness}</p>}
            {diagnosis.target_level_gap && (
              <div style={{ marginTop: 8 }}>
                <Tag color="blue" style={{ fontSize: 10, lineHeight: "16px" }}>
                  目标差距
                </Tag>
                <p style={STYLES.description}>{diagnosis.target_level_gap}</p>
              </div>
            )}
            {diagnosis.top_patterns && diagnosis.top_patterns.length > 0 && (
              <Flex wrap="wrap" gap={6} style={{ marginTop: 8 }}>
                {diagnosis.top_patterns.map((p, i) => (
                  <Tag key={i} color="blue" style={{ marginInlineEnd: 0 }}>
                    {p}
                  </Tag>
                ))}
              </Flex>
            )}
            {diagnosis.evidence_refs && diagnosis.evidence_refs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {diagnosis.evidence_refs.map((ref, i) => (
                  <TrainingPlanEvidence key={i} text={ref} />
                ))}
              </div>
            )}
          </section>
        )}

        {priorityWeaknesses.length > 0 && (
          <section>
            <Space style={{ marginBottom: 12 }}>
              <WarningOutlined style={{ color: "#faad14" }} />
              <Text strong>优先改进项</Text>
            </Space>
            <Flex vertical gap={8}>
              {priorityWeaknesses.map((w, i) => {
                const focusParams = new URLSearchParams({
                  focus: w.dimension,
                  length: "deep",
                });
                if (sourceSessionId) {
                  focusParams.set("resume_from", sourceSessionId);
                }
                const focusHref = w.dimension ? `/interview/setup?${focusParams.toString()}` : null;
                const evidence = (w as { evidence?: unknown }).evidence;
                return (
                  <div key={i} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                    <Flex justify="space-between" align="flex-start" gap={12}>
                      <div style={{ minWidth: 0 }}>
                        <Text style={{ fontFamily: "monospace", fontSize: 12, color: "#389e0d" }}>
                          {formatDimensionName(w.dimension)}
                        </Text>
                        <div>
                          <Text strong style={{ fontSize: 14 }}>
                            {translateReportText(w.focus)}
                          </Text>
                        </div>
                      </div>
                      {focusHref && (
                        <Link href={focusHref}>
                          <Button type="link" size="small" icon={<PlayCircleOutlined />} style={{ color: "#389e0d", padding: "0 4px" }}>
                            练这个
                          </Button>
                        </Link>
                      )}
                    </Flex>
                    <TrainingPlanWeaknessAnalysis text={w.why_it_matters} />
                    {Boolean(evidence) && <TrainingPlanEvidence text={evidence} />}
                  </div>
                );
              })}
            </Flex>
          </section>
        )}

        {practiceItems.length > 0 && (
          <section>
            <Space style={{ marginBottom: 12 }}>
              <PlayCircleOutlined style={{ color: "#1677ff" }} />
              <Text strong>练习计划</Text>
            </Space>
            <Flex vertical gap={8}>
              {practiceItems.map((p, i) => {
                const extras = p as typeof p & PracticeExtras;
                const steps = Array.isArray(extras.steps) ? (extras.steps as string[]) : [];
                const criteria = Array.isArray(extras.success_criteria)
                  ? (extras.success_criteria as string[])
                  : [];
                return (
                  <Flex key={i} gap={12} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 14 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        width: 24,
                        height: 24,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "50%",
                        background: "#f0f0f0",
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={STYLES.body}>{translateReportText(p.task)}</p>
                      {p.rationale && <p style={STYLES.description}>{translateReportText(p.rationale)}</p>}
                      {typeof p.estimated_hours === "number" && (
                        <Tag style={{ marginTop: 4 }}>(~{p.estimated_hours}h)</Tag>
                      )}
                      {steps.length > 0 && (
                        <ol
                          style={{
                            margin: "10px 0 0",
                            paddingLeft: 32,
                            paddingTop: 8,
                            paddingBottom: 8,
                            paddingRight: 12,
                            border: "1px solid #f0f0f0",
                            borderRadius: 6,
                            background: "#fafafa",
                            fontSize: 12,
                            lineHeight: "20px",
                            color: "rgba(0,0,0,0.6)",
                          }}
                        >
                          {steps.map((s, j) => (
                            <li key={j}>{s}</li>
                          ))}
                        </ol>
                      )}
                      {criteria.length > 0 && (
                        <div style={{ marginTop: 8, border: "1px solid #d9f7be", background: "#f6ffed", borderRadius: 6, padding: "8px 12px" }}>
                          <Text strong style={{ fontSize: 11, letterSpacing: 1, color: "#389e0d" }}>
                            验收标准
                          </Text>
                          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                            {criteria.map((c, j) => (
                              <li key={j} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: "20px", color: "rgba(0,0,0,0.65)" }}>
                                <CheckCircleOutlined style={{ marginTop: 4, color: "#52c41a" }} />
                                {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </Flex>
                );
              })}
            </Flex>
          </section>
        )}

        {weakPracticeHref && (
          <div>
            <WeakPracticeButton href={weakPracticeHref} />
          </div>
        )}

        {plan.goals_30_60_90 && (
          <section>
            <Space style={{ marginBottom: 12 }}>
              <RiseOutlined style={{ color: "#52c41a" }} />
              <Text strong>30/60/90 天训练目标</Text>
            </Space>
            <Row gutter={[12, 12]}>
              <GoalColumn label="30 天" items={plan.goals_30_60_90["30_days"]} color="green" />
              <GoalColumn label="60 天" items={plan.goals_30_60_90["60_days"]} color="blue" />
              <GoalColumn label="90 天" items={plan.goals_30_60_90["90_days"]} color="purple" />
            </Row>
          </section>
        )}

        {weakPracticeHref && (
          <div>
            <WeakPracticeButton href={weakPracticeHref} />
          </div>
        )}
      </Flex>
    </Card>
  );
}

function GoalColumn({
  label,
  items,
  color,
}: {
  label: string;
  items?: string[];
  color: "green" | "blue" | "purple";
}) {
  const visibleItems = (items || []).filter((g) => !isSystemFallbackText(g));
  if (visibleItems.length === 0) return null;

  return (
    <Col xs={24} md={8}>
      <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, height: "100%" }}>
        <Tag color={color} style={{ fontFamily: "monospace", fontSize: 10, marginBottom: 8 }}>
          {label}
        </Tag>
        <ul style={{ listStyle: "disc", paddingLeft: 18, margin: 0, fontSize: 12, lineHeight: 1.7, color: "rgba(0,0,0,0.5)" }}>
          {visibleItems.map((g, i) => (
            <li key={i}>{translateReportText(g)}</li>
          ))}
        </ul>
      </div>
    </Col>
  );
}
