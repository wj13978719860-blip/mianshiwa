"use client";

import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Flex,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleOutlined,
  CloseOutlined,
  FileTextOutlined,
  InboxOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type {
  DimensionOption,
  ResumeCandidateProfile,
  ResumeFocusArea,
  ResumeProject,
} from "@/wenjing/lib/api/types";
import {
  CANDIDATE_HIGHLIGHTS_MAX_COUNT,
  CANDIDATE_HIGHLIGHT_MAX_LENGTH,
  CANDIDATE_SKILLS_MAX_COUNT,
  CANDIDATE_SKILL_MAX_LENGTH,
  CANDIDATE_SUMMARY_MAX_LENGTH,
  LENGTH_OPTIONS,
  RESUME_FOCUS_AREAS_MAX_COUNT,
  RESUME_FOCUS_LABEL_MAX_LENGTH,
  RESUME_PROJECTS_MAX_COUNT,
  RESUME_PROJECT_ANCHOR_MAX_COUNT,
  RESUME_PROJECT_ANCHOR_MAX_LENGTH,
  RESUME_PROJECT_NAME_MAX_LENGTH,
  RESUME_PROJECT_ROLE_MAX_LENGTH,
  STEP_LABELS,
  categoryForDirection,
  directionByIdFrom,
  groupedDirections,
  type DirectionCategoryId,
  type DirectionId,
  type JdStatus,
  type LengthId,
  type SetupDirection,
  type UploadStatus,
} from "./constants";
import {
  joinCsv,
  normaliseFocusAreas,
  resumeCandidateProfileChips,
  resumeParseStatusMessage,
  splitCsv,
} from "./helpers";
import styles from "./components.module.css";

const { Text, Paragraph } = Typography;
const ACCENT = "#10b981";

function selectableCardStyle(active: boolean): React.CSSProperties {
  return {
    cursor: "pointer",
    height: "100%",
    borderColor: active ? ACCENT : undefined,
    background: active ? "rgba(16,185,129,0.06)" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

export function StepIndicator({
  current,
  onJump,
}: {
  current: number;
  onJump: (id: number) => void;
}) {
  return (
    <Steps
      current={current}
      onChange={onJump}
      size="small"
      items={STEP_LABELS.map((label) => ({ title: label }))}
      style={{ marginBottom: 8 }}
    />
  );
}

export function ExpectationBanner() {
  return (
    <Alert
      type="info"
      showIcon
      message={
        <span>
          面试通常包含 <Text strong>5-12 轮问题</Text>，AI 会根据你的回答动态调整难度和追问方向。
        </span>
      }
      description={<Text type="secondary" style={{ fontSize: 12 }}>进度自动保存，你可以随时关闭页面继续。</Text>}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 0: direction
// ---------------------------------------------------------------------------

export function DirectionStep({
  selected,
  directions,
  onSelect,
}: {
  selected: DirectionId;
  directions: ReadonlyArray<SetupDirection>;
  onSelect: (id: DirectionId) => void;
}) {
  const groups = groupedDirections(directions);
  const selectedDirection = directionByIdFrom(directions, selected);
  const selectedCategory = categoryForDirection(selectedDirection);
  const [activeCategory, setActiveCategory] = useState<DirectionCategoryId>(selectedCategory);
  const activeGroup = groups.find((group) => group.id === activeCategory) ?? groups[0];

  useEffect(() => {
    setActiveCategory(selectedCategory);
  }, [selectedCategory]);

  return (
    <Card title="先选目标岗位">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          type="success"
          message="选一个最接近你目标岗位的方向，我们会先准备一份通用岗位要求，后面你还可以自己修改。"
        />

        <div>
          <Space size={8} style={{ marginBottom: 8 }}>
            <Tag>岗位大类</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              先按工作类型缩小范围
            </Text>
          </Space>
          <Row gutter={[8, 8]}>
            {groups.map((group) => {
              const active = activeGroup?.id === group.id;
              const selectedInGroup = group.directions.some((direction) => direction.id === selected);
              return (
                <Col key={group.id} xs={12} sm={12} lg={Math.floor(24 / Math.max(groups.length, 1))}>
                  <Card
                    size="small"
                    hoverable
                    style={selectableCardStyle(active)}
                    onClick={() => setActiveCategory(group.id)}
                  >
                    <Flex justify="space-between" align="center" gap={8}>
                      <Text strong>{group.label}</Text>
                      {selectedInGroup && <CheckCircleFilled style={{ color: ACCENT }} />}
                    </Flex>
                    <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 12, margin: "4px 0 0" }}>
                      {group.desc}
                    </Paragraph>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </div>

        <div>
          <Space size={8} style={{ marginBottom: 8 }}>
            <Tag bordered>目标岗位</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {activeGroup?.label ?? "选择最接近的一项"}
            </Text>
          </Space>
          <Row gutter={[12, 12]}>
            {(activeGroup?.directions ?? directions).map((item) => {
              const active = selected === item.id;
              return (
                <Col key={item.id} xs={24} md={12}>
                  <Card size="small" hoverable style={selectableCardStyle(active)} onClick={() => onSelect(item.id)}>
                    <Flex justify="space-between" align="center" gap={12}>
                      <Text strong style={{ fontSize: 15 }}>
                        {item.label}
                      </Text>
                      {active && <CheckCircleFilled style={{ color: ACCENT }} />}
                    </Flex>
                    <Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 12, margin: "4px 0 0" }}>
                      {item.desc}
                    </Paragraph>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </div>
      </Space>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 1: resume uploader
// ---------------------------------------------------------------------------

export function ResumeUploader({
  status,
  isDragging,
  onPick,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onClear,
}: {
  status: UploadStatus;
  isDragging: boolean;
  onPick: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onClear: () => void;
}) {
  const label = <Text strong>从简历自动填写（推荐）</Text>;

  if (status.kind === "parsing") {
    return (
      <div>
        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
          {label}
          <Button type="text" size="small" onClick={onClear}>
            取消解析
          </Button>
        </Flex>
        <Card size="small" style={{ borderColor: "rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.04)" }}>
          <Flex gap={12} align="flex-start" wrap="wrap" justify="space-between">
            <Flex gap={12} align="flex-start" style={{ minWidth: 0, flex: 1 }}>
              <Spin indicator={<LoadingOutlined spin style={{ color: ACCENT }} />} />
              <div style={{ minWidth: 0 }}>
                <Space size={8} wrap>
                  <Tag color="green">AI 解析中</Tag>
                  <Text strong ellipsis style={{ maxWidth: 260 }}>
                    {status.filename}
                  </Text>
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    解析可能需要几分钟。你可以离开当前页面，之后从首页“接着练”或“我的面试”继续回来。
                  </Text>
                </div>
              </div>
            </Flex>
            <Space size={4}>
              {["读取文件", "AI 精修", "自动补全"].map((item, idx) => (
                <Tag key={item} color={idx === 1 ? "green" : undefined} style={{ margin: 0 }}>
                  {item}
                </Tag>
              ))}
            </Space>
          </Flex>
        </Card>
      </div>
    );
  }

  if (status.kind === "success") {
    const parseStatus = status.parseStatus;
    const successIsBasic = parseStatus?.mode === "basic";
    return (
      <div>
        <div style={{ marginBottom: 8 }}>{label}</div>
        <Card size="small" style={{ borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.04)" }}>
          <Flex gap={12} align="center" justify="space-between" wrap="wrap">
            <Flex gap={12} align="center" style={{ minWidth: 0, flex: 1 }}>
              <Tag color={successIsBasic ? "gold" : "green"} style={{ margin: 0 }}>
                {successIsBasic ? "基础解析" : "AI 已解析"}
              </Tag>
              <FileTextOutlined style={{ color: "#8c8c8c" }} />
              <div style={{ minWidth: 0 }}>
                <Text strong ellipsis style={{ display: "block" }}>
                  {status.filename}
                </Text>
                <Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
                  {resumeParseStatusMessage(parseStatus)}
                </Text>
              </div>
            </Flex>
            <Space>
              <Button size="small" onClick={onPick}>
                重新上传
              </Button>
              <Button size="small" type="text" onClick={onClear}>
                清除解析结果
              </Button>
            </Space>
          </Flex>
        </Card>
      </div>
    );
  }

  const isError = status.kind === "error";
  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        {label}
        {isError && (
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClear}>
            清除解析结果
          </Button>
        )}
      </Flex>
      <div
        role="button"
        tabIndex={0}
        onClick={onPick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          cursor: "pointer",
          textAlign: "center",
          padding: "28px 24px",
          borderRadius: 8,
          border: `2px dashed ${isDragging ? ACCENT : isError ? "#ffccc7" : "#d9d9d9"}`,
          background: isDragging ? "rgba(16,185,129,0.08)" : isError ? "#fff2f0" : "#fafafa",
          transition: "all .2s",
        }}
      >
        {status.kind === "idle" && (
          <>
            <InboxOutlined style={{ fontSize: 28, color: "#8c8c8c" }} />
            <div style={{ marginTop: 8 }}>
              <Text strong>拖拽简历到这里，或点击选择文件</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              支持 PDF / DOCX / TXT / Markdown，最大 5 MB
            </Text>
          </>
        )}
        {status.kind === "error" && (
          <>
            <CloseCircleOutlined style={{ fontSize: 28, color: "#ff4d4f" }} />
            <div style={{ marginTop: 8 }}>
              <Text strong>{status.filename} 解析失败</Text>
            </div>
            <div style={{ maxWidth: 480, margin: "4px auto" }}>
              <Text type="danger" style={{ fontSize: 12 }}>
                {status.message}
              </Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              你可以重试，或直接手动填写
            </Text>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: resume preview / manual fields
// ---------------------------------------------------------------------------

type PreviewTab = "summary" | "skills" | "highlights" | "projects" | "focus";

// 删除列表项后不能直接用“列表长度 + 1”生成 ID，否则会与仍存在的卡片重复。
function nextResumeItemId(prefix: "proj" | "focus", items: { id: string }[]): string {
  const existingIds = new Set(items.map((item) => item.id));
  let nextIndex = items.length + 1;
  while (existingIds.has(`${prefix}-${nextIndex}`)) nextIndex += 1;
  return `${prefix}-${nextIndex}`;
}

export function ResumePreviewCard({
  candidateProfile,
  summary,
  skills,
  highlights,
  projects,
  focusAreas,
  concerns,
  showHint,
  readOnly,
  summaryError,
  onChangeSummary,
  onChangeSkills,
  onChangeHighlights,
  onChangeProjects,
  onChangeFocusAreas,
}: {
  candidateProfile: ResumeCandidateProfile;
  summary: string;
  skills: string;
  highlights: string;
  projects: ResumeProject[];
  focusAreas: ResumeFocusArea[];
  concerns: string[];
  showHint: boolean;
  readOnly?: boolean;
  summaryError?: string;
  onChangeSummary: (v: string) => void;
  onChangeSkills: (v: string) => void;
  onChangeHighlights: (v: string) => void;
  onChangeProjects: (v: ResumeProject[]) => void;
  onChangeFocusAreas: (v: ResumeFocusArea[]) => void;
}) {
  const [tab, setTab] = useState<PreviewTab>("summary");
  const skillCount = splitCsv(skills).length;
  const highlightCount = splitCsv(highlights).filter(Boolean).length;
  const isEmpty =
    !summary && skillCount === 0 && highlightCount === 0 && projects.length === 0 && focusAreas.length === 0;
  const profileChips = resumeCandidateProfileChips(candidateProfile);

  function updateProject(idx: number, patch: Partial<ResumeProject>) {
    onChangeProjects(projects.map((project, i) => (i === idx ? { ...project, ...patch } : project)));
  }

  function addProject() {
    onChangeProjects([
      ...projects,
      {
        id: nextResumeItemId("proj", projects),
        name: "",
        role: "",
        tech_stack: [],
        responsibilities: [],
        achievements: [],
        question_anchors: [],
      },
    ]);
  }

  function updateFocus(idx: number, patch: Partial<ResumeFocusArea>) {
    onChangeFocusAreas(focusAreas.map((focus, i) => (i === idx ? { ...focus, ...patch } : focus)));
  }

  function addFocusArea() {
    onChangeFocusAreas([
      ...focusAreas,
      {
        id: nextResumeItemId("focus", focusAreas),
        label: "",
        project_id: null,
        dimensions: ["project_experience", "technical_depth"],
        skills: [],
        priority: focusAreas.length + 1,
      },
    ]);
  }

  return (
    <Card
      size="small"
      style={{ background: "#fafafa" }}
      title={
        <Space size={6}>
          <ThunderboltOutlined style={{ color: ACCENT }} />
          <span>{isEmpty ? "手动填写或上传简历" : "简历内容确认"}</span>
        </Space>
      }
      extra={
        <Space size={8}>
          {!isEmpty && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {projects.length} 个项目 · {focusAreas.length} 个重点
            </Text>
          )}
          {showHint && <Text style={{ fontSize: 12, color: ACCENT }}>已自动回填</Text>}
        </Space>
      }
    >
      {profileChips.length > 0 && (
        <Flex wrap="wrap" gap={6} style={{ marginBottom: 12 }}>
          {profileChips.map((chip) => (
            <Tag key={chip.label} style={{ margin: 0 }}>
              <Text strong style={{ fontSize: 11, marginRight: 4 }}>
                {chip.label}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {chip.value}
              </Text>
            </Tag>
          ))}
        </Flex>
      )}

      <Segmented<PreviewTab>
        block
        value={tab}
        onChange={(v) => setTab(v)}
        options={[
          { value: "summary", label: "概要" },
          { value: "skills", label: `技能 (${skillCount})` },
          { value: "highlights", label: `亮点 (${highlightCount})` },
          { value: "projects", label: `项目 (${projects.length})` },
          { value: "focus", label: `重点 (${focusAreas.length})` },
        ]}
        style={{ marginBottom: 12 }}
      />

      {tab === "summary" && (
        <div>
          <Input.TextArea
            rows={4}
            maxLength={CANDIDATE_SUMMARY_MAX_LENGTH}
            value={summary}
            onChange={(e) => onChangeSummary(e.target.value)}
            disabled={readOnly}
            status={summaryError ? "error" : undefined}
            placeholder="一句话概述你的经验、领域和优势。例如：5 年后端经验，专注支付与消息系统，主导过…"
            style={{ resize: "none" }}
          />
          {summaryError && (
            <Text type="danger" style={{ fontSize: 12 }}>
              {summaryError}
            </Text>
          )}
        </div>
      )}
      {tab === "skills" && (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Input
            value={skills}
            onChange={(e) => onChangeSkills(e.target.value)}
            disabled={readOnly}
            maxLength={CANDIDATE_SKILLS_MAX_COUNT * (CANDIDATE_SKILL_MAX_LENGTH + 2)}
            placeholder="例如：React, TypeScript, Next.js"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            用逗号分隔多个技能，最多 40 项。AI 会用这些技能匹配题库和评分标准。
          </Text>
          {skillCount > 0 && (
            <Flex wrap="wrap" gap={6}>
              {splitCsv(skills).map((s) => (
                <Tag key={s} color="green" style={{ margin: 0 }}>
                  {s}
                </Tag>
              ))}
            </Flex>
          )}
        </Space>
      )}
      {tab === "highlights" && (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Input.TextArea
            rows={4}
            maxLength={CANDIDATE_HIGHLIGHTS_MAX_COUNT * CANDIDATE_HIGHLIGHT_MAX_LENGTH}
            value={highlights}
            onChange={(e) => onChangeHighlights(e.target.value)}
            disabled={readOnly}
            placeholder="每行一条经历。建议带具体成果：例如「将首屏加载从 3.2s 优化到 0.9s」"
            style={{ resize: "none" }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            亮点会作为 AI 出题的素材。可以是项目、成果、影响范围。
          </Text>
        </Space>
      )}
      {tab === "projects" && (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            AI 会优先围绕这些项目追问，最多 12 个项目。你可以把项目名、技术栈和可追问点改得更准确。
          </Text>
          {projects.map((project, idx) => (
            <Card key={project.id || idx} size="small">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Flex gap={8} align="center">
                  <Input
                    value={project.name}
                    onChange={(e) => updateProject(idx, { name: e.target.value })}
                    disabled={readOnly}
                    maxLength={RESUME_PROJECT_NAME_MAX_LENGTH}
                    placeholder="项目名称，例如：支付系统迁移"
                  />
                  <Button
                    type="text"
                    icon={<CloseOutlined />}
                    disabled={readOnly}
                    onClick={() => onChangeProjects(projects.filter((_, i) => i !== idx))}
                    aria-label="删除项目"
                  />
                </Flex>
                <Input
                  value={project.role ?? ""}
                  onChange={(e) => updateProject(idx, { role: e.target.value })}
                  disabled={readOnly}
                  maxLength={RESUME_PROJECT_ROLE_MAX_LENGTH}
                  placeholder="你的角色，例如：负责人 / 核心开发"
                />
                <Input
                  value={joinCsv(project.tech_stack ?? [])}
                  onChange={(e) => updateProject(idx, { tech_stack: splitCsv(e.target.value) })}
                  disabled={readOnly}
                  maxLength={CANDIDATE_SKILLS_MAX_COUNT * (CANDIDATE_SKILL_MAX_LENGTH + 2)}
                  placeholder="技术栈，用逗号分隔，例如：Java, Kafka, Redis"
                />
                <Input.TextArea
                  rows={2}
                  value={(project.question_anchors ?? []).join("\n")}
                  onChange={(e) => updateProject(idx, { question_anchors: splitCsv(e.target.value) })}
                  disabled={readOnly}
                  maxLength={RESUME_PROJECT_ANCHOR_MAX_COUNT * RESUME_PROJECT_ANCHOR_MAX_LENGTH}
                  placeholder="建议追问点，每行一条，例如：一致性、性能优化、故障恢复"
                  style={{ resize: "none" }}
                />
              </Space>
            </Card>
          ))}
          <Button
            size="small"
            onClick={addProject}
            disabled={readOnly || projects.length >= RESUME_PROJECTS_MAX_COUNT}
          >
            添加项目
          </Button>
        </Space>
      )}
      {tab === "focus" && (
        <div className={styles.focusSection}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            这些是 AI 从简历项目里整理出的考察重点，最多 20 个重点。留空也可以，系统会按方向和 JD 兜底。
          </Text>
          {/* 网格使用 minmax(0, 1fr)，长标题和技能标签不会把卡片撑出容器。 */}
          <div className={styles.focusGrid}>
            {focusAreas.map((focus, idx) => (
              <Card key={focus.id || idx} size="small" className={styles.focusCard}>
                <div className={styles.focusHeader}>
                  <Text strong>考察重点 {idx + 1}</Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    disabled={readOnly}
                    onClick={() => onChangeFocusAreas(focusAreas.filter((_, i) => i !== idx))}
                    aria-label={`删除重点 ${idx + 1}`}
                    className={styles.focusDelete}
                  />
                </div>
                <div className={styles.focusField}>
                  <Text type="secondary" className={styles.focusLabel}>重点内容</Text>
                  <Input.TextArea
                    value={focus.label}
                    onChange={(e) => updateFocus(idx, { label: e.target.value })}
                    disabled={readOnly}
                    maxLength={RESUME_FOCUS_LABEL_MAX_LENGTH}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder="例如：支付迁移中的幂等和一致性"
                    aria-label={`重点 ${idx + 1} 内容`}
                    className={styles.focusInput}
                  />
                </div>
                <div className={styles.focusField}>
                  <Text type="secondary" className={styles.focusLabel}>关联技能</Text>
                  {/* 标签输入保留正在编辑的文字，避免 split/join 回显立即吞掉逗号。 */}
                  <Select<string[]>
                    mode="tags"
                    value={focus.skills ?? []}
                    onChange={(skills) => updateFocus(idx, {
                      skills: skills
                        .map((skill) => skill.trim().slice(0, CANDIDATE_SKILL_MAX_LENGTH))
                        .filter(Boolean)
                        .slice(0, CANDIDATE_SKILLS_MAX_COUNT),
                    })}
                    tokenSeparators={[",", "，", "\n"]}
                    maxCount={CANDIDATE_SKILLS_MAX_COUNT}
                    disabled={readOnly}
                    placeholder="输入技能后按回车或逗号确认"
                    aria-label={`重点 ${idx + 1} 关联技能`}
                    className={styles.focusSkills}
                  />
                  <Text type="secondary" className={styles.focusHelp}>
                    支持多个技能；按回车或输入逗号添加。
                  </Text>
                </div>
              </Card>
            ))}
          </div>
          <Button
            size="small"
            onClick={addFocusArea}
            disabled={readOnly || focusAreas.length >= RESUME_FOCUS_AREAS_MAX_COUNT}
          >
            添加重点
          </Button>
          {concerns.length > 0 && (
            <Alert
              type="warning"
              message="可能会先确认"
              description={
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12 }}>
                  {concerns.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              }
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2 helpers
// ---------------------------------------------------------------------------

export function ResumeFocusSummary({
  focusAreas,
  direction,
}: {
  focusAreas: ResumeFocusArea[];
  direction: SetupDirection;
}) {
  const visible = normaliseFocusAreas(focusAreas).slice(0, 6);
  if (visible.length === 0) {
    return (
      <div style={{ border: "1px solid #f0f0f0", background: "#fafafa", borderRadius: 6, padding: "8px 12px" }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          还没有从简历中提取到明确项目重点。AI 会先按「{direction.label}」方向考察，
          并结合岗位描述和本地题库补充基础题。
        </Text>
        <Flex wrap="wrap" gap={6} style={{ marginTop: 8 }}>
          {direction.skills.slice(0, 6).map((skill) => (
            <Tag key={skill} style={{ margin: 0, fontSize: 11 }}>
              {skill}
            </Tag>
          ))}
        </Flex>
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid rgba(16,185,129,0.25)",
        background: "rgba(16,185,129,0.05)",
        borderRadius: 6,
        padding: "8px 12px",
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          已根据简历项目生成重点。面试会优先从这些经历切入，基础题和算法题会作为补充。
        </Text>
      </div>
      <Flex wrap="wrap" gap={6}>
        {visible.map((focus) => (
          <Tag key={focus.id} color="green" style={{ margin: 0, fontSize: 11 }}>
            {focus.label}
          </Tag>
        ))}
      </Flex>
    </div>
  );
}

export function JdHint({ status, onRetry }: { status: JdStatus; onRetry: () => void }) {
  if (status.kind === "idle") {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        粘贴 JD 后，AI 会自动识别考察重点
      </Text>
    );
  }
  if (status.kind === "parsing") {
    return (
      <Space size={4} style={{ fontSize: 12, color: ACCENT }}>
        <LoadingOutlined spin />
        分析中…
      </Space>
    );
  }
  if (status.kind === "success") {
    return (
      <Space size={4} style={{ fontSize: 12, color: ACCENT }}>
        <ThunderboltOutlined />
        已识别考察重点
      </Space>
    );
  }
  return (
    <Space size={8} wrap>
      <Text type="danger" style={{ fontSize: 12 }}>
        JD 分析失败，仍可继续使用默认考察维度：{status.message}
      </Text>
      <Button size="small" danger onClick={onRetry}>
        重试
      </Button>
    </Space>
  );
}

export function DimensionPicker({
  selected,
  catalog,
  onToggle,
  onRemove,
}: {
  selected: DimensionOption[];
  catalog: DimensionOption[];
  onToggle: (option: DimensionOption) => void;
  onRemove: (id: string) => void;
}) {
  const selectedIds = new Set(selected.map((d) => d.id));
  const inactive = catalog.filter((d) => !selectedIds.has(d.id));

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Flex wrap="wrap" gap={8} align="center">
        {selected.length === 0 ? (
          <Text type="secondary">尚未选择考察维度，至少保留一项</Text>
        ) : (
          selected.map((d) => (
            <Tag
              key={d.id}
              color="green"
              closable
              onClose={(e) => {
                e.preventDefault();
                onRemove(d.id);
              }}
              style={{ margin: 0, padding: "2px 10px", borderRadius: 999, cursor: "pointer" }}
              onClick={() => onRemove(d.id)}
            >
              {d.label}
            </Tag>
          ))
        )}
      </Flex>

      {inactive.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            点击添加：
          </Text>
          <Flex wrap="wrap" gap={8} style={{ marginTop: 6 }}>
            {inactive.map((d) => (
              <Button
                key={d.id}
                size="small"
                shape="round"
                onClick={() => onToggle(d)}
                disabled={selected.length >= 5}
              >
                + {d.label}
              </Button>
            ))}
          </Flex>
          {selected.length >= 5 && (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
              最多 5 项考察维度
            </Text>
          )}
        </div>
      )}
    </Space>
  );
}

export function LengthPicker({ value, onChange }: { value: LengthId; onChange: (v: LengthId) => void }) {
  return (
    <Row gutter={12} role="radiogroup" aria-label="面试深度选择">
      {LENGTH_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <Col span={8} key={opt.id}>
            <Card
              size="small"
              hoverable
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              id={`length-picker-${opt.id}`}
              style={{ ...selectableCardStyle(active), borderWidth: 2 }}
              onClick={() => onChange(opt.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const idx = LENGTH_OPTIONS.findIndex((o) => o.id === opt.id);
                  const nextIdx = (idx + 1) % LENGTH_OPTIONS.length;
                  onChange(LENGTH_OPTIONS[nextIdx].id);
                  document.getElementById(`length-picker-${LENGTH_OPTIONS[nextIdx].id}`)?.focus();
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const idx = LENGTH_OPTIONS.findIndex((o) => o.id === opt.id);
                  const nextIdx = (idx - 1 + LENGTH_OPTIONS.length) % LENGTH_OPTIONS.length;
                  onChange(LENGTH_OPTIONS[nextIdx].id);
                  document.getElementById(`length-picker-${LENGTH_OPTIONS[nextIdx].id}`)?.focus();
                }
              }}
            >
              <Text strong style={{ fontSize: 15, color: active ? ACCENT : undefined, display: "block" }}>
                {opt.label}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {opt.desc}
              </Text>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Advanced panel
// ---------------------------------------------------------------------------

export type AdvancedField = "max_turns_override" | "quality_threshold" | "turn_budget_override";
export type Focusable = { focus: () => void };

export function AdvancedPanel({
  open,
  onToggle,
  values,
  errors,
  onChange,
  inputRef,
}: {
  open: boolean;
  onToggle: () => void;
  values: Record<AdvancedField, string>;
  errors: Partial<Record<AdvancedField, string>>;
  onChange: (field: AdvancedField, value: string) => void;
  inputRef: (field: AdvancedField) => (el: Focusable | null) => void;
}) {
  function fieldError(field: AdvancedField) {
    const error = errors[field];
    return error ? (
      <Text id={`${field}-error`} type="danger" style={{ fontSize: 12 }}>
        {error}
      </Text>
    ) : null;
  }

  return (
    <Collapse
      activeKey={open ? ["advanced"] : []}
      onChange={onToggle}
      items={[
        {
          key: "advanced",
          label: (
            <Text type="secondary">
              高级选项<span style={{ fontSize: 12 }}>（开发者用，正常情况无需修改）</span>
            </Text>
          ),
          children: (
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Text>最大轮数（覆盖深度预设）</Text>
                  <Input
                    ref={inputRef("max_turns_override")}
                    type="number"
                    min={1}
                    max={20}
                    placeholder="留空则按深度预设"
                    value={values.max_turns_override}
                    status={errors.max_turns_override ? "error" : undefined}
                    aria-invalid={Boolean(errors.max_turns_override)}
                    onChange={(e) => onChange("max_turns_override", e.target.value)}
                  />
                  {fieldError("max_turns_override")}
                </Space>
              </Col>
              <Col xs={24} md={8}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Text>通过阈值 (0-10)</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    判定本场面试&quot;达标&quot;的目标分数；高于此分会显示&quot;达到目标水平&quot;。
                  </Text>
                  <Input
                    ref={inputRef("quality_threshold")}
                    type="number"
                    step="0.1"
                    min={0}
                    max={10}
                    value={values.quality_threshold}
                    status={errors.quality_threshold ? "error" : undefined}
                    aria-invalid={Boolean(errors.quality_threshold)}
                    onChange={(e) => onChange("quality_threshold", e.target.value)}
                  />
                  {fieldError("quality_threshold")}
                </Space>
              </Col>
              <Col xs={24} md={8}>
                <Space direction="vertical" size={4} style={{ width: "100%" }}>
                  <Text>总轮次预算（含追问）</Text>
                  <Input
                    ref={inputRef("turn_budget_override")}
                    type="number"
                    min={1}
                    max={30}
                    placeholder="默认 = 最大轮数 + 2"
                    value={values.turn_budget_override}
                    status={errors.turn_budget_override ? "error" : undefined}
                    aria-invalid={Boolean(errors.turn_budget_override)}
                    onChange={(e) => onChange("turn_budget_override", e.target.value)}
                  />
                  {fieldError("turn_budget_override")}
                </Space>
              </Col>
            </Row>
          ),
        },
      ]}
    />
  );
}
