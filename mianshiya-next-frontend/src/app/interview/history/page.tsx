"use client";

import { HistoryOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import HistoryList from "@/wenjing/components/HistoryList";
import "@/wenjing/wenjing.css";

export default function InterviewHistoryPage() {
  return (
    <section className="wenjing-page">
      <PageHeader
        icon={<HistoryOutlined />}
        eyebrow="练习记录"
        title="我的面试"
        description="这里是你做过的所有 AI 模拟面试。还没答完的可以接着练；已经完成的可以再看一次评分和反馈，比较自己每一次的进步。"
      />
      <AuthGate>
        <HistoryList />
      </AuthGate>
    </section>
  );
}
