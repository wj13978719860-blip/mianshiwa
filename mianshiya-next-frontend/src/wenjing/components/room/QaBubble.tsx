"use client";

import React, { useState, type ReactNode } from "react";
import { Button, Col, Flex, Row, Tag, Typography } from "antd";
import {
  BulbOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CompressOutlined,
  ExpandOutlined,
  StarOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import MdViewer from "@/components/MdViewer";
import { CollapsibleAnswerBubble } from "@/wenjing/components/shared";
import type { PreviousTurnEvaluation } from "@/wenjing/lib/api/types";
import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import {
  hasDisplayableTurnFeedback,
  isFallbackTurnEvaluation,
  resumeAnchorLabel,
  type QaEntry,
} from "./helpers";

export const QaBubble = React.memo(function QaBubble({
  entry,
  isCurrent,
  showTurnFeedback,
}: {
  entry: QaEntry;
  isCurrent: boolean;
  showTurnFeedback: boolean;
}) {
  const isSelfIntro = entry.questionType === "self_intro";
  const displayTurnIdx = entry.displayTurnIdx ?? entry.formalTurnIdx ?? entry.turnIdx;
  const turnLabel = isSelfIntro
    ? "开场"
    : displayTurnIdx !== null && displayTurnIdx !== undefined
      ? String(displayTurnIdx + 1)
      : "?";
  const turnBadgeText = isSelfIntro ? turnLabel : `第 ${turnLabel} 题`;
  const answerContentId = `answer-content-${entry.turnIdx ?? "intro"}`;
  const anchorLabel = resumeAnchorLabel(entry.resumeAnchor);

  return (
    <Flex vertical gap={8}>
      <Flex align="center" gap={6} wrap="wrap">
        <Tag color="green" style={{ fontSize: 14, fontWeight: 700, padding: "2px 12px", margin: 0 }}>
          {turnBadgeText}
        </Tag>
        {isSelfIntro && (
          <Tag color="green" bordered={false} style={{ margin: 0 }}>
            开场介绍
          </Tag>
        )}
        {!isSelfIntro && entry.dimension && (
          <Tag aria-label={`维度：${formatDimensionName(entry.dimension)}`} style={{ margin: 0 }}>
            {formatDimensionName(entry.dimension)}
          </Tag>
        )}
        {anchorLabel && (
          <Tag color="green" bordered={false} style={{ margin: 0 }}>
            本题围绕：{anchorLabel}
          </Tag>
        )}
        {isCurrent && entry.answer === null && (
          <Tag color="orange" style={{ margin: 0 }}>
            等待你的回答
          </Tag>
        )}
        {entry.answer !== null && <CheckCircleFilled style={{ color: "#52c41a" }} />}
      </Flex>

      <div
        style={{
          border: "1px solid #f0f0f0",
          background: "#fafafa",
          borderRadius: 8,
          padding: 16,
          lineHeight: 1.7,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <Tag color="green" style={{ marginRight: 6 }}>
            Q
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            面试官
          </Typography.Text>
        </div>
        <MdViewer value={entry.question} />
      </div>

      {entry.answer !== null && (
        <div style={{ marginLeft: 24 }}>
          <CollapsibleAnswerBubble text={entry.answer} contentId={answerContentId} />
        </div>
      )}
      {showTurnFeedback &&
        entry.answer !== null &&
        hasDisplayableTurnFeedback(entry.evaluation) && (
          <div style={{ marginLeft: 24 }}>
            <TurnFeedbackSummary evaluation={entry.evaluation} />
          </div>
        )}
    </Flex>
  );
});

type TurnFeedbackVerdict = {
  label: string;
  icon: ReactNode;
  tagColor: string;
  borderColor: string;
  background: string;
  emptyWeaknessText: string;
};

function getTurnFeedbackVerdict(evaluation: PreviousTurnEvaluation): TurnFeedbackVerdict {
  if (isFallbackTurnEvaluation(evaluation)) {
    return {
      label: "评估暂不可用",
      icon: <WarningOutlined style={{ color: "#8c8c8c" }} />,
      tagColor: "default",
      borderColor: "#f0f0f0",
      background: "#fafafa",
      emptyWeaknessText: "评估模型暂时不可用，本轮回答已保存；这次不作为能力短板判断。",
    };
  }
  if (evaluation.passed) {
    return {
      label: "本题通过",
      icon: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
      tagColor: "success",
      borderColor: "#b7eb8f",
      background: "#f6ffed",
      emptyWeaknessText: "这题完成度不错，暂时没有明显短板。下一题继续保持这样的展开力度。",
    };
  }
  if (typeof evaluation.score === "number" && evaluation.score >= 4) {
    return {
      label: "接近通过线",
      icon: <StarOutlined style={{ color: "#faad14" }} />,
      tagColor: "warning",
      borderColor: "#ffe58f",
      background: "#fffbe6",
      emptyWeaknessText: "整体已经接近要求，下一题可以继续补充关键细节，把证据链再压实一点。",
    };
  }
  return {
    label: "可以再补齐",
    icon: <BulbOutlined style={{ color: "#8c8c8c" }} />,
    tagColor: "default",
    borderColor: "#f0f0f0",
    background: "#fafafa",
    emptyWeaknessText: "本题还需要更多信息支撑，下一题优先把背景、动作和结果讲完整。",
  };
}

function TurnFeedbackSummary({ evaluation }: { evaluation: PreviousTurnEvaluation }) {
  const verdict = getTurnFeedbackVerdict(evaluation);

  return (
    <div
      style={{
        border: `1px solid ${verdict.borderColor}`,
        background: verdict.background,
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
      }}
    >
      <Flex align="center" gap={8} wrap="wrap" style={{ marginBottom: 8 }}>
        {verdict.icon}
        <Typography.Text strong style={{ fontSize: 13 }}>
          本题反馈
        </Typography.Text>
        <Tag color={verdict.tagColor} style={{ margin: 0 }}>
          {verdict.label}
        </Tag>
      </Flex>
      {isFallbackTurnEvaluation(evaluation) ? (
        <TurnFeedbackFallbackNotice evaluation={evaluation} />
      ) : (
        <Row gutter={[8, 8]}>
          <Col xs={24} sm={12}>
            <TurnFeedbackList
              tone="positive"
              heading="做得好"
              items={evaluation.strengths}
              emptyText="这题暂未提炼出明确亮点，可以继续保持作答节奏。"
            />
          </Col>
          <Col xs={24} sm={12}>
            <TurnFeedbackList
              tone="negative"
              heading="可补齐"
              items={evaluation.weaknesses}
              emptyText={verdict.emptyWeaknessText}
            />
          </Col>
        </Row>
      )}
    </div>
  );
}

function TurnFeedbackFallbackNotice({ evaluation }: { evaluation: PreviousTurnEvaluation }) {
  const warning = evaluation.system_warnings?.find((item) => item.trim());
  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        background: "#fff",
        borderRadius: 6,
        padding: "8px 12px",
        lineHeight: 1.7,
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        本轮回答已保存，但评估模型暂时不可用。这次不会作为能力短板判断，
        可以继续下一题，稍后在报告里查看整体反馈。
      </Typography.Text>
      {warning ? (
        <div style={{ marginTop: 6 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {warning}
          </Typography.Text>
        </div>
      ) : null}
    </div>
  );
}

const TURN_FEEDBACK_PREVIEW_LIMIT = 2;

function TurnFeedbackList({
  tone,
  heading,
  items,
  emptyText,
}: {
  tone: "positive" | "negative";
  heading: string;
  items: string[];
  emptyText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = items.length > TURN_FEEDBACK_PREVIEW_LIMIT;
  const visibleItems = expanded ? items : items.slice(0, TURN_FEEDBACK_PREVIEW_LIMIT);
  const palette =
    tone === "positive"
      ? { border: "#d9f7be", bg: "#f6ffed", marker: "#52c41a", heading: "#389e0d" }
      : { border: "#ffe7ba", bg: "#fff7e6", marker: "#fa8c16", heading: "#d46b08" };
  const itemStyle: React.CSSProperties = {
    border: `1px solid ${palette.border}`,
    background: "#fff",
    borderRadius: 6,
    padding: "6px 8px",
    lineHeight: 1.6,
    color: "rgba(0,0,0,0.75)",
  };

  return (
    <section
      style={{
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        borderRadius: 6,
        padding: 10,
        height: "100%",
      }}
    >
      <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: "50%", background: palette.marker }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: palette.heading }}>{heading}</span>
      </Flex>
      {items.length > 0 ? (
        <>
          <Flex vertical gap={6} component="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visibleItems.map((item, index) => (
              <li key={`${tone}-${index}-${item.slice(0, 12)}`} style={itemStyle}>
                {item}
              </li>
            ))}
          </Flex>
          {hasOverflow ? (
            <Button
              type="link"
              size="small"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
              style={{ marginTop: 6, paddingInline: 0, fontSize: 12, color: palette.heading }}
            >
              {expanded ? "收起" : `展开全部 ${items.length} 条`}
            </Button>
          ) : null}
        </>
      ) : (
        <p style={{ ...itemStyle, margin: 0, color: "rgba(0,0,0,0.55)" }}>{emptyText}</p>
      )}
    </section>
  );
}
