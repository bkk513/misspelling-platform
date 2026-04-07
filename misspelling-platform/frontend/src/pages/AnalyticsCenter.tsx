import {
  BranchesOutlined,
  ClusterOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  InputNumber,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToApp } from "../app/router";
import {
  api,
  describeApiError,
  type DataSourceKey,
  type MesoAnalysisResult,
  type MesoPrepareResponse,
  type ProjectCohortItem,
  type ProjectItem,
  type ProjectTermsResponse,
  type TaskDetailResponse,
  type TaskListItem,
} from "../lib/api";
import "./analyticsCenter.css";

type ProjectTermItem = ProjectTermsResponse["items"][number];

const CLUSTER_COLORS = ["#1456d9", "#0f766e", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
const TERMINAL_STATES = new Set(["SUCCESS", "FAILURE", "PAUSED", "REVOKED", "DELETED"]);
const REQUIRED_TASKS = ["word-analysis", "pcmci-causal", "mrnmr-steady", "deltaT-null"];

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeWord(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeMicroTaskType(value: unknown): string {
  const key = String(value || "").trim().toLowerCase();
  if (key === "causal-work" || key === "casual-work" || key === "causal_work") return "pcmci-causal";
  return key;
}

function extractTaskWord(task: TaskListItem): string {
  const raw = task.params_json;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  return normalizeWord((raw as Record<string, unknown>).word);
}

function extractTaskDataSource(task: TaskListItem): string {
  const raw = task.params_json;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "gbnc";
  return String((raw as Record<string, unknown>).data_source || "gbnc").trim().toLowerCase();
}

function metricLabel(key: string): string {
  const map: Record<string, string> = {
    avg_misspelling_rate: "平均错拼率",
    peak_misspelling_rate: "峰值错拼率",
    steady_lag_years: "稳定耗时",
    delta_t_years: "delta_t",
    variant_count: "错误变体数",
    causal_edge_count: "因果边数",
    causal_mean_strength: "因果强度",
    simulation_best_score: "仿真 best_score",
  };
  return map[key] || key;
}

function formatMetric(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (key.includes("rate")) return `${(value * 100).toFixed(2)}%`;
  if (key.includes("count")) return value.toFixed(0);
  if (key.includes("score")) return value.toFixed(3);
  return value.toFixed(2);
}

function taskColor(state: string): string {
  const key = String(state || "").toUpperCase();
  if (key === "SUCCESS") return "green";
  if (key === "FAILURE") return "red";
  if (key === "QUEUED" || key === "RUNNING" || key === "PROGRESS") return "blue";
  if (key === "PAUSED" || key === "REVOKED") return "orange";
  if (key === "SKIPPED") return "default";
  return "default";
}

function HeatmapBoard({ result }: { result: MesoAnalysisResult }) {
  if (!result.comparison.heatmap.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可展示的类别对比数据" />;
  }

  return (
    <div className="meso-heatmap">
      <div className="meso-heatmap-row meso-heatmap-head">
        <div className="meso-heatmap-category">类别</div>
        {result.comparison.metrics.map((metric) => (
          <div key={metric.key} className="meso-heatmap-cell meso-heatmap-metric">
            {metricLabel(metric.key)}
          </div>
        ))}
      </div>
      {result.comparison.heatmap.map((row) => (
        <div key={row.category} className="meso-heatmap-row">
          <div className="meso-heatmap-category">{row.category}</div>
          {row.values.map((cell) => (
            <div
              key={`${row.category}-${cell.key}`}
              className="meso-heatmap-cell"
              style={{
                background: cell.score === null
                  ? "linear-gradient(135deg, rgba(15,23,42,0.05), rgba(15,23,42,0.02))"
                  : `linear-gradient(135deg, rgba(20,86,217,${0.12 + (cell.score || 0) * 0.6}), rgba(8,145,178,${0.1 + (cell.score || 0) * 0.45}))`,
              }}
            >
              <div className="meso-heatmap-value">{formatMetric(cell.key, cell.mean)}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DistributionBoard({ result }: { result: MesoAnalysisResult }) {
  const distributions = result.comparison.distributions.slice(0, 3);
  if (!distributions.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有分布数据" />;
  }

  return (
    <div className="meso-distribution-grid">
      {distributions.map((metric) => {
        const groups = metric.groups.map((group) => {
          const mean = group.values.length ? group.values.reduce((sum, item) => sum + item, 0) / group.values.length : 0;
          return { ...group, mean };
        });
        const maxValue = Math.max(0.0001, ...groups.map((item) => item.mean));
        return (
          <Card key={metric.key} className="meso-panel-card" bordered={false}>
            <div className="meso-panel-title">{metricLabel(metric.key)}</div>
            <div className="meso-bar-list">
              {groups.map((group) => (
                <div key={`${metric.key}-${group.category}`} className="meso-bar-row">
                  <div className="meso-bar-meta">
                    <span>{group.category}</span>
                    <span>{formatMetric(metric.key, group.mean)}</span>
                  </div>
                  <div className="meso-bar-track">
                    <div className="meso-bar-fill" style={{ width: `${(group.mean / maxValue) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ClusterScatter({ result }: { result: MesoAnalysisResult }) {
  const points = result.clustering.scatter;
  if (!points.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有聚类散点" />;
  }

  const width = 860;
  const height = 320;
  const pad = 28;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scaleX = (value: number) => (maxX === minX ? width / 2 : pad + ((value - minX) / (maxX - minX)) * (width - pad * 2));
  const scaleY = (value: number) => (maxY === minY ? height / 2 : height - pad - ((value - minY) / (maxY - minY)) * (height - pad * 2));

  return (
    <div className="meso-scatter-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="meso-scatter-svg" role="img" aria-label="meso clustering scatter">
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="#d8e3f2" strokeDasharray="4,4" />
        <line x1={width / 2} y1={pad} x2={width / 2} y2={height - pad} stroke="#d8e3f2" strokeDasharray="4,4" />
        {points.map((point) => (
          <g key={`${point.term_id}-${point.cluster_id}`}>
            <circle
              cx={scaleX(point.x)}
              cy={scaleY(point.y)}
              r={6}
              fill={CLUSTER_COLORS[point.cluster_id % CLUSTER_COLORS.length]}
              opacity={0.9}
            />
            <title>{`${point.canonical} · ${point.cluster_label}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function AnalyticsCenterPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>(undefined);
  const [projectTerms, setProjectTerms] = useState<ProjectTermItem[]>([]);
  const [projectCohorts, setProjectCohorts] = useState<ProjectCohortItem[]>([]);
  const [projectTasks, setProjectTasks] = useState<TaskListItem[]>([]);

  const [selectedCohorts, setSelectedCohorts] = useState<string[]>([]);
  const [selectedTermIds, setSelectedTermIds] = useState<number[]>([]);
  const [dataSource, setDataSource] = useState<DataSourceKey>("gbnc");
  const [clusterK, setClusterK] = useState(3);
  const [includeSimulation, setIncludeSimulation] = useState(false);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineStep, setPipelineStep] = useState("");

  const [prepareResult, setPrepareResult] = useState<MesoPrepareResponse | null>(null);
  const [microTaskStates, setMicroTaskStates] = useState<TaskDetailResponse[]>([]);
  const [mesoTaskId, setMesoTaskId] = useState<string | null>(null);
  const [mesoTaskState, setMesoTaskState] = useState<TaskDetailResponse | null>(null);
  const [mesoResult, setMesoResult] = useState<MesoAnalysisResult | null>(null);

  const activeCohorts = useMemo(
    () => projectCohorts.filter((item) => Boolean(item.is_active)),
    [projectCohorts]
  );

  const cohortOptions = useMemo(
    () => activeCohorts.map((item) => ({ value: item.name, label: item.name })),
    [activeCohorts]
  );

  const filteredTerms = useMemo(() => {
    if (!selectedCohorts.length) return projectTerms;
    const selected = new Set(selectedCohorts);
    return projectTerms.filter((term) => selected.has(term.primary_cohort || term.category || "custom"));
  }, [projectTerms, selectedCohorts]);

  const effectiveTerms = useMemo(() => {
    if (!selectedTermIds.length) return filteredTerms;
    const selected = new Set(selectedTermIds);
    return filteredTerms.filter((term) => selected.has(term.term_id));
  }, [filteredTerms, selectedTermIds]);

  const projectOptions = useMemo(
    () => projects.map((item) => ({ value: item.id, label: item.name })),
    [projects]
  );

  const termOptions = useMemo(
    () => filteredTerms.map((term) => ({ value: term.term_id, label: `${term.canonical} · ${term.primary_cohort || term.category || "custom"}` })),
    [filteredTerms]
  );

  const latestTaskMap = useMemo(() => {
    const map = new Map<string, TaskListItem>();
    for (const task of projectTasks) {
      const word = extractTaskWord(task);
      if (!word) continue;
      const key = `${word}::${normalizeMicroTaskType(task.task_type)}::${extractTaskDataSource(task)}`;
      if (!map.has(key)) map.set(key, task);
    }
    return map;
  }, [projectTasks]);

  const coverageRows = useMemo(() => {
    return REQUIRED_TASKS.concat(includeSimulation ? ["simulation-run"] : []).map((taskType) => {
      const readyTerms = effectiveTerms.filter((term) => {
        const taskKey = `${normalizeWord(term.canonical)}::${taskType}::${dataSource}`;
        return String(latestTaskMap.get(taskKey)?.status || "").toUpperCase() === "SUCCESS";
      }).length;
      return {
        taskType,
        readyTerms,
        ratio: effectiveTerms.length ? readyTerms / effectiveTerms.length : 0,
      };
    });
  }, [dataSource, effectiveTerms, includeSimulation, latestTaskMap]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === projectId) || null,
    [projects, projectId]
  );

  const microReadyCount = useMemo(() => {
    if (!effectiveTerms.length) return 0;
    return effectiveTerms.filter((term) =>
      coverageRows.every((item) => {
        const taskKey = `${normalizeWord(term.canonical)}::${item.taskType}::${dataSource}`;
        return String(latestTaskMap.get(taskKey)?.status || "").toUpperCase() === "SUCCESS";
      })
    ).length;
  }, [coverageRows, dataSource, effectiveTerms, latestTaskMap]);

  const requestBody = useMemo(
    () => ({
      project_id: projectId || 0,
      cohort_names: selectedCohorts,
      term_ids: selectedTermIds,
      cluster_k: clusterK,
      include_simulation: includeSimulation,
      data_source: dataSource,
    }),
    [clusterK, dataSource, includeSimulation, projectId, selectedCohorts, selectedTermIds]
  );

  const refreshProjects = async () => {
    setLoadingProjects(true);
    try {
      const resp = await api.listProjects(150);
      const items = resp.items || [];
      setProjects(items);
      setProjectId((current) => {
        if (current && items.some((item) => item.id === current)) return current;
        return items[0]?.id;
      });
    } catch (error) {
      message.error(describeApiError(error));
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadProjectContext = async (id: number) => {
    setLoadingContext(true);
    try {
      const [termResp, cohortResp, taskResp] = await Promise.all([
        api.listProjectTerms(id),
        api.listProjectCohorts(id),
        api.listProjectTasks(id, 500),
      ]);
      const nextTerms = termResp.items || [];
      const nextCohorts = (cohortResp.items || []).filter((item) => Boolean(item.is_active));
      setProjectTerms(nextTerms);
      setProjectCohorts(nextCohorts);
      setProjectTasks(taskResp.items || []);

      const defaultCohorts = nextCohorts.map((item) => item.name);
      setSelectedCohorts((current) => {
        const filtered = current.filter((name) => defaultCohorts.includes(name));
        return filtered.length ? filtered : defaultCohorts;
      });
      setSelectedTermIds((current) => current.filter((termId) => nextTerms.some((term) => term.term_id === termId)));
    } catch (error) {
      message.error(describeApiError(error));
      setProjectTerms([]);
      setProjectCohorts([]);
      setProjectTasks([]);
    } finally {
      setLoadingContext(false);
    }
  };

  useEffect(() => {
    if (sessionRole === "guest") return;
    void refreshProjects();
  }, [sessionRole]);

  useEffect(() => {
    if (!projectId || sessionRole === "guest") return;
    void loadProjectContext(projectId);
  }, [projectId, sessionRole]);

  const waitForTasks = async (taskIds: string[]) => {
    const uniqueIds = Array.from(new Set(taskIds.filter(Boolean)));
    if (!uniqueIds.length) return [] as TaskDetailResponse[];
    let latest: TaskDetailResponse[] = [];
    for (let round = 0; round < 120; round += 1) {
      latest = await Promise.all(uniqueIds.map((taskId) => api.getTask(taskId)));
      setMicroTaskStates(latest);
      if (latest.every((item) => TERMINAL_STATES.has(String(item.state || "").toUpperCase()))) {
        return latest;
      }
      await sleep(2000);
    }
    return latest;
  };

  const waitForSingleTask = async (taskId: string) => {
    let latest: TaskDetailResponse | null = null;
    for (let round = 0; round < 120; round += 1) {
      latest = await api.getTask(taskId);
      setMesoTaskState(latest);
      if (TERMINAL_STATES.has(String(latest.state || "").toUpperCase())) {
        return latest;
      }
      await sleep(2000);
    }
    return latest;
  };

  const runAnalyzeOnly = async () => {
    if (!projectId || !effectiveTerms.length) {
      message.warning("先选择项目和至少一个词项");
      return;
    }
    setRunningPipeline(true);
    setPipelineStep("正在生成中观聚合");
    setMesoResult(null);
    try {
      const created = await api.analyticsMesoAnalyze(requestBody);
      setMesoTaskId(created.task_id);
      const detail = await waitForSingleTask(created.task_id);
      if (!detail || String(detail.state || "").toUpperCase() !== "SUCCESS") {
        throw new Error("中观聚合任务失败");
      }
      setMesoResult(detail.result as MesoAnalysisResult);
      await loadProjectContext(projectId);
      message.success("中观结果已生成");
    } catch (error) {
      message.error(describeApiError(error));
    } finally {
      setRunningPipeline(false);
      setPipelineStep("");
    }
  };

  const runPipeline = async () => {
    if (!projectId || !effectiveTerms.length) {
      message.warning("先选择项目和至少一个词项");
      return;
    }
    setRunningPipeline(true);
    setPrepareResult(null);
    setMicroTaskStates([]);
    setMesoTaskState(null);
    setMesoTaskId(null);
    setMesoResult(null);

    try {
      setPipelineStep("正在准备微观任务");
      const prepare = await api.analyticsMesoPrepare(requestBody);
      setPrepareResult(prepare);
      await loadProjectContext(projectId);

      if (prepare.watched_task_ids.length) {
        setPipelineStep("正在等待微观任务完成");
        const microStates = await waitForTasks(prepare.watched_task_ids);
        const failedCount = microStates.filter((item) => String(item.state || "").toUpperCase() === "FAILURE").length;
        if (failedCount > 0) {
          message.warning(`有 ${failedCount} 个微观任务失败，系统会继续做可用结果聚合`);
        }
        await loadProjectContext(projectId);
      }

      setPipelineStep("正在生成中观聚合");
      const created = await api.analyticsMesoAnalyze(requestBody);
      setMesoTaskId(created.task_id);
      const detail = await waitForSingleTask(created.task_id);
      if (!detail || String(detail.state || "").toUpperCase() !== "SUCCESS") {
        throw new Error("中观聚合任务失败");
      }
      setMesoResult(detail.result as MesoAnalysisResult);
      await loadProjectContext(projectId);
      message.success("中观链路已跑通");
    } catch (error) {
      message.error(describeApiError(error));
    } finally {
      setRunningPipeline(false);
      setPipelineStep("");
    }
  };

  const taskColumns = [
    {
      title: "词项",
      dataIndex: "canonical",
      key: "canonical",
    },
    {
      title: "类别",
      dataIndex: "primary_cohort",
      key: "primary_cohort",
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "微观状态",
      key: "statuses",
      render: (_: unknown, row: MesoPrepareResponse["task_matrix"][number]) => (
        <Space wrap>
          {row.task_statuses.map((item) => (
            <Tag key={`${row.term_id}-${item.task_type}`} color={taskColor(item.status)}>
              {item.task_type}: {item.status}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  const featureColumns = [
    {
      title: "词项",
      dataIndex: "canonical",
      key: "canonical",
      fixed: "left" as const,
      width: 140,
    },
    {
      title: "类别",
      dataIndex: "primary_cohort",
      key: "primary_cohort",
      width: 120,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "平均错拼率",
      key: "avg_misspelling_rate",
      width: 140,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("avg_misspelling_rate", row.avg_misspelling_rate),
    },
    {
      title: "峰值错拼率",
      key: "peak_misspelling_rate",
      width: 140,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("peak_misspelling_rate", row.peak_misspelling_rate),
    },
    {
      title: "delta_t",
      key: "delta_t_years",
      width: 110,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("delta_t_years", row.delta_t_years),
    },
    {
      title: "稳定耗时",
      key: "steady_lag_years",
      width: 120,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("steady_lag_years", row.steady_lag_years),
    },
    {
      title: "变体数",
      key: "variant_count",
      width: 100,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("variant_count", row.variant_count),
    },
    {
      title: "因果边数",
      key: "causal_edge_count",
      width: 110,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("causal_edge_count", row.causal_edge_count),
    },
    {
      title: "因果强度",
      key: "causal_mean_strength",
      width: 120,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) => formatMetric("causal_mean_strength", row.causal_mean_strength),
    },
    {
      title: "微观结果",
      key: "micro_ready",
      width: 180,
      render: (_: unknown, row: MesoAnalysisResult["feature_rows"][number]) =>
        row.micro_ready ? <Tag color="green">完整</Tag> : <Tag color="orange">缺失: {row.missing_tasks.join(", ")}</Tag>,
    },
  ];

  if (sessionRole === "guest") {
    return <Alert type="warning" message="中观分析需要登录后使用" showIcon />;
  }

  return (
    <div className="meso-page">
      <div className="meso-hero">
        <div>
          <div className="meso-eyebrow">MESO ANALYTICS</div>
          <Typography.Title level={2} className="meso-title">
            中观层面分析
          </Typography.Title>
          <Typography.Paragraph className="meso-subtitle">
            用已有微观结果把单词级实验提升为类别级画像、对比和轻量聚类。页面只保留一条可答辩的操作链路。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => goToApp("project-manager")}>Project Manager</Button>
          <Button icon={<ReloadOutlined />} loading={loadingProjects || loadingContext} onClick={() => void (projectId ? loadProjectContext(projectId) : refreshProjects())}>
            刷新
          </Button>
        </Space>
      </div>

      <Card className="meso-control-card" bordered={false}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={10}>
            <div className="meso-field-label">项目</div>
            <Select
              value={projectId}
              options={projectOptions}
              onChange={(value) => setProjectId(value)}
              className="meso-full"
              placeholder="选择项目"
              loading={loadingProjects}
            />
          </Col>
          <Col xs={12} xl={4}>
            <div className="meso-field-label">数据源</div>
            <Select
              value={dataSource}
              onChange={(value) => setDataSource(value as DataSourceKey)}
              options={[
                { value: "gbnc", label: "GBNC" },
                { value: "gdelt", label: "GDELT" },
              ]}
              className="meso-full"
            />
          </Col>
          <Col xs={24} xl={10}>
            <div className="meso-action-row">
              <Button type="primary" size="large" icon={<ThunderboltOutlined />} onClick={() => void runPipeline()} loading={runningPipeline}>
                一键准备并生成中观分析
              </Button>
              <Button size="large" icon={<ExperimentOutlined />} onClick={() => void runAnalyzeOnly()} disabled={runningPipeline || !effectiveTerms.length}>
                仅刷新聚合
              </Button>
            </div>
          </Col>
          <Col xs={24}>
            <Typography.Text type="secondary">
              默认最简流程：只选项目和数据源即可运行。系统会自动使用项目内所有 active 类别与词项。
            </Typography.Text>
          </Col>
        </Row>

        <Collapse
          ghost
          className="meso-advanced-collapse"
          items={[
            {
              key: "advanced",
              label: "高级筛选与参数（可选）",
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={8}>
                    <div className="meso-field-label">类别</div>
                    <Select
                      mode="multiple"
                      value={selectedCohorts}
                      options={cohortOptions}
                      onChange={setSelectedCohorts}
                      className="meso-full"
                      optionFilterProp="label"
                      placeholder="默认分析当前项目全部 active 类别"
                    />
                  </Col>
                  <Col xs={24} xl={10}>
                    <div className="meso-field-label">词项</div>
                    <Select
                      mode="multiple"
                      value={selectedTermIds}
                      options={termOptions}
                      onChange={setSelectedTermIds}
                      className="meso-full"
                      optionFilterProp="label"
                      placeholder="留空表示使用当前类别下全部词项"
                      maxTagCount="responsive"
                    />
                  </Col>
                  <Col xs={12} xl={3}>
                    <div className="meso-field-label">聚类数</div>
                    <InputNumber min={2} max={8} value={clusterK} onChange={(value) => setClusterK(Number(value) || 3)} className="meso-full" />
                  </Col>
                  <Col xs={12} xl={3}>
                    <div className="meso-field-label">包含仿真</div>
                    <div className="meso-switch-row">
                      <Switch checked={includeSimulation} onChange={setIncludeSimulation} />
                    </div>
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card className="meso-stat-card" bordered={false}>
            <Statistic title="当前项目" value={selectedProject?.name || "-"} prefix={<FolderOpenOutlined />} />
            <div className="meso-stat-copy">类别 {selectedCohorts.length || activeCohorts.length} 个，词项 {effectiveTerms.length} 个，数据源 {String(dataSource).toUpperCase()}。</div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="meso-stat-card" bordered={false}>
            <Statistic title="微观完整词项" value={microReadyCount} suffix={`/ ${effectiveTerms.length || 0}`} prefix={<ExperimentOutlined />} />
            <Progress percent={effectiveTerms.length ? Number(((microReadyCount / effectiveTerms.length) * 100).toFixed(1)) : 0} size="small" showInfo={false} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="meso-stat-card" bordered={false}>
            <Statistic title="必需任务覆盖" value={coverageRows.length ? `${coverageRows.filter((item) => item.ratio >= 1).length}/${coverageRows.length}` : "0/0"} prefix={<BranchesOutlined />} />
            <div className="meso-stat-copy">{coverageRows.map((item) => `${item.taskType}:${Math.round(item.ratio * 100)}%`).join(" · ")}</div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="meso-stat-card" bordered={false}>
            <Statistic title="当前建议" value={effectiveTerms.length ? "可直接运行" : "先补词项"} prefix={<ClusterOutlined />} />
            <div className="meso-stat-copy">页面默认只分析你选中的类别和词，不再要求手动理解多个分析模块。</div>
          </Card>
        </Col>
      </Row>

      {(runningPipeline || prepareResult || mesoTaskState) ? (
        <Card className="meso-process-card" bordered={false}>
          <div className="meso-section-head">
            <div>
              <div className="meso-section-title">执行链路</div>
              <div className="meso-section-copy">准备微观结果，然后自动产出中观画像与聚类结果。</div>
            </div>
            {pipelineStep ? <Tag color="blue">{pipelineStep}</Tag> : null}
          </div>

          {prepareResult ? (
            <Alert
              type="info"
              showIcon
              message={`已纳入 ${prepareResult.selected_term_count} 个词项，创建 ${prepareResult.created_tasks.length} 个任务，复用 ${prepareResult.reused_tasks.length} 个已有任务。`}
            />
          ) : null}

          {microTaskStates.length ? (
            <div className="meso-inline-tags">
              {microTaskStates.map((item) => (
                <Tag key={item.task_id} color={taskColor(item.state)}>
                  {item.task_id.slice(0, 8)} · {item.state}
                </Tag>
              ))}
            </div>
          ) : null}

          {mesoTaskId ? (
            <div className="meso-inline-tags">
              <Tag color={taskColor(mesoTaskState?.state || "QUEUED")}>meso-analysis · {mesoTaskState?.state || "QUEUED"}</Tag>
            </div>
          ) : null}

          {prepareResult?.task_matrix?.length ? (
            <Table
              rowKey={(row) => String(row.term_id)}
              columns={taskColumns}
              dataSource={prepareResult.task_matrix}
              pagination={{ pageSize: 6 }}
              size="small"
            />
          ) : null}
        </Card>
      ) : null}

      {!mesoResult ? (
        <Card className="meso-empty-card" bordered={false}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有生成中观结果。先选类别和词项，然后点击“一键准备并生成中观分析”。"
          />
        </Card>
      ) : (
        <>
          {mesoResult.warnings.length ? (
            <Alert
              type="warning"
              showIcon
              message="部分词项的微观结果还不完整，本次中观结果会对缺失指标做空值安全聚合。"
              description={mesoResult.warnings.slice(0, 5).join("；")}
            />
          ) : null}

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={6}>
              <Card className="meso-result-card" bordered={false}>
                <Statistic title="分析词项" value={mesoResult.summary.selected_terms} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card className="meso-result-card" bordered={false}>
                <Statistic title="分析类别" value={mesoResult.summary.selected_categories} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card className="meso-result-card" bordered={false}>
                <Statistic title="聚类数" value={mesoResult.clustering.k} />
              </Card>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <Card className="meso-result-card" bordered={false}>
                <Statistic title="微观就绪率" value={Number((mesoResult.summary.ready_ratio * 100).toFixed(1))} suffix="%" />
              </Card>
            </Col>
          </Row>

          <Card className="meso-panel-card" bordered={false}>
            <div className="meso-section-head">
              <div>
                <div className="meso-section-title">类别画像</div>
                <div className="meso-section-copy">每个类别用已有微观结果聚合出错拼率、稳定耗时、delta_t 和变体数。</div>
              </div>
            </div>
            <div className="meso-profile-grid">
              {mesoResult.category_profiles.map((profile) => (
                <div key={profile.category} className="meso-profile-card">
                  <div className="meso-profile-head">
                    <div className="meso-profile-title">{profile.category}</div>
                    <Tag>{profile.term_count} terms</Tag>
                  </div>
                  <div className="meso-profile-metrics">
                    <div>平均错拼率: {formatMetric("avg_misspelling_rate", profile.metrics.avg_misspelling_rate?.mean)}</div>
                    <div>峰值错拼率: {formatMetric("peak_misspelling_rate", profile.metrics.peak_misspelling_rate?.mean)}</div>
                    <div>delta_t: {formatMetric("delta_t_years", profile.metrics.delta_t_years?.mean)}</div>
                    <div>因果强度: {formatMetric("causal_mean_strength", profile.metrics.causal_mean_strength?.mean)}</div>
                  </div>
                  <div className="meso-profile-terms">代表词: {profile.representative_terms.join(", ") || "-"}</div>
                </div>
              ))}
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
              <Card className="meso-panel-card" bordered={false}>
                <div className="meso-section-head">
                  <div>
                    <div className="meso-section-title">类别对比热力图</div>
                    <div className="meso-section-copy">颜色越深，表示该类别在对应指标上的均值越高。</div>
                  </div>
                </div>
                <HeatmapBoard result={mesoResult} />
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card className="meso-panel-card" bordered={false}>
                <div className="meso-section-head">
                  <div>
                    <div className="meso-section-title">关键指标分布</div>
                    <div className="meso-section-copy">保留最能解释中观差异的几个核心指标。</div>
                  </div>
                </div>
                <DistributionBoard result={mesoResult} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card className="meso-panel-card" bordered={false}>
                <div className="meso-section-head">
                  <div>
                    <div className="meso-section-title">轻量聚类散点</div>
                    <div className="meso-section-copy">使用标准化后的词项特征向量做 KMeans 聚类，并用 PCA 投影到二维平面。</div>
                  </div>
                  {mesoResult.clustering.diagnostics.silhouette !== null ? (
                    <Tag color="blue">silhouette {mesoResult.clustering.diagnostics.silhouette.toFixed(3)}</Tag>
                  ) : null}
                </div>
                <ClusterScatter result={mesoResult} />
              </Card>
            </Col>
            <Col xs={24} xl={9}>
              <Card className="meso-panel-card" bordered={false}>
                <div className="meso-section-head">
                  <div>
                    <div className="meso-section-title">簇解释</div>
                    <div className="meso-section-copy">簇标签直接根据簇中心的错拼率、变体数和稳定速度自动概括。</div>
                  </div>
                </div>
                <div className="meso-cluster-list">
                  {mesoResult.clustering.clusters.map((cluster, index) => (
                    <div key={cluster.cluster_id} className="meso-cluster-card">
                      <div className="meso-cluster-head">
                        <Tag color={CLUSTER_COLORS[index % CLUSTER_COLORS.length]}>{cluster.label}</Tag>
                        <span>{cluster.size} terms</span>
                      </div>
                      <div className="meso-cluster-copy">代表词: {cluster.representative_terms.join(", ") || "-"}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>

          <Card className="meso-panel-card" bordered={false}>
            <div className="meso-section-head">
              <div>
                <div className="meso-section-title">词项特征表</div>
                <div className="meso-section-copy">答辩时可以直接说明：中观模块不是另造模型，而是对词项级微观结果做结构化聚合。</div>
              </div>
            </div>
            <Table
              rowKey={(row) => String(row.term_id)}
              columns={featureColumns}
              dataSource={mesoResult.feature_rows}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 980 }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
