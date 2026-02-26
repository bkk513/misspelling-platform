import { useEffect, useState } from "react";
import { api, describeApiError, type AdminAuditLogItem } from "../lib/api";

export function AdminPage() {
  const [adminTokenCompat, setAdminTokenCompat] = useState(() => window.sessionStorage.getItem("admin_token") ?? "");
  const [accessToken, setAccessToken] = useState(() => window.sessionStorage.getItem("admin_access_token") ?? "");
  const [username, setUsername] = useState(() => window.sessionStorage.getItem("admin_username") ?? "");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<{ username: string; roles: string[] } | null>(null);
  const [loginMsg, setLoginMsg] = useState("");
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [auditMsg, setAuditMsg] = useState("Loading audit logs...");
  const [users, setUsers] = useState<Array<{ id: number; username: string; roles: string[] }>>([]);
  const [usersMsg, setUsersMsg] = useState("");
  const [gbncRows, setGbncRows] = useState<Array<{ series_id: number; canonical: string; variant: string; point_count: number; corpus?: string; updated_at?: string }>>([]);
  const [gbncMsg, setGbncMsg] = useState("");
  const [word, setWord] = useState("demo");
  const [variantsInput, setVariantsInput] = useState("demo-x\ndemoo");
  const [submitMsg, setSubmitMsg] = useState("");

  const loadAuditLogs = async (tokenOverride?: string) => {
    try {
      const resp = await api.adminListAuditLogs(20, tokenOverride ?? accessToken, adminTokenCompat.trim());
      setAuditLogs(resp.items ?? []);
      setAuditMsg(resp.items?.length ? "" : "No audit logs yet.");
    } catch (e) {
      setAuditMsg(describeApiError(e));
    }
  };

  useEffect(() => {
    window.sessionStorage.setItem("admin_token", adminTokenCompat);
    window.sessionStorage.setItem("admin_access_token", accessToken);
    window.sessionStorage.setItem("admin_username", username);
  }, [adminTokenCompat, accessToken, username]);

  const refreshAdmin = async (tokenOverride?: string) => {
    const bearer = tokenOverride ?? accessToken;
    try {
      const meResp = await api.authMe(bearer);
      const roles = meResp.user.roles ?? [];
      setMe({ username: meResp.user.username, roles });
      if (!roles.map((r) => r.toLowerCase()).includes("admin")) {
        setLoginMsg("Logged in but current user has no admin role.");
        return;
      }
      setLoginMsg("");
    } catch (e) {
      setMe(null);
      setLoginMsg(accessToken ? describeApiError(e) : "Please login as admin.");
      return;
    }
      await Promise.all([
      loadAuditLogs(bearer),
      api.adminListUsers(50, bearer, adminTokenCompat.trim()).then((r) => { setUsers(r.items ?? []); setUsersMsg(""); }).catch((e) => setUsersMsg(describeApiError(e))),
      api.adminListGbncSeries(50, bearer, adminTokenCompat.trim()).then((r) => { setGbncRows(r.items ?? []); setGbncMsg(""); }).catch((e) => setGbncMsg(describeApiError(e))),
    ]);
  };

  useEffect(() => {
    void refreshAdmin();
  }, []);

  const submitVariants = async () => {
    setSubmitMsg("Submitting...");
    try {
      const variants = variantsInput
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
      const resp = await api.adminAddLexiconVariants({ word, variants }, accessToken, adminTokenCompat.trim());
      setSubmitMsg(`Saved ${resp.count} variants to term_id=${resp.term_id}, version_id=${resp.version_id ?? "null"}`);
      await refreshAdmin();
    } catch (e) {
      setSubmitMsg(describeApiError(e));
    }
  };

  const login = async () => {
    try {
      const resp = await api.authLogin(username.trim(), password);
      setAccessToken(resp.access_token);
      setPassword("");
      setLoginMsg("");
      await refreshAdmin(resp.access_token);
    } catch (e) {
      setLoginMsg(describeApiError(e));
    }
  };

  const isAdmin = !!me && (me.roles || []).map((r) => r.toLowerCase()).includes("admin");

  return (
    <div className="stack">
      <section className="panel">
        <h2>Admin Console</h2>
        <p className="muted">Login with username/password (`/api/auth/login`). Admin APIs require Bearer token with admin role.</p>
        <div className="row-inline">
          <input placeholder="admin username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button onClick={() => void login()}>Login</button>
          {accessToken && <button onClick={() => { setAccessToken(""); setMe(null); }}>Logout</button>}
        </div>
        <div className="field">
          <label>Deprecated compat token (optional, requires backend ALLOW_ADMIN_TOKEN_COMPAT=1)</label>
          <input type="password" value={adminTokenCompat} onChange={(e) => setAdminTokenCompat(e.target.value)} placeholder="deprecated X-Admin-Token" />
        </div>
        {me && <div className="muted">Logged in: {me.username} ({me.roles.join(", ") || "no-role"})</div>}
        {loginMsg && <div className="error-text">{loginMsg}</div>}
        <button onClick={() => void refreshAdmin()}>Refresh Admin Console</button>
      </section>
      {!isAdmin && <section className="panel"><div className="muted">Admin login required to access console modules.</div></section>}
      {isAdmin && (
        <>
          <section className="panel">
            <h3>Manual Lexicon Variant Add</h3>
            <div className="field"><label>word</label><input value={word} onChange={(e) => setWord(e.target.value)} /></div>
            <div className="field"><label>variants (newline or comma separated)</label><textarea className="text-area" value={variantsInput} onChange={(e) => setVariantsInput(e.target.value)} /></div>
            <button onClick={() => void submitVariants()}>Submit Variants</button>
            {submitMsg && <div className="muted" style={{ marginTop: 8 }}>{submitMsg}</div>}
          </section>
          <section className="panel">
            <h3>Users</h3>
            {usersMsg && <div className="muted">{usersMsg}</div>}
            <div className="table-wrap">
              <table className="simple-table">
                <thead><tr><th>id</th><th>username</th><th>roles</th></tr></thead>
                <tbody>
                  {users.map((u) => <tr key={u.id}><td>{u.id}</td><td>{u.username}</td><td>{(u.roles || []).join(", ")}</td></tr>)}
                  {users.length === 0 && <tr><td colSpan={3} className="muted">No users.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h3>Data Sources / GBNC Pull Records</h3>
            {gbncMsg && <div className="muted">{gbncMsg}</div>}
            <div className="table-wrap">
              <table className="simple-table">
                <thead><tr><th>series_id</th><th>word</th><th>variant</th><th>points</th><th>corpus</th><th>updated_at</th></tr></thead>
                <tbody>
                  {gbncRows.map((r) => <tr key={r.series_id}><td className="mono">{r.series_id}</td><td>{r.canonical}</td><td>{r.variant}</td><td>{r.point_count}</td><td>{r.corpus ?? "-"}</td><td>{r.updated_at ?? "-"}</td></tr>)}
                  {gbncRows.length === 0 && <tr><td colSpan={6} className="muted">No GBNC series records.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {isAdmin && (
        <section className="panel">
          <h3>Audit Logs</h3>
          {auditMsg && <div className="muted">{auditMsg}</div>}
          <div className="table-wrap">
            <table className="simple-table">
              <thead><tr><th>time</th><th>action</th><th>target</th><th>meta</th></tr></thead>
              <tbody>
                {auditLogs.map((it) => (
                  <tr key={it.id}>
                    <td>{it.created_at ?? "-"}</td>
                    <td>{it.action}</td>
                    <td>{it.target_type}/{it.target_id}</td>
                    <td><pre className="pre-block">{JSON.stringify(it.meta ?? null, null, 2)}</pre></td>
                  </tr>
                ))}
                {auditLogs.length === 0 && <tr><td colSpan={4} className="muted">No audit logs.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
