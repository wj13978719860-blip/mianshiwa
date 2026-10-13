"use client";

import { BranchesOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import TraceView from "@/wenjing/components/TraceView";
import "@/wenjing/wenjing.css";

export default function InterviewTracePage({ params }: { params: { sessionId: string } }) {
  return (
    <section className="wenjing-page wide">
      <PageHeader
        icon={<BranchesOutlined />}
        eyebrow="Trace Explorer"
        title="本场面试 Trace"
        description="和报告、训练回放一起盘本次面试的关键节点、评估依据和异常证据。"
      />
      <AuthGate>
        <TraceView sessionId={params.sessionId} />
      </AuthGate>
    </section>
  );
}
