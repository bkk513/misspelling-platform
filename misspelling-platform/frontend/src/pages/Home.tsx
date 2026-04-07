/* 文件说明：首页页面组件，负责展示平台入口信息与核心功能导航。 */

import { BarChartOutlined, FileSearchOutlined, LinkOutlined, RadarChartOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography, message } from "antd";
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
    <div className="enterprise-page-shell">
      {extended?.warnings && extended.warnings.length > 0 && (
        <Alert type="warning" showIcon message={`系统告警: ${extended.warnings.join(", ")}`} />
      )}
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">
              <RadarChartOutlined />
              研究者仪表盘
            </div>
            <Typography.Title level={2} className="enterprise-hero-title">
              错拼研究总览
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              首页统一成和算法页同一套视觉语言，只保留真正高频的信息：系统健康、近期任务执行情况，以及三个最常用的入口。这里不改功能，只把研究操作入口收成一个更清晰的总览面。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">系统健康</span>
              <div className="enterprise-meta-value">{health?.db ? "在线" : "离线"}</div>
              <div className="enterprise-meta-copy">数据库{health?.db ? "可用" : "不可用"}。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">最近任务量</span>
              <div className="enterprise-meta-value">{tasks.length}</div>
              <div className="enterprise-meta-copy">当前首页展示的最近任务数量。</div>
            </div>
          </div>
        </div>

        <div className="enterprise-stat-grid">
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">成功率</div>
            <div className="enterprise-stat-value">{successRate}%</div>
            <div className="enterprise-stat-copy">最近任务中的成功率。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">Redis</div>
            <div className="enterprise-stat-value">{extended?.redis ? "在线" : "降级"}</div>
            <div className="enterprise-stat-copy">任务与缓存链路状态。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">LLM</div>
            <div className="enterprise-stat-value">{extended?.llm_enabled ? "开启" : "关闭"}</div>
            <div className="enterprise-stat-copy">变体推荐与起点建议能力。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">GBNC</div>
            <div className="enterprise-stat-value">{extended?.gbnc_enabled ? "在线" : "Stub"}</div>
            <div className="enterprise-stat-copy">外部语料数据源可用性。</div>
          </div>
        </div>
      </Card>

      <Row gutter={[18, 18]}>
        <Col xs={24} xl={8}>
          <Card
            className="enterprise-section-card"
            title={
              <div className="enterprise-section-title">
                <LinkOutlined />
                <div className="enterprise-section-copy">
                  <strong>快捷入口</strong>
                  <span>直接进入最常用的研究面板。</span>
                </div>
              </div>
            }
          >
            <div className="enterprise-toolbar">
              <div className="enterprise-toolbar-copy">
                <strong>进入工作区</strong>
                <span>保持原功能，只优化呈现方式。</span>
              </div>
              <Button onClick={() => void refresh()} loading={loading}>
                刷新
              </Button>
            </div>

            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div className="enterprise-note-box">
                <Button type="primary" icon={<FileSearchOutlined />} block onClick={() => goToApp("word-analysis")}>
                  进入 Word Analysis
                </Button>
              </div>
              <div className="enterprise-note-box">
                <Button icon={<BarChartOutlined />} block onClick={() => goToApp("simulation")}>
                  进入 Simulation
                </Button>
              </div>
              <div className="enterprise-note-box">
                <Button block onClick={() => goToApp("tasks")}>
                  进入 Task Center
                </Button>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={16}>
          <Card
            className="enterprise-section-card"
            title={
              <div className="enterprise-section-title">
                <RadarChartOutlined />
                <div className="enterprise-section-copy">
                  <strong>最近任务</strong>
                  <span>最近任务的状态、时间和详情入口。</span>
                </div>
              </div>
            }
          >
            <Table
              size="small"
              rowKey="task_id"
              loading={loading}
              dataSource={tasks}
              pagination={{ pageSize: 6 }}
              columns={[
                {
                  title: "任务",
                  render: (_: unknown, row: TaskListItem) => (
                    <Space direction="vertical" size={0}>
                      <Typography.Text>{row.display_name || row.task_type}</Typography.Text>
                      <Typography.Text code>{row.task_id.slice(0, 12)}...</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>
                },
                { title: "创建时间", dataIndex: "created_at", render: (v: string) => v || "-" },
                {
                  title: "操作",
                  render: (_: unknown, row: TaskListItem) => (
                    <Button size="small" onClick={() => goToTask(row.task_id)}>
                      详情
                    </Button>
                  )
                }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
