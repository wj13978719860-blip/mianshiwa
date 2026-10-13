"use client";

import { RiseOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import ReportView from "@/wenjing/components/ReportView";
import "@/wenjing/wenjing.css";

export default function InterviewReportPage({ params }: { params: { sessionId: string } }) {
  return (
    <section className="wenjing-page narrow">
      <PageHeader
        icon={<RiseOutlined />}
        eyebrow="最终报告"
        title="面试报告"
        description="问镜从多个维度给出了分数和改进建议，帮你看清当前的强项和差距。"
      />
      <AuthGate>
        <ReportView sessionId={params.sessionId} />
      </AuthGate>
    </section>
  );
}
