"use client";

/**
 * 多个页面共用的小组件（对应上游 CollapsibleAnswerBubble / SessionIdTooltip /
 * TrainingPlanSourceBadge / InfoTooltip），行为与上游一致，UI 改用 Ant Design。
 */
import React, { useId, useState } from "react";
import { Button, Tag, Tooltip, Typography } from "antd";
import { CompressOutlined, ExpandOutlined, InfoCircleOutlined } from "@ant-design/icons";

const ANSWER_COLLAPSE_CHAR_LIMIT = 900;
const ANSWER_COLLAPSE_LINE_LIMIT = 12;

export function CollapsibleAnswerBubble({
  text,
  contentId,
  className,
  label = "你",
}: {
  text: string;
  contentId?: string;
  className?: string;
  label?: string;
}) {
  const generatedId = useId();
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const answerLineCount = text.split(/\r?\n/).length;
  const shouldCollapseAnswer =
    text.length > ANSWER_COLLAPSE_CHAR_LIMIT || answerLineCount > ANSWER_COLLAPSE_LINE_LIMIT;
  const resolvedContentId = contentId ?? `answer-content-${generatedId}`;
  const collapsed = shouldCollapseAnswer && !answerExpanded;

  return (
    <div
      className={className}
      style={{
        border: "1px solid #e6f4ff",
        background: "#f7fbff",
        borderRadius: 8,
        padding: 16,
        lineHeight: 1.7,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        <Tag color="blue" style={{ marginRight: 6 }}>
          A
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
      </div>
      <div
        id={resolvedContentId}
        style={{
          whiteSpace: "pre-wrap",
          ...(collapsed
            ? {
                maxHeight: 288,
                overflow: "hidden",
                WebkitMaskImage: "linear-gradient(to bottom, black 75%, transparent)",
                maskImage: "linear-gradient(to bottom, black 75%, transparent)",
              }
            : {}),
        }}
      >
        {text}
      </div>
      {shouldCollapseAnswer && (
        <div style={{ marginTop: 12, textAlign: "right", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
          <Button
            size="small"
            type="text"
            aria-controls={resolvedContentId}
            aria-expanded={answerExpanded}
            icon={answerExpanded ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => setAnswerExpanded((value) => !value)}
          >
            {answerExpanded ? "收起" : "展开"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function shortSessionId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function SessionIdTooltip({ sessionId }: { sessionId: string }) {
  return (
    <Tooltip title={<span style={{ wordBreak: "break-all", fontFamily: "monospace" }}>{sessionId}</span>}>
      <span tabIndex={0} aria-label={`完整 Session ID：${sessionId}`} style={{ fontFamily: "monospace", cursor: "default" }}>
        {shortSessionId(sessionId)}
      </span>
    </Tooltip>
  );
}

const LLM_SOURCE_DESCRIPTION = "由 AI 复盘链路从你的回答中提炼";
const FALLBACK_SOURCE_DESCRIPTION = "AI 复盘链路暂不可用，已根据评分聚合生成";

export function TrainingPlanSourceBadge({ source }: { source: string | undefined }) {
  if (source === "llm") {
    return (
      <Tooltip title={LLM_SOURCE_DESCRIPTION}>
        <Tag color="green" tabIndex={0} aria-label={`AI 复盘 · ${LLM_SOURCE_DESCRIPTION}`} style={{ marginLeft: 4 }}>
          AI 复盘
        </Tag>
      </Tooltip>
    );
  }
  if (source === "fallback") {
    return (
      <Tooltip title={FALLBACK_SOURCE_DESCRIPTION}>
        <Tag color="gold" tabIndex={0} aria-label={`基础版 · ${FALLBACK_SOURCE_DESCRIPTION}`} style={{ marginLeft: 4 }}>
          基础版
        </Tag>
      </Tooltip>
    );
  }
  return null;
}

export function InfoTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip title={<span style={{ lineHeight: 1.7 }}>{children}</span>}>
      <Button type="text" size="small" aria-label={label} icon={<InfoCircleOutlined />} />
    </Tooltip>
  );
}
