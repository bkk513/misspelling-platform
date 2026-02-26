import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { LineChart } from "../components/LineChart";
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

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskDetailResponse | null>(null);
  const [taskErr, setTaskErr] = useState("");
  const [events, setEvents] = useState<TaskEventsResponse | null>(null);
  const [eventsInfo, setEventsInfo] = useState("");
  const [polling, setPolling] = useState(true);
  const [ticks, setTicks] = useState(0);
  const [probePngOk, setProbePngOk] = useState<boolean | null>(null);
  const [probeCsvOk, setProbeCsvOk] = useState<boolean | null>(null);
  const [tsInfo, setTsInfo] = useState<string>("Loading...");
  const [tsVariants, setTsVariants] = useState<string[]>([]);
  const [tsShowAll, setTsShowAll] = useState(false);
  const [tsSeries, setTsSeries] = useState<Array<{ name: string; points: Array<{ time: string; value: number }> }>>([]);

  const taskObj = useMemo(() => asObject(task?.result), [task?.result]);
  const taskType = useMemo(() => {
    const queued = events?.items?.find((e) => e.event_type === "QUEUED");
    const meta = asObject(queued?.meta);
    const t = meta?.task_type;
    return typeof t === "string" ? t : "-";
  }, [events]);
  const taskDisplayName = useMemo(() => {
    return typeof task?.display_name === "string" && task.display_name ? task.display_name : taskType;
  }, [task?.display_name, taskType]);

  const refresh = async (resetTicks = false) => {
    if (resetTicks) setTicks(0);
    try {
      setTask(await api.getTask(taskId));
      setTaskErr("");
    } catch (e) {
      setTaskErr(describeApiError(e));
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
  };

  useEffect(() => {
    void refresh(true);
    setProbePngOk(null);
    setProbeCsvOk(null);
    setTsInfo("Loading...");
    setTsVariants([]);
    setTsShowAll(false);
    setTsSeries([]);
  }, [taskId]);

  useEffect(() => {
    if (!polling) return;
    if (ticks >= 30) return;
    const id = window.setTimeout(() => {
      void refresh();
      setTicks((t) => t + 1);
    }, 2000);
    return () => window.clearTimeout(id);
  }, [polling, ticks, taskId]);

  useEffect(() => {
    if (ticks >= 30) setPolling(false);
  }, [ticks]);

  useEffect(() => {
    const state = (task?.state || "").toUpperCase();
    if (state !== "SUCCESS") {
      setProbeCsvOk(null);
      return;
    }
    fetch(api.fileUrl(taskId, "result.csv"))
      .then((r) => setProbeCsvOk(r.ok))
      .catch(() => setProbeCsvOk(false));
  }, [task?.state, taskId]);

  useEffect(() => {
    let cancelled = false;
    api.getTimeSeriesMeta(taskId)
      .then((meta) => {
        if (cancelled) return;
        const variants = meta.variants?.length ? meta.variants : ["correct"];
        const sourceKind = /stub/i.test(meta.source || "") ? "stub" : /cache/i.test(meta.source || "") ? "cache" : "external";
        setTsVariants(variants);
        setTsInfo(
          `source=${sourceKind} granularity=${meta.granularity} variants_count=${variants.length} points_count=${meta.point_count}`
        );
      })
      .catch((e) => {
        if (cancelled) return;
        const err = e as { status?: number };
        setTsVariants([]);
        setTsSeries([]);
        setTsInfo(
          err?.status === 404
            ? "未写入时序数据。"
            : describeApiError(e)
        );
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (tsVariants.length === 0) return;
    let cancelled = false;
    const visible = (tsShowAll ? tsVariants : tsVariants.slice(0, 6)).filter(Boolean);
    Promise.all(
      visible.map(async (variant) => {
        const resp = await api.getTimeSeriesPoints(taskId, variant);
        return { name: variant, points: resp.items ?? [] };
      })
    )
      .then((rows) => {
        if (!cancelled) setTsSeries(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setTsSeries([]);
        setTsInfo(describeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, tsVariants, tsShowAll]);

  const csvUrl = api.fileUrl(taskId, "result.csv");
  const pngUrl = api.fileUrl(taskId, "preview.png");
  const resultFiles = asObject(taskObj?.files);
  const resultPreviewRows = Array.isArray(taskObj?.preview) ? taskObj?.preview : [];

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
            <button onClick={() => setPolling((v) => !v)}>{polling ? "Stop Auto Refresh" : "Resume Auto Refresh"}</button>
            <button onClick={() => void refresh()}>Refresh Now</button>
          </div>
        </div>
        <div className="row-inline">
          <span className="muted">Display: {taskDisplayName}</span>
          <span className="muted">Task Type: {taskType}</span>
          <span style={{ color: statusTone(task?.state), fontWeight: 600 }}>Status: {task?.state ?? "loading..."}</span>
          <span className="muted">Polling: {polling ? `on (${ticks * 2}s)` : `off (${ticks >= 30 ? "auto-stopped at 60s" : "manual"})`}</span>
        </div>
        {taskErr && <div className="error-text">{taskErr}</div>}
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
                {events.items.map((e, idx) => (
                  <tr key={`${e.event_type}-${e.created_at}-${idx}`}>
                    <td>{e.created_at ?? "-"}</td>
                    <td style={{ color: statusTone(e.event_type), fontWeight: 600 }}>{e.event_type}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
                {events.items.length === 0 && <tr><td colSpan={3} className="muted">No events.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Artifacts</h3>
        <div className="row-inline">
          <a href={csvUrl} target="_blank" rel="noreferrer">Download result.csv</a>
          <span className="muted">
            {probeCsvOk === null ? "CSV status pending..." : probeCsvOk ? "CSV available (HTTP 200)" : "CSV not available (404/5xx)"}
          </span>
        </div>
        <div className="row-inline">
          <a href={pngUrl} target="_blank" rel="noreferrer">Download preview.png</a>
          <span className="muted">
            {probePngOk === null ? "PNG status pending..." : probePngOk ? "PNG available (HTTP 200)" : "PNG not available (404/5xx)"}
          </span>
        </div>
        {(taskType === "simulation-run" || probePngOk !== false) && (
          <div className="panel" style={{ marginTop: 12, background: "#fafafa" }}>
            <div className="muted" style={{ marginBottom: 8 }}>preview.png (simulation-run)</div>
            <img
              src={pngUrl}
              alt="preview artifact"
              style={{ maxWidth: "100%", border: "1px solid #e5e7eb", borderRadius: 6 }}
              onLoad={() => setProbePngOk(true)}
              onError={() => setProbePngOk(false)}
            />
          </div>
        )}
        {resultFiles && <div className="muted" style={{ marginTop: 8 }}>Result files payload: {JSON.stringify(resultFiles)}</div>}
        {resultPreviewRows.length > 0 && (
          <div className="muted" style={{ marginTop: 8 }}>
            Preview rows captured in task result: {resultPreviewRows.length}. Open Task Lifecycle/Result for full JSON.
          </div>
        )}
      </section>

      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Time Series</h3>
        <div className="muted" style={{ marginBottom: 10 }}>{tsInfo}</div>
        {tsVariants.length > 0 && (
          <>
            <div className="row-inline">
              <span className="muted">showing {Math.min(tsSeries.length, tsShowAll ? tsVariants.length : 6)} / {tsVariants.length} variants</span>
              {tsVariants.length > 6 && (
                <button onClick={() => setTsShowAll((v) => !v)}>{tsShowAll ? "Show First 6" : "Show All Variants"}</button>
              )}
              <button onClick={() => void refresh()}>Refresh Task State</button>
              <button onClick={() => goToTask(taskId)}>Reload Route</button>
            </div>
            <LineChart series={tsSeries} title="Time Series (variants)" />
            {!tsShowAll && tsVariants.length > 6 && (
              <div className="muted" style={{ marginTop: 8 }}>
                Hidden variants: {tsVariants.slice(6).join(", ")}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
