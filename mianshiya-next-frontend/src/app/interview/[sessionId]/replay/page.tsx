"use client";

import { HistoryOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import ReplayView from "@/wenjing/components/ReplayView";
import "@/wenjing/wenjing.css";

export default function InterviewReplayPage({ params }: { params: { sessionId: string } }) {
  return (
    <section className="wenjing-page narrow">
      <PageHeader
        icon={<HistoryOutlined />}
        eyebrow="训练回放"
        title="复盘这场面试"
        description="按轮次回看问题、回答、评分依据和后续练习建议，把一次面试变成下一次提升的路线图。"
      />
      <AuthGate>
        <ReplayView sessionId={params.sessionId} />
      </AuthGate>
    </section>
  );
}
