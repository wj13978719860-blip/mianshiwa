"use client";

import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Alert, Button, Card, Input, Skeleton, Space, Tag, Typography } from "antd";
import { CommentOutlined, SendOutlined } from "@ant-design/icons";
import { askAiModel, ModelAnswer } from "@/api/aiModelController";
import MdViewer from "@/components/MdViewer";
import "./index.css";

const examples = [
  "HashMap 和 ConcurrentHashMap 有什么区别？",
  "如何理解 MySQL 索引的最左前缀原则？",
  "解释一下 Redis 缓存穿透、击穿和雪崩。",
];

/** 管理员 AI 问答页面：每次独立提问，展示真实回答，不伪装成多轮面试。 */
export default function AiQuestionPage() {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [answer, setAnswer] = useState<ModelAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // ref 同步阻止重复提交，同时用于页面离开时取消等待。
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const count = Array.from(question).length;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    // 使用 Unicode 码点计数，与 Java/Python 的 256 字符约定一致。
    if (!question.trim() || count > 256) {
      setError("请输入问题，最多 256 个字符。");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    setAnswer(null);
    setSubmittedQuestion(question);
    try {
      const response = await askAiModel(question, controller.signal);
      // 即使拦截器行为发生变化，也不能将无回答的业务失败显示为成功。
      if (response.code !== 0 || !response.data?.reply?.trim()) {
        throw new Error(response.message || "暂未获得回答，请稍后重试。");
      }
      if (!controller.signal.aborted) setAnswer(response.data);
    } catch (cause) {
      if (controller.signal.aborted || axios.isCancel(cause)) return;
      setError(axios.isAxiosError(cause) && cause.code === "ECONNABORTED"
        ? "等待回答超时，请稍后重新提交。"
        : cause instanceof Error ? cause.message : "请求失败，请稍后重试。");
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div id="aiQuestionPage">
      <div className="ai-question-heading">
        <Space><CommentOutlined /><Typography.Title level={2}>AI 问答</Typography.Title></Space>
        <Typography.Paragraph type="secondary">
          输入你想弄懂的技术问题，让面试蛙帮你理清思路。每次提问独立回答。
        </Typography.Paragraph>
      </div>

      <Card title="你想问什么？">
        <form onSubmit={submit}>
          <Input.TextArea
            aria-label="技术问题"
            placeholder="例如：HashMap 为什么不是线程安全的？"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            autoSize={{ minRows: 4, maxRows: 10 }}
            disabled={loading}
            status={count > 256 ? "error" : undefined}
            showCount={{ formatter: () => `${count} / 256` }}
          />
          <Space wrap className="ai-question-examples">
            {examples.map((example) => (
              <Button key={example} size="small" disabled={loading} onClick={() => setQuestion(example)}>
                {example}
              </Button>
            ))}
          </Space>
          <Space className="ai-question-actions">
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={loading}
              disabled={!question.trim() || count > 256}>
              {loading ? "正在生成回答" : "发送问题"}
            </Button>
            <Button disabled={loading} onClick={() => {
              setQuestion(""); setSubmittedQuestion(""); setAnswer(null); setError("");
            }}>清空</Button>
          </Space>
        </form>
      </Card>

      <div className="ai-question-result" aria-live="polite" aria-busy={loading}>
        {error && <Alert type="error" showIcon message="暂时无法回答" description={error} />}
        {(loading || answer) && (
          <Card title="面试蛙的回答" extra={answer && <Tag color="green">{answer.model}</Tag>}>
            <Typography.Paragraph className="ai-submitted-question">{submittedQuestion}</Typography.Paragraph>
            {loading ? <><Typography.Paragraph type="secondary">正在思考，请稍候…</Typography.Paragraph><Skeleton active paragraph={{ rows: 4 }} /></>
              : answer && <MdViewer value={answer.reply} />}
          </Card>
        )}
      </div>
    </div>
  );
}
