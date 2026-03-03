import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import {
  api,
  describeApiError,
  type AnalyticsClusterResponse,
  type AnalyticsSummaryResponse,
  type ProjectItem
} from "../lib/api";

export function AnalyticsCenterPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [k, setK] = useState(3);
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [cluster, setCluster] = useState<AnalyticsClusterResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshProjects = async () => {
    try {
      const resp = await api.listProjects(120);
      setProjects(resp.items ?? []);
      if (!projectId && resp.items.length > 0) setProjectId(resp.items[0].id);
    } catch (e) {
      message.error(describeApiError(e));
    }
  };

  const loadSummary = async (id: number) => {
    try {
      setSummary(await api.analyticsSummary(id));
    } catch (e) {
      setSummary(null);
      message.warning(describeApiError(e));
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (!projectId) {
      setSummary(null);
      setCluster(null);
      return;
    }
    void loadSummary(projectId);
  }, [projectId]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="Meso Analytics Baseline"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void refreshProjects()} loading={loading}>
            Refresh Projects
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Baseline clustering is intentionally replaceable. It uses project-level term features and writes each run to `analytics_runs`.
        </Typography.Paragraph>
        <Space wrap>
          <Select
            style={{ width: 420 }}
            showSearch
            value={projectId}
            placeholder="Select project"
            onChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
          />
          <InputNumber min={1} max={8} value={k} onChange={(v) => setK(v || 3)} />
          <Button
            type="primary"
            onClick={async () => {
              if (!projectId) return;
              setLoading(true);
              try {
                const resp = await api.analyticsCluster(projectId, k);
                setCluster(resp);
                message.success("Clustering completed");
              } catch (e) {
                message.error(describeApiError(e));
              } finally {
                setLoading(false);
              }
            }}
            loading={loading}
            disabled={!projectId}
          >
            Run Clustering
          </Button>
        </Space>
      </Card>

      <Card title="Project Summary">
        {!summary ? (
          <Typography.Text type="secondary">No summary data.</Typography.Text>
        ) : (
          <Space wrap size={12}>
            <Tag color="blue">terms={summary.total_terms}</Tag>
            <Tag color="geekblue">points={summary.total_points}</Tag>
            <Tag color="purple">avg_variants={summary.avg_variants}</Tag>
            {Object.entries(summary.category_distribution || {}).map(([key, value]) => (
              <Tag key={key}>{`${key}:${value}`}</Tag>
            ))}
          </Space>
        )}
      </Card>

      <Card title="Cluster Result">
        {!cluster ? (
          <Typography.Text type="secondary">Run clustering to populate result.</Typography.Text>
        ) : (
          <Table
            rowKey="cluster_id"
            size="small"
            dataSource={cluster.clusters}
            pagination={false}
            columns={[
              { title: "Cluster", dataIndex: "cluster_id", width: 100 },
              { title: "Size", dataIndex: "size", width: 100 },
              {
                title: "Terms",
                render: (_: unknown, row: AnalyticsClusterResponse["clusters"][number]) =>
                  row.items.map((x) => x.canonical).join(", ")
              }
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
