import { BarChartOutlined, FileSearchOutlined, RocketOutlined } from "@ant-design/icons";
import { Button, Card, Col, Input, Row, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToApp, goToTask } from "../app/router";
import { api, describeApiError, type HealthResponse, type TaskListItem } from "../lib/api";

function statusColor(status: string) {
  const v = status.toUpperCase();
  if (v === "SUCCESS") return "green";
  if (v === "FAILURE") return "red";
  if (v === "RUNNING" || v === "PROGRESS") return "processing";
  return "default";
}

export function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [word, setWord] = useState("demo");
  const [n, setN] = useState("20");
  const [steps, setSteps] = useState("15");
  const [busy, setBusy] = useState<"" | "word" | "sim">("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [h, list] = await Promise.all([api.getHealth(), api.listTasks(12)]);
      setHealth(h);
      setTasks(list.items ?? []);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const successRate = useMemo(() => {
    if (!tasks.length) return 0;
    const ok = tasks.filter((t) => t.status === "SUCCESS").length;
    return Math.round((ok / tasks.length) * 100);
  }, [tasks]);

  const runWord = async () => {
    setBusy("word");
    try {
      const resp = await api.createWordAnalysis(word.trim() || "demo");
      message.success(`word-analysis queued: ${resp.task_id}`);
      goToTask(resp.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy("");
    }
  };

  const runSimulation = async () => {
    setBusy("sim");
    try {
      const resp = await api.createSimulation(Number(n) || 20, Number(steps) || 15);
      message.success(`simulation-run queued: ${resp.task_id}`);
      goToTask(resp.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Text type="secondary">
        当前为 Guest 演示模式：任务与数据暂为共享视图。后续版本将启用 owner 绑定与“我的任务”隔离。
      </Typography.Text>
      <Row gutter={16}>
        <Col xs={24} md={8}><Card><Statistic title="DB Health" value={health?.db ? "ONLINE" : "OFFLINE"} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="Today Task Volume" value={tasks.length} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="Recent Success Rate" value={successRate} suffix="%" /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="Run Word Analysis" extra={<Button icon={<FileSearchOutlined />} onClick={() => goToApp("word-analysis")}>Open Workbench</Button>}>
            <Space.Compact style={{ width: "100%" }}>
              <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="word" />
              <Button type="primary" loading={busy === "word"} onClick={runWord}>Run</Button>
            </Space.Compact>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Run Simulation" extra={<Button icon={<BarChartOutlined />} onClick={() => goToApp("time-series")}>Open Explorer</Button>}>
            <Space.Compact style={{ width: "100%" }}>
              <Input value={n} onChange={(e) => setN(e.target.value)} placeholder="n" style={{ width: 120 }} />
              <Input value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="steps" style={{ width: 120 }} />
              <Button type="primary" icon={<RocketOutlined />} loading={busy === "sim"} onClick={runSimulation}>Run</Button>
            </Space.Compact>
          </Card>
        </Col>
      </Row>
      <Card title="Recent Tasks" extra={<Button onClick={() => void refresh()} loading={loading}>Refresh</Button>}>
        <Table
          size="small"
          rowKey="task_id"
          loading={loading}
          dataSource={tasks}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: "Task ID", dataIndex: "task_id", render: (v: string) => <Typography.Text code>{v.slice(0, 12)}...</Typography.Text> },
            { title: "Type", dataIndex: "task_type" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at", render: (v: string) => v || "-" },
            { title: "Action", render: (_: unknown, row: TaskListItem) => <Button size="small" onClick={() => goToTask(row.task_id)}>Detail</Button> }
          ]}
        />
      </Card>
    </Space>
  );
}
