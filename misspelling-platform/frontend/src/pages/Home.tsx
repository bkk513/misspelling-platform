import { BarChartOutlined, FileSearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToApp, goToTask } from "../app/router";
import {
  api,
  describeApiError,
  type ExtendedHealthResponse,
  type HealthResponse,
  type TaskListItem
} from "../lib/api";

function statusColor(status: string) {
  const v = status.toUpperCase();
  if (v === "SUCCESS") return "green";
  if (v === "FAILURE") return "red";
  if (v === "RUNNING" || v === "PROGRESS") return "processing";
  return "default";
}

export function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [extended, setExtended] = useState<ExtendedHealthResponse | null>(null);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [h, list] = await Promise.all([api.getHealth(), api.listTasks(12)]);
      setHealth(h);
      setTasks(list.items ?? []);
      try {
        setExtended(await api.getExtendedHealth());
      } catch {
        setExtended(null);
      }
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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {extended?.warnings && extended.warnings.length > 0 && (
        <Alert type="warning" showIcon message={`System warnings: ${extended.warnings.join(", ")}`} />
      )}
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="DB Health" value={health?.db ? "ONLINE" : "OFFLINE"} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Today Task Volume" value={tasks.length} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Recent Success Rate" value={successRate} suffix="%" />
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="Redis Status">
            <Tag color={extended?.redis ? "green" : "orange"}>{extended?.redis ? "ONLINE" : "DEGRADED"}</Tag>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="LLM Status">
            <Tag color={extended?.llm_enabled ? "green" : "default"}>
              {extended?.llm_enabled ? "ENABLED" : "DISABLED"}
            </Tag>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="GBNC Status">
            <Tag color={extended?.gbnc_enabled ? "green" : "orange"}>
              {extended?.gbnc_enabled ? "ENABLED" : "STUB_FALLBACK"}
            </Tag>
          </Card>
        </Col>
      </Row>
      <Card title="Quick Entry">
        <Space wrap>
          <Button type="primary" icon={<FileSearchOutlined />} onClick={() => goToApp("word-analysis")}>
            Open Word Analysis
          </Button>
          <Button icon={<BarChartOutlined />} onClick={() => goToApp("simulation")}>
            Open Simulation
          </Button>
          <Button onClick={() => goToApp("tasks")}>Open Task Center</Button>
        </Space>
      </Card>
      <Card title="Recent Tasks" extra={<Button onClick={() => void refresh()} loading={loading}>Refresh</Button>}>
        <Table
          size="small"
          rowKey="task_id"
          loading={loading}
          dataSource={tasks}
          pagination={{ pageSize: 6 }}
          columns={[
            {
              title: "Task",
              render: (_: unknown, row: TaskListItem) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{row.display_name || row.task_type}</Typography.Text>
                  <Typography.Text code>{row.task_id.slice(0, 12)}...</Typography.Text>
                </Space>
              )
            },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at", render: (v: string) => v || "-" },
            {
              title: "Action",
              render: (_: unknown, row: TaskListItem) => (
                <Button size="small" onClick={() => goToTask(row.task_id)}>
                  Detail
                </Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
