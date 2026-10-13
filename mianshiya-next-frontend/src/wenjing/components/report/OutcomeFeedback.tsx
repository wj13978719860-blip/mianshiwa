"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Col, Rate, Row, Space, Typography } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FrownOutlined,
  PauseCircleOutlined,
  TrophyOutlined,
} from "@ant-design/icons";

import { submitFeedback } from "@/wenjing/lib/api/interview";
import type { FeedbackOutcome } from "@/wenjing/lib/api/types";
import { upsertEntry } from "@/wenjing/lib/storage/interviewHistory";

const STORAGE_PREFIX = "feedback:";

const OUTCOME_OPTIONS: ReadonlyArray<{
  id: FeedbackOutcome;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "got_offer", label: "拿到 Offer", icon: <TrophyOutlined /> },
  { id: "no_offer", label: "没有通过", icon: <CloseCircleOutlined /> },
  { id: "still_preparing", label: "还在准备", icon: <PauseCircleOutlined /> },
  { id: "withdrew", label: "决定不面了", icon: <FrownOutlined /> },
];

function readSubmitted(sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + sessionId) === "1";
  } catch {
    return false;
  }
}

function markSubmitted(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + sessionId, "1");
  } catch {
    /* quota / private mode */
  }
}

export default function OutcomeFeedback({ sessionId }: { sessionId: string }) {
  const [submitted, setSubmitted] = useState(() => readSubmitted(sessionId));
  const [selected, setSelected] = useState<FeedbackOutcome | null>(null);
  const [helpful, setHelpful] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubmitted(readSubmitted(sessionId));
  }, [sessionId]);

  const handleSubmit = useCallback(async () => {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    try {
      await submitFeedback(sessionId, {
        outcome: selected,
        helpful_score: helpful ?? undefined,
      });
      markSubmitted(sessionId);
      setSubmitted(true);
      try {
        upsertEntry({ sessionId, feedbackSubmitted: true });
      } catch {
        /* non-critical */
      }
    } catch {
      setError("提交失败，请稍后重试");
    } finally {
      setSending(false);
    }
  }, [selected, helpful, sending, sessionId]);

  if (submitted) {
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message="感谢你的反馈，它会帮助我们更好地优化出题策略。"
      />
    );
  }

  return (
    <Card title="面试结果反馈">
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        告诉我们这场练习之后的真实面试结果（可选），帮助 AI
        持续优化出题和评估策略。
      </Typography.Paragraph>
      <Row gutter={[8, 8]}>
        {OUTCOME_OPTIONS.map((opt) => {
          const active = selected === opt.id;
          return (
            <Col key={opt.id} xs={12} sm={6}>
              <button
                type="button"
                onClick={() => setSelected(opt.id)}
                aria-pressed={active}
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 8px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  border: `1px solid ${active ? "#52c41a" : "#d9d9d9"}`,
                  background: active ? "#f6ffed" : "#fff",
                  color: active ? "#389e0d" : "rgba(0,0,0,0.88)",
                  transition: "all .2s",
                }}
              >
                <span style={{ fontSize: 18, color: active ? "#52c41a" : "rgba(0,0,0,0.45)" }}>
                  {opt.icon}
                </span>
                <span style={{ fontWeight: 500 }}>{opt.label}</span>
              </button>
            </Col>
          );
        })}
      </Row>

      {selected && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            这场练习对你有帮助吗？（可选）
          </Typography.Text>
          <div>
            <Space>
              <Rate
                value={helpful ?? 0}
                onChange={(v) => setHelpful(v === 0 ? null : v)}
                style={{ color: "#52c41a" }}
              />
              {helpful !== null && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {helpful}/5
                </Typography.Text>
              )}
            </Space>
          </div>
        </div>
      )}

      {error && (
        <Typography.Text type="danger" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
          {error}
        </Typography.Text>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button
          type="primary"
          disabled={!selected || sending}
          loading={sending}
          onClick={() => void handleSubmit()}
        >
          提交反馈
        </Button>
      </div>
    </Card>
  );
}
