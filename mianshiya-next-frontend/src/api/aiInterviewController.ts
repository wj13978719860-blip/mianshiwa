import request from "@/libs/request";

/** 新模拟面试契约：ID 使用字符串，避免 Java Long 在浏览器中丢失精度。 */
export interface InterviewSetup {
  bankId: string; bankTitle?: string; jobPosition: string;
  experience: "应届生" | "1-3 年" | "3-5 年" | "5 年以上";
  difficulty: "基础" | "进阶" | "深入"; maxQuestions: number; allowFollowup: boolean;
  background: string; jobDescription: string;
  workflowVersion?: "v2"; directionId?: string; depth?: "short" | "standard" | "deep";
  level?: "junior" | "mid" | "senior"; candidateProfile?: CandidateProfile; jobProfile?: JobProfile;
}
export interface CandidateProfile { summary: string; skills: string[]; concerns: string[]; projects: { name: string; role: string; techStack: string[]; contributions: string; challenges: string }[] }
export interface JobProfile { title: string; requirements: string[]; skills: string[]; dimensions: string[] }
export interface InterviewCatalog { version: string; directions: { direction: string; industry: string; label: string; default_title: string; template: string; skills: string[]; dimension_catalog: { id: string; label: string; description: string }[] }[]; depths: { id: "short" | "standard" | "deep"; label: string; turns: number }[] }
export interface SetupJob { id: string; kind: "resume" | "jd"; status: "queued" | "running" | "succeeded" | "failed"; result: CandidateProfile | JobProfile | null; error: string | null; message: string | null }
export interface InterviewQuestion { id: string; sourceId: string; title: string; content: string; kind: "main" | "followup" | "self_intro"; dimension?: string; projectLabel?: string; hints?: string[] }
export interface InterviewEvaluation {
  score: number; accuracy: number; completeness: number; expression: number;
  strengths: string[]; improvements: string[]; evidence: string[]; followup: string;
}
export interface InterviewTurn { question: InterviewQuestion; answer: string; status: "answered" | "skipped" | "introduced"; evaluation: InterviewEvaluation | null }
export interface InterviewReport {
  score: number | null; dimensions: { accuracy: number | null; completeness: number | null; expression: number | null };
  answered: number; skipped: number; strengths: string[]; recommendations: string[]; rubricVersion: string;
  summary?: string; trainingPlan?: { goal: string; action: string; criterion: string; turnId: string }[];
  dimensionScores?: { id: string; label: string; score: number | null; count: number }[];
}
export interface InterviewSession {
  id: string; version: number; status: "preparing" | "processing" | "waiting_answer" | "failed" | "completed";
  busy: boolean; settings: InterviewSetup; currentQuestion: InterviewQuestion | null;
  progress: { mainIndex: number; total: number }; turns: InterviewTurn[]; report: InterviewReport | null;
  createdAt: string; updatedAt: string; error: string | null;
  phase?: string; candidateProfile?: CandidateProfile;
}
interface Response<T> { code: number; data: T; message: string }
export type InterviewHistory = Pick<InterviewSession, "id" | "settings" | "status" | "createdAt" | "report" | "version">;
export type InterviewAction = "answer" | "skip" | "end" | "retry" | "hint";

/** 请求经 Java 沿用登录态，浏览器不直连 Python，不持有内部凭证。 */
export const interviewApi = {
  catalog: () => request.get<Response<InterviewCatalog>, Response<InterviewCatalog>>("/api/ai/interviews/catalog"),
  setup: (body: { commandId: string; kind: "resume" | "jd"; directionId: string; text?: string; filename?: string; fileBase64?: string }) =>
    request.post<Response<SetupJob>, Response<SetupJob>>("/api/ai/interviews/setup-jobs", body),
  setupJob: (id: string, signal?: AbortSignal) => request.get<Response<SetupJob>, Response<SetupJob>>(`/api/ai/interviews/setup-jobs/${id}`, { signal }),
  sources: () => request.get<Response<{ id: string; title: string }[]>, Response<{ id: string; title: string }[]>>("/api/ai/interviews/sources"),
  history: () => request.get<Response<InterviewHistory[]>, Response<InterviewHistory[]>>("/api/ai/interviews"),
  create: (settings: InterviewSetup, commandId: string) => request.post<Response<InterviewSession>, Response<InterviewSession>>(
    "/api/ai/interviews", { ...settings, commandId }),
  get: (id: string, signal?: AbortSignal) => request.get<Response<InterviewSession>, Response<InterviewSession>>(
    `/api/ai/interviews/${id}`, { signal, timeout: 10000 }),
  command: (session: InterviewSession, action: InterviewAction, commandId: string, answer = "") =>
    request.post<Response<InterviewSession>, Response<InterviewSession>>(`/api/ai/interviews/${session.id}/commands`, {
      commandId, expectedVersion: session.version, questionId: session.currentQuestion?.id, action, answer,
    }),
};
export const interviewStatus: Record<InterviewSession["status"], string> = {
  preparing: "正在准备", processing: "正在处理", waiting_answer: "等待回答", failed: "需要处理", completed: "已结束",
};
export function interviewError(error: unknown): string { return error instanceof Error ? error.message : "请求失败，请稍后重试"; }
