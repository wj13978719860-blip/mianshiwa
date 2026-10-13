"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  DownOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import { getSessionTrace } from "@/wenjing/lib/api/interview";
import type { TraceExplorerNode, TraceExplorerResponse } from "@/wenjing/lib/api/trace";
import {
  BackLinks,
  PartialTraceDiagnostics,
  TraceCommandCenter,
  TraceNodeDetail,
  TraceTurnRail,
} from "./trace/TraceParts";
import {
  NODE_TYPE_FILTERS,
  countNodeTypes,
  countTurns,
  groupByTurn,
  isEvaluatorFallbackTrace,
  nodeMatchesQuery,
  normalizeTraceNodeFilter,
  parseOptionalInt,
  pickFocusedNodeId,
  traceNodeCanonicalName,
  traceNodeDisplayName,
} from "./trace/traceUtils";

const { Text, Title, Paragraph } = Typography;

type Fetch =
  | { phase: "loading" }
  | { phase: "ready"; data: TraceExplorerResponse }
  | { phase: "error"; message: string };

type TraceFetcher = (
  sessionId: string,
  signal?: AbortSignal,
  options?: { offset?: number; limit?: number },
) => Promise<TraceExplorerResponse>;

export default function TraceView({ sessionId }: { sessionId: string }) {
  const fetchTrace: TraceFetcher = getSessionTrace;
  const [state, setState] = useState<Fetch>({ phase: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ phase: "loading" });
    fetchTrace(sessionId, ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ phase: "ready", data });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => ctrl.abort();
  }, [fetchTrace, sessionId, retryKey]);

  if (state.phase === "loading") {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Skeleton.Input active style={{ width: 256 }} />
        <Card>
          <Skeleton active paragraph={{ rows: 3 }} />
        </Card>
        <Card>
          <Skeleton active paragraph={{ rows: 5 }} />
        </Card>
      </Space>
    );
  }

  if (state.phase === "error") {
    return (
      <Alert
        type="error"
        showIcon
        message="Trace Explorer 加载失败"
        description={
          <Space direction="vertical" size={12}>
            <Text type="secondary">{state.message}</Text>
            <Space wrap>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => setRetryKey((k) => k + 1)}
              >
                重试
              </Button>
              <BackLinks sessionId={sessionId} />
            </Space>
          </Space>
        }
      />
    );
  }

  return <TraceExplorerView data={state.data} sessionId={sessionId} fetchTrace={fetchTrace} />;
}

function TraceExplorerView({
  data: initialData,
  sessionId,
  focusNode,
  focusDimension,
  fetchTrace,
}: {
  data: TraceExplorerResponse;
  sessionId: string;
  focusNode?: string;
  focusDimension?: string;
  fetchTrace: TraceFetcher;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [allNodes, setAllNodes] = useState<TraceExplorerNode[]>(initialData.nodes);
  const [hasMore, setHasMore] = useState(initialData.nodes_has_more);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState<string>(
    normalizeTraceNodeFilter(searchParams.get("nodeType") || "all"),
  );
  const [fallbackFilter, setFallbackFilter] = useState(
    searchParams.get("fallback") === "true",
  );
  const [searchText, setSearchText] = useState(searchParams.get("q") ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(() =>
    parseOptionalInt(searchParams.get("selectedTraceId")),
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  const totalNodeCount = initialData.node_count_total ?? initialData.trace_count;
  const diagnostics = initialData.trace_diagnostics ?? null;

  const replaceExplorerUrl = useCallback(
    (patch: Record<string, string | number | boolean | null>) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === false) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;
      window.history.replaceState(window.history.state, "", nextUrl);
    },
    [pathname],
  );

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const ctrl = new AbortController();
    fetchTrace(sessionId, ctrl.signal, { offset: allNodes.length })
      .then((resp) => {
        if (ctrl.signal.aborted) return;
        setAllNodes((prev) => [...prev, ...resp.nodes]);
        setHasMore(resp.nodes_has_more);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setLoadMoreError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingMore(false));
  }, [fetchTrace, sessionId, allNodes.length, hasMore, loadingMore]);

  const filteredNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const canonicalNodeFilter = traceNodeCanonicalName(nodeFilter);
    return allNodes.filter((node) => {
      if (nodeFilter !== "all" && traceNodeCanonicalName(node.node) !== canonicalNodeFilter) {
        return false;
      }
      if (fallbackFilter && !isEvaluatorFallbackTrace(node)) return false;
      if (!q) return true;
      return nodeMatchesQuery(node, q);
    });
  }, [allNodes, fallbackFilter, nodeFilter, searchText]);

  const grouped = useMemo(() => groupByTurn(filteredNodes, allNodes), [allNodes, filteredNodes]);
  const focusedNodeId = useMemo(
    () => pickFocusedNodeId(allNodes, focusNode, focusDimension),
    [allNodes, focusNode, focusDimension],
  );
  const selectedNode = useMemo(() => {
    const bySelected = selectedNodeId
      ? filteredNodes.find((node) => node.id === selectedNodeId)
      : null;
    if (bySelected) return bySelected;
    const byFocus = focusedNodeId
      ? filteredNodes.find((node) => node.id === focusedNodeId)
      : null;
    return byFocus ?? filteredNodes[0] ?? null;
  }, [filteredNodes, focusedNodeId, selectedNodeId]);

  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNodeId !== selectedNode.id) {
      setSelectedNodeId(selectedNode.id);
    }
  }, [selectedNode, selectedNodeId]);

  useEffect(() => {
    const needsFocusedNode = Boolean(focusNode && !focusedNodeId);
    const needsSelectedNode = Boolean(
      selectedNodeId && !allNodes.some((node) => node.id === selectedNodeId),
    );
    if ((needsFocusedNode || needsSelectedNode) && hasMore && !loadingMore) {
      loadMore();
    }
  }, [allNodes, focusNode, focusedNodeId, hasMore, loadMore, loadingMore, selectedNodeId]);

  const loadedNodeTypeCounts = useMemo(() => countNodeTypes(allNodes), [allNodes]);
  const nodeTypeCounts = initialData.node_type_counts ?? loadedNodeTypeCounts;
  const fallbackTraceCount = useMemo(
    () => initialData.fallback_trace_count ?? allNodes.filter(isEvaluatorFallbackTrace).length,
    [allNodes, initialData.fallback_trace_count],
  );

  const selectNode = useCallback(
    (node: TraceExplorerNode) => {
      setSelectedNodeId(node.id);
      replaceExplorerUrl({ selectedTraceId: node.id });
    },
    [replaceExplorerUrl],
  );

  const handleNodeFilterChange = useCallback(
    (value: string) => {
      const nextValue = normalizeTraceNodeFilter(value);
      setNodeFilter(nextValue);
      setSelectedNodeId(null);
      replaceExplorerUrl({
        nodeType: nextValue === "all" ? null : nextValue,
        selectedTraceId: null,
      });
    },
    [replaceExplorerUrl],
  );

  const handleFallbackFilterChange = useCallback(() => {
    setFallbackFilter((current) => {
      const next = !current;
      replaceExplorerUrl({ fallback: next || null, selectedTraceId: null });
      return next;
    });
    setSelectedNodeId(null);
  }, [replaceExplorerUrl]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchText(value);
      setSelectedNodeId(null);
      replaceExplorerUrl({ q: value.trim() || null, selectedTraceId: null });
    },
    [replaceExplorerUrl],
  );

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <TraceCommandCenter
        data={initialData}
        diagnostics={diagnostics}
        fallbackTraceCount={fallbackTraceCount}
        loadedCount={allNodes.length}
        nodeTypeCounts={nodeTypeCounts}
        totalNodeCount={totalNodeCount}
        turnCount={initialData.turn_count ?? countTurns(allNodes)}
      />

      {initialData.trace_health !== "missing" &&
        diagnostics &&
        diagnostics.missing_key_nodes.length > 0 && (
          <PartialTraceDiagnostics diagnostics={diagnostics} />
        )}

      {initialData.trace_health !== "missing" && (
        <Card
          title={
            <Flex wrap="wrap" justify="space-between" align="flex-start" gap={12} style={{ padding: "12px 0" }}>
              <div style={{ minWidth: 0, whiteSpace: "normal" }}>
                <Space>
                  <HistoryOutlined style={{ color: "#10b981" }} />
                  <Title level={5} style={{ margin: 0 }}>
                    轮次时间线
                  </Title>
                </Space>
                <Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 400 }}>
                  按 `generation_traces` 顺序浏览 node；右侧展示 node evidence、policy context 与 raw payload。
                  {nodeFilter !== "all" && (
                    <Text style={{ marginLeft: 8 }}>
                      节点筛选：{traceNodeDisplayName(nodeFilter)}（{filteredNodes.length} 条）
                    </Text>
                  )}
                  {fallbackFilter && (
                    <Text type="warning" style={{ marginLeft: 8 }}>
                      仅看 fallback（{filteredNodes.length} 条）
                    </Text>
                  )}
                </Paragraph>
              </div>
              {allNodes.length > 0 && (
                <Tag style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {filteredNodes.length}/{allNodes.length} 个 node
                </Tag>
              )}
            </Flex>
          }
        >
          <div style={{ maxWidth: 576 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              内容搜索
            </Text>
            <Input
              name="trace-node-search"
              type="search"
              autoComplete="off"
              allowClear
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="搜索问题、回答摘录、评估理由、context..."
              style={{ marginTop: 4 }}
            />
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {NODE_TYPE_FILTERS.map((t) => {
              const count =
                t === "all" ? totalNodeCount : (nodeTypeCounts[traceNodeCanonicalName(t)] ?? 0);
              if (t !== "all" && count === 0) return null;
              return (
                <Tag.CheckableTag
                  key={t}
                  aria-pressed={nodeFilter === t}
                  checked={nodeFilter === t}
                  onChange={() => handleNodeFilterChange(t)}
                  style={{ fontFamily: "monospace", fontSize: 11, border: "1px solid #d9d9d9" }}
                >
                  {t === "all" ? "全部" : traceNodeDisplayName(t)}
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>{count}</span>
                </Tag.CheckableTag>
              );
            })}
            {fallbackTraceCount > 0 && (
              <Tag.CheckableTag
                aria-pressed={fallbackFilter}
                checked={fallbackFilter}
                onChange={handleFallbackFilterChange}
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  border: "1px solid #ffd666",
                  ...(fallbackFilter ? { background: "#faad14" } : {}),
                }}
              >
                仅看 fallback
                <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>{fallbackTraceCount}</span>
              </Tag.CheckableTag>
            )}
          </div>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={9}>
              <TraceTurnRail
                grouped={grouped}
                selectedNodeId={selectedNode?.id ?? selectedNodeId}
                focusedNodeId={focusedNodeId}
                onSelectNode={selectNode}
              />
            </Col>
            <Col xs={24} lg={15}>
              <TraceNodeDetail
                node={selectedNode}
                focused={Boolean(selectedNode && focusedNodeId === selectedNode.id)}
                prefersReducedMotion={prefersReducedMotion}
              />
            </Col>
          </Row>

          {filteredNodes.length === 0 && (
            <Empty
              style={{ marginTop: 16 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前筛选没有命中 node。可以清空 search 或切换 node type。"
            />
          )}

          {loadMoreError && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              message={`加载更多失败：${loadMoreError}`}
            />
          )}

          {hasMore && (
            <Flex justify="center" style={{ marginTop: 16 }}>
              <Button
                size="small"
                icon={<DownOutlined />}
                loading={loadingMore}
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore
                  ? "加载中..."
                  : `加载更多（已展示 ${allNodes.length}/${totalNodeCount} 个 node）`}
              </Button>
            </Flex>
          )}
        </Card>
      )}
    </Space>
  );
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);
    const onChange = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return prefersReducedMotion;
}
