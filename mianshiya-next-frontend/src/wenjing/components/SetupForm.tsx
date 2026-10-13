"use client";

/**
 * 面试设置流程（移植自上游 components/interview/SetupForm.tsx）。
 *
 * 数据流、状态机、localStorage/sessionStorage 写入、校验与请求顺序与上游保持一致；
 * UI 改用 Ant Design。登录态恒为已登录（AuthGate），因此去掉了游客提示、额度/次数、
 * 自带模型 Key（LLM 设置）以及视频分析开关。
 */
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Flex, Form, Input, Modal, Select, Space, Spin, Typography } from "antd";
import {
  AimOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  SolutionOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  createResumeParseJob,
  getJobTemplate,
  getResumeParseJob,
  getSessionSetupSnapshot,
  listDimensions,
  listDirections,
  parseJobSpec,
  startSession,
} from "@/wenjing/lib/api/interview";
import { jobTemplateAutofillValue } from "@/wenjing/lib/job-template";
import {
  candidateNameAutofillValue,
  createResumeParseJobForSetup,
  resumeJobAutofillValues,
  resumeParsedForSession,
  resumeReuploadInputValue,
  resumeSourceIdForSession,
  resumeSourceRefFromParseResult,
  type ResumeSourceRef,
} from "@/wenjing/lib/resume-upload";
import type {
  DimensionOption,
  ParseJobSpecResponse,
  ParseResumeResponse,
  ResumeCandidateProfile,
  ResumeFocusArea,
  ResumeParseAudit,
  ResumeParseJobResponse,
  ResumeProject,
  SessionSetupSnapshotResponse,
  StartSessionRequest,
} from "@/wenjing/lib/api/types";
import { buildLLMPayload } from "@/wenjing/lib/llm-config";
import {
  getResumeSetupSnapshot,
  upsertEntry,
  type ResumeSetupSnapshot,
} from "@/wenjing/lib/storage/interviewHistory";
import { getSetupDraft, removeSetupDraft, upsertSetupDraft } from "@/wenjing/lib/storage/setupDrafts";
import {
  ACCEPTED_TYPES,
  ADVANCED_FIELD_NAMES,
  DEFAULTS,
  DEFAULT_DIMENSIONS,
  FIELD_LABEL,
  INTERNET_DIRECTIONS,
  JOB_LEVEL_OPTIONS,
  LENGTH_OPTIONS,
  LENGTH_VALUES,
  MAX_UPLOAD_BYTES,
  RESUME_DRAFT_KEY,
  START_INTERVIEW_PREFETCH_SESSION_ID,
  STEP_FIELDS,
  STEP_LABELS,
  directionById,
  directionByIdFrom,
  setupDirectionFromApi,
  type DirectionId,
  type FieldName,
  type FormValues,
  type JdStatus,
  type JobLevel,
  type ParsedFormValues,
  type SetupDirection,
  type UploadStatus,
} from "@/wenjing/components/setup/constants";
import {
  asJobLevel,
  createSetupDraftId,
  firstFormError,
  friendlyResumeUploadError,
  friendlySetupError,
  isAcceptedResumeFile,
  joinCsv,
  normaliseFocusAreas,
  normaliseProjects,
  resumeSetupSnapshotFromSession,
  safeSessionGetItem,
  safeSessionRemoveItem,
  safeSessionSetItem,
  setupDraftStatusFromJob,
  setupDraftStatusFromResult,
  splitCsv,
  uploadDraftId,
  validateForm,
  type FormErrors,
} from "@/wenjing/components/setup/helpers";
import {
  AdvancedPanel,
  DimensionPicker,
  DirectionStep,
  ExpectationBanner,
  JdHint,
  LengthPicker,
  ResumeFocusSummary,
  ResumePreviewCard,
  ResumeUploader,
  StepIndicator,
  type AdvancedField,
  type Focusable,
} from "@/wenjing/components/setup/components";

const { Text } = Typography;
const ACCENT = "#10b981";

type SetValueOptions = { shouldValidate?: boolean };

export default function SetupForm() {
  return (
    <Suspense
      fallback={
        <Flex justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      }
    >
      <SetupFormInner />
    </Suspense>
  );
}

function SetupFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdFromQuery = searchParams.get("draft_id");
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverDirections, setServerDirections] = useState<SetupDirection[]>([]);
  const [isInterviewStartPending, setInterviewStartPending] = useState(false);

  // ---- 表单状态（替代上游 react-hook-form + zod） --------------------------
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const valuesRef = useRef<FormValues>(DEFAULTS);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const fieldRefs = useRef<Partial<Record<FieldName, Focusable | null>>>({});

  const getValues = useCallback(<K extends FieldName>(name: K): FormValues[K] => {
    return valuesRef.current[name];
  }, []);

  const trigger = useCallback(async (fields: FieldName[]): Promise<boolean> => {
    const result = validateForm(valuesRef.current);
    setErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const message = result.errors[field];
        if (message) next[field] = message;
        else delete next[field];
      }
      return next;
    });
    return fields.every((field) => !result.errors[field]);
  }, []);

  const setValue = useCallback(
    <K extends FieldName>(name: K, value: FormValues[K], options?: SetValueOptions) => {
      const next = { ...valuesRef.current, [name]: value };
      valuesRef.current = next;
      setValues(next);
      if (options?.shouldValidate) void trigger([name]);
    },
    [trigger],
  );

  /** 用户输入：提交过一次后按 onChange 重新校验（等同 rhf reValidateMode）。 */
  const changeField = useCallback(
    <K extends FieldName>(name: K, value: FormValues[K]) => {
      setValue(name, value, { shouldValidate: submittedRef.current });
    },
    [setValue],
  );

  const setFocus = useCallback((field: FieldName) => {
    fieldRefs.current[field]?.focus();
  }, []);

  const fieldRef = useCallback(
    (field: FieldName) => (el: Focusable | null) => {
      fieldRefs.current[field] = el;
    },
    [],
  );

  // Resume upload state
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [resumeProjects, setResumeProjects] = useState<ResumeProject[]>([]);
  const [resumeFocusAreas, setResumeFocusAreas] = useState<ResumeFocusArea[]>([]);
  const [resumeConcerns, setResumeConcerns] = useState<string[]>([]);
  const [resumeCandidateProfile, setResumeCandidateProfile] = useState<ResumeCandidateProfile>({});
  const [resumeParseAudit, setResumeParseAudit] = useState<ResumeParseAudit | null>(null);
  const [resumeSource, setResumeSource] = useState<ResumeSourceRef | null>(null);
  const [candidateNameFromResume, setCandidateNameFromResume] = useState(false);
  const [jobTitleFromResume, setJobTitleFromResume] = useState(false);
  const [jobLevelFromResume, setJobLevelFromResume] = useState(false);
  const [jobTitleEdited, setJobTitleEdited] = useState(false);
  const [jobLevelEdited, setJobLevelEdited] = useState(false);
  const jobTitleEditedRef = useRef(false);
  const jobLevelEditedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadRequestRef = useRef(0);
  const restoredDraftRef = useRef<string | null>(null);
  const restoredResumeFromRef = useRef<string | null>(null);

  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const draft = safeSessionGetItem(RESUME_DRAFT_KEY);
    if (draft && upload.kind === "idle") {
      setHasDraft(true);
    }
  }, [upload.kind]);

  // JD parse state
  const [jdStatus, setJdStatus] = useState<JdStatus>({ kind: "idle" });
  const jdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jdTemplateRequestRef = useRef(0);
  const jdUserEditedRef = useRef(false);
  const practiceFocusAppliedRef = useRef(false);
  const [allDimensions, setAllDimensions] = useState<DimensionOption[]>([]);
  const [selectedDims, setSelectedDims] = useState<DimensionOption[]>(
    () => directionById(DEFAULTS.interview_direction).dimensions,
  );
  const [practiceFocusDims, setPracticeFocusDims] = useState<DimensionOption[]>([]);
  // Required skills inferred by the JD parser. Kept separate from
  // candidate skills so the rubric reflects what the *role* demands,
  // not what the candidate has.
  const [jdRequiredSkills, setJdRequiredSkills] = useState<string[]>([]);

  // Advanced panel toggle
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const directionOptions = serverDirections.length > 0 ? serverDirections : INTERNET_DIRECTIONS;
  const resolveDirection = useCallback(
    (id: DirectionId) => directionByIdFrom(directionOptions, id),
    [directionOptions],
  );

  const watchedSummary = values.candidate_summary;
  const watchedSkills = values.candidate_skills;
  const watchedHighlights = values.candidate_highlights;
  const resumeFieldsLocked = upload.kind === "parsing";
  const isStartingInterview = isSubmitting || isInterviewStartPending;

  useEffect(() => {
    if (step === STEP_LABELS.length - 1) {
      router.prefetch(`/interview/${START_INTERVIEW_PREFETCH_SESSION_ID}`);
    }
  }, [router, step]);

  useEffect(() => {
    if (!isStartingInterview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isStartingInterview]);

  useEffect(() => {
    jobTitleEditedRef.current = jobTitleEdited;
  }, [jobTitleEdited]);

  useEffect(() => {
    jobLevelEditedRef.current = jobLevelEdited;
  }, [jobLevelEdited]);

  const applyResumeSetupSnapshot = useCallback(
    (snapshot: ResumeSetupSnapshot) => {
      if (snapshot.candidate_name) {
        setValue("candidate_name", snapshot.candidate_name, { shouldValidate: true });
        setCandidateNameFromResume(true);
      }
      if (snapshot.candidate_summary !== undefined) {
        setValue("candidate_summary", snapshot.candidate_summary, { shouldValidate: true });
      }
      if (snapshot.candidate_skills !== undefined) {
        setValue("candidate_skills", snapshot.candidate_skills, { shouldValidate: true });
      }
      if (snapshot.candidate_highlights !== undefined) {
        setValue("candidate_highlights", snapshot.candidate_highlights, { shouldValidate: true });
      }
      setResumeProjects(normaliseProjects(snapshot.resumeProjects as ResumeProject[] | undefined));
      setResumeFocusAreas(normaliseFocusAreas(snapshot.resumeFocusAreas as ResumeFocusArea[] | undefined));
      setResumeConcerns(snapshot.resumeConcerns ?? []);
      setResumeCandidateProfile(
        (snapshot.resumeCandidateProfile as ResumeCandidateProfile | undefined) ?? {},
      );
      setResumeParseAudit((snapshot.resumeParseAudit as ResumeParseAudit | undefined) ?? null);
      setUpload({
        kind: "success",
        filename: "已沿用上一场简历解析结果",
      });
      setHasDraft(false);
    },
    [setValue],
  );

  const applySessionSetupSnapshot = useCallback(
    (response: SessionSetupSnapshotResponse) => {
      applyResumeSetupSnapshot(resumeSetupSnapshotFromSession(response));

      const { job_spec: jobSpec } = response;
      const title = jobSpec.title?.trim();
      if (title && !jobTitleEditedRef.current) {
        setValue("job_title", title, { shouldValidate: true });
        setJobTitleFromResume(false);
      }

      const level = asJobLevel(jobSpec.level);
      if (level && !jobLevelEditedRef.current) {
        setValue("job_level", level, { shouldValidate: true });
        setJobLevelFromResume(false);
      }

      if (jobSpec.interview_industry) {
        setValue("interview_industry", jobSpec.interview_industry, { shouldValidate: true });
      }
      if (jobSpec.interview_direction) {
        setValue("interview_direction", jobSpec.interview_direction, { shouldValidate: true });
      }
      if (jobSpec.required_skills.length > 0) {
        setJdRequiredSkills(jobSpec.required_skills);
      }
    },
    [applyResumeSetupSnapshot, setValue],
  );

  useEffect(() => {
    const sourceSessionId = searchParams.get("resume_from");
    if (!sourceSessionId || restoredResumeFromRef.current === sourceSessionId) {
      return;
    }
    restoredResumeFromRef.current = sourceSessionId;
    const localSnapshot = getResumeSetupSnapshot(sourceSessionId);
    if (localSnapshot) {
      applyResumeSetupSnapshot(localSnapshot);
      return;
    }
    let cancelled = false;
    void getSessionSetupSnapshot(sourceSessionId)
      .then((snapshot) => {
        if (!cancelled) {
          applySessionSetupSnapshot(snapshot);
        }
      })
      .catch(() => {
        /* Old sessions may not have setup snapshots; keep normal setup usable. */
      });
    return () => {
      cancelled = true;
    };
  }, [applyResumeSetupSnapshot, applySessionSetupSnapshot, searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasDraft && (resumeProjects.length > 0 || resumeFocusAreas.length > 0 || watchedSummary)) {
        safeSessionSetItem(
          RESUME_DRAFT_KEY,
          JSON.stringify({
            candidate_summary: watchedSummary,
            candidate_skills: watchedSkills,
            candidate_highlights: watchedHighlights,
            resumeProjects,
            resumeFocusAreas,
            resumeCandidateProfile,
            resumeParseAudit,
            resumeSourceId: resumeSource?.id,
            resumeSourceExpiresAt: resumeSource?.expiresAt,
          }),
        );
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    resumeProjects,
    resumeFocusAreas,
    resumeCandidateProfile,
    resumeParseAudit,
    resumeSource,
    watchedSummary,
    watchedSkills,
    watchedHighlights,
    hasDraft,
  ]);

  useEffect(() => {
    return () => {
      if (jdDebounceRef.current) clearTimeout(jdDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listDirections()
      .then((res) => {
        if (cancelled) return;
        const mapped = res.directions.map(setupDirectionFromApi);
        setServerDirections(mapped);
        const current = directionByIdFrom(mapped, getValues("interview_direction"));
        if (current) {
          setSelectedDims(current.dimensions.slice(0, 5));
          setJdRequiredSkills((prev) => (prev.length > 0 ? prev : current.skills));
          setValue("interview_industry", current.industry ?? "internet", { shouldValidate: true });
        }
      })
      .catch(() => {
        /* Keep local fallback directions if the endpoint is unavailable. */
      });
    return () => {
      cancelled = true;
    };
  }, [getValues, setValue]);

  // Lazy-load the full dimension catalog. The catalog is small and static
  // so this is a one-shot fetch.
  useEffect(() => {
    let cancelled = false;
    void listDimensions()
      .then((res) => {
        if (!cancelled) setAllDimensions(res.dimensions);
      })
      .catch(() => {
        /* picker stays in default-only mode if this fails */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markJobDescriptionEdited = useCallback(() => {
    jdUserEditedRef.current = true;
  }, []);

  const dimensionOptionsFromIds = useCallback(
    (ids: string[], directionId: DirectionId): DimensionOption[] => {
      const direction = resolveDirection(directionId);
      const labels = new Map(
        [...allDimensions, ...direction.dimensions, ...DEFAULT_DIMENSIONS].map((option) => [
          option.id,
          option.label,
        ]),
      );
      return ids
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({
          id,
          label: labels.get(id) ?? id.replace(/_/g, " "),
        }));
    },
    [allDimensions, resolveDirection],
  );

  const loadJobTemplate = useCallback(
    async function loadJobTemplate(directionId: DirectionId) {
      const requestId = ++jdTemplateRequestRef.current;
      try {
        const res = await getJobTemplate({
          direction: directionId,
          level: getValues("job_level"),
        });
        if (requestId !== jdTemplateRequestRef.current) return;

        const template = jobTemplateAutofillValue({
          template: res.template,
          userEdited: jdUserEditedRef.current,
        });
        if (!template) return;

        setValue("job_description", template, { shouldValidate: false });
        if (res.skills.length > 0) {
          setJdRequiredSkills(res.skills);
        }
        const dims = dimensionOptionsFromIds(res.rubric_dimensions, directionId);
        if (dims.length > 0) {
          setSelectedDims(dims);
        }
      } catch {
        /* Keep direction defaults if the template endpoint is unavailable. */
      }
    },
    [dimensionOptionsFromIds, getValues, setValue],
  );

  const applyPracticeFocusQuery = useCallback(() => {
    if (practiceFocusAppliedRef.current) return;
    const focusValue = searchParams.get("focus") ?? "";
    const queryLength = searchParams.get("length");
    const queryJobTitle = searchParams.get("job_title");
    const queryJobLevel = searchParams.get("job_level");

    if (queryLength && (LENGTH_VALUES as readonly string[]).includes(queryLength)) {
      setValue("length", queryLength as FormValues["length"], { shouldValidate: true });
    }
    if (queryJobTitle?.trim()) {
      setValue("job_title", queryJobTitle.trim(), { shouldValidate: true });
      setJobTitleEdited(true);
    }
    if (queryJobLevel && ["junior", "mid", "senior", "staff", "principal"].includes(queryJobLevel)) {
      setValue("job_level", queryJobLevel as JobLevel, { shouldValidate: true });
      setJobLevelEdited(true);
    }

    const focusIds = focusValue
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (focusIds.length > 0) {
      const knownIds = new Set(
        [
          ...allDimensions,
          ...DEFAULT_DIMENSIONS,
          ...directionOptions.flatMap((direction) => direction.dimensions),
        ].map((option) => option.id),
      );
      const validIds = focusIds.filter((id) => knownIds.has(id));
      const resolvedFocus = dimensionOptionsFromIds(validIds, getValues("interview_direction"));
      if (resolvedFocus.length === 0 && allDimensions.length === 0) return;
      if (resolvedFocus.length > 0) {
        setPracticeFocusDims(resolvedFocus.slice(0, 5));
        setSelectedDims(resolvedFocus.slice(0, 5));
        setStep((prev) => Math.max(prev, 2));
      }
    }

    practiceFocusAppliedRef.current = true;
  }, [allDimensions, dimensionOptionsFromIds, directionOptions, getValues, searchParams, setValue]);

  useEffect(() => {
    applyPracticeFocusQuery();
  }, [applyPracticeFocusQuery]);

  const applyResumeResult = useCallback(
    (result: ParseResumeResponse) => {
      const candidateName = candidateNameAutofillValue(result, getValues("candidate_name"));
      if (candidateName) {
        setValue("candidate_name", candidateName, { shouldValidate: true });
        setCandidateNameFromResume(true);
      } else {
        setCandidateNameFromResume(false);
      }
      setResumeCandidateProfile(result.candidate_profile ?? {});
      setResumeParseAudit(result.resume_parse_audit ?? null);
      setResumeSource(resumeSourceRefFromParseResult(result));
      const jobSuggestion = resumeJobAutofillValues({
        profile: result.candidate_profile,
        currentTitle: getValues("job_title"),
        titleDirty: jobTitleEdited,
        levelDirty: jobLevelEdited,
      });
      if (jobSuggestion.jobTitle) {
        setValue("job_title", jobSuggestion.jobTitle, { shouldValidate: true });
        setJobTitleFromResume(true);
      }
      if (jobSuggestion.jobLevel) {
        setValue("job_level", jobSuggestion.jobLevel, { shouldValidate: false });
        setJobLevelFromResume(true);
      }
      if (result.summary) {
        setValue("candidate_summary", result.summary, { shouldValidate: true });
      }
      if (result.skills.length > 0) {
        setValue("candidate_skills", joinCsv(result.skills), { shouldValidate: true });
      }
      if (result.highlights.length > 0) {
        setValue("candidate_highlights", result.highlights.join("\n"), { shouldValidate: true });
      }
      setResumeProjects(normaliseProjects(result.projects));
      setResumeFocusAreas(normaliseFocusAreas(result.focus_areas));
      setResumeConcerns(result.concerns ?? []);
    },
    [getValues, jobLevelEdited, jobTitleEdited, setValue],
  );

  const handleResumeJobSnapshot = useCallback(
    (job: ResumeParseJobResponse, draftId: string, fallbackFilename: string): boolean => {
      const filename = job.filename ?? fallbackFilename;
      if (job.status === "running") {
        upsertSetupDraft({
          draftId,
          jobId: job.job_id,
          filename,
          status: "parsing",
          expiresAt: job.expires_at,
        });
        return false;
      }
      if (job.status === "completed" && job.result) {
        applyResumeResult(job.result);
        upsertSetupDraft({
          draftId,
          jobId: job.job_id,
          filename,
          status: setupDraftStatusFromResult(job.result),
          expiresAt: job.expires_at,
        });
        setUpload({
          kind: "success",
          filename,
          parseStatus: job.result.parse_status,
          draftId,
        });
        return true;
      }
      const status = setupDraftStatusFromJob(job);
      upsertSetupDraft({
        draftId,
        jobId: job.job_id,
        filename,
        status,
        expiresAt: job.expires_at,
      });
      setUpload({
        kind: "error",
        filename,
        draftId,
        jobId: job.job_id,
        expiresAt: job.expires_at,
        message:
          job.status === "expired"
            ? "简历解析草稿已过期，请重新上传。"
            : job.error || "简历解析失败，请重新上传或手动填写。",
      });
      return true;
    },
    [applyResumeResult],
  );

  useEffect(() => {
    if (upload.kind !== "parsing" || !upload.jobId || !upload.draftId) return;
    const { jobId, draftId, filename } = upload;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const job = await getResumeParseJob(jobId);
        if (cancelled) return;
        const done = handleResumeJobSnapshot(job, draftId, filename);
        if (!done) {
          timer = window.setTimeout(poll, 2500);
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(poll, 5000);
        }
      }
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [handleResumeJobSnapshot, upload]);

  useEffect(() => {
    if (!draftIdFromQuery || restoredDraftRef.current === draftIdFromQuery) return;
    restoredDraftRef.current = draftIdFromQuery;
    const draft = getSetupDraft(draftIdFromQuery);
    if (!draft) {
      setStep((prev) => Math.max(prev, 1));
      setUpload({
        kind: "error",
        filename: "resume",
        message: "简历解析草稿已失效，请重新上传。",
      });
      return;
    }
    setStep((prev) => Math.max(prev, 1));
    setUpload({
      kind: "parsing",
      filename: draft.filename,
      draftId: draft.draftId,
      jobId: draft.jobId,
      expiresAt: draft.expiresAt,
    });
    void getResumeParseJob(draft.jobId)
      .then((job) => handleResumeJobSnapshot(job, draft.draftId, draft.filename))
      .catch(() => {
        setUpload({
          kind: "error",
          filename: draft.filename,
          draftId: draft.draftId,
          jobId: draft.jobId,
          expiresAt: draft.expiresAt,
          message: "暂时无法恢复解析状态，请稍后重试或重新上传。",
        });
      });
  }, [draftIdFromQuery, handleResumeJobSnapshot]);

  // ---- Step 1: resume file upload --------------------------------------

  async function handleFile(file: File) {
    const requestId = ++uploadRequestRef.current;
    if (!isAcceptedResumeFile(file)) {
      setUpload({
        kind: "error",
        filename: file.name,
        message: "暂时只支持 PDF / DOCX / TXT / Markdown。可以换个格式再试。",
      });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUpload({
        kind: "error",
        filename: file.name,
        message: "文件过大（>5MB），请压缩或裁剪后再上传",
      });
      return;
    }
    const draftId = createSetupDraftId();
    setUpload({ kind: "parsing", filename: file.name, draftId });
    try {
      const job = await createResumeParseJobForSetup(file, {
        createResumeParseJob,
        buildLLMPayload,
      });
      if (requestId !== uploadRequestRef.current) return;
      const filename = job.filename ?? file.name;
      if (job.status === "running") {
        upsertSetupDraft({
          draftId,
          jobId: job.job_id,
          filename,
          status: "parsing",
          expiresAt: job.expires_at,
        });
        setUpload({
          kind: "parsing",
          filename,
          draftId,
          jobId: job.job_id,
          expiresAt: job.expires_at,
        });
      } else {
        handleResumeJobSnapshot(job, draftId, file.name);
      }
    } catch (err) {
      if (requestId !== uploadRequestRef.current) return;
      setUpload({
        kind: "error",
        filename: file.name,
        draftId,
        message: friendlyResumeUploadError(err),
      });
    }
  }

  function clearUpload() {
    const draftId = uploadDraftId(upload);
    if (draftId) {
      removeSetupDraft(draftId);
    }
    uploadRequestRef.current += 1;
    setUpload({ kind: "idle" });
    setResumeCandidateProfile({});
    setResumeParseAudit(null);
    setResumeSource(null);
    setCandidateNameFromResume(false);
    setJobTitleFromResume(false);
    setJobLevelFromResume(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function pickResumeFile() {
    if (fileInputRef.current) {
      fileInputRef.current.value = resumeReuploadInputValue();
      fileInputRef.current.click();
    }
  }

  // ---- Step 2: JD-driven dimension inference ----------------------------

  const applyJdResult = useCallback((res: ParseJobSpecResponse) => {
    setJdRequiredSkills(res.required_skills);
    if (res.rubric_dimension_labels.length > 0) {
      setSelectedDims(res.rubric_dimension_labels);
    }
  }, []);

  const scheduleJdParse = useCallback(
    (text: string) => {
      if (jdDebounceRef.current) clearTimeout(jdDebounceRef.current);
      if (text.trim().length < 30) {
        // Too short to bother with the LLM. Reset to defaults.
        setJdStatus({ kind: "idle" });
        return;
      }
      setJdStatus({ kind: "parsing" });
      jdDebounceRef.current = setTimeout(async () => {
        try {
          const res = await parseJobSpec({
            text,
            direction: getValues("interview_direction"),
            title: getValues("job_title") || undefined,
            level: getValues("job_level"),
            llmConfig: buildLLMPayload(),
          });
          applyJdResult(res);
          setJdStatus({ kind: "success", rationale: res.rationale });
        } catch (err) {
          setJdStatus({
            kind: "error",
            message: friendlySetupError(err, "jd"),
          });
        }
      }, 700);
    },
    [applyJdResult, getValues],
  );

  function handleJobDescriptionChange(text: string) {
    changeField("job_description", text);
    markJobDescriptionEdited();
    scheduleJdParse(text || "");
  }

  useEffect(() => {
    void loadJobTemplate(DEFAULTS.interview_direction);
  }, [loadJobTemplate]);

  function toggleDim(option: DimensionOption) {
    setSelectedDims((prev) => {
      if (prev.some((d) => d.id === option.id)) {
        return prev.filter((d) => d.id !== option.id);
      }
      if (prev.length >= 5) return prev;
      return [...prev, option];
    });
  }

  function removeDim(id: string) {
    setSelectedDims((prev) => prev.filter((d) => d.id !== id));
  }

  function selectDirection(id: DirectionId) {
    const direction = resolveDirection(id);
    setValue("interview_industry", direction.industry ?? "internet", { shouldValidate: true });
    setValue("interview_direction", id, { shouldValidate: true });
    setValue("job_title", direction.defaultTitle, { shouldValidate: true });
    setValue("job_level", direction.level, { shouldValidate: false });
    setJobTitleEdited(false);
    setJobLevelEdited(false);
    setJobTitleFromResume(false);
    setJobLevelFromResume(false);
    setSelectedDims(direction.dimensions.slice(0, 5));
    setJdRequiredSkills(direction.skills);
    void loadJobTemplate(id);
  }

  // ---- Submit -----------------------------------------------------------

  async function goNext() {
    const fields = STEP_FIELDS[step] ?? [];
    const ok = await trigger(fields);
    if (!ok) {
      const field = fields[0];
      const label = FIELD_LABEL[field] ?? "当前步骤信息";
      setServerError(`请先补全${label}`);
      if (field) setFocus(field);
      return;
    }
    setServerError(null);
    if (step < STEP_LABELS.length - 1) setStep(step + 1);
  }

  function goPrev() {
    if (step > 0) setStep(step - 1);
  }

  async function handleStepJump(targetStep: number) {
    if (targetStep <= step) {
      setStep(targetStep);
      return;
    }

    const fieldsToCheck = STEP_FIELDS.slice(0, targetStep).flat();
    const ok = await trigger(fieldsToCheck);
    if (ok) {
      setServerError(null);
      setStep(targetStep);
      return;
    }

    if (targetStep > 1 && !getValues("candidate_name").trim()) {
      setStep(1);
      setServerError("请先填写称呼");
      window.setTimeout(() => setFocus("candidate_name"), 0);
      return;
    }
    if (targetStep > 2 && !getValues("job_title").trim()) {
      setStep(2);
      setServerError("请先填写岗位名称");
      window.setTimeout(() => setFocus("job_title"), 0);
      return;
    }
    setServerError("请先补全前面步骤的必填信息");
  }

  async function onValid(parsedValues: ParsedFormValues) {
    const formValues = parsedValues;
    setInterviewStartPending(true);
    setServerError(null);
    if (resumeFieldsLocked) {
      setInterviewStartPending(false);
      setServerError("AI 简历解析还在进行中，完成后会自动填入表单。");
      setStep(1);
      return;
    }
    if (selectedDims.length === 0) {
      setInterviewStartPending(false);
      setServerError("请至少保留一个考察维度");
      setStep(2);
      return;
    }

    const lengthChoice = LENGTH_OPTIONS.find((opt) => opt.id === formValues.length) ?? LENGTH_OPTIONS[1];
    const max_turns = formValues.max_turns_override ?? lengthChoice.turns;
    const turn_budget = formValues.turn_budget_override ?? max_turns + 2;

    // Required skills priority:
    //   1. JD-parsed list (what the role actually demands)
    //   2. Candidate skills as a reasonable proxy when no JD is filled
    const candidateSkills = splitCsv(formValues.candidate_skills ?? "");
    const selectedDirection = resolveDirection(formValues.interview_direction);
    const requiredSkills =
      jdRequiredSkills.length > 0
        ? jdRequiredSkills
        : candidateSkills.length > 0
          ? candidateSkills.slice(0, 8)
          : selectedDirection.skills;
    const projects = normaliseProjects(resumeProjects);
    const focusAreas = normaliseFocusAreas(resumeFocusAreas);
    const concerns = resumeConcerns.map((c) => c.trim()).filter(Boolean);
    const resumeSetupSnapshot: ResumeSetupSnapshot = {
      candidate_name: formValues.candidate_name,
      candidate_summary: formValues.candidate_summary,
      candidate_skills: formValues.candidate_skills,
      candidate_highlights: formValues.candidate_highlights,
      resumeProjects: projects as unknown as Record<string, unknown>[],
      resumeFocusAreas: focusAreas as unknown as Record<string, unknown>[],
      resumeConcerns: concerns,
      resumeCandidateProfile: resumeCandidateProfile as Record<string, unknown>,
      ...(resumeParseAudit
        ? { resumeParseAudit: resumeParseAudit as unknown as Record<string, unknown> }
        : {}),
    };
    const resumeSourceId = resumeSourceIdForSession(resumeSource);

    const payload: StartSessionRequest = {
      candidate: {
        name: formValues.candidate_name,
        resume_parsed: resumeParsedForSession({
          summary: formValues.candidate_summary || undefined,
          skills: candidateSkills,
          highlights: splitCsv(formValues.candidate_highlights ?? ""),
          projects,
          focus_areas: focusAreas,
          concerns,
          candidate_profile: resumeCandidateProfile,
        }),
        ...(resumeParseAudit ? { resume_parse_audit: resumeParseAudit } : {}),
      },
      job_spec: {
        title: formValues.job_title,
        level: formValues.job_level,
        required_skills: requiredSkills,
        rubric_dimensions: selectedDims.map((d) => d.id),
        interview_industry: formValues.interview_industry,
        interview_direction: formValues.interview_direction,
        interview_direction_label: selectedDirection.label,
      },
      max_turns,
      interview_depth: lengthChoice.id,
      quality_threshold: formValues.quality_threshold,
      turn_budget,
      focus_dimensions: practiceFocusDims.map((d) => d.id),
      mode: "mixed",
      enable_video_analysis: false,
      ...(resumeSourceId ? { resume_source_id: resumeSourceId } : {}),
    };

    try {
      const res = await startSession(payload);
      try {
        upsertEntry({
          sessionId: res.session_id,
          sessionToken: res.session_token,
          sessionTokenExpiresAt: res.session_token_expires_at,
          recoveryToken: res.recovery_token,
          recoveryTokenExpiresAt: res.recovery_token_expires_at,
          ownerUserId: res.owner_user_id ?? undefined,
          ownerClaimedAt: res.owner_user_id ? res.created_at : undefined,
          createdAt: res.created_at,
          updatedAt: res.updated_at,
          jdTitle: formValues.job_title,
          candidateName: formValues.candidate_name,
          jobLevel: formValues.job_level,
          rubricDimensions: selectedDims.map((d) => d.id),
          maxTurns: res.max_turns ?? max_turns,
          status: "running",
          resumeSetupSnapshot,
        });
      } catch {
        /* ignore */
      }
      const draftId = uploadDraftId(upload);
      if (draftId) {
        removeSetupDraft(draftId);
      }
      safeSessionRemoveItem(RESUME_DRAFT_KEY);
      router.push(`/interview/${res.session_id}`);
    } catch (err) {
      setInterviewStartPending(false);
      setServerError(friendlySetupError(err, "start"));
    }
  }

  function onInvalid(formErrors: FormErrors) {
    setInterviewStartPending(false);
    const first = firstFormError(formErrors);
    setServerError(first?.message ?? "请先补全必填信息");
    if (first) {
      if (ADVANCED_FIELD_NAMES.includes(first.field)) {
        setAdvancedOpen(true);
      }
      setStep(first.step);
      window.setTimeout(() => setFocus(first.field), 0);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    submittedRef.current = true;
    try {
      const result = validateForm(valuesRef.current);
      setErrors(result.errors);
      if (result.parsed) {
        await onValid(result.parsed);
      } else {
        onInvalid(result.errors);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Render -----------------------------------------------------------

  const currentDirection = resolveDirection(values.interview_direction);
  const dimensionCatalog =
    currentDirection.dimensions.length > 0
      ? currentDirection.dimensions
      : allDimensions.length > 0
        ? allDimensions
        : DEFAULT_DIMENSIONS;

  function fieldHelp(field: FieldName) {
    const message = errors[field];
    return message ? <span id={`${String(field)}-error`}>{message}</span> : undefined;
  }

  return (
    <div style={{ position: "relative" }}>
      <form
        onSubmit={(e) => void onSubmit(e)}
        aria-busy={isStartingInterview}
        style={isStartingInterview ? { pointerEvents: "none", userSelect: "none" } : undefined}
      >
        <Form layout="vertical" component={false}>
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <ExpectationBanner />

            <StepIndicator current={step} onJump={(id) => void handleStepJump(id)} />

            {step === 0 && (
              <DirectionStep
                selected={values.interview_direction}
                directions={directionOptions}
                onSelect={selectDirection}
              />
            )}

            {step === 1 && (
              <Card
                title={
                  <Space>
                    <UserOutlined style={{ color: ACCENT }} />
                    介绍一下你自己
                  </Space>
                }
              >
                <Space direction="vertical" size={20} style={{ width: "100%" }}>
                  <Form.Item
                    style={{ marginBottom: 0 }}
                    label={
                      <Space size={8}>
                        <span>称呼 *</span>
                        {candidateNameFromResume && (
                          <Text style={{ fontSize: 12, color: ACCENT }}>已从简历识别</Text>
                        )}
                      </Space>
                    }
                    validateStatus={errors.candidate_name ? "error" : undefined}
                    help={fieldHelp("candidate_name")}
                  >
                    <Input
                      ref={fieldRef("candidate_name")}
                      value={values.candidate_name}
                      onChange={(e) => {
                        changeField("candidate_name", e.target.value);
                        setCandidateNameFromResume(false);
                      }}
                      placeholder="请输入你的姓名或昵称"
                      aria-invalid={Boolean(errors.candidate_name)}
                      aria-describedby={errors.candidate_name ? "candidate_name-error" : undefined}
                      disabled={resumeFieldsLocked}
                    />
                  </Form.Item>

                  <ResumeUploader
                    status={upload}
                    isDragging={isDragging}
                    onPick={pickResumeFile}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) await handleFile(file);
                    }}
                    onClear={clearUpload}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await handleFile(file);
                    }}
                  />

                  <ResumePreviewCard
                    candidateProfile={resumeCandidateProfile}
                    summary={values.candidate_summary ?? ""}
                    skills={values.candidate_skills ?? ""}
                    highlights={values.candidate_highlights ?? ""}
                    projects={resumeProjects}
                    focusAreas={resumeFocusAreas}
                    concerns={resumeConcerns}
                    showHint={upload.kind === "success"}
                    readOnly={resumeFieldsLocked}
                    summaryError={errors.candidate_summary}
                    onChangeSummary={(v) => setValue("candidate_summary", v, { shouldValidate: true })}
                    onChangeSkills={(v) => setValue("candidate_skills", v, { shouldValidate: true })}
                    onChangeHighlights={(v) => setValue("candidate_highlights", v, { shouldValidate: true })}
                    onChangeProjects={setResumeProjects}
                    onChangeFocusAreas={setResumeFocusAreas}
                  />
                </Space>
              </Card>
            )}

            {step === 2 && (
              <Space direction="vertical" size={24} style={{ width: "100%" }}>
                <Card
                  title={
                    <Space>
                      <SolutionOutlined style={{ color: ACCENT }} />
                      面试什么岗位
                    </Space>
                  }
                >
                  <Flex gap={16} wrap="wrap">
                    <div style={{ flex: "1 1 260px" }}>
                      <Form.Item
                        style={{ marginBottom: 0 }}
                        label={
                          <Space size={8}>
                            <span>岗位名称 *</span>
                            {jobTitleFromResume && (
                              <Text style={{ fontSize: 12, color: ACCENT }}>已根据简历建议</Text>
                            )}
                          </Space>
                        }
                        validateStatus={errors.job_title ? "error" : undefined}
                        help={fieldHelp("job_title")}
                      >
                        <Input
                          ref={fieldRef("job_title")}
                          value={values.job_title}
                          onChange={(e) => {
                            changeField("job_title", e.target.value);
                            setJobTitleEdited(true);
                            setJobTitleFromResume(false);
                          }}
                          placeholder="例如：高级前端工程师"
                          aria-invalid={Boolean(errors.job_title)}
                          aria-describedby={errors.job_title ? "job_title-error" : undefined}
                          disabled={resumeFieldsLocked}
                        />
                      </Form.Item>
                    </div>
                    <div style={{ flex: "1 1 260px" }}>
                      <Form.Item
                        style={{ marginBottom: 0 }}
                        label={
                          <Space size={8}>
                            <span>目标级别 *</span>
                            {jobLevelFromResume && (
                              <Text style={{ fontSize: 12, color: ACCENT }}>已根据履历阶段建议</Text>
                            )}
                          </Space>
                        }
                        validateStatus={errors.job_level ? "error" : undefined}
                        help={fieldHelp("job_level")}
                        extra={
                          jobLevelFromResume &&
                          resumeCandidateProfile.suggested_job_level_basis &&
                          resumeCandidateProfile.suggested_job_level_basis.length > 0 ? (
                            <span>
                              级别建议依据：
                              {resumeCandidateProfile.suggested_job_level_basis.join("、")}
                            </span>
                          ) : undefined
                        }
                      >
                        <Select<JobLevel>
                          ref={fieldRef("job_level")}
                          value={values.job_level}
                          onChange={(v) => {
                            changeField("job_level", v);
                            setJobLevelEdited(true);
                            setJobLevelFromResume(false);
                          }}
                          disabled={resumeFieldsLocked}
                          options={JOB_LEVEL_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                        />
                      </Form.Item>
                    </div>
                    <div style={{ flex: "1 1 100%" }}>
                      <Flex justify="space-between" align="center" wrap="wrap" gap={8} style={{ marginBottom: 4 }}>
                        <Text>岗位要求</Text>
                        <JdHint
                          status={jdStatus}
                          onRetry={() => scheduleJdParse(values.job_description || "")}
                        />
                      </Flex>
                      <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                        系统已根据目标岗位生成通用要求，可直接调整；如果你有真实 JD，也可以粘贴覆盖。
                      </Text>
                      <Input.TextArea
                        rows={5}
                        maxLength={50000}
                        value={values.job_description}
                        onChange={(e) => handleJobDescriptionChange(e.target.value)}
                        status={errors.job_description ? "error" : undefined}
                        placeholder="粘贴真实岗位 JD，或基于当前通用要求微调。系统会据此调整考察重点和技能范围，不用于判断目标级别。"
                        style={{ resize: "none" }}
                      />
                      {errors.job_description && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {errors.job_description}
                        </Text>
                      )}
                    </div>
                  </Flex>
                </Card>

                <Card
                  size="small"
                  title={
                    <Space>
                      <AimOutlined style={{ color: ACCENT }} />
                      AI 会重点考察
                    </Space>
                  }
                >
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <ResumeFocusSummary focusAreas={resumeFocusAreas} direction={currentDirection} />
                    <DimensionPicker
                      selected={selectedDims}
                      catalog={dimensionCatalog}
                      onToggle={toggleDim}
                      onRemove={removeDim}
                    />
                  </Space>
                </Card>

                <Card
                  size="small"
                  title={
                    <Space>
                      <ClockCircleOutlined style={{ color: ACCENT }} />
                      面试深度
                    </Space>
                  }
                >
                  <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
                    控制最多提问轮数和追问空间，实际时长会根据回答长度和模型响应速度变化。
                  </Text>
                  <LengthPicker value={values.length} onChange={(v) => setValue("length", v)} />
                </Card>

                <AdvancedPanel
                  open={advancedOpen}
                  onToggle={() => setAdvancedOpen((v) => !v)}
                  values={{
                    max_turns_override: values.max_turns_override,
                    quality_threshold: values.quality_threshold,
                    turn_budget_override: values.turn_budget_override,
                  }}
                  errors={{
                    max_turns_override: errors.max_turns_override,
                    quality_threshold: errors.quality_threshold,
                    turn_budget_override: errors.turn_budget_override,
                  }}
                  onChange={(field: AdvancedField, v: string) => changeField(field, v)}
                  inputRef={(field: AdvancedField) => fieldRef(field)}
                />
              </Space>
            )}

            {serverError && (
              <Alert type="error" showIcon role="alert" aria-live="assertive" message={serverError} />
            )}

            <Flex justify="space-between" align="center">
              <Button type="text" onClick={goPrev} disabled={step === 0 || isStartingInterview}>
                上一步
              </Button>
              {step < STEP_LABELS.length - 1 ? (
                <Button
                  type="primary"
                  onClick={() => void goNext()}
                  disabled={isStartingInterview}
                  style={{ background: ACCENT }}
                >
                  下一步
                  <ArrowRightOutlined />
                </Button>
              ) : (
                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  disabled={isStartingInterview || resumeFieldsLocked}
                  loading={isStartingInterview}
                  style={{ background: isStartingInterview || resumeFieldsLocked ? undefined : ACCENT }}
                >
                  {isStartingInterview ? "正在创建面试环境" : "开始我的面试"}
                  {!isStartingInterview && <ArrowRightOutlined />}
                </Button>
              )}
            </Flex>
          </Space>
        </Form>
      </form>

      <Modal open={isStartingInterview} footer={null} closable={false} maskClosable={false} keyboard={false} centered width={400}>
        <Flex gap={16} align="center" role="status" aria-live="polite" style={{ minHeight: 100 }}>
          <Spin indicator={<LoadingOutlined spin style={{ fontSize: 24, color: ACCENT }} />} />
          <div>
            <Text strong>正在创建面试环境</Text>
            <div style={{ marginTop: 4 }}>
              <Text type="secondary">正在保存配置并打开面试页面，准备好后会自动进入。</Text>
            </div>
          </div>
        </Flex>
      </Modal>
    </div>
  );
}