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

export function SteadyStatePage() {
  const [word, setWord] = useState("internet");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [tippingIndex, setTippingIndex] = useState(0);
  const [polyDegree, setPolyDegree] = useState(20);
  const [variants, setVariants] = useState("");
  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);

  const run = async () => {
    setBusy(true);
    try {
      const resp = await api.createMrnmrSteady(word, {
        startYear,
        endYear,
        smoothing,
        variants: variants.split(",").map((v) => v.trim()).filter(Boolean),
        tippingIndex,
        polyDegree
      });
      setLatestTaskId(resp.task_id);
      setRows([]);
      message.success(`MR/NMR task queued: ${resp.task_id}`);
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
      const metrics = Array.isArray(result?.metrics_preview) ? (result?.metrics_preview as Array<Record<string, unknown>>) : [];
      setRows(metrics);
      message.success(`Loaded ${metrics.length} MR/NMR rows.`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Steady State (MR/NMR)">
        <Row gutter={16}>
          <Col xs={24} md={8}><Typography.Text>Word</Typography.Text><Input value={word} onChange={(e) => setWord(e.target.value)} /></Col>
          <Col xs={12} md={4}><Typography.Text>Start Year</Typography.Text><InputNumber min={1500} max={2026} value={startYear} onChange={(v) => setStartYear(v || 1900)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>End Year</Typography.Text><InputNumber min={1500} max={2026} value={endYear} onChange={(v) => setEndYear(v || 2019)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Smoothing</Typography.Text><InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v || 3)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Tipping Index</Typography.Text><InputNumber min={0} max={1000} value={tippingIndex} onChange={(v) => setTippingIndex(v || 0)} style={{ width: "100%" }} /></Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} md={8}><Typography.Text>Poly Degree</Typography.Text><InputNumber min={1} max={60} value={polyDegree} onChange={(v) => setPolyDegree(v || 20)} style={{ width: "100%" }} /></Col>
          <Col xs={24} md={16}><Typography.Text>Variants (comma separated)</Typography.Text><Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="chatgpt,chagpt,chat-gpt" /></Col>
        </Row>
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={() => void run()}>Run MR/NMR</Button>
          <Button loading={busy} onClick={() => void loadPreview()}>Load Latest Result Preview</Button>
          <Typography.Text type="secondary">latest: {latestTaskId || "-"}</Typography.Text>
        </Space>
      </Card>

      <Card title="Steady Metrics Preview">
        <Table
          rowKey={(_, idx) => String(idx)}
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "year", dataIndex: "year" },
            { title: "MR", dataIndex: "MR" },
            { title: "NMR", dataIndex: "NMR" },
            { title: "density", dataIndex: "density" },
            { title: "misspelling", dataIndex: "misspelling" },
            { title: "correct", dataIndex: "correct" }
          ]}
        />
      </Card>
    </Space>
  );
}
