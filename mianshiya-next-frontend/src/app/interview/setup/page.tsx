"use client";

import { SettingOutlined } from "@ant-design/icons";
import AuthGate from "@/wenjing/components/AuthGate";
import PageHeader from "@/wenjing/components/PageHeader";
import SetupForm from "@/wenjing/components/SetupForm";
import "@/wenjing/wenjing.css";

export default function SetupPage() {
  return (
    <section className="wenjing-page narrow">
      <PageHeader
        icon={<SettingOutlined />}
        eyebrow="开始之前"
        title="告诉 AI 你想练什么"
        description="填写你的背景和目标岗位，问镜会据此挑选题目和评分维度。没有标准答案——按你真实的想法回答即可，结束后会拿到多维度反馈和提升建议。"
      />
      <AuthGate>
        <SetupForm />
      </AuthGate>
    </section>
  );
}
