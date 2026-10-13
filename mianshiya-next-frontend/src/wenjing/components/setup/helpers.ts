import { ApiError } from "@/wenjing/lib/api/client";
import { userStorage } from "@/wenjing/lib/storage/userStorage";
import type {
  ParseResumeResponse,
  ParseResumeStatus,
  ResumeCandidateProfile,
  ResumeFocusArea,
  ResumeParseJobResponse,
  ResumeProject,
  SessionSetupSnapshotResponse,
} from "@/wenjing/lib/api/types";
import type { ResumeSetupSnapshot } from "@/wenjing/lib/storage/interviewHistory";
import type { SetupDraftStatus } from "@/wenjing/lib/storage/setupDrafts";
import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  CANDIDATE_SUMMARY_MAX_LENGTH,
  ERROR_FIELD_PRIORITY,
  FIELD_LABEL,
  FIELD_STEP,
  JOB_LEVEL_VALUES,
  LENGTH_VALUES,
  type FieldName,
  type FormValues,
  type JobLevel,
  type ParsedFormValues,
  type UploadStatus,
} from "./constants";

export type FormErrors = Partial<Record<FieldName, string>>;

export function splitCsv(s: string): string[] {
  return s
    .split(/[\n,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function joinCsv(items: string[]): string {
  return items.join(", ");
}

// ---------------------------------------------------------------------------
// 校验：逐条复刻上游 zod schema 的规则与提示文案
// ---------------------------------------------------------------------------

const ZOD_MIN_1_MESSAGE = "String must contain at least 1 character(s)";

function optionalInteger(
  raw: string,
  min: number,
  max: number,
  message: string,
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (raw === "") return { ok: true, value: undefined };
  const value = Number(raw);
  if (Number.isNaN(value) || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, message };
  }
  return { ok: true, value };
}

function numberWithDefault(
  raw: string,
  defaultValue: number,
  min: number,
  max: number,
  message: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = raw === "" ? defaultValue : Number(raw);
  if (Number.isNaN(value) || value < min || value > max) {
    return { ok: false, message };
  }
  return { ok: true, value };
}

export function validateForm(values: FormValues): {
  errors: FormErrors;
  parsed: ParsedFormValues | null;
} {
  const errors: FormErrors = {};
  if (values.interview_industry.length < 1) errors.interview_industry = ZOD_MIN_1_MESSAGE;
  if (values.interview_direction.length < 1) errors.interview_direction = ZOD_MIN_1_MESSAGE;

  const candidateName = values.candidate_name.trim();
  if (candidateName.length < 1) errors.candidate_name = "请填写称呼";
  if (values.candidate_summary.length > CANDIDATE_SUMMARY_MAX_LENGTH) {
    errors.candidate_summary = "简历概要太长，请精简到 1200 字以内";
  }

  const jobTitle = values.job_title.trim();
  if (jobTitle.length < 1) errors.job_title = "请填写岗位名称";
  if (!JOB_LEVEL_VALUES.includes(values.job_level)) {
    errors.job_level = "Invalid enum value";
  }
  if (values.job_description.length > 50000) {
    errors.job_description = "JD 过长，请精简后再试";
  }
  if (!LENGTH_VALUES.includes(values.length)) {
    errors.length = "Invalid enum value";
  }

  const maxTurns = optionalInteger(values.max_turns_override, 1, 20, "请输入 1-20 的整数");
  if (!maxTurns.ok) errors.max_turns_override = maxTurns.message;
  const quality = numberWithDefault(values.quality_threshold, 7, 0, 10, "请输入 0-10 的数字");
  if (!quality.ok) errors.quality_threshold = quality.message;
  const turnBudget = optionalInteger(values.turn_budget_override, 1, 30, "请输入 1-30 的整数");
  if (!turnBudget.ok) errors.turn_budget_override = turnBudget.message;

  if (Object.keys(errors).length > 0 || !maxTurns.ok || !quality.ok || !turnBudget.ok) {
    return { errors, parsed: null };
  }
  return {
    errors,
    parsed: {
      interview_industry: values.interview_industry,
      interview_direction: values.interview_direction,
      candidate_name: candidateName,
      candidate_summary: values.candidate_summary,
      candidate_skills: values.candidate_skills,
      candidate_highlights: values.candidate_highlights,
      job_title: jobTitle,
      job_level: values.job_level,
      job_description: values.job_description,
      length: values.length,
      max_turns_override: maxTurns.value,
      quality_threshold: quality.value,
      turn_budget_override: turnBudget.value,
    },
  };
}

export function firstFormError(
  formErrors: FormErrors,
): { field: FieldName; message: string; step: number } | null {
  const firstKey =
    ERROR_FIELD_PRIORITY.find((key) => Boolean(formErrors[key])) ??
    (Object.keys(formErrors)[0] as FieldName | undefined);
  if (!firstKey) return null;

  const error = formErrors[firstKey];
  const label = FIELD_LABEL[firstKey] ?? "必填信息";
  const message = typeof error === "string" ? error : `请先补全${label}`;
  return {
    field: firstKey,
    message,
    step: FIELD_STEP[firstKey] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Local helpers（与上游一致）
// ---------------------------------------------------------------------------

export function isAcceptedResumeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const hasAcceptedExtension = ACCEPTED_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
  return hasAcceptedExtension || ACCEPTED_MIME_TYPES.has(file.type);
}

export function safeSessionGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return userStorage("session")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSessionSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    userStorage("session")?.setItem(key, value);
  } catch {
    /* Storage can be unavailable in private mode; never block the form. */
  }
}

export function safeSessionRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    userStorage("session")?.removeItem(key);
  } catch {
    /* ignore storage cleanup failures */
  }
}

export function normaliseProjects(projects?: ResumeProject[]): ResumeProject[] {
  return (projects ?? [])
    .filter((project) => project.name?.trim())
    .map((project, idx) => ({
      ...project,
      id: project.id || `proj-${idx + 1}`,
      name: project.name.trim(),
      role: project.role?.trim() || undefined,
      tech_stack: project.tech_stack ?? [],
      responsibilities: project.responsibilities ?? [],
      achievements: project.achievements ?? [],
      question_anchors: project.question_anchors ?? [],
    }));
}

export function normaliseFocusAreas(focusAreas?: ResumeFocusArea[]): ResumeFocusArea[] {
  return (focusAreas ?? [])
    .filter((focus) => focus.label?.trim())
    .map((focus, idx) => ({
      ...focus,
      id: focus.id || `focus-${idx + 1}`,
      label: focus.label.trim(),
      project_id: focus.project_id ?? null,
      dimensions: focus.dimensions ?? [],
      skills: focus.skills ?? [],
      priority: focus.priority ?? idx + 1,
    }));
}

export function resumeSetupSnapshotFromSession(
  response: SessionSetupSnapshotResponse,
): ResumeSetupSnapshot {
  const parsed = response.candidate.resume_parsed ?? {};
  return {
    candidate_name: response.candidate.name,
    candidate_summary: parsed.summary ?? "",
    candidate_skills: joinCsv(parsed.skills ?? []),
    candidate_highlights: (parsed.highlights ?? []).join("\n"),
    resumeProjects: parsed.projects as unknown as Record<string, unknown>[] | undefined,
    resumeFocusAreas: parsed.focus_areas as unknown as Record<string, unknown>[] | undefined,
    resumeConcerns: parsed.concerns ?? [],
    resumeCandidateProfile: (parsed.candidate_profile ?? {}) as unknown as Record<
      string,
      unknown
    >,
    resumeParseAudit: response.candidate.resume_parse_audit as unknown as
      | Record<string, unknown>
      | undefined,
  };
}

export function asJobLevel(value: string | undefined): JobLevel | null {
  return JOB_LEVEL_VALUES.includes(value as JobLevel) ? (value as JobLevel) : null;
}

export function createSetupDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function uploadDraftId(status: UploadStatus): string | undefined {
  return status.kind === "idle" ? undefined : status.draftId;
}

export function setupDraftStatusFromResult(result: ParseResumeResponse): SetupDraftStatus {
  return result.parse_status?.mode === "basic" ? "basic_ready" : "ready";
}

export function setupDraftStatusFromJob(job: ResumeParseJobResponse): SetupDraftStatus {
  if (job.status === "expired") return "expired";
  if (job.status === "failed") return "failed";
  if (job.status === "completed" && job.result) {
    return setupDraftStatusFromResult(job.result);
  }
  return "parsing";
}

export function friendlyResumeUploadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("timeout") || lower.includes("aborterror") || lower.includes("timed out")) {
    return "简历解析等太久了。可以再试一次；如果还是超时，也可以直接手动填写，后续面试仍可继续。";
  }
  if (lower.includes("scanned") || lower.includes("extract any text")) {
    return "这份文件没有提取到文字。如果是扫描版 PDF，建议上传 DOCX/Markdown，或把简历文本粘贴进来。";
  }
  if (lower.includes("too large") || lower.includes("文件过大")) {
    return "文件超过 5MB，请压缩、裁剪，或换成文本版简历后再上传。";
  }
  if (lower.includes("unsupported")) {
    return "暂时只支持 PDF / DOCX / TXT / Markdown。可以换个格式再试。";
  }
  return friendlySetupError(err, "resume");
}

export function friendlySetupError(
  err: unknown,
  context: "resume" | "jd" | "start" | "general" = "general",
): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiError) {
    if (err.status === 413) {
      return "文件超过大小限制，请压缩、裁剪，或换成文本版后再试。";
    }
    if (err.status === 415) {
      return "文件格式暂不支持，请上传 PDF / DOCX / TXT / Markdown。";
    }
    if (err.status === 409) {
      return "这场面试的会话标识已存在，请重新开始一次。";
    }
    if (err.status === 422) {
      return context === "jd"
        ? "岗位要求暂时无法自动分析，仍可继续使用默认考察维度。"
        : "有字段内容超出范围或格式不正确，请检查高亮提示后再试。";
    }
    if (err.status >= 500) {
      return "服务端暂时无法处理请求，请稍后重试；已填写内容不会丢失。";
    }
  }
  if (context === "resume") {
    return raw || "简历解析失败了。你可以重试，或直接手动填写。";
  }
  if (context === "jd") {
    return raw || "JD 分析失败，仍可继续使用默认考察维度。";
  }
  if (context === "start") {
    return raw || "暂时无法开始面试，请稍后重试。";
  }
  return raw || "操作失败，请稍后重试。";
}

export function resumeParseStatusMessage(status?: ParseResumeStatus): string {
  if (!status) return "已更新简历内容确认区";
  if (status.cached) {
    return "已使用上次解析结果，可继续检查和微调";
  }
  if (status.mode === "ai_refined") {
    return "已生成概要、技能、项目和面试重点";
  }
  if (status.reason === "timeout") {
    return "已先完成基础整理，可继续检查和微调";
  }
  if (status.reason === "llm_failed") {
    return "已先完成基础整理，智能补全暂时未完成";
  }
  if (status.reason === "stub_mode") {
    return "已生成可编辑的基础简历信息";
  }
  return "已生成可编辑的基础简历信息";
}

export function resumeCandidateProfileChips(profile: ResumeCandidateProfile) {
  const chips: Array<{ label: string; value: string }> = [];
  if (profile.education_level) {
    chips.push({ label: "学历", value: profile.education_level });
  }
  if (profile.school) {
    chips.push({ label: "学校", value: profile.school });
  }
  if (profile.major) {
    chips.push({ label: "专业", value: profile.major });
  }
  if (typeof profile.experience_years === "number") {
    chips.push({ label: "经验", value: `${profile.experience_years} 年` });
  }
  if (profile.current_or_target_role) {
    chips.push({ label: "方向", value: profile.current_or_target_role });
  }
  if (profile.fresh_graduate) {
    chips.push({ label: "阶段", value: "应届/在读" });
  }
  if (profile.graduation_year) {
    chips.push({ label: "毕业", value: `${profile.graduation_year} 届` });
  }
  if (profile.age) {
    chips.push({ label: "年龄", value: `${profile.age} 岁` });
  }
  return chips;
}
