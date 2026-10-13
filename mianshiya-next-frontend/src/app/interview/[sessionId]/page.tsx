"use client";

import { MessageOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import InterviewRoom from "@/wenjing/components/InterviewRoom";
import "@/wenjing/wenjing.css";

export default function InterviewSessionPage({ params }: { params: { sessionId: string } }) {
  return (
    <section className="wenjing-page narrow">
      <PageHeader
        icon={<MessageOutlined />}
        eyebrow="面试中"
        title="面试进行中"
        description="用自己的节奏认真回答每个问题。进度会自动保存，关闭页面后可随时回来继续。"
      />
      <AuthGate>
        <InterviewRoom sessionId={params.sessionId} />
      </AuthGate>
    </section>
  );
}
