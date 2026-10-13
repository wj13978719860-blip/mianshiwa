import type { TraceExplorerNode, TraceHealth } from "@/wenjing/lib/api/trace";

export const healthLabel: Record<TraceHealth, string> = {
  missing: "缺失",
  partial: "部分",
  complete: "完整",
};

export const NODE_TYPE_FILTERS = [
  "all",
  "director_sample",
  "ask_question",
  "evaluator",
  "verification",
  "reward_update",
  "turn_finalize",
  "route_decision",
  "final_report",
  "refine_followup",
  "training_plan",
  "experience_extractor",
  "resume_parse",
  "self_intro_question",
  "self_intro_parse",
] as const;

const OPENING_NODES = new Set([
  "resume_parse",
  "self_intro_question",
  "self_intro_parse",
]);

const SESSION_CLOSING_NODES = new Set([
  "final_report",
  "training_plan",
  "experience_extractor",
]);

const TRACE_NODE_WORKFLOW_ORDER = [
  "resume_parse",
  "self_intro_question",
  "self_intro_parse",
  "director_sample",
  "ask_question",
  "evaluator",
  "verification",
  "reward_update",
  "turn_finalize",
  "route_decision",
  "refine_followup",
  "skip_question",
  "final_report",
  "training_plan",
  "experience_extractor",
];

const TRACE_NODE_ALIASES: Record<string, string> = {
  compress_context: "turn_finalize",
};

export function traceNodeCanonicalName(node: string | null | undefined): string {
  const raw = String(node || "").trim();
  return TRACE_NODE_ALIASES[raw] || raw;
}

export function normalizeTraceNodeFilter(node: string | null | undefined): string {
  if (!node || node === "all") return "all";
  return traceNodeCanonicalName(node);
}

export function traceNodeDisplayName(
  node: string | null | undefined,
  payload?: Record<string, unknown> | null,
): string {
  const semanticNode =
    typeof payload?.semantic_node === "string" ? payload.semantic_node : null;
  const canonical = traceNodeCanonicalName(semanticNode || node);
  return canonical || node || "—";
}

export function traceNodeDescription(
  node: string | null | undefined,
  payload?: Record<string, unknown> | null,
): string {
  if (typeof payload?.display_name_zh === "string" && payload.display_name_zh.trim()) {
    return payload.display_name_zh;
  }
  const semanticNode =
    typeof payload?.semantic_node === "string" ? payload.semantic_node : null;
  const canonical = traceNodeCanonicalName(semanticNode || node);
  if (canonical === "turn_finalize") return "轮次收尾";
  if (canonical === "route_decision") return "路由决策";
  if (canonical === "refine_followup") return "下一轮准备";
  return "";
}

export function isTurnFinalizeNode(node: string | null | undefined): boolean {
  return traceNodeCanonicalName(node) === "turn_finalize";
}

export function isVirtualTraceNode(node: string | null | undefined): boolean {
  return node === "route_decision";
}

export function traceNodeRawAlias(
  node: string | null | undefined,
  payload?: Record<string, unknown> | null,
): string {
  const display = traceNodeDisplayName(node, payload);
  return node && display !== node ? `node: ${node}` : "";
}

export function isEvaluatorFallbackTrace(node: TraceExplorerNode): boolean {
  if (node.node !== "evaluator") return false;
  const evaluation = recordFromUnknown(node.evaluation);
  const payload = recordFromUnknown(node.payload);
  return (
    hasFallbackMarker(evaluation) ||
    hasFallbackMarker(recordFromUnknown(payload.evaluation)) ||
    hasFallbackMarker(payload)
  );
}

function hasFallbackMarker(record: Record<string, unknown>): boolean {
  if (record.source === "fallback") return true;
  if (typeof record.fallback_reason === "string" && record.fallback_reason.trim()) {
    return true;
  }
  const weaknesses = record.weaknesses;
  return Array.isArray(weaknesses)
    ? weaknesses.some((item) => String(item ?? "").toLowerCase().includes("fallback"))
    : false;
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter((item) => item.length > 0);
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseOptionalInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function countNodeTypes(nodes: TraceExplorerNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const canonical = traceNodeCanonicalName(node.node);
    counts[canonical] = (counts[canonical] || 0) + 1;
  }
  return counts;
}

export function countTurns(nodes: TraceExplorerNode[]): number {
  return new Set(nodes.map((node) => node.turn_idx ?? "session")).size;
}

const payloadSearchCache = new WeakMap<TraceExplorerNode, string>();

function payloadSearchText(node: TraceExplorerNode): string {
  const cached = payloadSearchCache.get(node);
  if (cached !== undefined) return cached;
  let text = "";
  try {
    text = node.payload ? JSON.stringify(node.payload).toLowerCase() : "";
  } catch {
    text = "";
  }
  payloadSearchCache.set(node, text);
  return text;
}

export function nodeMatchesQuery(node: TraceExplorerNode, query: string): boolean {
  const evaluation = recordFromUnknown(node.evaluation);
  const fields = [
    node.node,
    traceNodeCanonicalName(node.node),
    traceNodeDisplayName(node.node, node.payload),
    node.dimension,
    node.action_id,
    node.policy_id,
    node.context_key,
    node.question,
    node.answer_excerpt,
    ...stringList(node.policy_context_keys),
    ...stringList(evaluation.strengths),
    ...stringList(evaluation.weaknesses),
    stringValue(evaluation.rationale),
    stringValue(evaluation.feedback),
  ];
  if (fields.some((field) => String(field ?? "").toLowerCase().includes(query))) {
    return true;
  }
  return payloadSearchText(node).includes(query);
}

export function isSessionClosingNode(nodeName: string | null | undefined): boolean {
  return SESSION_CLOSING_NODES.has(traceNodeCanonicalName(nodeName));
}

export function isSessionOpeningNode(nodeName: string | null | undefined): boolean {
  return OPENING_NODES.has(traceNodeCanonicalName(nodeName));
}

type TraceTurnGroupKey = "opening" | number | "session" | "closing";

function isAskRoundStartNode(node: TraceExplorerNode): boolean {
  const canonical = traceNodeCanonicalName(node.node);
  return canonical === "director_sample" || canonical === "ask_question";
}

function shouldGroupRefineFollowupWithNextTurn(
  node: TraceExplorerNode,
  contextNodes: TraceExplorerNode[],
): boolean {
  if (traceNodeCanonicalName(node.node) !== "refine_followup") return false;
  if (typeof node.turn_idx !== "number") return false;
  const turnIdx = node.turn_idx;

  const sameTurnHasQuestionStart = contextNodes.some(
    (candidate) =>
      candidate.id !== node.id &&
      candidate.turn_idx === turnIdx &&
      isAskRoundStartNode(candidate),
  );
  if (sameTurnHasQuestionStart) return false;

  // Old traces can stamp refine_followup with the completed answer turn;
  // group it with the next ask round whose hints it prepares.
  const nextTurnHasQuestionStart = contextNodes.some(
    (candidate) => candidate.turn_idx === turnIdx + 1 && isAskRoundStartNode(candidate),
  );
  return nextTurnHasQuestionStart;
}

function effectiveTraceTurnKey(
  node: TraceExplorerNode,
  contextNodes: TraceExplorerNode[] = [],
): TraceTurnGroupKey {
  if (isSessionOpeningNode(node.node)) return "opening";
  if (isSessionClosingNode(node.node)) return "closing";
  if (shouldGroupRefineFollowupWithNextTurn(node, contextNodes)) {
    return typeof node.turn_idx === "number" ? node.turn_idx + 1 : "session";
  }
  if (isTurnFinalizeNode(node.node) && typeof node.turn_idx === "number") {
    if (node.node === "turn_finalize") return node.turn_idx;
    const payload = recordFromUnknown(node.payload);
    if (payload.phase !== "turn_finalize") return Math.max(0, node.turn_idx - 1);
  }
  return typeof node.turn_idx === "number" ? node.turn_idx : "session";
}

function traceNodeWorkflowOrder(
  node: TraceExplorerNode,
  groupNodes: TraceExplorerNode[] = [],
): number {
  const canonical = traceNodeCanonicalName(node.node);
  if (
    canonical === "refine_followup" &&
    groupNodes.some(
      (candidate) =>
        candidate.id !== node.id &&
        (traceNodeCanonicalName(candidate.node) === "director_sample" ||
          traceNodeCanonicalName(candidate.node) === "ask_question"),
    )
  ) {
    return TRACE_NODE_WORKFLOW_ORDER.indexOf("director_sample") - 0.5;
  }
  const index = TRACE_NODE_WORKFLOW_ORDER.indexOf(canonical);
  return index >= 0 ? index : TRACE_NODE_WORKFLOW_ORDER.length;
}

function traceTurnGroupLabel(key: TraceTurnGroupKey): string {
  if (key === "opening") return "准备/开场阶段";
  if (key === "closing") return "收尾阶段";
  if (key === "session") return "Session-level events";
  return `Turn ${key}`;
}

function traceTurnGroupSortKey(key: TraceTurnGroupKey): number {
  if (key === "opening") return Number.MIN_SAFE_INTEGER;
  if (key === "closing") return Number.MAX_SAFE_INTEGER;
  if (key === "session") return Number.POSITIVE_INFINITY;
  return key;
}

export type TraceTurnGroup = { label: string; nodes: TraceExplorerNode[] };

export function groupByTurn(
  nodes: TraceExplorerNode[],
  turnContextNodes: TraceExplorerNode[] = nodes,
): TraceTurnGroup[] {
  const buckets = new Map<TraceTurnGroupKey, TraceExplorerNode[]>();
  for (const node of nodes) {
    const key = effectiveTraceTurnKey(node, turnContextNodes);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      buckets.set(key, [node]);
    }
  }
  const groups = Array.from(buckets.entries()).map(([key, items]) => ({
    label: traceTurnGroupLabel(key),
    sortKey: traceTurnGroupSortKey(key),
    nodes: [...items].sort((a, b) => {
      const orderDelta =
        traceNodeWorkflowOrder(a, items) - traceNodeWorkflowOrder(b, items);
      if (orderDelta !== 0) return orderDelta;
      return a.id - b.id;
    }),
  }));
  groups.sort((a, b) => a.sortKey - b.sortKey);
  return groups.map(({ label, nodes: groupNodes }) => ({ label, nodes: groupNodes }));
}

export function formatTs(value?: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return value;
  }
}

export function pickFocusedNodeId(
  nodes: TraceExplorerNode[],
  focusNode: string | undefined,
  focusDimension: string | undefined,
): number | null {
  if (!focusNode) return null;
  const wantedNode = traceNodeCanonicalName(focusNode).toLowerCase();
  const wantedDim = focusDimension?.toLowerCase();
  const exact = nodes.find(
    (n) =>
      traceNodeCanonicalName(n.node).toLowerCase() === wantedNode &&
      (wantedDim === undefined || String(n.dimension ?? "").toLowerCase() === wantedDim),
  );
  if (exact) return exact.id;
  const nodeOnly = nodes.find(
    (n) => traceNodeCanonicalName(n.node).toLowerCase() === wantedNode,
  );
  return nodeOnly?.id ?? null;
}
