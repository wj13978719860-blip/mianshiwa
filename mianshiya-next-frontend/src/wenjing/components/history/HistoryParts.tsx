"use client";

import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Flex,
  Modal,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  StarOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import { SessionIdTooltip } from "@/wenjing/components/shared";
import type {
  InterviewHistoryEntry,
  InterviewHistoryStatus,
} from "@/wenjing/lib/storage/interviewHistory";
import type { SetupDraft } from "@/wenjing/lib/storage/setupDrafts";
import {
  formatDateTimeFull,
  formatDateTimeShort,
  formatRelative,
  formatVerdictShort,
  historyTimeSummary,
  jobLevelLabel,
  setupDraftStatusLabel,
  type DisplayHistoryEntry,
} from "./utils";

const { Text, Title, Paragraph } = Typography;

export function AnonymousHistorySection({
  entries,
  deletingSessionId,
  onRemoveLocal,
  onDeleteData,
}: {
  entries: DisplayHistoryEntry[];
  deletingSessionId: string | null;
  onRemoveLocal: (sessionId: string) => void;
  onDeleteData: (entry: DisplayHistoryEntry) => void;
}) {
  return (
    <Collapse
      items={[
        {
          key: "anonymous",
          label: `本机匿名记录（${entries.length}）`,
          children: (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                这些记录只在当前浏览器；当前没有可同步凭证，只能在本机查看，或从本机列表移除，不能删除服务端数据。
              </Text>
              {entries.map((entry) => (
                <HistoryCard
                  key={entry.sessionId}
                  entry={entry}
                  deleting={deletingSessionId === entry.sessionId}
                  canRemoveLocal={entry.source === "local_anonymous"}
                  canDeleteData={false}
                  onRemoveLocal={onRemoveLocal}
                  onDeleteData={onDeleteData}
                />
              ))}
            </Space>
          ),
        },
      ]}
    />
  );
}

export function SetupDraftSection({
  drafts,
  onRemoveDraft,
}: {
  drafts: SetupDraft[];
  onRemoveDraft: (draftId: string) => void;
}) {
  return (
    <section>
      <div style={{ marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>
          准备中的面试
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          这些只是本浏览器里的填写草稿，还没有生成正式面试记录。
        </Text>
      </div>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {drafts.map((draft) => (
          <SetupDraftCard
            key={draft.draftId}
            draft={draft}
            onRemove={() => onRemoveDraft(draft.draftId)}
          />
        ))}
      </Space>
    </section>
  );
}

function SetupDraftCard({
  draft,
  onRemove,
}: {
  draft: SetupDraft;
  onRemove: () => void;
}) {
  return (
    <Card size="small" style={{ borderColor: "#b7eb8f", background: "#f6ffed" }}>
      <Flex wrap="wrap" align="center" justify="space-between" gap={12}>
        <div style={{ minWidth: 0 }}>
          <Space wrap size={8}>
            <Text strong ellipsis style={{ maxWidth: 360 }}>
              {draft.filename}
            </Text>
            <Tag color="green">{setupDraftStatusLabel(draft.status)}</Tag>
          </Space>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              最近更新 {formatRelative(draft.updatedAt)}
            </Text>
          </div>
        </div>
        <Space>
          <Link href={`/interview/setup?draft_id=${encodeURIComponent(draft.draftId)}`}>
            <Button type="primary" size="small">
              继续填写 <ArrowRightOutlined />
            </Button>
          </Link>
          <Button type="text" size="small" icon={<DeleteOutlined />} onClick={onRemove}>
            放弃草稿
          </Button>
        </Space>
      </Flex>
    </Card>
  );
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <Card style={{ borderStyle: "dashed" }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" size={4}>
            <Text strong>当前筛选下没有面试记录</Text>
            <Text type="secondary">
              可以切回“全部”查看其它状态的面试，或先开始一场新的练习。
            </Text>
          </Space>
        }
      >
        <Button size="small" onClick={onClear}>
          查看全部
        </Button>
      </Empty>
    </Card>
  );
}

export function HistoryCard({
  entry,
  deleting,
  canRemoveLocal,
  canDeleteData,
  onRemoveLocal,
  onDeleteData,
}: {
  entry: DisplayHistoryEntry;
  deleting: boolean;
  canRemoveLocal: boolean;
  canDeleteData: boolean;
  onRemoveLocal: (sessionId: string) => void;
  onDeleteData: (entry: DisplayHistoryEntry) => void;
}) {
  const primaryHref =
    entry.status === "done"
      ? `/interview/${entry.sessionId}/report`
      : `/interview/${entry.sessionId}`;
  const primaryLabel =
    entry.status === "done"
      ? "查看报告"
      : entry.status === "cancelled"
        ? "查看记录"
        : entry.status === "failed"
          ? "查看原因"
          : "继续面试";
  const primaryIcon =
    entry.status === "done" ? (
      <FileTextOutlined />
    ) : entry.status === "failed" ? (
      <ExclamationCircleOutlined />
    ) : (
      <PlayCircleOutlined />
    );

  return (
    <Card hoverable size="small" styles={{ body: { padding: 16 } }}>
      <Flex justify="space-between" align="flex-start" gap={12}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Space size={8} wrap>
            <Text strong ellipsis style={{ fontSize: 16, maxWidth: 420 }}>
              {entry.jdTitle}
            </Text>
            <StatusBadge status={entry.status} />
          </Space>
          <div style={{ marginTop: 4, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
            {entry.candidateName ? (
              <>
                <span style={{ color: "rgba(0,0,0,0.65)" }}>{entry.candidateName}</span>
                {entry.jobLevel && <span style={{ marginLeft: 6 }}>· {jobLevelLabel(entry.jobLevel)}</span>}
                {" · "}
              </>
            ) : null}
            <SessionIdTooltip sessionId={entry.sessionId} />
            <span style={{ margin: "0 4px", opacity: 0.5 }}>·</span>
            <HistoryTimeMeta entry={entry} />
          </div>
        </div>

        {typeof entry.overallScore === "number" && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <span style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700 }}>
              {entry.overallScore.toFixed(1)}
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>
                /10
              </Text>
            </span>
            {(entry.growthSignal || entry.overallVerdict) && (
              <div style={{ fontSize: 10, letterSpacing: 1, color: "rgba(0,0,0,0.45)" }}>
                {formatVerdictShort(entry.growthSignal ?? entry.overallVerdict ?? "")}
              </div>
            )}
          </div>
        )}
      </Flex>

      <Flex wrap="wrap" justify="space-between" align="center" gap={12} style={{ marginTop: 12 }}>
        <Space size={4} wrap>
          {(entry.rubricDimensions ?? []).slice(0, 4).map((dim) => (
            <Tag key={dim} style={{ fontFamily: "monospace", fontSize: 10 }}>
              {dim}
            </Tag>
          ))}
        </Space>

        <Space size={6} wrap>
          <Link href={primaryHref}>
            <Button
              size="small"
              type={entry.status === "running" ? "primary" : "default"}
              icon={primaryIcon}
            >
              {primaryLabel} <ArrowRightOutlined />
            </Button>
          </Link>
          {entry.status === "done" && (
            <Link href={`/interview/${entry.sessionId}/replay`}>
              <Button size="small" icon={<RedoOutlined />}>
                训练回放
              </Button>
            </Link>
          )}
          {canRemoveLocal && (
            <Button
              type="text"
              size="small"
              icon={<CloseCircleOutlined />}
              onClick={() => onRemoveLocal(entry.sessionId)}
              aria-label="只从当前浏览器列表中移除，不删除后端数据"
            >
              从列表移除
            </Button>
          )}
          {canDeleteData && (
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
              disabled={deleting}
              onClick={() => onDeleteData(entry)}
              aria-label="删除后端保存的面试数据"
            >
              删除数据
            </Button>
          )}
        </Space>
      </Flex>
    </Card>
  );
}

function HistoryTimeMeta({ entry }: { entry: InterviewHistoryEntry }) {
  const accessLabel = entry.status === "running" ? "最近继续" : "最近访问";
  const createdLabel = entry.updatedAt ? "创建于" : "加入列表";
  const createdText = entry.updatedAt
    ? formatDateTimeShort(entry.createdAt)
    : formatRelative(entry.createdAt);

  return (
    <>
      <span aria-label={`${accessLabel} ${formatDateTimeFull(entry.lastVisitedAt)}`}>
        {accessLabel} {formatRelative(entry.lastVisitedAt)}
      </span>
      <span style={{ margin: "0 4px", opacity: 0.5 }}>·</span>
      <span aria-label={`${createdLabel} ${formatDateTimeFull(entry.createdAt)}`}>
        {createdLabel} {createdText}
      </span>
    </>
  );
}

export function DeleteSessionModal({
  entry,
  deleting,
  onCancel,
  onConfirm,
}: {
  entry: DisplayHistoryEntry | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={entry !== null}
      width={520}
      onCancel={onCancel}
      maskClosable={!deleting}
      closable={!deleting}
      title={
        <Space>
          <WarningOutlined style={{ color: "#ff4d4f" }} />
          删除这场面试的数据？
        </Space>
      }
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={deleting}>
          取消，保留数据
        </Button>,
        <Button
          key="confirm"
          type="primary"
          danger
          icon={<DeleteOutlined />}
          loading={deleting}
          disabled={deleting || entry === null}
          onClick={onConfirm}
        >
          永久删除数据
        </Button>,
      ]}
    >
      <Paragraph type="secondary">这不是从列表里隐藏记录，而是删除后端保存的面试数据。</Paragraph>
      {entry && (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Card size="small" style={{ background: "#fafafa" }}>
            <Text strong ellipsis style={{ display: "block" }}>
              {entry.jdTitle || "未命名面试"}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {entry.candidateName ? `${entry.candidateName} · ` : ""}
              {entry.jobLevel ? `${jobLevelLabel(entry.jobLevel)} · ` : ""}
              <SessionIdTooltip sessionId={entry.sessionId} />
              <span style={{ margin: "0 4px", opacity: 0.5 }}>·</span>
              {historyTimeSummary(entry)}
            </Text>
          </Card>
          <Card size="small" style={{ background: "#fff2f0", borderColor: "#ffccc7" }}>
            <Text strong style={{ color: "#cf1322" }}>
              删除后会发生：
            </Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "rgba(0,0,0,0.65)" }}>
              <li>无法继续面试</li>
              <li>无法回看本场面试报告与反馈</li>
              <li>本地“我的面试”列表也会移除这条记录</li>
            </ul>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: "12px 0 0" }}>
              简历解析缓存不会被删除，它会按当前 24 小时缓存策略自动过期。
            </Paragraph>
          </Card>
        </Space>
      )}
    </Modal>
  );
}

export function StatusBadge({ status }: { status: InterviewHistoryStatus }) {
  if (status === "running") {
    return (
      <Tag color="warning">
        <Badge status="processing" color="#faad14" style={{ marginRight: 4 }} />
        进行中
      </Tag>
    );
  }
  if (status === "done") {
    return (
      <Tag color="success" icon={<CheckCircleOutlined />}>
        已完成
      </Tag>
    );
  }
  if (status === "failed") {
    return (
      <Tag color="error" icon={<ExclamationCircleOutlined />}>
        需处理
      </Tag>
    );
  }
  return (
    <Tag icon={<CloseCircleOutlined />}>已取消</Tag>
  );
}

export function EmptyState() {
  return (
    <Card style={{ borderStyle: "dashed" }}>
      <Result
        icon={<StarOutlined style={{ color: "#10b981" }} />}
        title="还没有练习记录"
        subTitle={
          <>
            来一场 AI 模拟面试吧。完成后可以随时回到这里查看评分与反馈，
            对比自己每一次的进步。
          </>
        }
        extra={
          <Link href="/interview/setup">
            <Button type="primary">
              开始第一场面试 <ArrowRightOutlined />
            </Button>
          </Link>
        }
      />
    </Card>
  );
}

export function SkeletonList() {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {[0, 1, 2].map((i) => (
        <Card key={i} size="small">
          <Skeleton active paragraph={{ rows: 1 }} />
        </Card>
      ))}
    </Space>
  );
}
