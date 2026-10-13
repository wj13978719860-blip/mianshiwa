"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button, Card, Popconfirm, Progress, Result, Skeleton, Space, Spin, Tabs, Tag, Typography, Input, message } from "antd";
import { ArrowLeftOutlined, SendOutlined, SyncOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { RootState } from "@/stores";
import { BRAND_LOGO, BRAND_NAME } from "@/constants/brand";
import MdViewer from "@/components/MdViewer";
import { Feedback, TurnHistory } from "@/components/Interview/Feedback";
import InterviewReportView from "@/components/Interview/Report";
import { interviewApi, interviewError, InterviewAction, InterviewSession, interviewStatus } from "@/api/aiInterviewController";
import "@/components/Interview/interview.css";

/** 新答题房间：接口状态驱动按钮，刷新恢复当前题，草稿按用户/会话/题目隔离。 */
export default function InterviewRoomPage({ params }: { params: { mockInterviewId: string } }) {
  const sessionId = params.mockInterviewId;
  const router = useRouter();
  const loginUser = useSelector((state: RootState) => state.loginUser);
  const [session, setSession] = useState<InterviewSession>();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("question");
  const pending = useRef<{ fingerprint: string; id: string }>();
  const activeController = useRef<AbortController>();
  const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId);
  const completed = session?.status === "completed";
  useEffect(() => {
    if (completed && session?.settings.workflowVersion === "v2") router.replace(`/mockInterview/report/${sessionId}`);
  }, [completed, session?.settings.workflowVersion, sessionId, router]);
  const draftKey = session?.currentQuestion && loginUser.id ? `mianshiwa:answer:${loginUser.id}:${sessionId}:${session.currentQuestion.id}` : "";

  const refresh = useCallback(async () => {
    if (!loginUser.id || !validId) return;
    activeController.current?.abort();
    const controller = new AbortController(); activeController.current = controller;
    try {
      const response = await interviewApi.get(sessionId, controller.signal);
      if (!controller.signal.aborted) { setSession(response.data); setError(""); }
      return response.data;
    } catch (cause) { if (!controller.signal.aborted) setError(interviewError(cause)); }
  }, [loginUser.id, sessionId, validId]);

  useEffect(() => {
    if (completed) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const data = await refresh();
      // 请求完成后再安排下一次，不重叠轮询；已结束不持续发请求。
      if (!stopped && data?.status !== "completed") timer = setTimeout(poll, data?.busy ? 1500 : 8000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); activeController.current?.abort(); };
  }, [refresh, session?.busy, completed]);

  useEffect(() => {
    document.title = `${session?.status === "completed" ? "面试报告" : "AI 模拟面试"} - ${BRAND_NAME}`;
  }, [session?.status]);

  useEffect(() => {
    try { setAnswer(draftKey ? localStorage.getItem(draftKey) ?? "" : ""); }
    catch { setAnswer(""); }
  }, [draftKey]);
  const updateDraft = (text: string) => {
    setAnswer(text);
    // 浏览器禁止存储时仍允许作答，草稿落盘失败不阻止提交。
    try { if (draftKey) localStorage.setItem(draftKey, text); } catch { /* 保留内存草稿。 */ }
  };
  const act = async (action: InterviewAction) => {
    if (!session || submitting || session.busy) return;
    if (action === "answer" && !answer.trim()) { message.warning("请先输入回答"); return; }
    const submittedAnswer = action === "answer" ? answer : "";
    const fingerprint = JSON.stringify([session.version, session.currentQuestion?.id, action, submittedAnswer]);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    setSubmitting(true); setError("");
    try {
      const response = await interviewApi.command(session, action, pending.current.id, submittedAnswer);
      setSession(response.data);
      // 收到受理不代表评价成功；原草稿保留，失败时可重试或自行复制。
      // busy 变化会立即重新安排轮询，不让用户额外等待原来的空闲轮询周期。
    } catch (cause) { setError(interviewError(cause)); message.error(interviewError(cause)); void refresh(); }
    finally { setSubmitting(false); }
  };

  if (!validId) return <Result status="info" title="这个链接属于旧版模拟面试" subTitle="新面试已替换原流程，请从面试设置开始。" extra={<Button type="primary" onClick={() => router.push("/mockInterview/add")}>开始新面试</Button>} />;
  if (!loginUser.id) return <Result title="登录后继续面试" extra={<Button type="primary" onClick={() => router.push(`/user/login?redirect=${encodeURIComponent(window.location.origin + "/mockInterview/chat/" + sessionId)}`)}>去登录</Button>} />;
  if (!session) return <main className="interview-page">{error ? <Result status="warning" title="无法加载面试" subTitle={error} extra={<Button onClick={refresh}>重新加载</Button>} /> : <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>}</main>;
  const current = session.currentQuestion;
  const canAnswer = session.status === "waiting_answer" && !session.busy && !submitting;
  const lastTurn = session.turns[session.turns.length - 1];
  const mainNumber = Math.min(session.progress.mainIndex + 1, session.progress.total);

  return <main className="interview-page">
    <div className="interview-section-heading"><div><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => router.push("/mockInterview/add")}>面试设置与记录</Button>
      <Typography.Title level={2}>{session.settings.jobPosition}</Typography.Title>
      <Space wrap><Typography.Text type="secondary">{session.settings.bankTitle} · {session.settings.experience} · {session.settings.difficulty}</Typography.Text>
        <Tag color={session.status === "completed" ? "green" : session.status === "failed" ? "orange" : "blue"}>{interviewStatus[session.status]}</Tag></Space></div>
      <Space><Button icon={<SyncOutlined />} onClick={refresh}>刷新状态</Button>{session.status !== "completed" && <Popconfirm title="结束本场面试？" description="将根据已完成回答生成报告，未回答题目不评分。" onConfirm={() => act("end")} okText="结束并查看报告" cancelText="继续作答" disabled={session.busy || submitting}>
        <Button danger disabled={session.busy || submitting}>结束面试</Button></Popconfirm>}</Space></div>
    {error && <Alert className="interview-room-error" type="error" showIcon message={error} />}
    {session.status === "failed" && <Alert className="interview-room-error" type="warning" showIcon message="上一步未能完成，已保存的回答和记录仍然保留。"
      description={`错误类型：${session.error ?? "EXECUTION_FAILED"}。可重试失败步骤，或结束面试查看已有反馈。重试可能再次调用模型。`}
      action={<Button loading={submitting} onClick={() => act("retry")}>重试失败步骤</Button>} />}
    {session.status === "completed" || (session.report && session.phase === "report") ? <InterviewReportView session={session} /> : <div className="interview-room-grid">
      <div><Tabs activeKey={activeTab} onChange={setActiveTab} items={[{ key: "question", label: "当前问题" }, { key: "history", label: `作答记录 (${session.turns.length})` }]} />
        {activeTab === "history" ? <Card><TurnHistory turns={session.turns} /></Card> : <>
          <Card className="interview-question-card">{current ? <><Space wrap><Avatar size="small" src={BRAND_LOGO} alt="面试蛙" /><Tag color="blue">{current.kind === "self_intro" ? "自我介绍" : current.kind === "followup" ? "动态追问" : `问题 ${mainNumber} / ${session.progress.total}`}</Tag><Typography.Text type="secondary">面试官</Typography.Text></Space>
            <Typography.Title level={3} style={{ marginTop: 16 }}>{current.title}</Typography.Title>
            <Space wrap>{current.dimension && <Tag>{current.dimension}</Tag>}{current.projectLabel && <Tag color="purple">本题围绕：{current.projectLabel}</Tag>}</Space>
            <MdViewer value={current.content} />{current.hints?.map((hint, index) => <Alert key={index} style={{ marginTop: 12 }} type="info" showIcon message={`提示 ${index + 1}`} description={hint} />)}</>
            : <div className="interview-status-panel"><Spin /><p>正在从题库准备本场面试…</p></div>}
            {session.busy && current && <Alert style={{ marginTop: 20 }} type="info" showIcon icon={<SyncOutlined spin />} message="正在处理你的回答，请稍候。" description="可以离开页面，之后从面试记录继续查看结果。" />}</Card>
          <Card title="你的回答" className="interview-answer-card"><Input.TextArea value={answer} onChange={event => updateDraft(event.target.value)} disabled={!canAnswer}
            rows={9} showCount maxLength={8000} placeholder="像真实面试一样，用自己的话讲清楚思路。可以结合项目经历，说明关键点和取舍。"
            onKeyDown={event => { if (event.ctrlKey && event.key === "Enter" && canAnswer) { event.preventDefault(); void act("answer"); } }} />
            <div className="interview-answer-actions"><span className="interview-answer-tip">草稿保存在当前浏览器 · Ctrl + Enter 提交</span><Space>
              {session.settings.workflowVersion === "v2" && current?.kind !== "self_intro" && <Button disabled={!canAnswer || (current?.hints?.length || 0) >= 2} onClick={() => act("hint")}>获取提示</Button>}
              <Popconfirm title="跳过当前问题？" description="本题不会生成评分。" okText="跳过" cancelText="继续回答" onConfirm={() => act("skip")} disabled={!canAnswer}><Button disabled={!canAnswer}>跳过本题</Button></Popconfirm>
              <Button type="primary" icon={<SendOutlined />} loading={submitting} disabled={!canAnswer || !answer.trim()} onClick={() => act("answer")}>提交回答</Button></Space></div></Card>
          {lastTurn && <Card title="上一题反馈" style={{ marginTop: 20 }}><Typography.Paragraph type="secondary">{lastTurn.question.title}</Typography.Paragraph><Feedback turn={lastTurn} /></Card>}
        </>}</div>
      <aside className="interview-room-sidebar"><Card title="本场进度" className="interview-side-card"><Progress percent={Math.round(session.progress.mainIndex / Math.max(session.progress.total, 1) * 100)} />
        <Typography.Paragraph type="secondary">已推进 {session.progress.mainIndex} / {session.progress.total} {session.settings.workflowVersion === "v2" ? "轮正式问题" : "道主问题"}</Typography.Paragraph>
        <div className="interview-progress-list">{Array.from({ length: session.progress.total }, (_, index) => <p key={index} style={{ marginBottom: 14 }}><Tag color={index < session.progress.mainIndex ? "green" : index === session.progress.mainIndex && current?.kind !== "self_intro" ? "blue" : undefined}>{index < session.progress.mainIndex ? "已完成" : index === session.progress.mainIndex && current?.kind !== "self_intro" ? "当前" : "待开始"}</Tag>{session.settings.workflowVersion === "v2" ? "正式轮次" : "主问题"} {index + 1}</p>)}</div>
        <Typography.Text type="secondary">{session.settings.workflowVersion === "v2" ? "自我介绍独立处理；主问题与追问均计入正式轮次。" : "追问不占主问题数量，每题最多一次。"}</Typography.Text></Card>
        <Card title="作答小建议"><Typography.Paragraph>先给结论，再解释原理，最后结合实际项目说明。</Typography.Paragraph><Typography.Text type="secondary">不确定的地方可以直接说明。反馈会记录遗漏点，帮助你下一次补齐。</Typography.Text></Card></aside>
    </div>}
  </main>;
}
