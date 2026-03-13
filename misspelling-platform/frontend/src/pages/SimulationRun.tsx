import { BarChartOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Card, InputNumber, Space, Typography, message } from "antd";
import { useState } from "react";
import { goToTask } from "../app/router";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError } from "../lib/api";

export function SimulationRunPage() {
  const [n, setN] = useState(20);
  const [steps, setSteps] = useState(15);
  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

  const run = async () => {
    if (!turnstileToken) {
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
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Simulation Workbench">
        <Space wrap align="end">
          <div>
            <Typography.Text>Population Size (n)</Typography.Text>
            <InputNumber min={1} max={100000} value={n} onChange={(v) => setN(v || 20)} style={{ width: 160, display: "block" }} />
          </div>
          <div>
            <Typography.Text>Steps</Typography.Text>
            <InputNumber min={1} max={10000} value={steps} onChange={(v) => setSteps(v || 15)} style={{ width: 160, display: "block" }} />
          </div>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={() => void run()} disabled={!turnstileToken}>
            Run Simulation
          </Button>
        </Space>
        <div style={{ marginTop: 12 }}>
          <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
          Latest task: {latestTaskId || "-"}
        </Typography.Paragraph>
      </Card>

      <Card title="Result Entry">
        <Typography.Paragraph type="secondary">
          Simulation output is managed in Task Detail / Time Series / Reports after task completion.
        </Typography.Paragraph>
        <Button icon={<BarChartOutlined />} onClick={() => latestTaskId && goToTask(latestTaskId)} disabled={!latestTaskId}>
          Open Latest Task
        </Button>
      </Card>
    </Space>
  );
}
