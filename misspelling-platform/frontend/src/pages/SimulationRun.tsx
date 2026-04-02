import { BarChartOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Card, InputNumber, Space, Typography, message } from "antd";
import { useState } from "react";
import { goToTask } from "../app/router";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError } from "../lib/api";
import "./algorithmStudio.css";

export function SimulationRunPage() {
  const [n, setN] = useState(20);
  const [steps, setSteps] = useState(15);
  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  const run = async () => {
    if (turnstileEnabled && !turnstileToken) {
      message.warning("Please complete Turnstile verification first.");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.createSimulation(Number(n) || 20, Number(steps) || 15, turnstileToken);
      setLatestTaskId(resp.task_id);
      message.success(`simulation-run queued: ${resp.task_id}`);
      goToTask(resp.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
      setTurnstileNonce((v) => v + 1);
    }
  };

  return (
    <div className="algo-studio-shell">
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Card bordered={false} className="algo-hero-card">
          <div className="algo-hero-head">
            <div>
              <div className="algo-kicker">
                <BarChartOutlined />
                Simulation / Workbench
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                Simulation Workbench
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                仿真页只做显示层升级，不改提交逻辑。这里仍然负责设置群体规模和步数、完成 Turnstile 验证，然后进入对应任务详情看结果。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Population</span>
                <div className="algo-hero-note-value">{n}</div>
                <div className="algo-hero-note-copy">仿真的 agent 数量。</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Steps</span>
                <div className="algo-hero-note-value">{steps}</div>
                <div className="algo-hero-note-copy">仿真的迭代步数。</div>
              </div>
            </div>
          </div>
        </Card>

        <Card
          className="algo-section-card"
          title={
            <div className="algo-section-title">
              <ThunderboltOutlined />
              <div className="algo-section-title-copy">
                <strong>Simulation Console</strong>
                <span>输入参数、完成验证并提交仿真任务。</span>
              </div>
            </div>
          }
        >
          <div className="algo-parameter-grid">
            <div className="algo-field algo-span-3">
              <span className="algo-field-label">Population Size (n)</span>
              <InputNumber min={1} max={100000} value={n} onChange={(v) => setN(v || 20)} style={{ width: "100%" }} />
            </div>
            <div className="algo-field algo-span-3">
              <span className="algo-field-label">Steps</span>
              <InputNumber min={1} max={10000} value={steps} onChange={(v) => setSteps(v || 15)} style={{ width: "100%" }} />
            </div>
          </div>

          <div className="algo-console-actions">
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={() => void run()}
              disabled={turnstileEnabled && !turnstileToken}
            >
              Run Simulation
            </Button>
            <Button icon={<BarChartOutlined />} onClick={() => latestTaskId && goToTask(latestTaskId)} disabled={!latestTaskId}>
              Open Latest Task
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
          </div>
          <Typography.Paragraph className="algo-origin-copy" style={{ marginTop: 12 }}>
            Latest task: {latestTaskId || "-"}
          </Typography.Paragraph>
        </Card>
      </Space>
    </div>
  );
}
