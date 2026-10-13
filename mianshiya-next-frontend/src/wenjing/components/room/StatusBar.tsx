"use client";

import { Badge, Flex, Progress, Typography } from "antd";
import { StarOutlined } from "@ant-design/icons";

import { SessionIdTooltip } from "@/wenjing/components/shared";
import type { PollerState } from "@/wenjing/lib/hooks/useQuestionPoller";
import {
  clampVisibleFormalTurn,
  extractFormalTurnIdx,
  extractQuestionType,
  phaseLabel,
} from "./helpers";

export function StatusBar({
  state,
  sessionId,
  currentDisplayTurnIdx,
}: {
  state: PollerState;
  sessionId: string;
  currentDisplayTurnIdx?: number | null;
}) {
  const label = phaseLabel(state.phase);
  const isActive = state.phase === "waiting_for_answer";
  const isError = state.phase === "error";
  const questionType =
    state.phase === "waiting_for_answer" && state.question
      ? extractQuestionType(state.question)
      : undefined;
  const formalTurnIdx =
    state.phase === "waiting_for_answer" && state.question
      ? extractFormalTurnIdx(state.question)
      : null;
  const maxTurns = state.maxTurns;
  const rawFormalTurn =
    questionType === "self_intro"
      ? 0
      : currentDisplayTurnIdx !== null && currentDisplayTurnIdx !== undefined
        ? currentDisplayTurnIdx + 1
        : formalTurnIdx !== null
          ? formalTurnIdx + 1
          : state.phase !== "loading" && state.turnIdx !== null
            ? state.turnIdx + 1
            : 0;
  const currentFormalTurn = clampVisibleFormalTurn(rawFormalTurn, maxTurns);
  const turnLabel =
    questionType === "self_intro"
      ? "开场"
      : `第 ${currentFormalTurn > 0 ? currentFormalTurn : "-"} 题`;
  const progressPercent =
    typeof maxTurns === "number" && maxTurns > 0
      ? Math.min(100, Math.max(0, (currentFormalTurn / maxTurns) * 100))
      : 0;
  const separator = <Typography.Text type="secondary" style={{ opacity: 0.4 }}>·</Typography.Text>;

  return (
    <Flex
      align="center"
      gap={12}
      wrap="wrap"
      style={{
        border: "1px solid #f0f0f0",
        background: "#fff",
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 12,
      }}
    >
      <Badge
        status={isActive ? "processing" : isError ? "error" : "warning"}
        color={isActive ? "#52c41a" : undefined}
        text={
          <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 1 }}>
            {label}
          </Typography.Text>
        }
      />
      {separator}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        会话{" "}
        <Typography.Text style={{ fontSize: 12 }}>
          <SessionIdTooltip sessionId={sessionId} />
        </Typography.Text>
      </Typography.Text>
      {separator}
      <Typography.Text style={{ fontSize: 12 }}>
        {turnLabel}
        {typeof maxTurns === "number" && maxTurns > 0 && questionType !== "self_intro" && (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
            / {maxTurns}
          </Typography.Text>
        )}
      </Typography.Text>
      {typeof maxTurns === "number" && maxTurns > 0 && (
        <Flex align="center" gap={8} style={{ minWidth: 140 }}>
          <Progress
            percent={progressPercent}
            showInfo={false}
            size="small"
            strokeColor="#52c41a"
            style={{ width: 96, margin: 0 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace" }}>
            {questionType === "self_intro" ? "0" : currentFormalTurn}/{maxTurns}
          </Typography.Text>
        </Flex>
      )}
      <Typography.Text type="secondary" style={{ marginLeft: "auto", fontSize: 12 }}>
        <StarOutlined style={{ color: "#95de64", marginRight: 4 }} />
        问镜追问中
      </Typography.Text>
    </Flex>
  );
}
