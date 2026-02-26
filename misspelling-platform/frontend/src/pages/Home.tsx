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
  const [selectedVariants, setSelectedVariants] = useState<string[]>([]);
  const [manualVariant, setManualVariant] = useState("");
  const [loginUser, setLoginUser] = useState(() => window.sessionStorage.getItem("user_login_username") ?? "");
  const [loginPass, setLoginPass] = useState("");
  const [userToken, setUserToken] = useState(() => window.sessionStorage.getItem("user_access_token") ?? "");
  const [meInfo, setMeInfo] = useState<{ username: string; roles: string[] } | null>(null);
  const [authMsg, setAuthMsg] = useState("");
  const [waStartYear, setWaStartYear] = useState("1900");
  const [waEndYear, setWaEndYear] = useState("2019");
  const [waCorpus, setWaCorpus] = useState("eng_2019");
  const [waSmoothing, setWaSmoothing] = useState("3");

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

  useEffect(() => {
    window.sessionStorage.setItem("user_access_token", userToken);
    window.sessionStorage.setItem("user_login_username", loginUser);
  }, [userToken, loginUser]);

  useEffect(() => {
    setVariantInfo(null);
    setVariantMsg("");
    setSelectedVariants([]);
  }, [word]);

  useEffect(() => {
    if (!userToken) {
      setMeInfo(null);
      return;
    }
    api.authMe(userToken)
      .then((r) => {
        setMeInfo({ username: r.user.username, roles: r.user.roles ?? [] });
        setAuthMsg("");
      })
      .catch((e) => {
        setMeInfo(null);
        setAuthMsg(describeApiError(e));
      });
  }, [userToken]);

  const createWord = async () => {
    setBusy("word");
    try {
      const variants = Array.from(
        new Set(selectedVariants.map((v) => v.trim()).filter(Boolean))
      );
      const r = await api.createWordAnalysis({
        word: word.trim() || "demo",
        start_year: Number(waStartYear) || 1900,
        end_year: Number(waEndYear) || 2019,
        smoothing: Math.max(0, Math.min(50, Number(waSmoothing) || 0)),
        corpus: waCorpus.trim() || "eng_2019",
        variants,
      });
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
      setSelectedVariants((prev) => Array.from(new Set([...prev, ...(r.variants ?? [])])));
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

  const login = async () => {
    try {
      const resp = await api.authLogin(loginUser.trim(), loginPass);
      setUserToken(resp.access_token);
      setMeInfo({ username: resp.user.username, roles: resp.user.roles ?? [] });
      setAuthMsg("");
      setLoginPass("");
    } catch (e) {
      setAuthMsg(describeApiError(e));
    }
  };

  const toggleVariant = (variant: string) => {
    setSelectedVariants((prev) =>
      prev.includes(variant) ? prev.filter((v) => v !== variant) : [...prev, variant]
    );
  };

  const addManualVariant = () => {
    const v = manualVariant.trim();
    if (!v) return;
    setSelectedVariants((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setManualVariant("");
  };

  const deleteTask = async (taskId: string) => {
    if (!window.confirm(`Delete task ${taskId}? This will remove cached artifacts and task-linked time series.`)) return;
    try {
      await api.deleteTask(taskId);
      if (lastTaskId === taskId) setLastTaskId("");
      await refresh();
    } catch (e) {
      setListErr(describeApiError(e));
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Researcher Entry</h2>
        <div className="muted">Health: {health ? `${health.status} / db=${String(health.db)}` : "loading..."}</div>
        <div className="row-inline">
          <span className="muted">User Auth:</span>
          <input placeholder="username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} style={{ width: 140 }} />
          <input type="password" placeholder="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} style={{ width: 140 }} />
          <button onClick={login}>Login</button>
          {userToken && <button onClick={() => { setUserToken(""); setMeInfo(null); }}>Logout</button>}
          {meInfo && <span className="muted">Logged in: {meInfo.username} ({(meInfo.roles || []).join(", ") || "no-role"})</span>}
        </div>
        {authMsg && <div className="muted">{authMsg}</div>}
        {healthErr && <div className="error-text">{healthErr}</div>}
      </section>
      <section className="panel grid-two">
        <div>
          <h3>Word Analysis (Micro)</h3>
          <div className="field"><label>word</label><input value={word} onChange={(e) => setWord(e.target.value)} /></div>
          <div className="grid-two">
            <div className="field"><label>start_year</label><input value={waStartYear} onChange={(e) => setWaStartYear(e.target.value)} /></div>
            <div className="field"><label>end_year</label><input value={waEndYear} onChange={(e) => setWaEndYear(e.target.value)} /></div>
            <div className="field"><label>smoothing</label><input value={waSmoothing} onChange={(e) => setWaSmoothing(e.target.value)} /></div>
            <div className="field"><label>corpus</label><input value={waCorpus} onChange={(e) => setWaCorpus(e.target.value)} /></div>
          </div>
          <div className="row-inline">
            <button onClick={suggestVariants} disabled={busy !== ""}>{busy === "word" ? "Working..." : "Suggest Variants"}</button>
            <button onClick={createWord} disabled={busy !== ""}>{busy === "word" ? "Working..." : "Run Word Analysis"}</button>
          </div>
          <div className="row-inline" style={{ marginTop: 8 }}>
            <input
              placeholder="manual variant (Enter)"
              value={manualVariant}
              onChange={(e) => setManualVariant(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualVariant(); } }}
              style={{ flex: 1 }}
            />
            <button onClick={addManualVariant} disabled={busy !== ""}>Add Variant</button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            Selected variants for next run: {selectedVariants.length ? selectedVariants.join(", ") : "(none; use correct spelling only)"}
          </div>
          {variantMsg && <div className="error-text">{variantMsg}</div>}
          {variantInfo && (
            <div className="sub-panel">
              <div className="row-inline">
                <span className="muted">source={variantInfo.source}</span>
                <span className="muted">llm_enabled={String(variantInfo.llm_enabled ?? false)}</span>
                {variantInfo.version_id != null && <span className="muted">version_id={variantInfo.version_id}</span>}
              </div>
              {(variantInfo.warnings ?? []).map((w, idx) => (
                <div key={`${w}-${idx}`} className="muted">{w}</div>
              ))}
              {variantInfo.llm_error && <div className="error-text">LLM: {variantInfo.llm_error}</div>}
              <div className="chip-list">
                {(variantInfo.variants ?? []).map((v) => (
                  <label key={v} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={selectedVariants.includes(v)} onChange={() => toggleVariant(v)} />
                    <span className="mono">{v}</span>
                  </label>
                ))}
                {(variantInfo.variants ?? []).length === 0 && <span className="muted">No variants returned.</span>}
              </div>
            </div>
          )}
          {selectedVariants.length > 0 && (
            <div className="chip-list" style={{ marginTop: 8 }}>
              {selectedVariants.map((v) => (
                <button key={`sel-${v}`} type="button" className="chip mono" onClick={() => toggleVariant(v)}>
                  {v} ×
                </button>
              ))}
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
            <thead><tr><th>display</th><th>status</th><th>created_at</th><th>task_id</th><th colSpan={2} /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.task_id}>
                  <td>{it.display_name || it.task_type}</td>
                  <td>{it.status}</td>
                  <td>{it.created_at ?? "-"}</td>
                  <td className="mono">{it.task_id}</td>
                  <td><button onClick={() => goToTask(it.task_id)}>Open</button></td>
                  <td><button onClick={() => void deleteTask(it.task_id)}>Delete</button></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="muted">No tasks returned.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
