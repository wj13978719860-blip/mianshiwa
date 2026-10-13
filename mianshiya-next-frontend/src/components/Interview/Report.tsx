"use client";
import { Button, Card, Empty, Progress, Space, Statistic, Typography, message } from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { InterviewSession } from "@/api/aiInterviewController";
import { TurnHistory } from "./Feedback";

/** 只汇总服务端已保存的评价；没有已评分回答时显示空值。 */
export default function InterviewReportView({ session }: { session: InterviewSession }) {
  const router = useRouter();
  const report = session.report;
  if (!report) return <Empty description="报告尚未生成，请刷新状态。" />;
  const copyReport = async () => {
    const text = [`面试蛙 · 面试复盘`, `岗位：${session.settings.jobPosition}`, `题库：${session.settings.bankTitle}`,
      `综合评分：${report.score ?? "无已评分回答"}`, `已回答：${report.answered}，已跳过：${report.skipped}`,
      "\n优点", ...report.strengths.map(value => `- ${value}`), "\n改进建议", ...report.recommendations.map(value => `- ${value}`),
      report.summary || "", "\n训练计划", ...(report.trainingPlan || []).map(t => `${t.goal}：${t.action}；完成标准：${t.criterion}`),
      ...session.turns.flatMap(turn => [`\n题目：${turn.question.title}`, turn.question.content, `回答：${turn.answer || "已跳过"}`,
        `评价：${turn.evaluation?.score ?? "未评分"}`, ...(turn.evaluation?.improvements ?? [])])].join("\n");
    try { await navigator.clipboard.writeText(text); message.success("报告已复制"); }
    catch { message.error("无法复制，请检查浏览器剪贴板权限"); }
  };
  return <div className="interview-report"><Card className="interview-report-summary">
    <div className="interview-section-heading"><div><span className="interview-eyebrow">INTERVIEW REVIEW</span><Typography.Title level={2}>面试结束，看看你的表现</Typography.Title>
      <Typography.Paragraph type="secondary">{session.settings.jobPosition} · {session.settings.bankTitle} · {session.settings.difficulty}</Typography.Paragraph></div>
      <Space wrap>{session.status === "failed" && <Button onClick={() => router.push(`/mockInterview/chat/${session.id}`)}>继续生成报告</Button>}<Button icon={<CopyOutlined />} onClick={copyReport}>复制报告</Button><Button type="primary" icon={<ReloadOutlined />} onClick={() => router.push("/mockInterview/add")}>再练一场</Button></Space></div>
    <div className="interview-report-metrics"><Statistic title="综合评分" value={report.score ?? "—"} suffix={report.score === null ? "" : "/ 100"} />
      <Statistic title="已评价回答（含追问）" value={report.answered} /><Statistic title="已跳过" value={report.skipped} /></div>
    <div className="interview-dimensions">{([["准确性", report.dimensions.accuracy], ["完整性", report.dimensions.completeness], ["表达逻辑", report.dimensions.expression]] as [string, number | null][])
      .map(([label, score]) => <div key={label}><Typography.Text>{label}</Typography.Text>{score === null ? <p>暂无评分</p> : <Progress percent={score} />}</div>)}</div>
    {report.summary && <Typography.Paragraph>{report.summary}</Typography.Paragraph>}
    <Typography.Text type="secondary">评分基于本场实际回答；未考察的能力不作结论。</Typography.Text></Card>
    {report.dimensionScores && <Card title="岗位能力维度"><div className="interview-dimensions">{report.dimensionScores.map(d => <div key={d.id}><Typography.Text>{d.label}</Typography.Text>{d.score === null ? <p>未覆盖</p> : <Progress percent={d.score} />}</div>)}</div></Card>}
    {report.trainingPlan && <Card title="下一步训练计划">{report.trainingPlan.map((t, i) => <Card size="small" key={i} title={t.goal} style={{ marginBottom: 12 }}>
      <Typography.Paragraph>{t.action}</Typography.Paragraph><Typography.Text type="secondary">完成标准：{t.criterion}</Typography.Text>
      <Button type="link" onClick={() => document.getElementById(`turn-record-${t.turnId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>查看对应回答</Button></Card>)}</Card>}
    <div className="interview-feedback-columns"><Card title="继续保持">{report.strengths.length ? <ul>{report.strengths.map((text, index) => <li key={index}>{text}</li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可汇总的优点" />}</Card>
      <Card title="下一次练习重点">{report.recommendations.length ? <ol>{report.recommendations.map((text, index) => <li key={index}>{text}</li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无改进建议" />}</Card></div>
    <Card title="逐题回放"><TurnHistory turns={session.turns} /></Card></div>;
}
