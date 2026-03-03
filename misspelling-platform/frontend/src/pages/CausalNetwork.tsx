import { ThunderboltOutlined } from "@ant-design/icons";
import { Button, Card, Col, Input, InputNumber, Row, Space, Table, Typography, message } from "antd";
import { useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError } from "../lib/api";

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

export function CausalNetworkPage() {
  const [word, setWord] = useState("internet");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [tauMax, setTauMax] = useState(8);
  const [alphaLevel, setAlphaLevel] = useState(0.01);
  const [variants, setVariants] = useState("");
  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [edges, setEdges] = useState<Array<Record<string, unknown>>>([]);

  const run = async () => {
    setBusy(true);
    try {
      const resp = await api.createPcmciCausal(word, {
        startYear,
        endYear,
        smoothing,
        variants: variants.split(",").map((v) => v.trim()).filter(Boolean),
        tauMax,
        alphaLevel
      });
      setLatestTaskId(resp.task_id);
      setEdges([]);
      message.success(`PCMCI task queued: ${resp.task_id}`);
      goToTask(resp.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const loadPreview = async () => {
    if (!latestTaskId) {
      message.info("Run task first.");
      return;
    }
    setBusy(true);
    try {
      const detail = await api.getTask(latestTaskId);
      const result = asObject(detail.result);
      const topEdges = Array.isArray(result?.top_edges) ? (result?.top_edges as Array<Record<string, unknown>>) : [];
      setEdges(topEdges);
      message.success(`Loaded ${topEdges.length} edge rows.`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Causal Network (PCMCI)">
        <Row gutter={16}>
          <Col xs={24} md={8}><Typography.Text>Word</Typography.Text><Input value={word} onChange={(e) => setWord(e.target.value)} /></Col>
          <Col xs={12} md={4}><Typography.Text>Start Year</Typography.Text><InputNumber min={1500} max={2026} value={startYear} onChange={(v) => setStartYear(v || 1900)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>End Year</Typography.Text><InputNumber min={1500} max={2026} value={endYear} onChange={(v) => setEndYear(v || 2019)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Smoothing</Typography.Text><InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v || 3)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Tau Max</Typography.Text><InputNumber min={1} max={24} value={tauMax} onChange={(v) => setTauMax(v || 8)} style={{ width: "100%" }} /></Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} md={8}><Typography.Text>Alpha Level</Typography.Text><InputNumber min={0.0001} max={1} step={0.001} value={alphaLevel} onChange={(v) => setAlphaLevel(v || 0.01)} style={{ width: "100%" }} /></Col>
          <Col xs={24} md={16}><Typography.Text>Variants (comma separated)</Typography.Text><Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="chatgpt,chagpt,chat-gpt" /></Col>
        </Row>
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={() => void run()}>Run PCMCI</Button>
          <Button loading={busy} onClick={() => void loadPreview()}>Load Latest Result Preview</Button>
          <Typography.Text type="secondary">latest: {latestTaskId || "-"}</Typography.Text>
        </Space>
      </Card>

      <Card title="Top Edges Preview">
        <Table
          rowKey={(_, idx) => String(idx)}
          dataSource={edges}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "source", dataIndex: "source" },
            { title: "target", dataIndex: "target" },
            { title: "lag", dataIndex: "lag" },
            { title: "weight", dataIndex: "weight" },
            { title: "method", dataIndex: "method" }
          ]}
        />
      </Card>
    </Space>
  );
}
