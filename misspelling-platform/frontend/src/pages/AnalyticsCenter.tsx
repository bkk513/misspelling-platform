import {
  BarChartOutlined,
  ClusterOutlined,
  FundOutlined,
  RadarChartOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { LineChart } from "../components/LineChart";
import {
  api,
  describeApiError,
  type AnalyticsClusterResponse,
  type AnalyticsCohortCompareResponse,
  type AnalyticsExplainabilityResponse,
  type AnalyticsSummaryResponse,
  type AnalyticsTemporalPatternsResponse,
  type ProjectCohortItem,
  type ProjectItem,
} from "../lib/api";
import "./algorithmStudio.css";
import "./analyticsCenter.css";

type ClusterMethod = "kmeans_advanced" | "baseline-kmeans";

const CLUSTER_COLORS = ["#1164d6", "#0f766e", "#d97706", "#dc2626", "#7c3aed", "#0ea5e9", "#16a34a", "#b45309"];

function toPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function compactTerms(items: Array<{ canonical: string }>, max = 6): string {
  if (!items.length) return "-";
  const names = items.slice(0, max).map((item) => item.canonical);
  if (items.length > max) names.push(`+${items.length - max} more`);
  return names.join(", ");
}

function trajectoryShift(series: Array<{ year: number; value: number }>): { delta: number; trend: "up" | "down" | "flat" } {
  if (series.length < 2) return { delta: 0, trend: "flat" };
  const delta = Number((series[series.length - 1].value - series[0].value).toFixed(4));
  if (delta > 0.0001) return { delta, trend: "up" };
  if (delta < -0.0001) return { delta, trend: "down" };
  return { delta, trend: "flat" };
}

function DistributionPanel({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
}) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  return (
    <Card size="small" title={title} className="ac-subcard">
      <div className="ac-bar-list">
        {items.map((item) => (
          <div key={item.label} className="ac-bar-row">
            <div className="ac-bar-head">
              <span>{item.label}</span>
              <span>{item.value}</span>
            </div>
            <div className="ac-bar-track">
              <div className="ac-bar-fill" style={{ width: `${(item.value / maxValue) * 100}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No distribution data" /> : null}
      </div>
    </Card>
  );
}

function ClusterScatter({ cluster }: { cluster: AnalyticsClusterResponse }) {
  const points = cluster.clusters.flatMap((group, index) =>
    group.items.map((item) => ({
      clusterId: group.cluster_id,
      clusterIndex: index,
      label: item.canonical,
      x: item.embedding?.x ?? 0,
      y: item.embedding?.y ?? 0,
    }))
  );

  if (!points.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No embedding coordinates available" />;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = 860;
  const height = 320;
  const pad = 28;

  const scaleX = (value: number) => {
    if (maxX === minX) return width / 2;
    return pad + ((value - minX) / (maxX - minX)) * (width - pad * 2);
  };

  const scaleY = (value: number) => {
    if (maxY === minY) return height / 2;
    return height - pad - ((value - minY) / (maxY - minY)) * (height - pad * 2);
  };

  return (
    <div className="ac-scatter-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="ac-scatter-svg" role="img" aria-label="cluster scatter">
        <rect x={0} y={0} width={width} height={height} rx={18} fill="transparent" />
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="#d8e4f4" strokeDasharray="4,4" />
        <line x1={width / 2} y1={pad} x2={width / 2} y2={height - pad} stroke="#d8e4f4" strokeDasharray="4,4" />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle
              cx={scaleX(point.x)}
              cy={scaleY(point.y)}
              r={6}
              fill={CLUSTER_COLORS[point.clusterIndex % CLUSTER_COLORS.length]}
              opacity={0.88}
            />
            <title>{`${point.label} · cluster ${point.clusterId}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CompareBoard({ compare }: { compare: AnalyticsCohortCompareResponse }) {
  const maxAbs = Math.max(0.000001, ...compare.metrics.map((item) => Math.abs(item.diff_mean)));
  return (
    <div className="ac-bar-list">
      {compare.metrics.map((item) => (
        <div key={item.metric} className="ac-bar-row">
          <div className="ac-bar-head">
            <span>{item.metric}</span>
            <span>{item.diff_mean.toFixed(3)}</span>
          </div>
          <div className="ac-bar-track">
            <div
              className="ac-bar-fill"
              style={{
                width: `${Math.max(8, (Math.abs(item.diff_mean) / maxAbs) * 100)}%`,
                background: item.diff_mean >= 0 ? "#1164d6" : "#d94841",
              }}
            />
          </div>
          <div className="ac-inline-copy">
            d={item.effect_size_d.toFixed(3)} · perm p={item.perm_p_value.toExponential(2)} · q={item.fdr_q_value.toExponential(2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportanceBoard({ items }: { items: AnalyticsExplainabilityResponse["feature_importance"] }) {
  const maxValue = Math.max(0.000001, ...items.map((item) => item.importance_mean));
  return (
    <div className="ac-bar-list">
      {items.map((item) => (
        <div key={item.feature} className="ac-bar-row">
          <div className="ac-bar-head">
            <span>{item.feature}</span>
            <span>{item.importance_mean.toFixed(5)}</span>
          </div>
          <div className="ac-bar-track">
            <div className="ac-bar-fill" style={{ width: `${(item.importance_mean / maxValue) * 100}%` }} />
          </div>
          <div className="ac-inline-copy">std={item.importance_std.toFixed(5)}</div>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsCenterPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [cohorts, setCohorts] = useState<ProjectCohortItem[]>([]);

  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [cluster, setCluster] = useState<AnalyticsClusterResponse | null>(null);
  const [compare, setCompare] = useState<AnalyticsCohortCompareResponse | null>(null);
  const [temporal, setTemporal] = useState<AnalyticsTemporalPatternsResponse | null>(null);
  const [explainability, setExplainability] = useState<AnalyticsExplainabilityResponse | null>(null);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingCluster, setLoadingCluster] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [loadingTemporal, setLoadingTemporal] = useState(false);
  const [loadingExplainability, setLoadingExplainability] = useState(false);

  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>("kmeans_advanced");
  const [k, setK] = useState(3);

  const [cohortA, setCohortA] = useState<string | undefined>(undefined);
  const [cohortB, setCohortB] = useState<string | undefined>(undefined);
  const [permutations, setPermutations] = useState(1000);
  const [bootstrap, setBootstrap] = useState(1000);

  const [temporalClusters, setTemporalClusters] = useState(3);
  const [temporalLimit, setTemporalLimit] = useState(160);

  const [targetCohort, setTargetCohort] = useState<string | undefined>(undefined);

  const cohortOptions = useMemo(
    () =>
      cohorts
        .filter((item) => Boolean(item.is_active))
        .map((item) => ({ value: item.name, label: item.name })),
    [cohorts]
  );

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

  const loadProjectContext = async (id: number) => {
    setLoadingSummary(true);
    try {
      const [summaryResp, cohortsResp] = await Promise.all([api.analyticsSummary(id), api.listProjectCohorts(id)]);
      setSummary(summaryResp);
      const nextCohorts = cohortsResp.items || [];
      setCohorts(nextCohorts);

      const names = nextCohorts.filter((item) => Boolean(item.is_active)).map((item) => item.name);
      if (!names.length) {
        setCohortA(undefined);
        setCohortB(undefined);
        setTargetCohort(undefined);
      } else {
        setCohortA((current) => (current && names.includes(current) ? current : names[0]));
        setCohortB((current) => (current && names.includes(current) && current !== names[0] ? current : names[1] || names[0]));
        setTargetCohort((current) => (current && names.includes(current) ? current : names[0]));
      }
    } catch (e) {
      setSummary(null);
      setCohorts([]);
      message.warning(describeApiError(e));
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    if (sessionRole === "guest") return;
    void refreshProjects();
  }, [sessionRole]);

  useEffect(() => {
    setCluster(null);
    setCompare(null);
    setTemporal(null);
    setExplainability(null);

    if (!projectId || sessionRole === "guest") {
      setSummary(null);
      setCohorts([]);
      return;
    }
    void loadProjectContext(projectId);
  }, [projectId, sessionRole]);

  const runCluster = async () => {
    if (!projectId) return;
    setLoadingCluster(true);
    try {
      const resp = await api.analyticsCluster(projectId, k, clusterMethod);
      setCluster(resp);
      message.success("Cluster analysis completed");
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingCluster(false);
    }
  };

  const runCompare = async () => {
    if (!projectId || !cohortA || !cohortB) {
      message.warning("Select project and cohort pair first");
      return;
    }
    if (cohortA === cohortB) {
      message.warning("Cohort A and Cohort B must be different");
      return;
    }
    setLoadingCompare(true);
    try {
      const resp = await api.analyticsCohortCompare(projectId, cohortA, cohortB, { permutations, bootstrap });
      setCompare(resp);
      message.success("Cohort comparison completed");
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingCompare(false);
    }
  };

  const runTemporal = async () => {
    if (!projectId) return;
    setLoadingTemporal(true);
    try {
      const resp = await api.analyticsTemporalPatterns(projectId, temporalClusters, temporalLimit);
      setTemporal(resp);
      message.success("Temporal pattern analysis completed");
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingTemporal(false);
    }
  };

  const runExplainability = async () => {
    if (!projectId) return;
    setLoadingExplainability(true);
    try {
      const resp = await api.analyticsExplainability(projectId, targetCohort);
      setExplainability(resp);
      message.success("Explainability analysis completed");
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingExplainability(false);
    }
  };

  const summaryCategoryRows = useMemo(
    () => Object.entries(summary?.category_distribution || {}).map(([label, value]) => ({ label, value })),
    [summary]
  );

  const summaryCohortRows = useMemo(
    () => Object.entries(summary?.cohort_distribution || {}).map(([label, value]) => ({ label, value })),
    [summary]
  );

  const temporalSeries = useMemo(
    () =>
      (temporal?.clusters || []).map((clusterItem, index) => ({
        name: `cluster-${clusterItem.cluster_id}`,
        points: clusterItem.mean_trajectory.map((item) => ({ time: String(item.year), value: item.value })),
        color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
      })),
    [temporal]
  );

  if (sessionRole === "guest") {
    return (
      <div className="analytics-center-shell">
        <Card bordered={false} className="algo-guard-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Analytics Center Requires Login
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              cohort 级 analytics 会聚合项目定义、membership 结构和任务证据，因此只能对登录用户开放。这样可以保证分析结果始终绑定到真实项目所有者，而不会落入 guest 共享空间。
            </Typography.Paragraph>
            <div className="pm-guest-policy">
              <div className="pm-guest-policy-card">
                <strong>Why it is restricted</strong>
                <span>Analytics is project-scoped and ownership-bound. Guest mode only keeps isolated task/time-series views.</span>
              </div>
              <div className="pm-guest-policy-card">
                <strong>Recommended path</strong>
                <span>Login, create a project, define cohorts in Project Manager, then return here for clustering, cohort comparison and explainability.</span>
              </div>
            </div>
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
            <Button icon={<ReloadOutlined />} onClick={() => void refreshProjects()} loading={loadingProjects || loadingSummary}>
              Refresh Workspace
            </Button>
          }
        >
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 6 }}>
            Analytics Center
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 18 }}>
            这里不再只输出一批统计表，而是把 cohort portfolio、聚类散点、置换检验、时序模式和 explainability 组成一个真正的分析驾驶舱。
          </Typography.Paragraph>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card bordered={false} className="ac-metric-card">
                <Statistic title="Terms" value={summary?.total_terms || 0} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card bordered={false} className="ac-metric-card">
                <Statistic title="Data Points" value={summary?.total_points || 0} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card bordered={false} className="ac-metric-card">
                <Statistic title="Cohorts" value={summary?.total_cohorts || 0} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card bordered={false} className="ac-metric-card">
                <Statistic title="Coverage" value={toPercent(summary?.coverage_ratio, 1)} />
              </Card>
            </Col>
          </Row>
        </Card>

        <Card className="ac-card" title="Analysis Scope" loading={loadingProjects || loadingSummary}>
          <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
            <Select
              style={{ width: 440 }}
              showSearch
              value={projectId}
              placeholder="Select project"
              onChange={setProjectId}
              options={projects.map((project) => ({ value: project.id, label: `${project.name} (#${project.id})` }))}
            />
            <Space wrap>
              <Tag icon={<BarChartOutlined />} color="blue">permutation + bootstrap</Tag>
              <Tag icon={<ClusterOutlined />} color="geekblue">kmeans + pca</Tag>
              <Tag icon={<FundOutlined />} color="green">dtw agglomerative</Tag>
              <Tag icon={<RadarChartOutlined />} color="purple">rf importance</Tag>
            </Space>
          </Space>
        </Card>

        <Tabs
          className="ac-tabs"
          items={[
            {
              key: "summary",
              label: "Portfolio",
              children: (
                <Card className="ac-card" loading={loadingSummary}>
                  {!summary ? (
                    <Empty description="No summary data" />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Row gutter={[12, 12]}>
                        <Col xs={24} lg={8}>
                          <Card size="small" className="ac-subcard">
                            <Space direction="vertical" style={{ width: "100%" }}>
                              <Typography.Text strong>Project Coverage</Typography.Text>
                              <Progress percent={Number(((summary.coverage_ratio || 0) * 100).toFixed(1))} strokeColor="#1164d6" />
                              <Typography.Text type="secondary">
                                {summary.terms_with_points} / {summary.total_terms} terms already have time-series evidence.
                              </Typography.Text>
                            </Space>
                          </Card>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Card size="small" className="ac-subcard"><Statistic title="Avg Variants" value={summary.avg_variants} precision={3} /></Card>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Card size="small" className="ac-subcard"><Statistic title="Terms with Points" value={summary.terms_with_points} /></Card>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Card size="small" className="ac-subcard"><Statistic title="Membership / Term" value={summary.avg_memberships_per_term} precision={3} /></Card>
                        </Col>
                        <Col xs={12} lg={4}>
                          <Card size="small" className="ac-subcard"><Statistic title="Total Points" value={summary.total_points} /></Card>
                        </Col>
                      </Row>

                      <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                          <DistributionPanel title="Category Distribution" items={summaryCategoryRows} />
                        </Col>
                        <Col xs={24} lg={12}>
                          <DistributionPanel title="Cohort Distribution" items={summaryCohortRows} />
                        </Col>
                      </Row>
                    </Space>
                  )}
                </Card>
              ),
            },
            {
              key: "cluster",
              label: "Clustering",
              children: (
                <Card className="ac-card">
                  <Space wrap style={{ marginBottom: 16 }}>
                    <Select<ClusterMethod>
                      style={{ width: 220 }}
                      value={clusterMethod}
                      onChange={setClusterMethod}
                      options={[
                        { value: "kmeans_advanced", label: "kmeans_advanced" },
                        { value: "baseline-kmeans", label: "baseline-kmeans" },
                      ]}
                    />
                    <InputNumber min={1} max={8} value={k} onChange={(value) => setK(value || 3)} addonBefore="k" />
                    <Button type="primary" onClick={() => void runCluster()} loading={loadingCluster} disabled={!projectId}>
                      Run Cluster
                    </Button>
                    {cluster?.diagnostics ? (
                      <>
                        <Tag color="blue">silhouette={cluster.diagnostics.silhouette?.toFixed(4) ?? "-"}</Tag>
                        <Tag color="geekblue">
                          pca={cluster.diagnostics.pca_explained_variance.map((value) => toPercent(value, 1)).join(" / ") || "-"}
                        </Tag>
                      </>
                    ) : null}
                  </Space>

                  {!cluster ? (
                    <Empty description="Run clustering to see results" />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Card size="small" className="ac-subcard" title="Embedding Scatter">
                        <ClusterScatter cluster={cluster} />
                      </Card>
                      <Table
                        rowKey="cluster_id"
                        size="small"
                        dataSource={cluster.clusters}
                        pagination={false}
                        columns={[
                          { title: "Cluster", dataIndex: "cluster_id", width: 90 },
                          { title: "Size", dataIndex: "size", width: 90 },
                          {
                            title: "Top Terms",
                            render: (_: unknown, row: AnalyticsClusterResponse["clusters"][number]) => compactTerms(row.items),
                          },
                        ]}
                      />
                    </Space>
                  )}
                </Card>
              ),
            },
            {
              key: "compare",
              label: "Cohort Compare",
              children: (
                <Card className="ac-card">
                  <Space wrap style={{ marginBottom: 16 }}>
                    <Select style={{ width: 220 }} value={cohortA} placeholder="Cohort A" options={cohortOptions} onChange={setCohortA} />
                    <Select style={{ width: 220 }} value={cohortB} placeholder="Cohort B" options={cohortOptions} onChange={setCohortB} />
                    <InputNumber min={100} max={8000} step={100} value={permutations} onChange={(value) => setPermutations(value || 1000)} addonBefore="perm" />
                    <InputNumber min={100} max={5000} step={100} value={bootstrap} onChange={(value) => setBootstrap(value || 1000)} addonBefore="boot" />
                    <Button type="primary" onClick={() => void runCompare()} loading={loadingCompare} disabled={!projectId}>
                      Run Compare
                    </Button>
                  </Space>

                  {!compare ? (
                    <Empty description="Run cohort comparison to see statistical outputs" />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Card size="small" className="ac-subcard" title={`${compare.cohort_a} vs ${compare.cohort_b}`}>
                        <CompareBoard compare={compare} />
                      </Card>
                      <Table
                        rowKey="metric"
                        size="small"
                        pagination={false}
                        dataSource={compare.metrics}
                        columns={[
                          { title: "Metric", dataIndex: "metric", width: 160 },
                          { title: "A Mean", dataIndex: "mean_a", width: 110, render: (value: number) => value.toFixed(3) },
                          { title: "B Mean", dataIndex: "mean_b", width: 110, render: (value: number) => value.toFixed(3) },
                          { title: "Diff", dataIndex: "diff_mean", width: 110, render: (value: number) => value.toFixed(3) },
                          { title: "Effect d", dataIndex: "effect_size_d", width: 110, render: (value: number) => value.toFixed(3) },
                          { title: "FDR q", dataIndex: "fdr_q_value", width: 110, render: (value: number) => value.toExponential(2) },
                          {
                            title: "Sig",
                            width: 90,
                            render: (_: unknown, row: AnalyticsCohortCompareResponse["metrics"][number]) =>
                              row.is_significant ? <Tag color="green">yes</Tag> : <Tag>no</Tag>,
                          },
                        ]}
                      />
                    </Space>
                  )}
                </Card>
              ),
            },
            {
              key: "temporal",
              label: "Temporal",
              children: (
                <Card className="ac-card">
                  <Space wrap style={{ marginBottom: 16 }}>
                    <InputNumber min={2} max={12} value={temporalClusters} onChange={(value) => setTemporalClusters(value || 3)} addonBefore="clusters" />
                    <InputNumber min={20} max={400} step={20} value={temporalLimit} onChange={(value) => setTemporalLimit(value || 160)} addonBefore="limit" />
                    <Button type="primary" onClick={() => void runTemporal()} loading={loadingTemporal} disabled={!projectId}>
                      Run Temporal
                    </Button>
                    {temporal?.year_range?.length ? (
                      <Tag color="blue">
                        years {temporal.year_range[0]} - {temporal.year_range[temporal.year_range.length - 1]}
                      </Tag>
                    ) : null}
                  </Space>

                  {!temporal ? (
                    <Empty description="Run temporal analysis to see DTW clusters" />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Card size="small" className="ac-subcard" title="Mean Trajectories">
                        {temporalSeries.length > 0 ? (
                          <LineChart title="Cluster Mean Trajectories" series={temporalSeries} />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No temporal trajectories" />
                        )}
                      </Card>
                      <Table
                        rowKey="cluster_id"
                        size="small"
                        pagination={false}
                        dataSource={temporal.clusters}
                        columns={[
                          { title: "Cluster", dataIndex: "cluster_id", width: 90 },
                          { title: "Size", dataIndex: "size", width: 90 },
                          { title: "Medoid", dataIndex: "medoid_canonical", width: 180 },
                          {
                            title: "Trend",
                            width: 120,
                            render: (_: unknown, row: AnalyticsTemporalPatternsResponse["clusters"][number]) => {
                              const shift = trajectoryShift(row.mean_trajectory);
                              if (shift.trend === "up") return <Tag color="green">up {shift.delta.toFixed(3)}</Tag>;
                              if (shift.trend === "down") return <Tag color="red">down {shift.delta.toFixed(3)}</Tag>;
                              return <Tag>flat</Tag>;
                            },
                          },
                          {
                            title: "Terms",
                            render: (_: unknown, row: AnalyticsTemporalPatternsResponse["clusters"][number]) => compactTerms(row.terms),
                          },
                        ]}
                      />
                    </Space>
                  )}
                </Card>
              ),
            },
            {
              key: "explainability",
              label: "Explainability",
              children: (
                <Card className="ac-card">
                  <Space wrap style={{ marginBottom: 16 }}>
                    <Select
                      allowClear
                      style={{ width: 260 }}
                      value={targetCohort}
                      placeholder="target cohort (optional)"
                      options={cohortOptions}
                      onChange={setTargetCohort}
                    />
                    <Button type="primary" onClick={() => void runExplainability()} loading={loadingExplainability} disabled={!projectId}>
                      Run Explainability
                    </Button>
                    {explainability?.accuracy ? (
                      <Tag color="blue">cv accuracy={toPercent(explainability.accuracy.mean, 2)}</Tag>
                    ) : null}
                  </Space>

                  {!explainability ? (
                    <Empty description="Run explainability to see feature importance" />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: "100%" }}>
                      <Card size="small" className="ac-subcard" title="Feature Importance Board">
                        <ImportanceBoard items={explainability.feature_importance} />
                      </Card>
                      <Table
                        rowKey="term_id"
                        size="small"
                        pagination={{ pageSize: 8 }}
                        dataSource={explainability.target_preview}
                        columns={[
                          { title: "Term", dataIndex: "canonical", width: 180 },
                          { title: "True Cohort", dataIndex: "true_cohort", width: 150 },
                          { title: "Target Prob", dataIndex: "target_probability", render: (value: number) => value.toFixed(4) },
                        ]}
                      />
                    </Space>
                  )}
                </Card>
              ),
            },
          ]}
        />
      </Space>
    </div>
  );
}
