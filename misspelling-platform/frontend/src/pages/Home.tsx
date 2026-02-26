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
  const [loginUser, setLoginUser] = useState(() => window.sessionStorage.getItem("user_login_username") ?? "");
  const [loginPass, setLoginPass] = useState("");
  const [userToken, setUserToken] = useState(() => window.sessionStorage.getItem("user_access_token") ?? "");
  const [meInfo, setMeInfo] = useState<{ username: string; roles: string[] } | null>(null);
  const [authMsg, setAuthMsg] = useState("");
  const [gbncStartYear, setGbncStartYear] = useState("2018");
  const [gbncEndYear, setGbncEndYear] = useState("2019");
  const [gbncCorpus, setGbncCorpus] = useState("eng_2019");
  const [gbncSmoothing, setGbncSmoothing] = useState("0");
  const [gbncBusy, setGbncBusy] = useState(false);
  const [gbncMsg, setGbncMsg] = useState("");
  const [gbncResult, setGbncResult] = useState<{ cached: boolean; items: Array<{ series_id: number; variant: string; point_count: number }> } | null>(null);

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

  const pullGbnc = async () => {
    setGbncBusy(true);
    try {
      const resp = await api.gbncPull({
        word: word.trim() || "demo",
        start_year: Number(gbncStartYear) || 2018,
        end_year: Number(gbncEndYear) || 2019,
        corpus: gbncCorpus.trim() || "eng_2019",
        smoothing: Number(gbncSmoothing) || 0,
      });
      setGbncResult({ cached: !!resp.cached, items: resp.items ?? [] });
      setGbncMsg(`GBNC pull ${resp.cached ? "cache hit" : "completed"}: ${(resp.items ?? []).length} series`);
    } catch (e) {
      setGbncResult(null);
      setGbncMsg(describeApiError(e));
    } finally {
      setGbncBusy(false);
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
              {(variantInfo.warnings ?? []).map((w, idx) => (
                <div key={`${w}-${idx}`} className="muted">{w}</div>
              ))}
              {variantInfo.llm_error && <div className="error-text">LLM: {variantInfo.llm_error}</div>}
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
        <h3>GBNC Pull (Yearly Frequency)</h3>
        <div className="grid-two">
          <div className="field"><label>word</label><input value={word} onChange={(e) => setWord(e.target.value)} /></div>
          <div className="field"><label>corpus</label><input value={gbncCorpus} onChange={(e) => setGbncCorpus(e.target.value)} /></div>
          <div className="field"><label>start_year</label><input value={gbncStartYear} onChange={(e) => setGbncStartYear(e.target.value)} /></div>
          <div className="field"><label>end_year</label><input value={gbncEndYear} onChange={(e) => setGbncEndYear(e.target.value)} /></div>
          <div className="field"><label>smoothing</label><input value={gbncSmoothing} onChange={(e) => setGbncSmoothing(e.target.value)} /></div>
        </div>
        <div className="row-inline">
          <button onClick={pullGbnc} disabled={gbncBusy}>{gbncBusy ? "Pulling..." : "Pull GBNC"}</button>
          {gbncMsg && <span className="muted">{gbncMsg}</span>}
        </div>
        {gbncResult && (
          <div className="table-wrap">
            <table className="simple-table">
              <thead><tr><th>series_id</th><th>variant</th><th>points</th><th>source</th></tr></thead>
              <tbody>
                {gbncResult.items.map((it) => (
                  <tr key={it.series_id}>
                    <td className="mono">{it.series_id}</td>
                    <td>{it.variant}</td>
                    <td>{it.point_count}</td>
                    <td>{gbncResult.cached ? "cache" : "external"}</td>
                  </tr>
                ))}
                {gbncResult.items.length === 0 && <tr><td colSpan={4} className="muted">No GBNC points were returned for the selected word/range.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
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
            <thead><tr><th>display</th><th>status</th><th>created_at</th><th>task_id</th><th /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.task_id}>
                  <td>{it.display_name || it.task_type}</td>
                  <td>{it.status}</td>
                  <td>{it.created_at ?? "-"}</td>
                  <td className="mono">{it.task_id}</td>
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
