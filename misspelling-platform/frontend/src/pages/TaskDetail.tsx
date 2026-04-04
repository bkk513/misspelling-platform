import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Select,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ApartmentOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  FileImageOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RetweetOutlined,
} from "@ant-design/icons";
import { goToTask } from "../app/router";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { api, describeApiError, type TaskDetailResponse, type TaskEventsResponse } from "../lib/api";
import { taskStateTone } from "./algorithmStudioShared";
import "./algorithmStudio.css";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeProgress(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  const row = asObject(value);
  const raw = row?.percent ?? row?.progress ?? row?.value;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw <= 1) return Math.max(0, Math.min(100, Math.round(raw * 100)));
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  return null;
}

function formatMetric(value: unknown, digits = 4) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(Math.min(2, digits));
  return value.toFixed(digits);
}

function labelForTaskType(taskType: string) {
  if (taskType === "pcmci-causal") return "PCMCI Causal Network";
  if (taskType === "mrnmr-steady") return "Steady State";
  if (taskType === "deltaT-null") return "DeltaT Bias";
  if (taskType === "simulation-run") return "Simulation";
  if (!taskType || taskType === "-") return "Research Task";
  return taskType;
}

function normalizeEdges(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row, index) => ({
      key: `${String(row.source ?? "-")}-${String(row.target ?? "-")}-${String(row.lag ?? index)}`,
      source: String(row.source ?? "-"),
      target: String(row.target ?? "-"),
      lag: Number(row.lag ?? 0) || 0,
      weight: Number(row.weight ?? 0) || 0,
      method: String(row.method ?? "-"),
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

type WindowPayload = {
  window_index?: number;
  start_time?: string;
  end_time?: string;
  edge_count?: number;
  network_png?: string;
  timeseries_png?: string;
  top_edges?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
};

type AlgoState = {
  edges: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  simulationRows: Array<Record<string, unknown>>;
  interventions: Array<Record<string, unknown>>;
  variantBreakdown: Array<Record<string, unknown>>;
  windows: Array<Record<string, unknown>>;
  summary: Record<string, unknown> | null;
  deltaStats: Record<string, unknown> | null;
  networkSummary: Record<string, unknown> | null;
  explanation: Record<string, unknown> | null;
};

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskDetailResponse | null>(null);
  const [taskErr, setTaskErr] = useState("");
  const [events, setEvents] = useState<TaskEventsResponse | null>(null);
  const [eventsInfo, setEventsInfo] = useState("");
  const [polling, setPolling] = useState(true);
  const [pollInterval, setPollInterval] = useState(2000);
  const [ticks, setTicks] = useState(0);
  const [tsInfo, setTsInfo] = useState<string>("Loading...");
  const [tsVariants, setTsVariants] = useState<string[]>([]);
  const [tsSeriesMap, setTsSeriesMap] = useState<Record<string, Array<{ time: string; value: number }>>>({});
  const [tsLoading, setTsLoading] = useState(false);
  const [tsLoadedAt, setTsLoadedAt] = useState<string>("-");
  const [lastRefreshAt, setLastRefreshAt] = useState<string>("-");
  const [actionBusy, setActionBusy] = useState<"" | "retry" | "report">("");
  const [algoData, setAlgoData] = useState<AlgoState>({
    edges: [],
    metrics: [],
    events: [],
    simulationRows: [],
    interventions: [],
    variantBreakdown: [],
    windows: [],
    summary: null,
    deltaStats: null,
    networkSummary: null,
    explanation: null,
  });
  const [activeWindowIndex, setActiveWindowIndex] = useState(0);
  const prevTaskStateRef = useRef<string>("");

  const taskObj = useMemo(() => asObject(task?.result), [task?.result]);
  const paramObj = useMemo(() => asObject(task?.params), [task?.params]);
  const eventItems = useMemo(() => {
    const raw = Array.isArray(events?.items) ? events.items : [];
    return raw
      .filter((item) => !!item && typeof item === "object")
      .map((item, index) => {
        const row = item as Record<string, unknown>;
        return {
          key: `${String(row.event_type || "event")}-${String(row.created_at || index)}`,
          event_type: String(row.event_type || "-"),
          message: String(row.message || ""),
          created_at: row.created_at ? String(row.created_at) : "-",
          meta: row.meta,
        };
      });
  }, [events]);

  const taskType = useMemo(() => {
    const queued = eventItems.find((e) => e.event_type === "QUEUED");
    const meta = asObject(queued?.meta);
    const fromEvent = meta?.task_type;
    if (typeof fromEvent === "string" && fromEvent.trim()) return fromEvent;
    const provenance = asObject(taskObj?.provenance);
    const fromResult = provenance?.task_type;
    if (typeof fromResult === "string" && fromResult.trim()) return fromResult;
    return "-";
  }, [eventItems, taskObj]);

  const tsPointTotal = useMemo(
    () => Object.values(tsSeriesMap).reduce((sum, points) => sum + points.length, 0),
    [tsSeriesMap]
  );

  const refresh = async (resetTicks = false, manual = false) => {
    if (resetTicks) setTicks(0);
    try {
      setTask(await api.getTask(taskId));
      setTaskErr("");
    } catch (e) {
      setTaskErr(describeApiError(e));
      if (manual) message.error("Refresh failed.");
    }
    try {
      setEvents(await api.getTaskEvents(taskId));
      setEventsInfo("");
    } catch (e) {
      const msg = describeApiError(e);
      const err = e as { status?: number };
      if (err?.status === 404) {
        setEvents(null);
        setEventsInfo("Events endpoint not enabled on this backend.");
      } else {
        setEventsInfo(msg);
      }
    }
    setLastRefreshAt(new Date().toLocaleTimeString());
    if (manual) message.success("Task state refreshed.");
  };

  const loadTimeSeries = async (manual = false) => {
    setTsLoading(true);
    try {
      const meta = await api.getTimeSeriesMeta(taskId);
      const variants = meta.variants?.length ? meta.variants : ["correct"];
      const pointRows = await Promise.all(
        variants.map(async (variant) => {
          try {
            const resp = await api.getTimeSeriesPoints(taskId, variant);
            return { variant, items: resp.items ?? [] };
          } catch {
            return { variant, items: [] as Array<{ time: string; value: number }> };
          }
        })
      );
      const nextMap: Record<string, Array<{ time: string; value: number }>> = {};
      for (const row of pointRows) nextMap[row.variant] = row.items;
      setTsVariants(variants);
      setTsSeriesMap(nextMap);
      setTsInfo(
        `source=${meta.source} word=${meta.word} granularity=${meta.granularity} variants=${variants.length} points=${meta.point_count}`
      );
      setTsLoadedAt(new Date().toLocaleTimeString());
      if (manual) message.success("Time-series refreshed.");
    } catch (e) {
      const err = e as { status?: number };
      setTsVariants([]);
      setTsSeriesMap({});
      setTsInfo(
        err?.status === 404
          ? "This task has no time-series data (optional module not enabled or data not written)."
          : describeApiError(e)
      );
      if (manual) message.error("Time-series refresh failed.");
    } finally {
      setTsLoading(false);
    }
  };

  useEffect(() => {
    void refresh(true);
    setTsInfo("Loading...");
    setTsVariants([]);
    setTsSeriesMap({});
    setTsLoadedAt("-");
    setAlgoData({ edges: [], metrics: [], events: [], simulationRows: [], interventions: [], variantBreakdown: [], windows: [], summary: null, deltaStats: null, networkSummary: null, explanation: null });
    setActiveWindowIndex(0);
    prevTaskStateRef.current = "";
    void loadTimeSeries(false);
  }, [taskId]);

  useEffect(() => {
    const state = (task?.state || "").toUpperCase();
    if (state === "SUCCESS" || state === "FAILURE") {
      setPolling(false);
      return;
    }
    if (!polling) return;
    if (ticks >= Math.ceil(60000 / pollInterval)) return;
    const id = window.setTimeout(() => {
      void refresh();
      setTicks((t) => t + 1);
    }, pollInterval);
    return () => window.clearTimeout(id);
  }, [polling, ticks, taskId, pollInterval, task?.state]);

  useEffect(() => {
    if (ticks >= Math.ceil(60000 / pollInterval)) setPolling(false);
  }, [ticks, pollInterval]);

  useEffect(() => {
    const state = (task?.state || "").toUpperCase();
    if (state !== "SUCCESS") {
      setAlgoData({ edges: [], metrics: [], events: [], simulationRows: [], interventions: [], variantBreakdown: [], windows: [], summary: null, deltaStats: null, networkSummary: null, explanation: null });
      setActiveWindowIndex(0);
      return;
    }
    const knownType = ["pcmci-causal", "mrnmr-steady", "deltaT-null", "simulation-run"].includes(taskType) ? taskType : "";
    if (!knownType) return;
    fetch(api.fileUrl(taskId, "result.json"))
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`result.json HTTP ${resp.status}`);
        return resp.json();
      })
      .then((payload) => {
        const obj = asObject(payload);
        setAlgoData({
          edges: Array.isArray(obj?.edges) ? (obj.edges as Array<Record<string, unknown>>) : [],
          metrics: Array.isArray(obj?.metrics) ? (obj.metrics as Array<Record<string, unknown>>) : [],
          events: Array.isArray(obj?.events) ? (obj.events as Array<Record<string, unknown>>) : [],
          simulationRows: Array.isArray(obj?.series_rows) ? (obj.series_rows as Array<Record<string, unknown>>) : [],
          interventions: Array.isArray(obj?.interventions) ? (obj.interventions as Array<Record<string, unknown>>) : [],
          variantBreakdown: Array.isArray(obj?.variant_breakdown) ? (obj.variant_breakdown as Array<Record<string, unknown>>) : [],
          windows: Array.isArray(obj?.window_results) ? (obj.window_results as Array<Record<string, unknown>>) : [],
          summary: asObject(obj?.summary),
          deltaStats: asObject(obj?.delta_t_stats),
          networkSummary: asObject(obj?.network_summary),
          explanation: asObject(obj?.explanation),
        });
      })
      .catch(() => {
        setAlgoData({ edges: [], metrics: [], events: [], simulationRows: [], interventions: [], variantBreakdown: [], windows: [], summary: null, deltaStats: null, networkSummary: null, explanation: null });
        setActiveWindowIndex(0);
      });
  }, [task?.state, taskId, taskType]);

  useEffect(() => {
    const currentState = String(task?.state || "").toUpperCase();
    const prevState = prevTaskStateRef.current;
    prevTaskStateRef.current = currentState;
    if (currentState === "SUCCESS" && (prevState !== "SUCCESS" || tsPointTotal === 0)) {
      void loadTimeSeries(false);
    }
  }, [task?.state, taskId, tsPointTotal]);

  useEffect(() => {
    if (algoData.windows.length === 0) {
      if (activeWindowIndex !== 0) setActiveWindowIndex(0);
      return;
    }
    if (activeWindowIndex > algoData.windows.length - 1) {
      setActiveWindowIndex(algoData.windows.length - 1);
    }
  }, [algoData.windows.length, activeWindowIndex]);

  const provenance = asObject(taskObj?.provenance);
  const summary = algoData.summary || asObject(taskObj?.summary);
  const algoWarnings = Array.isArray(taskObj?.warnings) ? taskObj.warnings.map((v) => String(v)) : [];
  const progressPercent = normalizeProgress(task?.progress);
  const windowResults = algoData.windows as WindowPayload[];
  const safeWindowIndex = windowResults.length > 0 ? Math.min(activeWindowIndex, windowResults.length - 1) : 0;
  const activeWindow = windowResults[safeWindowIndex] || null;
  const activeNetworkPng = String(activeWindow?.network_png || "").trim();
  const activeTimeseriesPng = String(activeWindow?.timeseries_png || "").trim();
  const activeNetworkUrl = activeNetworkPng ? api.fileUrl(taskId, activeNetworkPng) : "";
  const activeTimeseriesUrl = activeTimeseriesPng ? api.fileUrl(taskId, activeTimeseriesPng) : "";
  const previewImageUrl = task?.state?.toUpperCase() === "SUCCESS" ? api.fileUrl(taskId, "preview.png") : "";
  const artifacts = asObject(taskObj?.artifacts);
  const explanation = algoData.explanation || asObject(taskObj?.explanation);
  const simulationGifUrl =
    taskType === "simulation-run" && typeof artifacts?.gif === "string" && task?.state?.toUpperCase() === "SUCCESS"
      ? api.fileUrl(taskId, "propagation.gif")
      : "";
  const isAlgoTask = ["pcmci-causal", "mrnmr-steady", "deltaT-null", "simulation-run"].includes(taskType);
  const currentWindowEdges = Array.isArray(activeWindow?.edges)
    ? normalizeEdges(activeWindow.edges as Array<Record<string, unknown>>)
    : Array.isArray(activeWindow?.top_edges)
      ? normalizeEdges(activeWindow.top_edges as Array<Record<string, unknown>>)
      : normalizeEdges(algoData.edges);
  const globalEdges = normalizeEdges(algoData.edges);
  const strongestEdge = currentWindowEdges[0] || globalEdges[0];
  const deltaStats = algoData.deltaStats || asObject(taskObj?.delta_t_stats);
  const networkSummary = algoData.networkSummary || asObject(taskObj?.network_summary);
  const taskWord = String(paramObj?.word || summary?.word || provenance?.word || "Research Task");
  const taskState = String(task?.state || "loading...");
  const createdAt = eventItems[0]?.created_at || "-";
  const lastEventAt = eventItems[eventItems.length - 1]?.created_at || "-";
  const variantCount = Array.isArray(paramObj?.variants) ? paramObj.variants.length : tsVariants.length;
  const windowMarks = useMemo(() => {
    if (windowResults.length === 0) return {};
    const keyIndexes = new Set<number>([0, windowResults.length - 1, Math.floor((windowResults.length - 1) / 2)]);
    if (windowResults.length > 4) {
      keyIndexes.add(Math.floor((windowResults.length - 1) * 0.25));
      keyIndexes.add(Math.floor((windowResults.length - 1) * 0.75));
    } else {
      windowResults.forEach((_, index) => keyIndexes.add(index));
    }
    return Object.fromEntries(
      Array.from(keyIndexes)
        .sort((a, b) => a - b)
        .map((index) => {
          const item = windowResults[index];
          return [index, `${item?.start_time || ""}-${item?.end_time || ""}`];
        })
    );
  }, [windowResults]);

  const summaryEntries = useMemo(() => {
    return Object.entries(summary || {})
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .slice(0, 10);
  }, [summary]);
  const explanationWarnings = Array.isArray(explanation?.warnings) ? explanation.warnings.map((item) => String(item)) : [];
  const fitAssessment = Array.isArray(explanation?.fit_assessment) ? explanation.fit_assessment.map((item) => String(item)) : [];
  const takeaways = Array.isArray(explanation?.takeaways) ? explanation.takeaways.map((item) => String(item)) : [];
  const chartGuide = Array.isArray(explanation?.chart_guide)
    ? explanation.chart_guide
        .filter((item) => !!item && typeof item === "object")
        .map((item) => item as Record<string, unknown>)
    : [];
  const parameterNotes = Array.isArray(explanation?.parameter_notes)
    ? explanation.parameter_notes
        .filter((item) => !!item && typeof item === "object")
        .map((item) => item as Record<string, unknown>)
    : [];

  return (
    <div className="algo-studio-shell">
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Card bordered={false} className="algo-hero-card">
          <div className="algo-hero-head">
            <div>
              <div className="algo-kicker">
                <ApartmentOutlined />
                Task Intelligence / {labelForTaskType(taskType)}
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                {taskWord}
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                任务详情页已经改成与算法页同一套展示逻辑：上方给出状态和操作，中间集中展示算法证据与预览，底部保留时序和生命周期日志。原来的任务刷新、重试、导出报告、时序查询等能力保持不变。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Task State</span>
                <div className="algo-hero-note-value">{taskState.toUpperCase()}</div>
                <div className="algo-hero-note-copy">Task ID: {taskId.slice(0, 16)}...</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Last Event</span>
                <div className="algo-hero-note-value" style={{ fontSize: 22 }}>{lastEventAt === "-" ? "--" : lastEventAt}</div>
                <div className="algo-hero-note-copy">Created: {createdAt}</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Task Type</div>
              <div className="algo-score-value" style={{ fontSize: 24 }}>{labelForTaskType(taskType)}</div>
              <div className="algo-score-copy">当前任务所属算法或工作流。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Events</div>
              <div className="algo-score-value">{eventItems.length}</div>
              <div className="algo-score-copy">任务运行期间累计写入的生命周期事件。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Series Points</div>
              <div className="algo-score-value">{tsPointTotal}</div>
              <div className="algo-score-copy">当前任务可用的时序点总数。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Polling</div>
              <div className="algo-score-value">{polling ? `${Math.round(pollInterval / 1000)}s` : "Paused"}</div>
              <div className="algo-score-copy">自动刷新间隔与当前轮询状态。</div>
            </div>
          </div>

          {taskErr && <Alert style={{ marginTop: 16 }} type="error" showIcon message={taskErr} />}
        </Card>

        <Card
          className="algo-section-card"
          title={
            <div className="algo-section-title">
              <ClockCircleOutlined />
              <div className="algo-section-title-copy">
                <strong>Execution Console</strong>
                <span>控制刷新、重试任务、导出报告，并查看本次运行的输入上下文。</span>
              </div>
            </div>
          }
          extra={
            <Space wrap>
              <Button icon={<CopyOutlined />} onClick={() => navigator.clipboard?.writeText(taskId).then(() => message.success("Task ID copied")).catch(() => {})}>
                Copy Task ID
              </Button>
              <Button
                icon={polling ? <PauseOutlined /> : <PlayCircleOutlined />}
                onClick={() => {
                  setPolling((value) => !value);
                  if (!polling) setTicks(0);
                }}
              >
                {polling ? "Pause" : "Resume"} Auto Refresh
              </Button>
              <Select
                value={pollInterval}
                onChange={(next) => {
                  setTicks(0);
                  setPollInterval(next);
                  setPolling(true);
                }}
                style={{ width: 112 }}
                options={[
                  { value: 2000, label: "2s" },
                  { value: 5000, label: "5s" },
                  { value: 15000, label: "15s" },
                  { value: 30000, label: "30s" },
                ]}
              />
              <Button icon={<ReloadOutlined />} onClick={() => void refresh(false, true)}>
                Refresh
              </Button>
              <Button
                icon={<RetweetOutlined />}
                loading={actionBusy === "retry"}
                onClick={async () => {
                  setActionBusy("retry");
                  try {
                    const resp = await api.retryTask(taskId);
                    if (!resp.ok || !resp.task_id) {
                      message.warning(resp.reason || "Retry rejected");
                    } else {
                      message.success(`Retry queued: ${resp.task_id}`);
                      goToTask(resp.task_id);
                    }
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setActionBusy("");
                  }
                }}
              >
                Retry Task
              </Button>
              <Button
                icon={<FileImageOutlined />}
                loading={actionBusy === "report"}
                onClick={async () => {
                  setActionBusy("report");
                  try {
                    const resp = await api.createTaskReport(taskId);
                    message.success(`Report generated: ${resp.filename}`);
                    window.open(resp.download_url, "_blank", "noopener,noreferrer");
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setActionBusy("");
                  }
                }}
              >
                Export Report
              </Button>
            </Space>
          }
        >
          <Space wrap size={[10, 10]}>
            <Tag color={taskStateTone(taskState)}>{taskState.toUpperCase()}</Tag>
            <Tag>{labelForTaskType(taskType)}</Tag>
            {typeof paramObj?.word === "string" && <Tag>{String(paramObj.word)}</Tag>}
            {paramObj?.start_year !== undefined && paramObj?.end_year !== undefined && (
              <Tag>{String(paramObj.start_year)} - {String(paramObj.end_year)}</Tag>
            )}
            <Tag>Variants: {variantCount || 0}</Tag>
            {typeof provenance?.dataset_source === "string" && <Tag>Dataset: {String(provenance.dataset_source)}</Tag>}
            <Tag>Last refresh: {lastRefreshAt}</Tag>
            {!polling && ticks >= Math.ceil(60000 / pollInterval) && <Tag color="warning">Auto-stopped at 60s</Tag>}
          </Space>

          {progressPercent !== null && taskState.toUpperCase() !== "SUCCESS" && taskState.toUpperCase() !== "FAILURE" && (
            <div style={{ marginTop: 16 }}>
              <Progress percent={progressPercent} strokeColor="#135bdb" />
            </div>
          )}

          {task?.error && (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              message="Task finished with error"
              description="请结合下方 Lifecycle 事件与生成结果排查失败原因。"
            />
          )}

          {algoWarnings.length > 0 && (
            <Alert
              style={{ marginTop: 16 }}
              type="warning"
              showIcon
              message="Warnings"
              description={algoWarnings.join(" | ")}
            />
          )}

          {summaryEntries.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <Typography.Text strong>Run Summary</Typography.Text>
              <div className="algo-insight-list" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                {summaryEntries.map(([key, value]) => (
                  <div key={key} className="algo-insight-card">
                    <div className="algo-insight-label">{key.replace(/_/g, " ")}</div>
                    <div className="algo-insight-value" style={{ fontSize: 20 }}>{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {isAlgoTask && (
          <Card
            className="algo-section-card"
            title={
              <div className="algo-section-title">
                <BarChartOutlined />
                <div className="algo-section-title-copy">
                  <strong>Algorithm Evidence</strong>
                  <span>按算法类型展示核心可视化、窗口证据和可解释指标，不再混在原始 JSON 里。</span>
                </div>
              </div>
            }
          >
            {taskType === "pcmci-causal" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                {windowResults.length > 0 && (
                  <>
                    <div className="algo-window-toolbar">
                      <div>
                        <div className="algo-window-range">
                          {String(activeWindow?.start_time || "-")} → {String(activeWindow?.end_time || "-")}
                        </div>
                        <div className="algo-window-copy">
                          当前窗口 {safeWindowIndex + 1}/{windowResults.length}，边数 {String(activeWindow?.edge_count || 0)}。
                        </div>
                      </div>
                      <Space wrap>
                        <div className="algo-latest-tag">
                          <Badge status={taskStateTone(taskState) === "success" ? "success" : taskStateTone(taskState) === "error" ? "error" : "processing"} />
                          State: {taskState.toUpperCase()}
                        </div>
                        <div className="algo-latest-tag">Windows: {windowResults.length}</div>
                      </Space>
                    </div>
                    <div className="algo-window-slider-wrap">
                      <Slider
                        min={0}
                        max={windowResults.length - 1}
                        step={1}
                        value={safeWindowIndex}
                        marks={windowMarks}
                        onChange={(next) => setActiveWindowIndex(Array.isArray(next) ? next[0] : next)}
                      />
                    </div>
                  </>
                )}

                <div className="algo-window-grid">
                  <div className="algo-preview-frame">
                    {activeNetworkUrl ? (
                      <img src={activeNetworkUrl} alt="pcmci-window-network" />
                    ) : previewImageUrl ? (
                      <img src={previewImageUrl} alt="pcmci-preview" />
                    ) : (
                      <div className="algo-preview-empty">No network preview available.</div>
                    )}
                  </div>
                  <div className="algo-preview-frame algo-preview-secondary">
                    {activeTimeseriesUrl ? (
                      <img src={activeTimeseriesUrl} alt="pcmci-window-timeseries" />
                    ) : (
                      <div className="algo-preview-empty">No window time-series figure.</div>
                    )}
                  </div>
                  <div className="algo-insight-list">
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Strongest Edge</div>
                      <div className="algo-insight-value" style={{ fontSize: 22 }}>
                        {strongestEdge ? `${strongestEdge.source} → ${strongestEdge.target}` : "--"}
                      </div>
                      <div className="algo-insight-copy">
                        {strongestEdge ? `lag=${strongestEdge.lag}, weight=${formatMetric(strongestEdge.weight, 6)}` : "当前窗口还没有可解释的边。"}
                      </div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Tau Max</div>
                      <div className="algo-insight-value" style={{ fontSize: 22 }}>{String(summary?.tau_max ?? paramObj?.tau_max ?? "--")}</div>
                      <div className="algo-insight-copy">最大时滞设置，直接影响边搜索范围。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Alpha Level</div>
                      <div className="algo-insight-value" style={{ fontSize: 22 }}>{String(paramObj?.alpha_level ?? "--")}</div>
                      <div className="algo-insight-copy">显著性阈值。阈值越严格，保留下来的边越少。</div>
                    </div>
                  </div>
                </div>

                <Card className="algo-table-card" bordered={false}>
                  <Table
                    rowKey="key"
                    size="small"
                    pagination={{ pageSize: 8 }}
                    dataSource={currentWindowEdges.length > 0 ? currentWindowEdges : globalEdges}
                    columns={[
                      { title: "Source", dataIndex: "source" },
                      { title: "Target", dataIndex: "target" },
                      { title: "Lag", dataIndex: "lag", width: 90 },
                      { title: "Weight", dataIndex: "weight", render: (value: number) => formatMetric(value, 6) },
                      { title: "Method", dataIndex: "method" },
                    ]}
                  />
                </Card>
              </Space>
            )}

            {taskType !== "pcmci-causal" && taskType !== "simulation-run" && (
              <div className="algo-preview-grid">
                <div className="algo-preview-frame">
                  {previewImageUrl ? (
                    <img src={previewImageUrl} alt={`${taskType}-preview`} />
                  ) : (
                    <div className="algo-preview-empty">Task preview will appear after a successful run.</div>
                  )}
                </div>
                <div className="algo-insight-list">
                  {taskType === "mrnmr-steady" && (
                    <>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Origin Year</div>
                        <div className="algo-insight-value">{String(summary?.origin_year ?? "--")}</div>
                        <div className="algo-insight-copy">稳态建模分析起点。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Steady Year</div>
                        <div className="algo-insight-value">{String(summary?.steady_year ?? "--")}</div>
                        <div className="algo-insight-copy">MR / NMR 密度最高的稳态点。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Signal / Noise</div>
                        <div className="algo-insight-value" style={{ fontSize: 18 }}>Correct + Misspellings / Misspellings</div>
                        <div className="algo-insight-copy">与论文中信号和噪声的定义保持一致。</div>
                      </div>
                    </>
                  )}

                  {taskType === "deltaT-null" && (
                    <>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Actual Mutation</div>
                        <div className="algo-insight-value">{String(summary?.actual_mutation_year ?? "--")}</div>
                        <div className="algo-insight-copy">总传播曲线上的成熟 / 变异点。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Predicted Mutation</div>
                        <div className="algo-insight-value">{String(summary?.predicted_mutation_year ?? "--")}</div>
                        <div className="algo-insight-copy">零假设正确拼写曲线的成熟点。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Δt Years</div>
                        <div className="algo-insight-value">
                          {typeof deltaStats?.delta_t_years === "number" ? Number(deltaStats.delta_t_years).toFixed(1) : "--"}
                        </div>
                        <div className="algo-insight-copy">公众认知成熟被错拼传播拖慢的年份差。</div>
                      </div>
                    </>
                  )}

                  {taskType === "simulation-run" && (
                    <>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Topology</div>
                        <div className="algo-insight-value">{String(summary?.topology ?? "--")}</div>
                        <div className="algo-insight-copy">传播网络结构，决定局部复制与 hub 放大模式。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Phase Break</div>
                        <div className="algo-insight-value">{String(summary?.phase_break_year ?? "--")}</div>
                        <div className="algo-insight-copy">错误传播机制从形成期切到稳定竞争期的年份。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Error R²</div>
                        <div className="algo-insight-value">
                          {typeof summary?.error_r2 === "number" ? Number(summary.error_r2).toFixed(3) : "--"}
                        </div>
                        <div className="algo-insight-copy">错误曲线拟合优度，越接近 1 越好。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Avg Degree</div>
                        <div className="algo-insight-value">
                          {typeof networkSummary?.avg_degree === "number" ? Number(networkSummary.avg_degree).toFixed(2) : "--"}
                        </div>
                        <div className="algo-insight-copy">网络平均连接度，影响传播接触面和纠偏难度。</div>
                      </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">ABM Share Scale</div>
                      <div className="algo-insight-value">
                        {typeof summary?.error_share_amplification === "number"
                          ? `×${Number(summary.error_share_amplification).toFixed(1)}`
                          : "--"}
                      </div>
                      <div className="algo-insight-copy">
                        {typeof summary?.error_share_amplification === "number" && Number(summary.error_share_amplification) <= 1.0001
                          ? "当前直接在真实 error share 尺度上拟合，没有额外缩放。"
                          : "如果词项极度稀疏，这里会显示额外的 error share 校正倍数。"}
                      </div>
                    </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {taskType === "simulation-run" && (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="algo-media-grid algo-media-stack">
                  <div className="algo-media-card">
                    <div className="algo-preview-frame">
                      {previewImageUrl ? (
                        <img src={previewImageUrl} alt="simulation-preview" />
                      ) : (
                        <div className="algo-preview-empty">Task preview will appear after a successful run.</div>
                      )}
                    </div>
                    <div className="algo-media-tools">
                      <div className="algo-preview-caption">静态仪表板展示拟合质量、phase break 和干预收益。</div>
                      {previewImageUrl ? (
                        <Button size="small" href={previewImageUrl} target="_blank" rel="noreferrer">
                          Open Full Size
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="algo-media-card">
                    <div className="algo-preview-frame algo-preview-secondary">
                      {simulationGifUrl ? (
                        <img src={simulationGifUrl} alt="simulation-propagation" />
                      ) : (
                        <div className="algo-preview-empty">传播动图会在任务成功后自动生成。</div>
                      )}
                    </div>
                    <div className="algo-media-tools">
                      <div className="algo-preview-caption">传播动图将网络扩散、热区变化和宏观曲线放到统一时间轴里解释。</div>
                      {simulationGifUrl ? (
                        <Button size="small" href={simulationGifUrl} target="_blank" rel="noreferrer">
                          Open Full Size
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="algo-preview-grid">
                  <div className="algo-insight-list">
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">How To Read This Run</div>
                      <div className="algo-insight-copy">
                        {String(explanation?.overview || "任务成功后，这里会展示本次拟合与传播过程的整段解释。")}
                      </div>
                    </div>
                    {chartGuide.slice(0, 4).map((item) => (
                      <div className="algo-insight-card" key={String(item.key || item.title || Math.random())}>
                        <div className="algo-insight-label">{String(item.title || item.key || "Guide")}</div>
                        <div className="algo-insight-copy">{String(item.explanation || "")}</div>
                      </div>
                    ))}
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">LLM Source</div>
                      <div className="algo-insight-value" style={{ fontSize: 18 }}>
                        {String(explanation?.source || "heuristic").toUpperCase()}
                      </div>
                      <div className="algo-insight-copy">
                        {explanationWarnings.length > 0 ? explanationWarnings.join(" | ") : "参数与曲线说明优先由 Qwen 生成。"}
                      </div>
                    </div>
                  </div>

                  <div className="algo-insight-list">
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Topology</div>
                      <div className="algo-insight-value">{String(summary?.topology ?? "--")}</div>
                      <div className="algo-insight-copy">传播网络结构，决定局部复制与 hub 放大模式。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Model Family</div>
                      <div className="algo-insight-value" style={{ fontSize: 18 }}>{String(summary?.model_family ?? "--")}</div>
                      <div className="algo-insight-copy">当前实现是复杂 contagion 启发的随机 ABM，不是逐变体的纯传染病模型。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Node Meaning</div>
                      <div className="algo-insight-value" style={{ fontSize: 18 }}>{String(summary?.node_semantics ?? "--")}</div>
                      <div className="algo-insight-copy">节点代表潜在写作者或暴露单元，不直接等同于真实平台用户 ID。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Competition Scope</div>
                      <div className="algo-insight-value" style={{ fontSize: 18 }}>{String(summary?.competition_scope ?? "--")}</div>
                      <div className="algo-insight-copy">当前仿真竞争的是规范拼写与非规范拼写簇，而不是多个错拼变体彼此竞争。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">State Space</div>
                      <div className="algo-insight-value" style={{ fontSize: 18 }}>
                        {Array.isArray(summary?.state_space) ? (summary?.state_space as unknown[]).join(" / ") : "--"}
                      </div>
                      <div className="algo-insight-copy">节点状态分为 unknown、error_cluster、right 三类。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Observed Variants</div>
                      <div className="algo-insight-value">{String(summary?.observed_variant_count ?? "--")}</div>
                      <div className="algo-insight-copy">输入端实际汇总进错误簇的错拼变体数。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Phase Break</div>
                      <div className="algo-insight-value">{String(summary?.phase_break_year ?? "--")}</div>
                      <div className="algo-insight-copy">传播机制从形成期切到稳定竞争期的年份。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Fit Profile</div>
                      <div className="algo-insight-value">{String(summary?.fit_profile ?? "--")}</div>
                      <div className="algo-insight-copy">决定参数搜索与局部精修的深度。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Best Score</div>
                      <div className="algo-insight-value">
                        {typeof summary?.best_score === "number" ? Number(summary.best_score).toFixed(3) : "--"}
                      </div>
                      <div className="algo-insight-copy">综合拟合代价，越低越好。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Right R²</div>
                      <div className="algo-insight-value">
                        {typeof summary?.right_r2 === "number" ? Number(summary.right_r2).toFixed(3) : "--"}
                      </div>
                      <div className="algo-insight-copy">正确拼写主轨迹拟合优度。</div>
                    </div>
                    <div className="algo-insight-card">
                      <div className="algo-insight-label">Error RMSE</div>
                      <div className="algo-insight-value">
                        {typeof summary?.error_rmse === "number" ? Number(summary.error_rmse).toExponential(2) : "--"}
                      </div>
                      <div className="algo-insight-copy">错误拼写轨迹的偏差量级，更直观反映拟合精度。</div>
                    </div>
                  </div>
                </div>

                {fitAssessment.length > 0 && (
                  <div className="algo-score-grid">
                    {fitAssessment.map((item, index) => (
                      <div className="algo-score-card" key={`fit-note-${index}`}>
                        <div className="algo-score-label">Fit Note {index + 1}</div>
                        <div className="algo-score-copy" style={{ marginTop: 10 }}>{item}</div>
                      </div>
                    ))}
                  </div>
                )}

                {takeaways.length > 0 && (
                  <div className="algo-score-grid">
                    {takeaways.map((item, index) => (
                      <div className="algo-score-card" key={`takeaway-${index}`}>
                        <div className="algo-score-label">Interpretation {index + 1}</div>
                        <div className="algo-score-copy" style={{ marginTop: 10 }}>{item}</div>
                      </div>
                    ))}
                  </div>
                )}

                {parameterNotes.length > 0 && (
                  <Card className="algo-table-card" bordered={false}>
                    <Table
                      size="small"
                      rowKey={(row) => String(row.name || Math.random())}
                      pagination={{ pageSize: 8 }}
                      dataSource={parameterNotes}
                      columns={[
                        { title: "Parameter", dataIndex: "label", width: 180 },
                        { title: "Value", dataIndex: "display_value", width: 100 },
                        {
                          title: "Band",
                          dataIndex: "band",
                          width: 90,
                          render: (value: unknown) => String(value || "").toUpperCase(),
                        },
                        { title: "Role", dataIndex: "role" },
                        { title: "Interpretation", dataIndex: "interpretation" },
                      ]}
                    />
                  </Card>
                )}
              </Space>
            )}

            {taskType === "mrnmr-steady" && algoData.metrics.length > 0 && (
              <Card className="algo-table-card" bordered={false} style={{ marginTop: 16 }}>
                <Table
                  size="small"
                  rowKey={(row) => String((row as Record<string, unknown>).year ?? Math.random())}
                  pagination={{ pageSize: 8 }}
                  dataSource={algoData.metrics}
                  columns={[
                    { title: "Year", dataIndex: "year", width: 90 },
                    { title: "Signal", dataIndex: "signal_total", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Noise", dataIndex: "noise_misspelling", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "MR", dataIndex: "MR", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "NMR", dataIndex: "NMR", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Density", dataIndex: "density", render: (value: unknown) => formatMetric(Number(value), 6) },
                  ]}
                />
              </Card>
            )}

            {taskType === "deltaT-null" && algoData.events.length > 0 && (
              <Card className="algo-table-card" bordered={false} style={{ marginTop: 16 }}>
                <Table
                  size="small"
                  rowKey={(row) => String((row as Record<string, unknown>).year ?? Math.random())}
                  pagination={{ pageSize: 8 }}
                  dataSource={algoData.events}
                  columns={[
                    { title: "Year", dataIndex: "year", width: 90 },
                    { title: "Actual Total", dataIndex: "actual_total", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "CfC Counterfactual", dataIndex: "predicted_correct", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Actual Bootstrap", dataIndex: "actual_bootstrap", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Predicted Bootstrap", dataIndex: "predicted_bootstrap", render: (value: unknown) => formatMetric(Number(value), 6) },
                  ]}
                />
              </Card>
            )}

            {taskType === "simulation-run" && algoData.simulationRows.length > 0 && (
              <Card className="algo-table-card" bordered={false} style={{ marginTop: 16 }}>
                <Table
                  size="small"
                  rowKey={(row) => String((row as Record<string, unknown>).year ?? Math.random())}
                  pagination={{ pageSize: 8 }}
                  dataSource={algoData.simulationRows}
                  columns={[
                    { title: "Year", dataIndex: "year", width: 90 },
                    { title: "Observed Correct", dataIndex: "right_actual", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Observed Error", dataIndex: "error_actual", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Simulated Correct", dataIndex: "right_simulated", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Simulated Error", dataIndex: "error_simulated", render: (value: unknown) => formatMetric(Number(value), 6) },
                    { title: "Observed Share", dataIndex: "error_share_actual", render: (value: unknown) => formatMetric(Number(value), 4) },
                    { title: "Simulated Share", dataIndex: "error_share_simulated", render: (value: unknown) => formatMetric(Number(value), 4) },
                  ]}
                />
              </Card>
            )}
          </Card>
        )}

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={15}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <BarChartOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Time Series Evidence</strong>
                    <span>保留任务关联的完整时序结果，用于交叉核查算法输出。</span>
                  </div>
                </div>
              }
              extra={
                <Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Last: {tsLoadedAt}
                  </Typography.Text>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadTimeSeries(true)} loading={tsLoading}>
                    Refresh
                  </Button>
                </Space>
              }
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                {tsInfo}
              </Typography.Paragraph>
              {tsVariants.length > 0 ? (
                <TimeSeriesChart
                  series={tsVariants.map((variant) => ({
                    name: variant,
                    data: (tsSeriesMap[variant] || []).map((point) => ({ time: point.time, value: point.value })),
                  }))}
                  title={`Time Series (${tsVariants.length} variants)`}
                  height={460}
                />
              ) : (
                <Empty description="No time-series data available." />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={9}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <ClockCircleOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Lifecycle Log</strong>
                    <span>排查任务运行问题时，优先看这里。</span>
                  </div>
                </div>
              }
            >
              {eventsInfo && (
                <Alert style={{ marginBottom: 12 }} type="info" showIcon message={eventsInfo} />
              )}
              <Table
                size="small"
                rowKey="key"
                pagination={{ pageSize: 6 }}
                dataSource={eventItems}
                locale={{ emptyText: "No lifecycle events." }}
                columns={[
                  {
                    title: "Time",
                    dataIndex: "created_at",
                    width: 146,
                    render: (value: string) => <Typography.Text type="secondary">{value}</Typography.Text>,
                  },
                  {
                    title: "Event",
                    dataIndex: "event_type",
                    width: 120,
                    render: (value: string) => <Tag color={taskStateTone(value)}>{value}</Tag>,
                  },
                  {
                    title: "Message",
                    dataIndex: "message",
                    render: (value: string) => value || "-",
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
