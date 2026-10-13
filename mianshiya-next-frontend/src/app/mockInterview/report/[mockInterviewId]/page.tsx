"use client";
import { useEffect, useState } from "react";
import { Button, Card, Result, Skeleton } from "antd";
import { useRouter } from "next/navigation";
import { useSelector } from "react-redux";
import { RootState } from "@/stores";
import { InterviewSession, interviewApi, interviewError } from "@/api/aiInterviewController";
import InterviewReportView from "@/components/Interview/Report";
import "@/components/Interview/interview.css";

/** 独立报告页仅查询本人会话，刷新可直接回看，不重新调用模型。 */
export default function ReportPage({ params }: { params: { mockInterviewId: string } }) {
  const router = useRouter();
  const user = useSelector((s: RootState) => s.loginUser);
  const [session, setSession] = useState<InterviewSession>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user.id) return;
    const controller = new AbortController();
    interviewApi.get(params.mockInterviewId, controller.signal).then(r => { if (!controller.signal.aborted) setSession(r.data); })
      .catch(e => { if (!controller.signal.aborted) setError(interviewError(e)); });
    return () => controller.abort();
  }, [user.id, params.mockInterviewId]);
  if (!user.id) return <Result title="登录后查看报告" extra={<Button onClick={() => router.push(`/user/login?redirect=${encodeURIComponent(window.location.origin + "/mockInterview/report/" + params.mockInterviewId)}`)}>去登录</Button>} />;
  if (error) return <Result status="warning" title="无法加载报告" subTitle={error} extra={<Button onClick={() => window.location.reload()}>重新加载</Button>} />;
  if (!session) return <Card><Skeleton active /></Card>;
  if (!session.report) return <Result title="面试还未生成报告" extra={<Button onClick={() => router.push(`/mockInterview/chat/${session.id}`)}>回到面试</Button>} />;
  return <main className="interview-page"><Button onClick={() => router.push("/mockInterview/add")} style={{ marginBottom: 16 }}>面试设置与记录</Button><InterviewReportView session={session} /></main>;
}
