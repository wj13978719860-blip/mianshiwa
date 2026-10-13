"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Flex, Input, Space, Typography } from "antd";
import {
  ArrowRightOutlined,
  BulbOutlined,
  CompressOutlined,
  ExpandOutlined,
  PauseOutlined,
  SendOutlined,
  StepForwardOutlined,
} from "@ant-design/icons";

import { requestHint } from "@/wenjing/lib/api/interview";
import { ANSWER_MAX_LENGTH, answerDraftKey, clearAnswerDraft } from "./helpers";

export function AnswerBox({
  sessionId,
  turnIdx,
  onSubmit,
  onSkip,
  paused,
  onPause,
  onResume,
  submitting,
  skipping,
  questionType,
}: {
  sessionId: string;
  turnIdx: number | null;
  onSubmit: (text: string) => Promise<boolean>;
  onSkip: () => Promise<boolean>;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  submitting: boolean;
  skipping: boolean;
  questionType?: string;
}) {
  const [draft, setDraft] = useState("");
  const [hintText, setHintText] = useState<string | null>(null);
  const [hintSource, setHintSource] = useState<string | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [answerExpanded, setAnswerExpanded] = useState(false);
  const isSelfIntro = questionType === "self_intro";
  const trimmedLength = draft.trim().length;
  const nearLimit = draft.length >= ANSWER_MAX_LENGTH * 0.9;
  const draftKey = answerDraftKey(sessionId, turnIdx);

  useEffect(() => {
    try {
      setDraft(window.sessionStorage.getItem(draftKey) ?? "");
    } catch {
      setDraft("");
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (draft) {
        window.sessionStorage.setItem(draftKey, draft);
      } else {
        window.sessionStorage.removeItem(draftKey);
      }
    } catch {
      /* ignore */
    }
  }, [draft, draftKey]);

  useEffect(() => {
    setHintText(null);
    setHintSource(null);
    setHintError(null);
    setHintLoading(false);
    setAnswerExpanded(false);
  }, [draftKey]);

  async function handleLocalSubmit() {
    const text = draft.trim();
    if (!text || submitting) return;
    const success = await onSubmit(text);
    if (success) {
      clearAnswerDraft(draftKey);
      setDraft("");
    }
  }

  async function handleLocalSkip() {
    if (submitting || skipping) return;
    const success = await onSkip();
    if (success) {
      clearAnswerDraft(draftKey);
      setDraft("");
    }
  }

  async function handleLocalHint() {
    if (hintLoading || turnIdx === null) return;
    setHintLoading(true);
    setHintError(null);
    try {
      const res = await requestHint(sessionId, turnIdx);
      setHintText(res.hint);
      setHintSource(res.source);
    } catch (err) {
      setHintError(err instanceof Error ? err.message : "暂时没能拿到提示");
    } finally {
      setHintLoading(false);
    }
  }

  return (
    <Card
      style={{ borderColor: "#b7eb8f", boxShadow: "0 2px 12px rgba(82,196,26,0.08)" }}
      title={
        <Space>
          <SendOutlined style={{ color: "#52c41a" }} />
          你的回答
        </Space>
      }
      extra={
        <Button
          type="text"
          size="small"
          aria-expanded={answerExpanded}
          aria-controls="answer-draft-input"
          icon={answerExpanded ? <CompressOutlined /> : <ExpandOutlined />}
          onClick={() => setAnswerExpanded((value) => !value)}
        >
          {answerExpanded ? "收起" : "展开"}
        </Button>
      }
    >
      <Flex vertical gap={12}>
        {paused ? (
          <Alert
            type="warning"
            showIcon
            message="已暂停休息"
            description="当前草稿已经保留，准备好后可以继续作答。"
          />
        ) : (
          <Input.TextArea
            id="answer-draft-input"
            autoSize={answerExpanded ? { minRows: 10, maxRows: 24 } : { minRows: 3, maxRows: 8 }}
            maxLength={ANSWER_MAX_LENGTH}
            aria-label="输入你的回答"
            placeholder={
              isSelfIntro
                ? "可以从背景、代表项目、想重点展开的能力方向开始。按 Ctrl/Cmd+Enter 提交。"
                : "在此输入你的回答… 按 Ctrl/Cmd+Enter 提交。"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !submitting) {
                e.preventDefault();
                void handleLocalSubmit();
              }
            }}
            style={answerExpanded ? { minHeight: 288 } : undefined}
          />
        )}
        <Flex align="center" justify="space-between" gap={8}>
          <Typography.Text
            style={{ fontSize: 12 }}
            type={nearLimit ? "warning" : "secondary"}
          >
            {draft.length > 0 &&
              `${trimmedLength} / ${ANSWER_MAX_LENGTH} 字${
                draft.length >= ANSWER_MAX_LENGTH ? "，已达上限" : ""
              }`}
          </Typography.Text>
          <Button
            type="primary"
            onClick={() => void handleLocalSubmit()}
            disabled={paused || submitting || !draft.trim()}
            loading={submitting}
            icon={<ArrowRightOutlined />}
          >
            提交回答
          </Button>
        </Flex>
        <Flex wrap="wrap" gap={8}>
          {paused ? (
            <Button size="small" onClick={onResume}>
              继续作答
            </Button>
          ) : (
            <Button size="small" type="text" icon={<PauseOutlined />} onClick={onPause}>
              暂停休息
            </Button>
          )}
          <Button
            size="small"
            type="text"
            icon={<BulbOutlined />}
            loading={hintLoading}
            onClick={() => void handleLocalHint()}
            disabled={hintLoading || turnIdx === null}
          >
            求一点思路
          </Button>
          <Button
            size="small"
            type="text"
            icon={<StepForwardOutlined />}
            loading={skipping}
            onClick={() => void handleLocalSkip()}
            disabled={submitting || skipping}
          >
            跳过本题
          </Button>
        </Flex>
        {(hintText || hintError || hintLoading) && (
          <div
            style={{
              border: "1px solid #b7eb8f",
              background: "#f6ffed",
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
            }}
          >
            <Flex align="center" gap={8} style={{ marginBottom: 4 }}>
              <BulbOutlined style={{ color: "#52c41a" }} />
              <Typography.Text strong>面试官提示</Typography.Text>
              {hintSource && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {hintSource}
                </Typography.Text>
              )}
            </Flex>
            {hintLoading ? (
              <Typography.Text type="secondary">正在整理一点切入角度…</Typography.Text>
            ) : hintError ? (
              <Flex vertical gap={8} align="flex-start">
                <Typography.Text type="warning">{hintError}</Typography.Text>
                <Button size="small" onClick={() => void handleLocalHint()}>
                  重试
                </Button>
              </Flex>
            ) : (
              <Typography.Paragraph type="secondary" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {hintText}
              </Typography.Paragraph>
            )}
          </div>
        )}
      </Flex>
    </Card>
  );
}
