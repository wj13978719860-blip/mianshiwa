"use client";
import { Alert, Card, Collapse, Progress, Space, Tag, Typography } from "antd";
import { CheckCircleOutlined, BulbOutlined } from "@ant-design/icons";
import MdViewer from "@/components/MdViewer";
import { InterviewTurn } from "@/api/aiInterviewController";

/** 展示回答证据和改进建议，不提前公开待答题的参考答案。 */
export function Feedback({ turn }: { turn: InterviewTurn }) {
  const evaluation = turn.evaluation;
  if (!evaluation) return <Alert type="info" showIcon message={turn.status === "introduced" ? "自我介绍已用于补充画像，不进行技术题评分。" : "本题已跳过，未生成评价。"} />;
  return <div className="interview-feedback">
    <div className="interview-score-row"><Typography.Text strong>本题反馈</Typography.Text>
      <Tag color={evaluation.score >= 75 ? "green" : evaluation.score >= 50 ? "blue" : "orange"}>{evaluation.score} 分</Tag></div>
    <div className="interview-dimensions">
      {([["准确性", evaluation.accuracy], ["完整性", evaluation.completeness], ["表达逻辑", evaluation.expression]] as [string, number][])
        .map(([label, score]) => <div key={label}><Typography.Text type="secondary">{label}</Typography.Text><Progress percent={score} size="small" /></div>)}
    </div>
    <div className="interview-feedback-columns">
      <div><Typography.Text strong><CheckCircleOutlined /> 回答得好的地方</Typography.Text>
        {evaluation.strengths.length ? <ul>{evaluation.strengths.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>本题暂未识别到明确优点。</p>}</div>
      <div><Typography.Text strong><BulbOutlined /> 下一次可以改进</Typography.Text>
        {evaluation.improvements.length ? <ul>{evaluation.improvements.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>本题没有列出额外改进项。</p>}</div>
    </div>
    {evaluation.evidence.length > 0 && <div className="interview-evidence"><Typography.Text type="secondary">来自你的回答</Typography.Text>
      {evaluation.evidence.map((quote, index) => <blockquote key={index}>{quote}</blockquote>)}</div>}
  </div>;
}

/** 作答回放保留题目、原回答和评价，不从聊天文本猜测状态。 */
export function TurnHistory({ turns }: { turns: InterviewTurn[] }) {
  if (!turns.length) return <Typography.Paragraph type="secondary">完成第一题后，这里会记录你的回答与反馈。</Typography.Paragraph>;
  return <Collapse className="interview-turns" items={turns.map((turn, index) => ({
    key: `${turn.question.id}-${index}`,
    label: <Space wrap><span id={`turn-record-${turn.question.id}`}>{index + 1}. {turn.question.title}</span><Tag>{turn.question.kind === "self_intro" ? "自我介绍" : turn.question.kind === "followup" ? "追问" : "主问题"}</Tag>
      {turn.evaluation ? <Tag color="blue">{turn.evaluation.score} 分</Tag> : <Tag>{turn.status === "introduced" ? "已介绍" : "已跳过"}</Tag>}</Space>,
    children: <><MdViewer value={turn.question.content} /><Card size="small" className="interview-answer-record" title="你的回答">
      <p className="interview-original-answer">{turn.answer || "本题没有提交回答。"}</p></Card><Feedback turn={turn} /></>,
  }))} />;
}
