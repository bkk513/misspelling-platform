import { useEffect, useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError, type HealthResponse, type LexiconSuggestResponse, type TaskListItem } from "../lib/api";

export function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthErr, setHealthErr] = useState<string>("");
  const [word, setWord] = useState("demo");
  const [n, setN] = useState("20");
  const [steps, setSteps] = useState("15");
  const [busy, setBusy] = useState<"" | "word" | "sim">("");
  const [lastTaskId, setLastTaskId] = useState("");
  const [listErr, setListErr] = useState("");
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [variantInfo, setVariantInfo] = useState<LexiconSuggestResponse | null>(null);
  const [variantMsg, setVariantMsg] = useState("");

  const refresh = async () => {
    try {
      setHealth(await api.getHealth());
      setHealthErr("");
    } catch (e) {
      setHealthErr(describeApiError(e));
    }
    try {
      setItems((await api.listTasks(10)).items ?? []);
      setListErr("");
    } catch (e) {
      setListErr(describeApiError(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const createWord = async () => {
    setBusy("word");
    try {
      const r = await api.createWordAnalysis(word.trim() || "demo");
      setLastTaskId(r.task_id);
      await refresh();
      goToTask(r.task_id);
    } catch (e) {
      setHealthErr(describeApiError(e));
    } finally {
      setBusy("");
    }
  };

  const suggestVariants = async () => {
    setBusy("word");
    try {
      const r = await api.suggestVariants(word.trim() || "demo", 10);
      setVariantInfo(r);
      setVariantMsg("");
    } catch (e) {
      setVariantInfo(null);
      setVariantMsg(describeApiError(e));
    } finally {
      setBusy("");
    }
  };

  const createSim = async () => {
    setBusy("sim");
    try {
      const r = await api.createSimulation(Number(n) || 20, Number(steps) || 15);
      setLastTaskId(r.task_id);
      await refresh();
    } catch (e) {
      setListErr(describeApiError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Researcher Entry</h2>
        <div className="muted">Health: {health ? `${health.status} / db=${String(health.db)}` : "loading..."}</div>
        {healthErr && <div className="error-text">{healthErr}</div>}
      </section>
      <section className="panel grid-two">
        <div>
          <h3>Word Analysis (Micro)</h3>
          <div className="field"><label>word</label><input value={word} onChange={(e) => setWord(e.target.value)} /></div>
          <div className="row-inline">
            <button onClick={suggestVariants} disabled={busy !== ""}>{busy === "word" ? "Working..." : "Suggest Variants"}</button>
            <button onClick={createWord} disabled={busy !== ""}>{busy === "word" ? "Working..." : "Run Word Analysis"}</button>
          </div>
          {variantMsg && <div className="error-text">{variantMsg}</div>}
          {variantInfo && (
            <div className="sub-panel">
              <div className="row-inline">
                <span className="muted">source={variantInfo.source}</span>
                <span className="muted">llm_enabled={String(variantInfo.llm_enabled ?? false)}</span>
                {variantInfo.version_id != null && <span className="muted">version_id={variantInfo.version_id}</span>}
              </div>
              {variantInfo.warning && <div className="muted">{variantInfo.warning}</div>}
              <div className="chip-list">
                {(variantInfo.variants ?? []).map((v) => <span key={v} className="chip mono">{v}</span>)}
                {(variantInfo.variants ?? []).length === 0 && <span className="muted">No variants returned.</span>}
              </div>
            </div>
          )}
        </div>
        <div>
          <h3>Simulation Run (Macro)</h3>
          <div className="field"><label>n</label><input value={n} onChange={(e) => setN(e.target.value)} /></div>
          <div className="field"><label>steps</label><input value={steps} onChange={(e) => setSteps(e.target.value)} /></div>
          <button onClick={createSim} disabled={busy !== ""}>{busy === "sim" ? "Submitting..." : "Create"}</button>
        </div>
      </section>
      <section className="panel">
        <h3>Recent Tasks</h3>
        {lastTaskId && (
          <div className="row-inline">
            <span className="mono">{lastTaskId}</span>
            <button onClick={() => goToTask(lastTaskId)}>Open Task Detail</button>
          </div>
        )}
        {listErr && <div className="error-text">{listErr}</div>}
        <div className="table-wrap">
          <table className="simple-table">
            <thead><tr><th>task_id</th><th>type</th><th>status</th><th>created_at</th><th /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.task_id}>
                  <td className="mono">{it.task_id}</td>
                  <td>{it.task_type}</td>
                  <td>{it.status}</td>
                  <td>{it.created_at ?? "-"}</td>
                  <td><button onClick={() => goToTask(it.task_id)}>Open</button></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="muted">No tasks returned.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
