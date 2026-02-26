import { useEffect, useState } from "react";
import { api, describeApiError, type AdminAuditLogItem } from "../lib/api";

export function AdminPage() {
  const [adminToken, setAdminToken] = useState("");
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [auditMsg, setAuditMsg] = useState("Loading audit logs...");
  const [word, setWord] = useState("demo");
  const [variantsInput, setVariantsInput] = useState("demo-x\ndemoo");
  const [submitMsg, setSubmitMsg] = useState("");

  const loadAuditLogs = async () => {
    try {
      const resp = await api.adminListAuditLogs(20, adminToken.trim());
      setAuditLogs(resp.items ?? []);
      setAuditMsg(resp.items?.length ? "" : "No audit logs yet.");
    } catch (e) {
      setAuditMsg(describeApiError(e));
    }
  };

  useEffect(() => {
    void loadAuditLogs();
  }, []);

  const submitVariants = async () => {
    setSubmitMsg("Submitting...");
    try {
      const variants = variantsInput
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
      const resp = await api.adminAddLexiconVariants({ word, variants }, adminToken.trim());
      setSubmitMsg(`Saved ${resp.count} variants to term_id=${resp.term_id}, version_id=${resp.version_id ?? "null"}`);
      await loadAuditLogs();
    } catch (e) {
      setSubmitMsg(describeApiError(e));
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Admin (Demo)</h2>
        <p className="muted">Weak auth via header `X-Admin-Token`. Leave empty when backend `ADMIN_TOKEN` is unset.</p>
        <div className="field">
          <label>Admin Token</label>
          <input type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="optional" />
        </div>
        <button onClick={() => void loadAuditLogs()}>Refresh Audit Logs</button>
      </section>

      <section className="panel">
        <h3>Manual Lexicon Variant Add</h3>
        <div className="field"><label>word</label><input value={word} onChange={(e) => setWord(e.target.value)} /></div>
        <div className="field"><label>variants (newline or comma separated)</label><textarea className="text-area" value={variantsInput} onChange={(e) => setVariantsInput(e.target.value)} /></div>
        <button onClick={() => void submitVariants()}>Submit Variants</button>
        {submitMsg && <div className="muted" style={{ marginTop: 8 }}>{submitMsg}</div>}
      </section>

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
    </div>
  );
}
