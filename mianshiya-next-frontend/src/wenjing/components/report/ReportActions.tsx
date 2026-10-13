"use client";

import React from "react";
import Link from "next/link";
import { Button, Flex, Segmented, Tooltip, message } from "antd";
import {
  AimOutlined,
  ArrowLeftOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

import type { FinalReport } from "@/wenjing/lib/api/types";
import { formatReportMarkdown, formatReportSummary } from "@/wenjing/lib/report-export";

export default function ReportActions({
  sessionId,
  report,
  weakPracticeHref,
}: {
  sessionId: string;
  report: FinalReport | null;
  weakPracticeHref?: string | null;
}) {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();

  async function handleCopySummary() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatReportSummary(report, { sessionId }));
      messageApi.success("已复制报告摘要");
    } catch {
      messageApi.error("复制失败，可以改用 Markdown 导出");
    }
  }

  function handleExportMarkdown() {
    if (!report) return;
    const payload = formatReportMarkdown(report, { sessionId });
    const blob = new Blob([payload], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-report-${sessionId.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Flex vertical gap={12}>
      {contextHolder}
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <Link href={`/interview/${sessionId}`}>
          <Button icon={<ArrowLeftOutlined />}>返回对话记录</Button>
        </Link>
        <Flex gap={6} aria-label="报告工具">
          <Tooltip title="复制报告摘要" mouseEnterDelay={0.15}>
            <Button
              icon={<CopyOutlined />}
              aria-label="复制报告摘要"
              disabled={!report}
              onClick={() => void handleCopySummary()}
            />
          </Tooltip>
          <Tooltip title="导出 Markdown" mouseEnterDelay={0.15}>
            <Button
              type="text"
              icon={<FileTextOutlined />}
              aria-label="导出 Markdown"
              disabled={!report}
              onClick={handleExportMarkdown}
            />
          </Tooltip>
        </Flex>
      </Flex>
      <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
        <nav aria-label="复盘视图">
          <Segmented
            value="report"
            onChange={(value) => {
              if (value === "replay") router.push(`/interview/${sessionId}/replay`);
              if (value === "trace") router.push(`/interview/${sessionId}/trace`);
            }}
            options={[
              { value: "report", label: "报告", icon: <CheckCircleOutlined /> },
              { value: "replay", label: "训练回放", icon: <StarOutlined /> },
              { value: "trace", label: "Trace", icon: <BranchesOutlined /> },
            ]}
          />
        </nav>
        <Flex wrap="wrap" gap={8} aria-label="下一步">
          {weakPracticeHref && (
            <Link href={weakPracticeHref}>
              <Button type="primary" icon={<AimOutlined />} style={{ background: "#16a34a" }}>
                针对薄弱点专项练习
              </Button>
            </Link>
          )}
          <Link href="/interview/setup">
            <Button
              type={weakPracticeHref ? "default" : "primary"}
              icon={<PlayCircleOutlined />}
              style={weakPracticeHref ? undefined : { background: "#16a34a" }}
            >
              开始新面试
            </Button>
          </Link>
        </Flex>
      </Flex>
    </Flex>
  );
}
