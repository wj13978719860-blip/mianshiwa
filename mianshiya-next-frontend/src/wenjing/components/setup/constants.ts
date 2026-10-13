import type {
  DimensionOption,
  InterviewDirection,
  ParseResumeStatus,
} from "@/wenjing/lib/api/types";

// ---------------------------------------------------------------------------
// Schema & defaults（与上游 SetupForm 一致）
// ---------------------------------------------------------------------------

export const LENGTH_VALUES = ["short", "standard", "deep"] as const;
export type LengthId = (typeof LENGTH_VALUES)[number];
export type JobLevel = "junior" | "mid" | "senior" | "staff" | "principal";
export type DirectionId = string;
export type DirectionCategoryId =
  | "internet_tech"
  | "product_ops"
  | "sales_marketing"
  | "functions_service"
  | "management";

export const JOB_LEVEL_VALUES: readonly JobLevel[] = [
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
];

export const JOB_LEVEL_OPTIONS: ReadonlyArray<{ value: JobLevel; label: string }> = [
  { value: "junior", label: "初级" },
  { value: "mid", label: "中级" },
  { value: "senior", label: "高级" },
  { value: "staff", label: "Staff / 技术专家" },
  { value: "principal", label: "Principal / 资深专家" },
];

export const CANDIDATE_SUMMARY_MAX_LENGTH = 1200;
export const CANDIDATE_SKILLS_MAX_COUNT = 40;
export const CANDIDATE_SKILL_MAX_LENGTH = 80;
export const CANDIDATE_HIGHLIGHTS_MAX_COUNT = 20;
export const CANDIDATE_HIGHLIGHT_MAX_LENGTH = 240;
export const RESUME_PROJECTS_MAX_COUNT = 12;
export const RESUME_PROJECT_NAME_MAX_LENGTH = 120;
export const RESUME_PROJECT_ROLE_MAX_LENGTH = 80;
export const RESUME_PROJECT_ANCHOR_MAX_COUNT = 8;
export const RESUME_PROJECT_ANCHOR_MAX_LENGTH = 160;
export const RESUME_FOCUS_AREAS_MAX_COUNT = 20;
export const RESUME_FOCUS_LABEL_MAX_LENGTH = 160;
export const START_INTERVIEW_PREFETCH_SESSION_ID = "__warmup_interview__";

export type SetupDirection = {
  id: DirectionId;
  industry?: string;
  label: string;
  desc: string;
  defaultTitle: string;
  level: JobLevel;
  dimensions: DimensionOption[];
  skills: string[];
};

export const DIRECTION_CATEGORIES: ReadonlyArray<{
  id: DirectionCategoryId;
  label: string;
  desc: string;
}> = [
  { id: "internet_tech", label: "互联网技术", desc: "开发、算法、架构、运维" },
  { id: "product_ops", label: "产品 / 运营", desc: "产品规划、用户增长、内容运营" },
  { id: "sales_marketing", label: "销售 / 市场", desc: "客户开拓、商务谈判、品牌增长" },
  { id: "functions_service", label: "职能 / 服务", desc: "HR、客服、客户成功" },
  { id: "management", label: "管理", desc: "团队管理、协作推进、经营决策" },
];

const DIRECTION_CATEGORY_BY_ID: Record<string, DirectionCategoryId> = {
  java_backend: "internet_tech",
  frontend: "internet_tech",
  ai_fullstack: "internet_tech",
  mobile: "internet_tech",
  ai_agent: "internet_tech",
  sre: "internet_tech",
  ai_algorithm: "internet_tech",
  architect: "internet_tech",
  product_manager: "product_ops",
  operations: "product_ops",
  sales_business: "sales_marketing",
  marketing_brand: "sales_marketing",
  hr_function: "functions_service",
  customer_success: "functions_service",
  general_management: "management",
};

const DIRECTION_CARD_DESC_BY_ID: Record<string, string> = {
  java_backend: "适合后端业务、接口、数据库和分布式系统相关岗位",
  frontend: "适合 Web、H5、管理后台、小程序等前端岗位",
  ai_fullstack: "适合需要前后端和 AI 能力结合的岗位",
  mobile: "适合 iOS、Android、Flutter、React Native 等移动端岗位",
  ai_agent: "适合 Agent、RAG、工具调用和 AI 应用工程岗位",
  sre: "适合运维、稳定性、监控、发布和故障处理岗位",
  ai_algorithm: "适合机器学习、深度学习、模型评估和算法落地岗位",
  architect: "适合架构设计、技术方案、技术管理和专家岗",
  product_manager: "适合产品规划、需求分析、用户体验和业务推进岗位",
  operations: "适合用户运营、内容运营、活动运营和数据运营岗位",
  sales_business: "适合客户拓展、方案销售、商务谈判和回款推进岗位",
  marketing_brand: "适合市场推广、品牌、渠道增长和内容传播岗位",
  hr_function: "适合招聘、员工关系、组织发展和职能支持岗位",
  customer_success: "适合客服、客户成功、售后支持和续约增长岗位",
  general_management: "适合团队管理、目标推进、跨部门协作和经营决策岗位",
};

export const INTERNET_DIRECTIONS: ReadonlyArray<SetupDirection> = [
  {
    id: "java_backend",
    label: "Java 后端开发",
    desc: "Spring、微服务、数据库、稳定性和系统设计",
    defaultTitle: "Java 后端开发工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "system_design", label: "系统设计" },
      { id: "problem_solving", label: "问题解决" },
      { id: "coding_quality", label: "代码质量" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["java", "spring", "mysql", "redis", "microservices"],
  },
  {
    id: "frontend",
    label: "前端开发",
    desc: "React/Vue、工程化、性能体验和协作交付",
    defaultTitle: "前端开发工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "coding_quality", label: "代码质量" },
      { id: "problem_solving", label: "问题解决" },
      { id: "project_experience", label: "项目经验" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["javascript", "typescript", "react", "vue", "frontend"],
  },
  {
    id: "ai_fullstack",
    label: "AI 全栈开发",
    desc: "前后端、LLM 接入、产品落地和端到端交付",
    defaultTitle: "AI 全栈开发工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "system_design", label: "系统设计" },
      { id: "product_thinking", label: "产品思维" },
      { id: "project_experience", label: "项目经验" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["typescript", "python", "llm", "rag", "fullstack"],
  },
  {
    id: "mobile",
    label: "移动端开发",
    desc: "iOS/Android、跨端、性能、稳定性和体验",
    defaultTitle: "移动端开发工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "problem_solving", label: "问题解决" },
      { id: "coding_quality", label: "代码质量" },
      { id: "project_experience", label: "项目经验" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["android", "ios", "flutter", "react native", "mobile"],
  },
  {
    id: "ai_agent",
    label: "AI Agent 开发",
    desc: "Agent 架构、工具调用、记忆、评测和工程可靠性",
    defaultTitle: "AI Agent 开发工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "system_design", label: "系统设计" },
      { id: "problem_solving", label: "问题解决" },
      { id: "product_thinking", label: "产品思维" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["llm", "agent", "rag", "python", "tool calling"],
  },
  {
    id: "sre",
    label: "运维 / SRE",
    desc: "可观测性、故障处理、容量、发布和稳定性治理",
    defaultTitle: "运维 / SRE 工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "system_design", label: "系统设计" },
      { id: "problem_solving", label: "问题解决" },
      { id: "project_experience", label: "项目经验" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["linux", "kubernetes", "observability", "devops", "sre"],
  },
  {
    id: "ai_algorithm",
    label: "AI 算法",
    desc: "模型能力、实验设计、数据、评测和业务落地",
    defaultTitle: "AI 算法工程师",
    level: "senior",
    dimensions: [
      { id: "technical_depth", label: "技术深度" },
      { id: "problem_solving", label: "问题解决" },
      { id: "project_experience", label: "项目经验" },
      { id: "product_thinking", label: "产品思维" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["python", "machine learning", "deep learning", "llm", "evaluation"],
  },
  {
    id: "architect",
    label: "架构师 / 技术专家",
    desc: "复杂系统设计、技术决策、治理、影响力和团队协同",
    defaultTitle: "架构师 / 技术专家",
    level: "staff",
    dimensions: [
      { id: "system_design", label: "系统设计" },
      { id: "technical_depth", label: "技术深度" },
      { id: "leadership", label: "领导力" },
      { id: "problem_solving", label: "问题解决" },
      { id: "communication", label: "沟通表达" },
    ],
    skills: ["architecture", "distributed systems", "scalability", "leadership"],
  },
];

export function directionById(id: DirectionId): SetupDirection {
  return INTERNET_DIRECTIONS.find((item) => item.id === id) ?? INTERNET_DIRECTIONS[0];
}

export function setupDirectionFromApi(item: InterviewDirection): SetupDirection {
  return {
    id: item.direction,
    industry: item.industry,
    label: item.label,
    desc: DIRECTION_CARD_DESC_BY_ID[item.direction] || item.default_title,
    defaultTitle: item.default_title,
    level: item.default_level,
    dimensions: item.dimension_catalog.map((dim) => ({
      id: dim.id,
      label: dim.label,
    })),
    skills: item.skills,
  };
}

export function directionByIdFrom(
  directions: ReadonlyArray<SetupDirection>,
  id: DirectionId,
): SetupDirection {
  return directions.find((item) => item.id === id) ?? directions[0] ?? directionById(id);
}

export function categoryForDirection(direction: SetupDirection): DirectionCategoryId {
  const configured = DIRECTION_CATEGORY_BY_ID[direction.id];
  if (configured) return configured;
  if (direction.industry === "internet") return "internet_tech";
  return "management";
}

export function groupedDirections(directions: ReadonlyArray<SetupDirection>) {
  return DIRECTION_CATEGORIES.map((category) => ({
    ...category,
    directions: directions.filter(
      (direction) => categoryForDirection(direction) === category.id,
    ),
  })).filter((group) => group.directions.length > 0);
}

/**
 * 表单原始值。高级数值字段保留输入框里的原始字符串，提交时再按上游 zod 规则
 * （空串 -> undefined / 默认值，coerce number，范围与整数校验）解析。
 */
export interface FormValues {
  interview_industry: string;
  interview_direction: string;
  candidate_name: string;
  candidate_summary: string;
  candidate_skills: string;
  candidate_highlights: string;
  job_title: string;
  job_level: JobLevel;
  job_description: string;
  length: LengthId;
  max_turns_override: string;
  quality_threshold: string;
  turn_budget_override: string;
}

export type FieldName = keyof FormValues;

/** 通过校验后的值（对应上游 `z.infer<typeof schema>` 的输出）。 */
export interface ParsedFormValues {
  interview_industry: string;
  interview_direction: string;
  candidate_name: string;
  candidate_summary: string;
  candidate_skills: string;
  candidate_highlights: string;
  job_title: string;
  job_level: JobLevel;
  job_description: string;
  length: LengthId;
  max_turns_override?: number;
  quality_threshold: number;
  turn_budget_override?: number;
}

export const DEFAULTS: FormValues = {
  interview_industry: "internet",
  interview_direction: "java_backend",
  candidate_name: "",
  candidate_summary: "",
  candidate_skills: "",
  candidate_highlights: "",
  job_title: "Java 后端开发工程师",
  job_level: "senior",
  job_description: "",
  length: "standard",
  max_turns_override: "",
  quality_threshold: "7",
  turn_budget_override: "",
};

export const LENGTH_OPTIONS: ReadonlyArray<{
  id: LengthId;
  label: string;
  desc: string;
  turns: number;
}> = [
  { id: "short", label: "快速练习", desc: "目标 5 轮 · 快速校准", turns: 5 },
  { id: "standard", label: "标准面试", desc: "目标 8 轮 · 核心覆盖", turns: 8 },
  { id: "deep", label: "深度追问", desc: "目标 12 轮 · 压力追问", turns: 12 },
];

export const STEP_LABELS = ["面试方向", "你是谁", "面试岗位"] as const;

export const ACCEPTED_TYPES =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_FILE_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"];
export const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);
export const RESUME_DRAFT_KEY = "resume_draft";
export const STEP_FIELDS: FieldName[][] = [
  ["interview_industry", "interview_direction"],
  ["candidate_name"],
  ["job_title", "job_level"],
];
export const ADVANCED_FIELD_NAMES: FieldName[] = [
  "max_turns_override",
  "quality_threshold",
  "turn_budget_override",
];

// Default dimension trio when no JD is supplied. Matches the backend
// fallback so behaviour is consistent across both call sites.
export const DEFAULT_DIMENSIONS: DimensionOption[] = [
  { id: "technical_depth", label: "技术深度" },
  { id: "problem_solving", label: "问题解决" },
  { id: "communication", label: "沟通表达" },
];

export const FIELD_STEP: Partial<Record<FieldName, number>> = {
  interview_industry: 0,
  interview_direction: 0,
  candidate_name: 1,
  job_title: 2,
  job_level: 2,
  length: 2,
  max_turns_override: 2,
  quality_threshold: 2,
  turn_budget_override: 2,
};

export const FIELD_LABEL: Partial<Record<FieldName, string>> = {
  interview_direction: "面试方向",
  candidate_name: "称呼",
  job_title: "岗位名称",
  job_level: "目标级别",
  length: "面试深度",
  max_turns_override: "问题轮数",
  quality_threshold: "通过阈值",
  turn_budget_override: "追问预算",
};

export const ERROR_FIELD_PRIORITY: FieldName[] = [
  "interview_direction",
  "candidate_name",
  "job_title",
  "job_level",
  "length",
  "max_turns_override",
  "quality_threshold",
  "turn_budget_override",
];

export type UploadStatus =
  | { kind: "idle" }
  | {
      kind: "parsing";
      filename: string;
      draftId?: string;
      jobId?: string;
      expiresAt?: string;
    }
  | {
      kind: "success";
      filename: string;
      parseStatus?: ParseResumeStatus;
      draftId?: string;
    }
  | {
      kind: "error";
      filename: string;
      message: string;
      draftId?: string;
      jobId?: string;
      expiresAt?: string;
    };

export type JdStatus =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "success"; rationale: string }
  | { kind: "error"; message: string };
