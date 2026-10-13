"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { Button, Card, Col, Empty, Row, Space, Statistic, Tag, Typography } from "antd";
import { ArrowRightOutlined, RiseOutlined } from "@ant-design/icons";

import { formatDimensionName } from "@/wenjing/lib/constants/interview";
import { WEAK_DIMENSION_THRESHOLD } from "@/wenjing/lib/constants/scores";
import type { InterviewHistoryEntry } from "@/wenjing/lib/storage/interviewHistory";

type ChartPoint = {
  label: string;
  tooltipLabel: string;
  score: number;
};

type RawChartPoint = {
  label: string;
  tooltipLabel: string;
  score: number;
};

export function ProgressChart({
  entries,
}: {
  entries: InterviewHistoryEntry[];
}) {
  const scoredEntries = useMemo(
    () =>
      entries
        .filter((entry) => typeof entry.overallScore === "number")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [entries],
  );
  const dimensions = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of scoredEntries) {
      for (const id of Object.keys(entry.dimensionScores ?? {})) {
        ids.add(id);
      }
    }
    return Array.from(ids).sort();
  }, [scoredEntries]);
  const [activeDimension, setActiveDimension] = useState<string>("overallScore");

  const chartData = useMemo<ChartPoint[]>(() => {
    const includesFullYear =
      new Set(
        scoredEntries.map((entry) => new Date(entry.createdAt).getFullYear()),
      ).size > 1;
    const rawPoints = scoredEntries
      .map((entry) => {
        const raw =
          activeDimension === "overallScore"
            ? entry.overallScore
            : entry.dimensionScores?.[activeDimension];
        if (typeof raw !== "number") return null;
        return {
          label: formatChartDate(entry.createdAt, { includeYear: includesFullYear }),
          tooltipLabel: formatChartDate(entry.createdAt, { includeYear: true }),
          score: Number(raw.toFixed(1)),
        };
      })
      .filter((point): point is RawChartPoint => Boolean(point));

    return disambiguateSameDayLabels(rawPoints);
  }, [activeDimension, scoredEntries]);

  const latest = scoredEntries[scoredEntries.length - 1];
  const best = scoredEntries.reduce<InterviewHistoryEntry | null>((acc, entry) => {
    if (typeof entry.overallScore !== "number") return acc;
    if (!acc || entry.overallScore > (acc.overallScore ?? 0)) return entry;
    return acc;
  }, null);
  const recentFive = scoredEntries.slice(-5);
  const delta =
    recentFive.length >= 2 &&
    typeof recentFive[0].overallScore === "number" &&
    typeof recentFive[recentFive.length - 1].overallScore === "number"
      ? recentFive[recentFive.length - 1].overallScore! - recentFive[0].overallScore!
      : null;
  const weakPracticeHref = buildWeakPracticeHref(scoredEntries);
  const currentMetricLabel =
    activeDimension === "overallScore"
      ? "总分"
      : formatDimensionName(activeDimension);

  const option = useMemo(
    () => ({
      grid: { top: 16, right: 24, bottom: 28, left: 32 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { dataIndex?: number; value?: unknown } | undefined;
          const point =
            typeof first?.dataIndex === "number" ? chartData[first.dataIndex] : undefined;
          const score = Number(first?.value);
          const scoreText = Number.isFinite(score) ? `${score.toFixed(1)} / 10` : "-";
          return `<div style="font-size:12px;color:#8c8c8c">${point?.tooltipLabel ?? ""}</div>
<div style="margin-top:4px"><span>${currentMetricLabel}</span>
<b style="margin-left:8px;color:#10b981;font-family:monospace">${scoreText}</b></div>`;
        },
      },
      xAxis: {
        type: "category",
        data: chartData.map((point) => point.label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 10,
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: chartData.map((point) => point.score),
          symbolSize: 6,
          lineStyle: { color: "#10b981", width: 2 },
          itemStyle: { color: "#10b981" },
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: "#f59e0b", type: "dashed", opacity: 0.7 },
            label: {
              formatter: `达标线 ${WEAK_DIMENSION_THRESHOLD}`,
              position: "insideEndTop",
              color: "#f59e0b",
              fontSize: 10,
            },
            data: [{ yAxis: WEAK_DIMENSION_THRESHOLD }],
          },
        },
      ],
    }),
    [chartData, currentMetricLabel],
  );

  return (
    <Card
      title={
        <Space direction="vertical" size={0}>
          <Space>
            <RiseOutlined style={{ color: "#10b981" }} />
            <span>进步趋势</span>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            看最近几场练习的分数变化和薄弱维度。
          </Typography.Text>
        </Space>
      }
      extra={
        weakPracticeHref && (
          <Link href={weakPracticeHref}>
            <Button type="primary" size="small">
              针对薄弱点专项练习 <ArrowRightOutlined />
            </Button>
          </Link>
        )
      }
    >
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="最近一次" value={formatScore(latest?.overallScore)} valueStyle={statValueStyle} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="最高分" value={formatScore(best?.overallScore)} valueStyle={statValueStyle} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="近 5 场变化" value={formatDelta(delta)} valueStyle={statValueStyle} />
          </Card>
        </Col>
      </Row>

      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Tag.CheckableTag
          checked={activeDimension === "overallScore"}
          onChange={() => setActiveDimension("overallScore")}
        >
          总分
        </Tag.CheckableTag>
        {dimensions.map((dimension) => (
          <Tag.CheckableTag
            key={dimension}
            checked={activeDimension === dimension}
            onChange={() => setActiveDimension(dimension)}
          >
            {formatDimensionName(dimension)}
          </Tag.CheckableTag>
        ))}
      </div>
      <Typography.Paragraph
        type="secondary"
        style={{
          marginTop: 12,
          marginBottom: 12,
          fontSize: 12,
          background: "#fafafa",
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          padding: "6px 12px",
        }}
      >
        当前查看：<Typography.Text>{currentMetricLabel}</Typography.Text>
        {" · "}
        {WEAK_DIMENSION_THRESHOLD} 分为达标线。
      </Typography.Paragraph>

      {chartData.length < 2 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="完成至少两场带评分的练习后，这里会出现趋势线。"
        />
      ) : (
        <ReactECharts option={option} style={{ height: 224, width: "100%" }} notMerge />
      )}
    </Card>
  );
}

const statValueStyle = { fontFamily: "monospace", fontSize: 18, fontWeight: 600 };

function formatChartDate(
  value: string,
  { includeYear }: { includeYear: boolean },
): string {
  return new Date(value).toLocaleDateString(undefined, {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "numeric",
    day: "numeric",
  });
}

function disambiguateSameDayLabels(points: RawChartPoint[]): ChartPoint[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    counts.set(point.tooltipLabel, (counts.get(point.tooltipLabel) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return points.map((point) => {
    const count = counts.get(point.tooltipLabel) ?? 0;
    if (count <= 1) {
      return {
        label: point.label,
        tooltipLabel: point.tooltipLabel,
        score: point.score,
      };
    }

    const occurrence = (seen.get(point.tooltipLabel) ?? 0) + 1;
    seen.set(point.tooltipLabel, occurrence);
    return {
      label: `${point.label} 第${occurrence}场`,
      tooltipLabel: `${point.tooltipLabel} 第${occurrence}场`,
      score: point.score,
    };
  });
}

function formatScore(score: number | undefined): string {
  return typeof score === "number" ? `${score.toFixed(1)} / 10` : "暂无";
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "暂无";
  if (Math.abs(delta) < 0.05) return "持平";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

function buildWeakPracticeHref(entries: InterviewHistoryEntry[]): string | null {
  const recent = entries.slice(-5);
  const buckets = new Map<string, { total: number; count: number }>();
  for (const entry of recent) {
    for (const [dimension, score] of Object.entries(entry.dimensionScores ?? {})) {
      if (score >= WEAK_DIMENSION_THRESHOLD) continue;
      const bucket = buckets.get(dimension) ?? { total: 0, count: 0 };
      bucket.total += score;
      bucket.count += 1;
      buckets.set(dimension, bucket);
    }
  }
  const focus = Array.from(buckets.entries())
    .sort((a, b) => a[1].total / a[1].count - b[1].total / b[1].count)
    .slice(0, 2)
    .map(([dimension]) => dimension);
  if (focus.length === 0) return null;
  const latest = recent[recent.length - 1];
  const params = new URLSearchParams({
    focus: focus.join(","),
    length: "short",
  });
  if (latest?.jdTitle) params.set("job_title", latest.jdTitle);
  if (latest?.jobLevel) params.set("job_level", latest.jobLevel);
  return `/interview/setup?${params.toString()}`;
}
