"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Collapse, Flex, Result, Skeleton, Space, Tag, Typography, notification } from "antd";
import { MessageOutlined } from "@ant-design/icons";

import {
  isReauthRequired,
  listInterviewWaitingTips,
  retryFailedQuestion,
  skipQuestion,
  submitAnswer,
} from "@/wenjing/lib/api/interview";
import type { InterviewWaitingTipsResponse } from "@/wenjing/lib/api/types";
import { useQuestionPoller } from "@/wenjing/lib/hooks/useQuestionPoller";
import { upsertEntry } from "@/wenjing/lib/storage/interviewHistory";
import { AnswerBox } from "./room/AnswerBox";
import { NextQuestionLoader } from "./room/NextQuestionLoader";
import { QaBubble } from "./room/QaBubble";
import { StatusBar } from "./room/StatusBar";
import {
  ENCOURAGEMENTS,
  answerInsightFromHistory,
  extractFormalTurnIdx,
  extractQuestion,
  extractQuestionType,
  extractResumeAnchor,
  filterRestoredHistoryForCurrentQuestion,
  friendlyAnswerError,
  friendlyConnectionMessage,
  isFinalFormalTurn,
  latestAnsweredFormalTurnIdx,
  mergeRestoredQaHistory,
  qaEntryIdentity,
  qaEntryMatchesEvaluation,
  recordQaAnswer,
  restoredTurnToQaEntry,
  visibleTurnIdx,
  type QaEntry,
} from "./room/helpers";

export default function InterviewRoom({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { state, afterAnswerSubmitted, afterQuestionRetryRequested, refreshStatus } =
    useQuestionPoller(sessionId);
  const [notify, notificationHolder] = notification.useNotification();
  const toast = useCallback(
    ({ title, description }: { title: string; description?: string }) => {
      notify.open({ message: title, description, placement: "topRight", duration: 3 });
    },
    [notify],
  );
  const [history, setHistory] = useState<QaEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [retryingQuestion, setRetryingQuestion] = useState(false);
  const [lastSubmittedTurn, setLastSubmittedTurn] = useState<number | null>(null);
  const [finalTurnSubmitted, setFinalTurnSubmitted] = useState(false);
  const [waitingTipsResponse, setWaitingTipsResponse] =
    useState<InterviewWaitingTipsResponse | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const displayedWaitingTipIdsRef = useRef<Set<string>>(new Set());
  const currentQuestionType =
    state.phase === "waiting_for_answer" && state.question
      ? extractQuestionType(state.question)
      : undefined;
  const currentDisplayTurnIdx =
    state.phase === "loading"
      ? latestAnsweredFormalTurnIdx(history)
      : state.phase === "waiting_for_answer" && history.length > 0
        ? visibleTurnIdx(history[history.length - 1])
        : null;
  const latestSubmittedAnswerInsight = useMemo(() => answerInsightFromHistory(history), [history]);

  useEffect(() => {
    let active = true;
    listInterviewWaitingTips()
      .then((payload) => {
        if (active) {
          setWaitingTipsResponse(payload);
        }
      })
      .catch(() => {
        if (active) {
          setWaitingTipsResponse(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const restored = state.restoredHistory
      .map(restoredTurnToQaEntry)
      .filter((entry): entry is QaEntry => Boolean(entry));
    if (restored.length === 0) return;
    const currentTurnIdxForDisplay =
      state.phase === "waiting_for_answer" && state.question
        ? extractFormalTurnIdx(state.question) ?? state.turnIdx
        : null;
    const priorRestored = filterRestoredHistoryForCurrentQuestion(
      restored,
      currentTurnIdxForDisplay,
    );
    setHistory((prev) => mergeRestoredQaHistory(prev, priorRestored));
  }, [state.phase, state.question, state.restoredHistory, state.turnIdx]);

  useEffect(() => {
    if (state.phase !== "waiting_for_answer" || !state.question) return;
    const q = state.question;
    const turnIdx = state.turnIdx;
    setHistory((prev) => {
      const lastOpen = prev[prev.length - 1];
      const qText = extractQuestion(q);
      const formalTurnIdx = extractFormalTurnIdx(q);
      const currentTurnIdxForDisplay = formalTurnIdx ?? turnIdx;
      if (
        lastOpen &&
        lastOpen.answer === null &&
        (lastOpen.turnIdx === turnIdx || visibleTurnIdx(lastOpen) === currentTurnIdxForDisplay)
      ) {
        return prev;
      }
      return [
        ...prev,
        {
          turnIdx,
          formalTurnIdx,
          displayTurnIdx: currentTurnIdxForDisplay,
          questionType: extractQuestionType(q),
          dimension: typeof q.dimension === "string" ? q.dimension : undefined,
          resumeAnchor: extractResumeAnchor(q),
          question: qText,
          answer: null,
        },
      ];
    });
  }, [state.phase, state.question, state.turnIdx]);

  useEffect(() => {
    const evaluation = state.previousEvaluation;
    if (!evaluation) return;
    setHistory((prev) =>
      prev.map((entry) =>
        qaEntryMatchesEvaluation(entry, evaluation) ? { ...entry, evaluation } : entry,
      ),
    );
  }, [state.previousEvaluation]);

  useEffect(() => {
    setPaused(false);
    setFinalTurnSubmitted(false);
  }, [state.turnIdx]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length]);

  useEffect(() => {
    if (state.phase === "completed") {
      router.push(`/interview/${sessionId}/report`);
    }
  }, [state.phase, router, sessionId]);

  // Keep the local history index in sync so /interview/history is accurate
  // even if the user lands here via a deep link (no setup form).
  useEffect(() => {
    upsertEntry({ sessionId, status: "running" });
  }, [sessionId]);

  useEffect(() => {
    if (state.phase === "cancelled") {
      upsertEntry({ sessionId, status: "cancelled" });
    }
    if (state.phase === "error") {
      upsertEntry({ sessionId, status: "failed" });
    }
  }, [state.phase, sessionId]);

  const handleWaitingTipShown = useCallback((tipId: string) => {
    displayedWaitingTipIdsRef.current.add(tipId);
  }, []);

  async function handleSubmit(text: string) {
    if (!text || submitting) return false;
    if (state.turnIdx === null) {
      toast({
        title: "Question state is not ready",
        description: "Please wait for the current question to finish loading.",
      });
      return false;
    }
    setSubmitting(true);
    const submittedWasFinal = isFinalFormalTurn({
      question: state.question,
      turnIdx: state.turnIdx,
      maxTurns: state.maxTurns,
    });
    try {
      await submitAnswer(sessionId, text, state.turnIdx);
      setReauthRequired(false);
      setPaused(false);
      setHistory((prev) => recordQaAnswer(prev, state.question, state.turnIdx!, text));
      setLastSubmittedTurn(state.turnIdx ?? null);
      setFinalTurnSubmitted(submittedWasFinal);
      afterAnswerSubmitted();
      // Lightweight encouragement so users feel acknowledged between turns.
      toast({
        title: submittedWasFinal
          ? "最后一题已提交，正在整理本场面试总结。"
          : ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)],
      });
      return true;
    } catch (err) {
      if (isReauthRequired(err)) {
        setReauthRequired(true);
        toast({
          title: "需要重新授权模型配置",
          description: "当前会话暂时无法继续提交，请稍后重试或回到面试历史查看。",
        });
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "提交时出了点问题",
        description: friendlyAnswerError(msg),
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkipCurrentQuestion() {
    if (skipping || state.turnIdx === null) return false;
    setSkipping(true);
    const skippedWasFinal = isFinalFormalTurn({
      question: state.question,
      turnIdx: state.turnIdx,
      maxTurns: state.maxTurns,
    });
    try {
      await skipQuestion(sessionId, state.turnIdx, "candidate_skip");
      setHistory((prev) => recordQaAnswer(prev, state.question, state.turnIdx!, "已跳过本题"));
      setPaused(false);
      setLastSubmittedTurn(state.turnIdx ?? null);
      setFinalTurnSubmitted(skippedWasFinal);
      afterAnswerSubmitted();
      toast({
        title: skippedWasFinal
          ? "已跳过最后一题，正在整理本场面试总结。"
          : "已跳过本题，继续下一轮练习。",
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "暂时没能跳过本题",
        description: friendlyAnswerError(msg),
      });
      return false;
    } finally {
      setSkipping(false);
    }
  }

  async function handleRetryQuestionGeneration() {
    if (retryingQuestion) return;
    setRetryingQuestion(true);
    try {
      await retryFailedQuestion(sessionId);
      upsertEntry({ sessionId, status: "running" });
      setHistory((prev) => prev.filter((entry) => entry.answer !== null));
      setLastSubmittedTurn(null);
      setFinalTurnSubmitted(false);
      afterQuestionRetryRequested();
      toast({ title: "正在继续处理" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "重试失败",
        description: friendlyAnswerError(msg),
      });
    } finally {
      setRetryingQuestion(false);
    }
  }

  return (
    <Flex vertical gap={24}>
      {notificationHolder}
      <StatusBar
        state={state}
        sessionId={sessionId}
        currentDisplayTurnIdx={currentDisplayTurnIdx}
      />

      {reauthRequired && (
        <Alert
          type="warning"
          showIcon
          message="需要重新授权模型配置"
          description="当前面试恢复后缺少本轮模型授权，暂时无法提交回答。可以稍后再试，或回到面试历史查看这场面试。"
          action={
            <Link href="/interview/history">
              <Button size="small">查看面试历史</Button>
            </Link>
          }
        />
      )}

      <Card
        title={
          <Space>
            <MessageOutlined style={{ color: "#52c41a" }} />
            对话记录
          </Space>
        }
        extra={<Tag style={{ fontFamily: "monospace", margin: 0 }}>{history.length} 轮</Tag>}
      >
        <Flex vertical gap={20}>
          {history.length === 0 && state.phase !== "waiting_for_answer" && (
            <Skeleton active paragraph={{ rows: 2 }} />
          )}

          {history.map((t, idx) => (
            <QaBubble
              key={qaEntryIdentity(t)}
              entry={t}
              isCurrent={idx === history.length - 1 && state.phase === "waiting_for_answer"}
              showTurnFeedback={!(state.phase === "loading" && idx === history.length - 1)}
            />
          ))}

          {state.phase === "loading" &&
            (lastSubmittedTurn !== null || latestSubmittedAnswerInsight !== null) && (
              <NextQuestionLoader
                etaMs={state.lastServerLatencyMs}
                isFinalTurn={finalTurnSubmitted}
                answerInsight={latestSubmittedAnswerInsight}
                waitingTips={waitingTipsResponse?.tips ?? null}
                tipRotationIntervalMs={waitingTipsResponse?.rotation_interval_ms}
                displayedTipIds={displayedWaitingTipIdsRef.current}
                onWaitingTipShown={handleWaitingTipShown}
              />
            )}

          <div ref={transcriptEnd} />
        </Flex>
      </Card>

      {state.phase === "waiting_for_answer" && (
        <AnswerBox
          sessionId={sessionId}
          turnIdx={state.turnIdx}
          onSubmit={handleSubmit}
          onSkip={handleSkipCurrentQuestion}
          paused={paused}
          onPause={() => setPaused(true)}
          onResume={() => setPaused(false)}
          submitting={submitting}
          skipping={skipping}
          questionType={currentQuestionType}
        />
      )}

      {state.phase === "error" && (
        <Alert
          type="error"
          showIcon
          message="嗯，连接出了点问题"
          description={
            <Flex vertical gap={12}>
              <Typography.Text type="secondary">
                {friendlyConnectionMessage(state.errorKind, state.error)}
              </Typography.Text>
              <Collapse
                size="small"
                ghost
                items={[
                  {
                    key: "detail",
                    label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>查看技术细节</Typography.Text>,
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          background: "#fafafa",
                          borderRadius: 4,
                          padding: 8,
                          fontSize: 11,
                          fontFamily: "monospace",
                        }}
                      >
                        {state.error}
                      </pre>
                    ),
                  },
                ]}
              />
              <Space wrap>
                {state.retryable && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => void handleRetryQuestionGeneration()}
                    disabled={retryingQuestion}
                    loading={retryingQuestion}
                  >
                    继续处理
                  </Button>
                )}
                <Button size="small" onClick={refreshStatus}>
                  刷新状态
                </Button>
              </Space>
            </Flex>
          }
        />
      )}

      {state.phase === "cancelled" && (
        <Card>
          <Typography.Text type="secondary">
            此会话已取消。 <Link href="/interview/setup">开始新面试</Link>。
          </Typography.Text>
        </Card>
      )}

      {state.phase === "completed" && (
        <Result
          status="success"
          title="面试已完成"
          subTitle="正在跳转到报告页…"
          extra={
            <Link href={`/interview/${sessionId}/report`}>
              <Button type="primary">查看报告</Button>
            </Link>
          }
        />
      )}
    </Flex>
  );
}
