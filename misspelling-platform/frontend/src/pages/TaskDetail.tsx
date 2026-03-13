import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, message, Progress, Select, Slider, Space, Tag, Typography } from "antd";
import { PauseOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { goToTask } from "../app/router";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { api, describeApiError, type TaskDetailResponse, type TaskEventsResponse } from "../lib/api";

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

function statusTone(state?: string) {
  const s = (state || "").toUpperCase();
  if (s === "SUCCESS") return "#15803d";
  if (s === "FAILURE") return "#b42318";
  if (s === "RUNNING" || s === "PROGRESS") return "#1d4ed8";
  return "#6b7280";
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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
  const [algoData, setAlgoData] = useState<{
    edges: Array<Record<string, unknown>>;
    metrics: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
    windows: Array<Record<string, unknown>>;
  }>({ edges: [], metrics: [], events: [], windows: [] });
  const [activeWindowIndex, setActiveWindowIndex] = useState(0);
  const prevTaskStateRef = useRef<string>("");

  const taskObj = useMemo(() => asObject(task?.result), [task?.result]);
  const eventItems = useMemo(() => {
    const raw = Array.isArray(events?.items) ? events.items : [];
    return raw
      .filter((item) => !!item && typeof item === "object")
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          event_type: String(row.event_type || "-"),
          message: String(row.message || ""),
          created_at: row.created_at ? String(row.created_at) : "-",
          meta: row.meta
        };
      });
  }, [events]);
  const taskType = useMemo(() => {
    const queued = eventItems.find((e) => e.event_type === "QUEUED");
    const meta = asObject(queued?.meta);
    const fromEvent = meta?.task_type;
    if (typeof fromEvent === "string" && fromEvent.trim()) {
      return fromEvent;
    }
    const provenance = asObject(taskObj?.provenance);
    const fromResult = provenance?.task_type;
    if (typeof fromResult === "string" && fromResult.trim()) {
      return fromResult;
    }
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
      for (const row of pointRows) {
        nextMap[row.variant] = row.items;
      }
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
    setAlgoData({ edges: [], metrics: [], events: [], windows: [] });
    setActiveWindowIndex(0);
    prevTaskStateRef.current = "";
    void loadTimeSeries(false);
  }, [taskId]);

  useEffect(() => {
    const state = (task?.state || "").toUpperCase();
    // Auto-stop polling when task reaches terminal state
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
      setAlgoData({ edges: [], metrics: [], events: [], windows: [] });
      setActiveWindowIndex(0);
      return;
    }
    const knownType = ["pcmci-causal", "mrnmr-steady", "deltaT-null"].includes(taskType) ? taskType : "";
    if (!knownType) {
      return;
    }
    const url = api.fileUrl(taskId, "result.json");
    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error(`result.json HTTP ${resp.status}`);
        }
        return resp.json();
      })
      .then((payload) => {
        const obj = asObject(payload);
        setAlgoData({
          edges: Array.isArray(obj?.edges) ? (obj?.edges as Array<Record<string, unknown>>) : [],
          metrics: Array.isArray(obj?.metrics) ? (obj?.metrics as Array<Record<string, unknown>>) : [],
          events: Array.isArray(obj?.events) ? (obj?.events as Array<Record<string, unknown>>) : [],
          windows: Array.isArray(obj?.window_results) ? (obj?.window_results as Array<Record<string, unknown>>) : []
        });
      })
      .catch(() => {
        setAlgoData({ edges: [], metrics: [], events: [], windows: [] });
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
  const algoSummary = asObject(taskObj?.summary);
  const algoArtifacts = asObject(taskObj?.artifacts);
  const algoWarnings = Array.isArray(taskObj?.warnings) ? taskObj?.warnings.map((v) => String(v)) : [];
  const topEdges = Array.isArray(taskObj?.top_edges) ? taskObj?.top_edges : [];
  const metricsPreview = Array.isArray(taskObj?.metrics_preview) ? taskObj?.metrics_preview : [];
  const eventsPreview = Array.isArray(taskObj?.events_preview) ? taskObj?.events_preview : [];
  const windowResults = algoData.windows;
  const safeWindowIndex = windowResults.length > 0 ? Math.min(activeWindowIndex, windowResults.length - 1) : 0;
  const activeWindow = (windowResults[safeWindowIndex] || null) as Record<string, unknown> | null;
  const activeWindowEdges = Array.isArray(activeWindow?.edges)
    ? (activeWindow?.edges as Array<Record<string, unknown>>)
    : Array.isArray(activeWindow?.top_edges)
      ? (activeWindow?.top_edges as Array<Record<string, unknown>>)
      : [];
  const edgesData = taskType === "pcmci-causal"
    ? (activeWindowEdges.length > 0 ? activeWindowEdges : (algoData.edges.length > 0 ? algoData.edges : topEdges))
    : (algoData.edges.length > 0 ? algoData.edges : topEdges);
  const metricsData = algoData.metrics.length > 0 ? algoData.metrics : metricsPreview;
  const deltaEventsData = algoData.events.length > 0 ? algoData.events : eventsPreview;
  const activeNetworkPng = String(activeWindow?.network_png || "").trim();
  const activeTimeseriesPng = String(activeWindow?.timeseries_png || "").trim();
  const activeNetworkUrl = activeNetworkPng ? api.fileUrl(taskId, activeNetworkPng) : "";
  const activeTimeseriesUrl = activeTimeseriesPng ? api.fileUrl(taskId, activeTimeseriesPng) : "";
  const mrSeries = metricsData
    .map((row) => ({
      time: String((row as Record<string, unknown>).year ?? ""),
      mr: toNumber((row as Record<string, unknown>).MR, NaN),
      nmr: toNumber((row as Record<string, unknown>).NMR, NaN)
    }))
    .filter((row) => row.time && Number.isFinite(row.mr) && Number.isFinite(row.nmr));
  const deltaSeries = deltaEventsData
    .map((row) => ({
      time: String((row as Record<string, unknown>).year ?? ""),
      value: toNumber((row as Record<string, unknown>).index, NaN)
    }))
    .filter((row) => row.time && Number.isFinite(row.value));
  const edgeChartRows = [...edgesData]
    .map((row) => ({
      source: String((row as Record<string, unknown>).source ?? "-"),
      target: String((row as Record<string, unknown>).target ?? "-"),
      weight: toNumber((row as Record<string, unknown>).weight, 0)
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 12);
  const edgeMax = Math.max(1e-9, ...edgeChartRows.map((row) => Math.abs(row.weight)));
  const isAlgoTask = ["pcmci-causal", "mrnmr-steady", "deltaT-null"].includes(taskType);

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-inline" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>Task Detail</h2>
            <div className="mono">{taskId}</div>
          </div>
          <div className="row-inline">
            <button onClick={() => navigator.clipboard?.writeText(taskId).catch(() => {})}>Copy TaskID</button>
            <Space.Compact>
              <Button
                icon={polling ? <PauseOutlined /> : <PlayCircleOutlined />}
                onClick={() => {
                  setPolling((v) => !v);
                  if (!polling) setTicks(0);
                }}
              >
                {polling ? 'Pause' : 'Resume'} Auto-Refresh
              </Button>
              <Select
                value={pollInterval}
                onChange={(next) => {
                  setTicks(0);
                  setPollInterval(next);
                  setPolling(true);
                }}
                style={{ width: 100 }}
                options={[
                  { value: 2000, label: '2s' },
                  { value: 5000, label: '5s' },
                  { value: 15000, label: '15s' },
                  { value: 30000, label: '30s' },
                ]}
              />
              <Button icon={<ReloadOutlined />} onClick={() => void refresh(false, true)}>
                Refresh Now
              </Button>
            </Space.Compact>
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              Last: {lastRefreshAt}
            </Typography.Text>
            <button
              disabled={actionBusy === "retry"}
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
            </button>
            <button
              disabled={actionBusy === "report"}
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
            </button>
          </div>
        </div>
        <div className="row-inline">
          <span className="muted">Task Type: {taskType}</span>
          <Space size={4}>
            <span style={{ fontWeight: 600 }}>Status:</span>
            <Tag color={
              task?.state?.toUpperCase() === 'SUCCESS' ? 'success' :
              task?.state?.toUpperCase() === 'FAILURE' ? 'error' :
              task?.state?.toUpperCase() === 'RUNNING' ? 'processing' :
              'default'
            }>
              {task?.state ?? "loading..."}
            </Tag>
          </Space>
          {polling && (
            <Space size={4}>
              <Badge status="processing" />
              <span className="muted">
                Auto-refresh: {Math.round(pollInterval / 1000)}s interval
                {ticks > 0 && ` (${ticks} ticks)`}
              </span>
            </Space>
          )}
          {!polling && ticks >= Math.ceil(60000 / pollInterval) && (
            <Tag color="warning">Auto-stopped at 60s</Tag>
          )}
        </div>
        <Space size="large" style={{ marginTop: 8 }}>
          <Typography.Text type="secondary">
            <strong>Events:</strong> {eventItems.length}
          </Typography.Text>
          <Typography.Text type="secondary">
            <strong>TS Points:</strong> {tsPointTotal}
          </Typography.Text>
        </Space>
        {taskErr && <div className="error-text" style={{ marginTop: 8 }}>{taskErr}</div>}
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Parameters / Result</h3>
        <div className="table-wrap">
          <table className="simple-table">
            <tbody>
              <tr><th>state</th><td>{task?.state ?? "-"}</td></tr>
              <tr><th>params</th><td><pre className="pre-block">{JSON.stringify(task?.params ?? null, null, 2)}</pre></td></tr>
              <tr><th>error</th><td><pre className="pre-block">{JSON.stringify(task?.error ?? null, null, 2)}</pre></td></tr>
              <tr><th>result</th><td><pre className="pre-block">{JSON.stringify(task?.result ?? null, null, 2)}</pre></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Task Lifecycle</h3>
        {eventsInfo && <div className="muted">{eventsInfo}</div>}
        {events && (
          <div className="table-wrap">
            <table className="simple-table">
              <thead><tr><th>time</th><th>event</th><th>message</th></tr></thead>
              <tbody>
                {eventItems.map((e, idx) => (
                  <tr key={`${e.event_type}-${e.created_at}-${idx}`}>
                    <td>{e.created_at ?? "-"}</td>
                    <td style={{ color: statusTone(e.event_type), fontWeight: 600 }}>{e.event_type}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
                {eventItems.length === 0 && <tr><td colSpan={3} className="muted">No events.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Artifacts</h3>
        <div className="muted">Temporarily empty.</div>
      </section>

      {isAlgoTask && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Algorithm Summary</h3>
          <div className="row-inline">
            <span className="muted">task_type={taskType}</span>
            <span className="muted">mode={String(provenance?.mode || "-")}</span>
            <span className="muted">dataset_source={String(provenance?.dataset_source || "-")}</span>
          </div>
          {algoSummary && (
            <pre className="pre-block" style={{ marginTop: 8 }}>{JSON.stringify(algoSummary, null, 2)}</pre>
          )}
          {algoArtifacts && (
            <pre className="pre-block" style={{ marginTop: 8 }}>{JSON.stringify(algoArtifacts, null, 2)}</pre>
          )}
          {algoWarnings.length > 0 && (
            <div className="error-text" style={{ marginTop: 8 }}>warnings: {algoWarnings.join("; ")}</div>
          )}

          {taskType === "pcmci-causal" && windowResults.length > 0 && (
            <div className="panel" style={{ marginTop: 10, background: "#fafafa" }}>
              <div className="muted" style={{ marginBottom: 8 }}>
                Sliding Window View ({windowResults.length} windows)
              </div>
              <Slider
                min={0}
                max={windowResults.length - 1}
                step={1}
                value={safeWindowIndex}
                onChange={(next) => setActiveWindowIndex(Array.isArray(next) ? next[0] : next)}
                tooltip={{
                  formatter: (value) => {
                    const idx = Number(value ?? 0);
                    const row = windowResults[idx] as Record<string, unknown> | undefined;
                    if (!row) return `window ${idx + 1}`;
                    return `${String(row.start_time || "")} -> ${String(row.end_time || "")}`;
                  }
                }}
              />
              <div className="row-inline" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <span className="muted">
                  window {safeWindowIndex + 1}/{windowResults.length}
                </span>
                <span className="muted">
                  {String(activeWindow?.start_time || "-")} → {String(activeWindow?.end_time || "-")} | edges={String(activeWindow?.edge_count || 0)}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 12,
                }}
              >
                {activeNetworkUrl && (
                  <div>
                    <div className="muted" style={{ marginBottom: 6 }}>Causal Network</div>
                    <img
                      src={activeNetworkUrl}
                      alt="pcmci-window-network"
                      style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6 }}
                    />
                  </div>
                )}
                {activeTimeseriesUrl && (
                  <div>
                    <div className="muted" style={{ marginBottom: 6 }}>Window Time Series</div>
                    <img
                      src={activeTimeseriesUrl}
                      alt="pcmci-window-timeseries"
                      style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6 }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {taskType === "pcmci-causal" && edgeChartRows.length > 0 && (
            <div className="panel" style={{ marginTop: 10, background: "#fafafa" }}>
              <div className="muted" style={{ marginBottom: 8 }}>Top Edge Weights (|weight|)</div>
              {edgeChartRows.map((row, idx) => (
                <div key={`edge-chart-${idx}`} style={{ marginBottom: 6 }}>
                  <div className="row-inline" style={{ justifyContent: "space-between" }}>
                    <span>{row.source} -&gt; {row.target}</span>
                    <span>{row.weight.toFixed(4)}</span>
                  </div>
                  <div style={{ background: "#e5e7eb", height: 8, borderRadius: 4, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(2, (Math.abs(row.weight) / edgeMax) * 100)}%`,
                        height: 8,
                        background: row.weight >= 0 ? "#2563eb" : "#dc2626"
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {taskType === "pcmci-causal" && edgesData.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="simple-table">
                <thead><tr><th>source</th><th>target</th><th>lag</th><th>weight</th><th>method</th></tr></thead>
                <tbody>
                  {edgesData.slice(0, 20).map((row, idx) => (
                    <tr key={`edge-${idx}`}>
                      <td>{String((row as Record<string, unknown>).source ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).target ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).lag ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).weight ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).method ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {taskType === "mrnmr-steady" && mrSeries.length > 0 && (
            <TimeSeriesChart
              title="MR / NMR Curves"
              series={[
                { name: "MR", data: mrSeries.map((row) => ({ time: row.time, value: row.mr })) },
                { name: "NMR", data: mrSeries.map((row) => ({ time: row.time, value: row.nmr })) }
              ]}
              height={400}
            />
          )}

          {taskType === "mrnmr-steady" && metricsData.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="simple-table">
                <thead><tr><th>year</th><th>MR</th><th>NMR</th><th>density</th></tr></thead>
                <tbody>
                  {metricsData.slice(0, 20).map((row, idx) => (
                    <tr key={`mrnmr-${idx}`}>
                      <td>{String((row as Record<string, unknown>).year ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).MR ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).NMR ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).density ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {taskType === "deltaT-null" && deltaSeries.length > 0 && (
            <TimeSeriesChart
              title="DeltaT Event Indices by Year"
              series={[{ name: "event_index", data: deltaSeries }]}
              height={400}
            />
          )}

          {taskType === "deltaT-null" && deltaEventsData.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="simple-table">
                <thead><tr><th>year</th><th>index</th></tr></thead>
                <tbody>
                  {deltaEventsData.slice(0, 20).map((row, idx) => (
                    <tr key={`deltat-${idx}`}>
                      <td>{String((row as Record<string, unknown>).year ?? "-")}</td>
                      <td>{String((row as Record<string, unknown>).index ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Time Series</h3>
          <Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void loadTimeSeries(true)}
              loading={tsLoading}
            >
              Refresh
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Last: {tsLoadedAt}
            </Typography.Text>
          </Space>
        </div>
        <div className="muted" style={{ marginBottom: 10 }}>{tsInfo}</div>
        {tsVariants.length > 0 && (
          <TimeSeriesChart
            series={tsVariants.map((variant) => ({
              name: variant,
              data: (tsSeriesMap[variant] || []).map(p => ({ time: p.time, value: p.value }))
            }))}
            title={`Time Series (${tsVariants.length} variants)`}
            height={450}
          />
        )}
      </section>
    </div>
  );
}
