"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Flex,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { BranchesOutlined, WarningOutlined } from "@ant-design/icons";

import type {
  TraceDiagnostics,
  TraceExplorerNode,
  TraceExplorerResponse,
} from "@/wenjing/lib/api/trace";
import {
  formatTs,
  healthLabel,
  isEvaluatorFallbackTrace,
  isSessionClosingNode,
  isSessionOpeningNode,
  isTurnFinalizeNode,
  isVirtualTraceNode,
  recordFromUnknown,
  stringList,
  stringValue,
  traceNodeCanonicalName,
  traceNodeDescription,
  traceNodeDisplayName,
  traceNodeRawAlias,
  type TraceTurnGroup,
} from "./traceUtils";

const { Text, Paragraph, Title } = Typography;

const monoStyle = { fontFamily: "monospace" } as const;
const labelStyle = {
  fontFamily: "monospace",
  fontSize: 10,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "rgba(0,0,0,0.45)",
} as const;

export function BackLinks({ sessionId }: { sessionId: string }) {
  return (
    <Space wrap size={4}>
      <Link href={`/interview/${sessionId}/report`}>
        <Button type="text" size="small">
          查看报告
        </Button>
      </Link>
      <Link href={`/interview/${sessionId}/replay`}>
        <Button type="text" size="small">
          Replay
        </Button>
      </Link>
    </Space>
  );
}

export function PartialTraceDiagnostics({ diagnostics }: { diagnostics: TraceDiagnostics }) {
  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      message="链路健康提示（Trace Health）"
      description={
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Row gutter={[8, 8]}>
            <Col xs={24} md={8}>
              <NodeFact label="健康状态" value={diagnostics.health} />
            </Col>
            <Col xs={24} md={8}>
              <NodeFact label="会话状态" value={diagnostics.session_status ?? "—"} />
            </Col>
            <Col xs={24} md={8}>
              <NodeFact label="最后节点" value={diagnostics.last_node ?? "—"} />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              缺失关键节点
            </Text>
            <div style={{ marginTop: 6 }}>
              {diagnostics.missing_key_nodes.map((node) => (
                <Tag key={node} style={{ ...monoStyle, fontSize: 10 }}>
                  {node}
                </Tag>
              ))}
            </div>
          </div>
        </Space>
      }
    />
  );
}

export function TraceCommandCenter({
  data,
  diagnostics,
  fallbackTraceCount,
  loadedCount,
  nodeTypeCounts,
  totalNodeCount,
  turnCount,
}: {
  data: TraceExplorerResponse;
  diagnostics: TraceDiagnostics | null;
  fallbackTraceCount: number;
  loadedCount: number;
  nodeTypeCounts: Record<string, number>;
  totalNodeCount: number;
  turnCount: number;
}) {
  const [showAllNodeTypes, setShowAllNodeTypes] = useState(false);
  const healthColor =
    data.trace_health === "complete"
      ? "success"
      : data.trace_health === "partial"
        ? "warning"
        : "error";
  const missingNodes = diagnostics?.missing_key_nodes ?? [];
  const nodeDistribution = useMemo(
    () =>
      Object.entries(nodeTypeCounts)
        .filter(([, count]) => count > 0)
        .sort(
          ([leftNode, leftCount], [rightNode, rightCount]) =>
            rightCount - leftCount || leftNode.localeCompare(rightNode),
        ),
    [nodeTypeCounts],
  );
  const visibleNodeDistribution = showAllNodeTypes
    ? nodeDistribution
    : nodeDistribution.slice(0, 6);
  const hiddenNodeTypeCount = nodeDistribution.length - visibleNodeDistribution.length;

  const tiles: { label: string; value: string }[] = [
    { label: "会话状态", value: data.status || "unknown" },
    {
      label: "总分",
      value: typeof data.overall_score === "number" ? data.overall_score.toFixed(2) : "—",
    },
    { label: "结论", value: data.overall_verdict || "—" },
    { label: "轮次", value: String(turnCount) },
    { label: "节点数", value: String(totalNodeCount) },
    { label: "最后节点", value: traceNodeDisplayName(diagnostics?.last_node) },
    {
      label: "已加载",
      value: `${loadedCount}/${totalNodeCount}${data.nodes_has_more ? "+" : ""}`,
    },
  ];

  return (
    <Card>
      <Flex wrap="wrap" justify="space-between" align="flex-start" gap={12}>
        <div style={{ minWidth: 0 }}>
          <Space wrap size={8}>
            <BranchesOutlined style={{ color: "#10b981" }} />
            <Title level={4} style={{ margin: 0 }}>
              Session Trace
            </Title>
            <Tag color={healthColor} style={monoStyle}>
              {healthLabel[data.trace_health]}
            </Tag>
            {fallbackTraceCount > 0 && (
              <Tag color="warning" style={monoStyle}>
                fallback {fallbackTraceCount}
              </Tag>
            )}
          </Space>
          <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            查看本次面试的 execution trace：先确认 Trace Health，再按 turn 定位 node evidence。
          </Paragraph>
          <Text type="secondary" style={{ ...monoStyle, fontSize: 11, wordBreak: "break-all" }}>
            {data.session_id}
          </Text>
        </div>
        <BackLinks sessionId={data.session_id} />
      </Flex>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        }}
      >
        {tiles.map((tile) => (
          <SummaryTile key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </div>

      {nodeDistribution.length > 0 && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid #f0f0f0",
            background: "#fafafa",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Flex justify="space-between" align="center" gap={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              节点分布
            </Text>
            {hiddenNodeTypeCount > 0 && (
              <Button
                type="text"
                size="small"
                aria-expanded={showAllNodeTypes}
                onClick={() => setShowAllNodeTypes((current) => !current)}
              >
                {showAllNodeTypes ? "收起" : `展开全部 +${hiddenNodeTypeCount}`}
              </Button>
            )}
          </Flex>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {visibleNodeDistribution.map(([node, count]) => {
              const alias = traceNodeRawAlias(node);
              const description = traceNodeDescription(node);
              return (
                <Tag key={node} translate="no" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  <span style={monoStyle}>{traceNodeDisplayName(node)}</span>
                  {description && (
                    <span style={{ marginLeft: 4, color: "rgba(0,0,0,0.45)" }}>{description}</span>
                  )}
                  {alias && (
                    <span style={{ ...monoStyle, marginLeft: 4, color: "rgba(0,0,0,0.45)" }}>
                      {alias}
                    </span>
                  )}
                  <span style={{ ...monoStyle, marginLeft: 6, color: "rgba(0,0,0,0.45)" }}>
                    {count}
                  </span>
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {fallbackTraceCount > 0 && (
        <div style={{ marginTop: 12 }}>
          <Tag color="warning" style={monoStyle}>
            Evaluator Fallback {fallbackTraceCount}
          </Tag>
        </div>
      )}

      {missingNodes.length > 0 && (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          message="缺失关键节点"
          description={missingNodes.map((node) => (
            <Tag key={node} style={{ ...monoStyle, fontSize: 10 }}>
              {node}
            </Tag>
          ))}
        />
      )}
    </Card>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, height: "100%" }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 500, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

export function TraceTurnRail({
  grouped,
  selectedNodeId,
  focusedNodeId,
  onSelectNode,
}: {
  grouped: TraceTurnGroup[];
  selectedNodeId: number | null;
  focusedNodeId: number | null;
  onSelectNode: (node: TraceExplorerNode) => void;
}) {
  return (
    <aside
      style={{
        position: "sticky",
        top: 16,
        maxHeight: "calc(100vh - 2rem)",
        overflow: "auto",
        paddingRight: 4,
      }}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {grouped.map((group) => (
          <div key={group.label}>
            <div style={{ ...labelStyle, fontSize: 12, marginBottom: 6 }}>{group.label}</div>
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {group.nodes.map((node) => {
                const selected = selectedNodeId === node.id;
                const focused = focusedNodeId === node.id;
                const nodeAlias = traceNodeRawAlias(node.node, node.payload);
                const nodeDescription = traceNodeDescription(node.node, node.payload);
                const isOpeningNode = isSessionOpeningNode(node.node);
                const isClosingNode = isSessionClosingNode(node.node);
                return (
                  <button
                    key={node.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectNode(node)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                      borderRadius: 6,
                      padding: "8px 10px",
                      border: `1px solid ${selected ? "#1677ff" : "#f0f0f0"}`,
                      background: selected ? "#e6f4ff" : "#fff",
                      boxShadow: focused ? "0 0 0 2px rgba(250,173,20,0.6)" : undefined,
                    }}
                  >
                    <Flex justify="space-between" align="center" gap={8}>
                      <Text strong ellipsis style={{ ...monoStyle, fontSize: 12 }}>
                        {traceNodeDisplayName(node.node, node.payload)}
                      </Text>
                      {typeof node.score === "number" && (
                        <Text style={{ ...monoStyle, fontSize: 11 }}>{node.score.toFixed(1)}</Text>
                      )}
                    </Flex>
                    {(nodeDescription ||
                      nodeAlias ||
                      isVirtualTraceNode(node.node) ||
                      isOpeningNode ||
                      isClosingNode) && (
                      <div
                        style={{
                          marginTop: 2,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 4,
                          fontSize: 10,
                          color: "rgba(0,0,0,0.45)",
                        }}
                      >
                        {isOpeningNode && <span>准备/开场阶段</span>}
                        {isClosingNode && <span>收尾阶段</span>}
                        {nodeDescription && <span>{nodeDescription}</span>}
                        {isVirtualTraceNode(node.node) && (
                          <Tag color="blue" style={{ ...monoStyle, fontSize: 9, lineHeight: "14px", margin: 0 }}>
                            route_after_eval
                          </Tag>
                        )}
                        {nodeAlias && <span style={monoStyle}>{nodeAlias}</span>}
                      </div>
                    )}
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {node.dimension && !isOpeningNode && !isClosingNode && (
                        <Tag style={{ fontSize: 10, margin: 0 }}>{node.dimension}</Tag>
                      )}
                      {isEvaluatorFallbackTrace(node) && (
                        <Tag color="warning" style={{ fontSize: 10, margin: 0 }}>
                          fallback
                        </Tag>
                      )}
                    </div>
                  </button>
                );
              })}
            </Space>
          </div>
        ))}
      </Space>
    </aside>
  );
}

export function TraceNodeDetail({
  node,
  focused,
  prefersReducedMotion,
}: {
  node: TraceExplorerNode | null;
  focused: boolean;
  prefersReducedMotion: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    }
  }, [focused, prefersReducedMotion]);

  if (!node) {
    return (
      <Card style={{ borderStyle: "dashed" }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧 timeline 里的 node 查看详情。" />
      </Card>
    );
  }

  const isFallback = isEvaluatorFallbackTrace(node);
  const rawPayload = {
    payload: node.payload,
    evaluation: node.evaluation,
    policy_context_keys: node.policy_context_keys,
    answer_excerpt: node.answer_excerpt,
  };
  const isClosingNode = isSessionClosingNode(node.node);
  const isOpeningNode = isSessionOpeningNode(node.node);
  const nodeAlias = traceNodeRawAlias(node.node, node.payload);
  const nodeDescription = traceNodeDescription(node.node, node.payload);

  return (
    <div
      ref={ref}
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 8,
        padding: 16,
        background: "#fff",
        boxShadow: focused ? "0 0 0 2px rgba(250,173,20,0.6)" : undefined,
      }}
    >
      <Flex wrap="wrap" justify="space-between" align="flex-start" gap={8}>
        <Space wrap size={8}>
          <Tag style={monoStyle}>{traceNodeDisplayName(node.node, node.payload)}</Tag>
          {nodeDescription && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {nodeDescription}
            </Text>
          )}
          {isVirtualTraceNode(node.node) && (
            <Tag color="blue" style={{ ...monoStyle, fontSize: 10 }}>
              route_after_eval
            </Tag>
          )}
          {nodeAlias && (
            <Text type="secondary" style={{ ...monoStyle, fontSize: 12 }}>
              {nodeAlias}
            </Text>
          )}
          {node.dimension && !isOpeningNode && !isClosingNode && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {node.dimension}
            </Text>
          )}
        </Space>
        <Space wrap size={6}>
          {typeof node.score === "number" && (
            <Tag color={node.passed ? "success" : "warning"}>{node.score.toFixed(1)}</Tag>
          )}
          {isFallback && <Tag color="warning">Evaluator fallback</Tag>}
        </Space>
      </Flex>

      <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
        <Col xs={24} md={12}>
          <NodeFact
            label="轮次"
            value={
              isOpeningNode
                ? "准备/开场阶段"
                : isClosingNode
                  ? "收尾阶段"
                  : String(node.turn_idx ?? "session")
            }
          />
        </Col>
        <Col xs={24} md={12}>
          <NodeFact label="创建时间" value={formatTs(node.created_at)} />
        </Col>
      </Row>

      {node.node === "reward_update" ? (
        <RewardQuestionContext value={node.question} />
      ) : !isOpeningNode && !isClosingNode && !isTurnFinalizeNode(node.node) ? (
        <TraceTextExcerpt label="问题" value={node.question} />
      ) : null}

      {traceNodeCanonicalName(node.node) === "self_intro_question" && node.question && (
        <TraceTextExcerpt label="开场问题文本" value={node.question} />
      )}

      {node.node !== "ask_question" &&
        node.node !== "route_decision" &&
        node.node !== "refine_followup" &&
        node.node !== "final_report" &&
        node.node !== "training_plan" &&
        !isTurnFinalizeNode(node.node) &&
        node.node !== "reward_update" &&
        node.node !== "experience_extractor" &&
        !isOpeningNode &&
        node.answer_excerpt && <TraceTextExcerpt label="回答摘录" value={node.answer_excerpt} />}

      <EvaluationEvidence node={node} />

      <RawTracePayloadDetails rawPayload={rawPayload} />
    </div>
  );
}

function TraceTextExcerpt({ label, value }: { label: string; value?: string | null }) {
  const text = stringValue(value);
  if (!text) return null;

  return (
    <section style={sectionStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}>
        {text}
      </div>
    </section>
  );
}

function RewardQuestionContext({ value }: { value?: string | null }) {
  const text = stringValue(value);
  if (!text) return null;

  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      items={[
        {
          key: "question",
          label: "展开本轮问题上下文",
          children: (
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}>
              {text}
            </div>
          ),
        },
      ]}
    />
  );
}

function EvaluationEvidence({ node }: { node: TraceExplorerNode }) {
  if (
    node.node === "director_sample" ||
    node.node === "ask_question" ||
    node.node === "route_decision" ||
    node.node === "refine_followup" ||
    node.node === "final_report" ||
    node.node === "training_plan" ||
    isTurnFinalizeNode(node.node) ||
    node.node === "reward_update" ||
    node.node === "experience_extractor"
  ) {
    return null;
  }

  const evaluation = recordFromUnknown(node.evaluation);
  const payload = recordFromUnknown(node.payload);
  const strengths = stringList(evaluation.strengths);
  const weaknesses = stringList(evaluation.weaknesses);
  const rationale =
    stringValue(evaluation.rationale) ||
    stringValue(evaluation.reasoning) ||
    stringValue(evaluation.feedback) ||
    (node.node === "verification" ? "" : stringValue(payload.rationale));

  if (
    strengths.length === 0 &&
    weaknesses.length === 0 &&
    !rationale &&
    typeof node.immediate_reward_applied !== "boolean"
  ) {
    return null;
  }

  return (
    <section style={sectionStyle}>
      <Space size={8} wrap>
        <span style={labelStyle}>评估证据</span>
        {typeof node.immediate_reward_applied === "boolean" && (
          <Tag color={node.immediate_reward_applied ? "success" : "default"} style={{ fontSize: 10 }}>
            奖励状态 {node.immediate_reward_applied ? "applied" : "pending"}
          </Tag>
        )}
      </Space>
      {rationale && <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>{rationale}</Paragraph>}
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
          <Col xs={24} md={12}>
            <EvidenceList label="优势" values={strengths} />
          </Col>
          <Col xs={24} md={12}>
            <EvidenceList label="不足" values={weaknesses} />
          </Col>
        </Row>
      )}
    </section>
  );
}

function EvidenceList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {values.map((value, idx) => (
          <li key={idx} style={{ wordBreak: "break-all" }}>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RawTracePayloadDetails({ rawPayload }: { rawPayload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const serialized = useMemo(
    () => (open ? JSON.stringify(rawPayload, null, 2) : ""),
    [open, rawPayload],
  );

  return (
    <Collapse
      size="small"
      style={{ marginTop: 12 }}
      onChange={(keys) => setOpen((Array.isArray(keys) ? keys : [keys]).includes("raw"))}
      items={[
        {
          key: "raw",
          label: "查看原始 Trace Payload",
          children: open ? (
            <pre
              style={{
                margin: 0,
                maxHeight: 512,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                fontFamily: "monospace",
                fontSize: 11,
              }}
            >
              {serialized}
            </pre>
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }}>
              展开后再渲染 JSON，避免长 trace 首屏做无效 stringify。
            </Text>
          ),
        },
      ]}
    />
  );
}

export function NodeFact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, borderRadius: 6, background: "#fafafa", padding: 8 }}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          marginTop: 4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const sectionStyle = {
  marginTop: 12,
  border: "1px solid #f0f0f0",
  borderRadius: 6,
  background: "#fcfcfc",
  padding: 12,
  fontSize: 13,
} as const;
