/* 文件说明：分析中心页面，负责聚合项目级算法运行与分析结果展示。 */

import { ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  describeApiError,
  type ProjectItem,
  type ProjectMesoClusterResponse,
  type ProjectMicroRunResponse,
} from "../lib/api";
import "./algorithmStudio.css";
import "./analyticsCenter.css";

export function AnalyticsCenterPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [clusterK, setClusterK] = useState(3);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [runningMicro, setRunningMicro] = useState(false);
  const [runningMeso, setRunningMeso] = useState(false);

  const [microResult, setMicroResult] = useState<ProjectMicroRunResponse | null>(null);
  const [mesoResult, setMesoResult] = useState<ProjectMesoClusterResponse | null>(null);

  const refreshProjects = async () => {
    setLoadingProjects(true);
    try {
      const resp = await api.listProjects(150);
      const next = resp.items || [];
      setProjects(next);
      setProjectId((current) => {
        if (current && next.some((item) => item.id === current)) return current;
        return next[0]?.id;
      });
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    if (sessionRole === "guest") return;
    void refreshProjects();
  }, [sessionRole]);

  useEffect(() => {
    setMicroResult(null);
    setMesoResult(null);
  }, [projectId]);

  const runMicro = async () => {
    if (!projectId) {
      message.warning("请先选择项目");
      return;
    }
    setRunningMicro(true);
    try {
      const termsResp = await api.listProjectTerms(projectId);
      const termCount = (termsResp.items || []).length;
      if (termCount <= 0) {
        message.warning("当前项目还没有词，请先在项目管理中添加词");
        setMicroResult(null);
        return;
      }
      const resp = await api.analyticsRunProjectMicro(projectId);
      setMicroResult(resp);
      message.success(`微观算法调度完成：新建 ${resp.created_tasks.length} 个，复用 ${resp.reused_tasks.length} 个`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningMicro(false);
    }
  };

  const runMeso = async () => {
    if (!projectId) {
      message.warning("请先选择项目");
      return;
    }
    setRunningMeso(true);
    try {
      const resp = await api.analyticsProjectMesoCluster(projectId, clusterK);
      setMesoResult(resp);
      message.success("中观聚类已完成");
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningMeso(false);
    }
  };

  const clusterRows = useMemo(() => {
    return (mesoResult?.clustering?.clusters || []).map((item) => ({
      key: item.cluster_id,
      id: item.cluster_id,
      label: item.label,
      size: item.size,
      reps: (item.representative_terms || []).join(", "),
    }));
  }, [mesoResult]);

  if (sessionRole === "guest") {
    return (
      <div className="analytics-center-shell">
        <Card bordered={false} className="algo-guard-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              分析中心需要登录
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              登录后可按项目一键运行三种微观算法，并基于结果执行中观聚类分析。
            </Typography.Paragraph>
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <div className="analytics-center-shell">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          bordered={false}
          className="analytics-center-hero"
          extra={
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void refreshProjects()}
              loading={loadingProjects || runningMicro || runningMeso}
            >
              刷新
            </Button>
          }
        >
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 6 }}>
            分析中心
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            先选择项目，再执行两步：1) 运行三种微观算法（因果网络、稳态分析、偏差）2) 计算中观聚类。
          </Typography.Paragraph>
          <Space wrap>
            <Select
              style={{ width: 420, maxWidth: "100%" }}
              showSearch
              value={projectId}
              placeholder="选择项目"
              onChange={setProjectId}
              options={projects.map((project) => ({ value: project.id, label: `${project.name} (#${project.id})` }))}
            />
            <InputNumber
              min={2}
              max={12}
              value={clusterK}
              onChange={(v) => setClusterK(Math.max(2, Math.min(12, Number(v || 3))))}
              addonBefore="聚类数"
            />
          </Space>
        </Card>

        <Card>
          <Space wrap>
            <Button type="primary" onClick={() => void runMicro()} loading={runningMicro} disabled={!projectId}>
              一键运行三种微观算法
            </Button>
            <Button type="primary" ghost onClick={() => void runMeso()} loading={runningMeso} disabled={!projectId}>
              计算中观聚类
            </Button>
          </Space>
        </Card>

        <Card title="微观算法运行结果" loading={runningMicro}>
          {!microResult ? (
            <Empty description="尚未运行微观算法" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="选中词数" value={microResult.selected_term_count} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="新建任务" value={microResult.created_tasks.length} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="复用任务" value={microResult.reused_tasks.length} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="监控任务" value={microResult.watched_task_ids.length} /></Card>
                </Col>
              </Row>
              <Table
                size="small"
                rowKey="task_id"
                dataSource={[...(microResult.created_tasks || []), ...(microResult.reused_tasks || [])]}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: "词", dataIndex: "word", width: 160 },
                  { title: "算法", dataIndex: "task_type", width: 180 },
                  { title: "模式", dataIndex: "mode", width: 120 },
                  { title: "状态", dataIndex: "status", width: 120 },
                  { title: "任务ID", dataIndex: "task_id" },
                ]}
              />
            </Space>
          )}
        </Card>

        <Card title="中观聚类结果" loading={runningMeso}>
          {!mesoResult ? (
            <Empty description="尚未计算中观聚类" />
          ) : (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="词总数" value={mesoResult.summary.selected_terms} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="已就绪词" value={mesoResult.summary.ready_terms} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="就绪率" value={`${(mesoResult.summary.ready_ratio * 100).toFixed(1)}%`} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small"><Statistic title="聚类数" value={mesoResult.clustering.k || mesoResult.summary.cluster_k} /></Card>
                </Col>
              </Row>
              <Table
                size="small"
                rowKey="key"
                dataSource={clusterRows}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: "簇ID", dataIndex: "id", width: 80 },
                  { title: "标签", dataIndex: "label", width: 220 },
                  { title: "规模", dataIndex: "size", width: 100 },
                  { title: "代表词", dataIndex: "reps" },
                ]}
              />
              {(mesoResult.warnings || []).length > 0 ? (
                <Typography.Text type="secondary">
                  提示：{(mesoResult.warnings || []).slice(0, 6).join("；")}
                </Typography.Text>
              ) : null}
            </Space>
          )}
        </Card>
      </Space>
    </div>
  );
}
