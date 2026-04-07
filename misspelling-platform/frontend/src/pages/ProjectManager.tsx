import {
  ArrowRightOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { goToApp } from "../app/router";
import {
  api,
  describeApiError,
  type AnalyticsSummaryResponse,
  type ProjectCohortItem,
  type ProjectItem,
  type ProjectMembershipItem,
  type ProjectTermsResponse,
  type TaskListItem,
} from "../lib/api";
import "./algorithmStudio.css";
import "./projectManager.css";

type ProjectTermItem = ProjectTermsResponse["items"][number];

type CreateProjectForm = { name: string; description?: string };
type IntakeForm = { words: string; target_cohort?: string };
type CreateCohortForm = { name: string };
type MembershipForm = {
  term_id?: number;
  cohort_id?: number;
  membership_weight?: number;
  confidence?: number;
  source?: string;
  note?: string;
};
type EditCohortForm = {
  name?: string;
  description?: string;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
};

function normalizeWord(v: string | undefined) {
  return String(v || "").trim().toLowerCase();
}

function splitWords(value: string): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,，;；]+/)
        .map((x) => normalizeWord(x))
        .filter(Boolean)
    )
  );
}

function ReadinessChip({ ready }: { ready: boolean }) {
  return ready ? (
    <Tag color="green" icon={<CheckCircleFilled />}>已就绪</Tag>
  ) : (
    <Tag color="orange" icon={<WarningFilled />}>待补齐</Tag>
  );
}

function FlowCard({
  index,
  title,
  copy,
}: {
  index: number;
  title: string;
  copy: string;
}) {
  return (
    <div className="pm-flow-card">
      <div className="pm-flow-index">0{index}</div>
      <div className="pm-flow-title">{title}</div>
      <div className="pm-flow-copy">{copy}</div>
    </div>
  );
}

export function ProjectManagerPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);

  const [projectTasks, setProjectTasks] = useState<TaskListItem[]>([]);
  const [projectTerms, setProjectTerms] = useState<ProjectTermItem[]>([]);
  const [projectCohorts, setProjectCohorts] = useState<ProjectCohortItem[]>([]);
  const [projectMemberships, setProjectMemberships] = useState<ProjectMembershipItem[]>([]);
  const [projectSummary, setProjectSummary] = useState<AnalyticsSummaryResponse | null>(null);

  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [runningAction, setRunningAction] = useState(false);

  const [bindTaskId, setBindTaskId] = useState("");
  const [editingCohort, setEditingCohort] = useState<ProjectCohortItem | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [lastImportInfo, setLastImportInfo] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [createProjectForm] = Form.useForm<CreateProjectForm>();
  const [intakeForm] = Form.useForm<IntakeForm>();
  const [createCohortForm] = Form.useForm<CreateCohortForm>();
  const [membershipForm] = Form.useForm<MembershipForm>();
  const [editCohortForm] = Form.useForm<EditCohortForm>();

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const activeCohorts = useMemo(
    () => projectCohorts.filter((row) => Boolean(row.is_active)),
    [projectCohorts]
  );
  const activeCohortNames = useMemo(() => activeCohorts.map((row) => row.name), [activeCohorts]);

  const cohortSizeMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of projectMemberships) {
      map.set(row.cohort_id, (map.get(row.cohort_id) || 0) + 1);
    }
    return map;
  }, [projectMemberships]);

  const taskOptions = useMemo(
    () =>
      tasks.map((t) => ({
        value: t.task_id,
        label: `${t.display_name || t.task_type} (${t.task_id.slice(0, 8)}...)`,
      })),
    [tasks]
  );

  const termOptions = useMemo(
    () =>
      projectTerms.map((term) => ({
        value: term.term_id,
        label: `${term.canonical} (#${term.term_id})`,
      })),
    [projectTerms]
  );

  const cohortOptions = useMemo(
    () =>
      activeCohorts.map((cohort) => ({
        value: cohort.id,
        label: cohort.name,
      })),
    [activeCohorts]
  );

  const intakeCohortOptions = useMemo(
    () => activeCohortNames.map((name) => ({ value: name, label: name })),
    [activeCohortNames]
  );

  const totalTerms = projectTerms.length;
  const linkedTasks = projectTasks.length;
  const termsWithPoints = Number(projectSummary?.terms_with_points || 0);
  const coverageRatio = Number(projectSummary?.coverage_ratio || 0);

  const hasProject = Boolean(selectedProjectId);
  const hasEnoughTerms = totalTerms >= 2;
  const hasEnoughCohorts = activeCohorts.length >= 2;
  const hasEvidenceSeries = termsWithPoints >= 2;
  const readyForAnalytics = hasProject && hasEnoughTerms && hasEnoughCohorts;
  const recommendedCohortDefs = [
    { value: "scientific_terms", label: "科研术语" },
    { value: "brands", label: "品牌词" },
    { value: "common_words", label: "常见词" },
  ];
  const recommendedCohorts = recommendedCohortDefs.map((item) => item.value);

  const refreshOverview = async () => {
    setLoadingOverview(true);
    try {
      const [projectResp, taskResp] = await Promise.all([api.listProjects(150), api.listTasks(200)]);
      const nextProjects = projectResp.items || [];
      setProjects(nextProjects);
      setTasks(taskResp.items || []);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((item) => item.id === current)) return current;
        return nextProjects[0]?.id;
      });
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadProjectDetail = async (projectId: number) => {
    setLoadingDetail(true);
    try {
      const [taskResp, termResp, cohortResp, membershipResp, summaryResp] = await Promise.all([
        api.listProjectTasks(projectId, 300),
        api.listProjectTerms(projectId),
        api.listProjectCohorts(projectId),
        api.listProjectMemberships(projectId),
        api.analyticsSummary(projectId),
      ]);
      setProjectTasks(taskResp.items || []);
      setProjectTerms(termResp.items || []);
      setProjectCohorts(cohortResp.items || []);
      setProjectMemberships(membershipResp.items || []);
      setProjectSummary(summaryResp);

      const cohortNames = (cohortResp.items || []).filter((item) => Boolean(item.is_active)).map((item) => item.name);
      if (cohortNames.length && !intakeForm.getFieldValue("target_cohort")) {
        intakeForm.setFieldValue("target_cohort", cohortNames[0]);
      }
      if (cohortResp.items?.length && !membershipForm.getFieldValue("cohort_id")) {
        const first = cohortResp.items.find((item) => Boolean(item.is_active));
        if (first) membershipForm.setFieldValue("cohort_id", first.id);
      }
    } catch (e) {
      setProjectTasks([]);
      setProjectTerms([]);
      setProjectCohorts([]);
      setProjectMemberships([]);
      setProjectSummary(null);
      message.error(describeApiError(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    void refreshOverview();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTasks([]);
      setProjectTerms([]);
      setProjectCohorts([]);
      setProjectMemberships([]);
      setProjectSummary(null);
      return;
    }
    void loadProjectDetail(selectedProjectId);
  }, [selectedProjectId]);

  const bindTask = async () => {
    if (!selectedProjectId || !bindTaskId) return;
    setRunningAction(true);
    try {
      await api.bindProjectTask(selectedProjectId, bindTaskId);
      message.success("Task linked to project");
      setBindTaskId("");
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningAction(false);
    }
  };

  const createRecommendedCohorts = async (names?: string[]) => {
    if (!selectedProjectId) {
      message.warning("Select a project first");
      return;
    }
    setRunningAction(true);
    try {
      for (const name of names || recommendedCohorts) {
        await api.createProjectCohort(selectedProjectId, { name: normalizeWord(name) });
      }
      message.success("Recommended cohorts ready");
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningAction(false);
    }
  };

  const importTermsFromFile = async (file: File) => {
    if (!selectedProjectId) {
      message.warning("Select a project first");
      return;
    }
    const targetCohort = normalizeWord(intakeForm.getFieldValue("target_cohort"));
    if (!targetCohort) {
      message.warning("Choose a target cohort first");
      return;
    }
    setImportingFile(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const raw = String(reader.result || "");
          const encoded = raw.includes(",") ? raw.split(",", 2)[1] : raw;
          resolve(encoded);
        };
        reader.onerror = () => reject(new Error("file_read_failed"));
        reader.readAsDataURL(file);
      });
      const resp = await api.importProjectTerms(selectedProjectId, {
        filename: file.name,
        content_base64: base64,
        target_cohort: targetCohort,
      });
      setLastImportInfo(
        `${resp.filename} · extracted=${resp.extracted_count} · added=${resp.added} · source=${resp.extract_source}`
      );
      message.success(`Imported ${resp.added} term(s) into ${targetCohort}`);
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setImportingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeMembership = async (row: ProjectMembershipItem) => {
    if (!selectedProjectId) return;
    setRunningAction(true);
    try {
      const resp = await api.deleteProjectMembership(selectedProjectId, { membership_id: row.id });
      message.success(`Deleted ${resp.deleted} membership mapping(s)`);
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningAction(false);
    }
  };

  const removeCohort = async (row: ProjectCohortItem) => {
    if (!selectedProjectId) return;
    setRunningAction(true);
    try {
      await api.deleteProjectCohort(selectedProjectId, row.id);
      message.success(`Cohort ${row.name} deleted`);
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setRunningAction(false);
    }
  };

  const openEditCohort = (cohort: ProjectCohortItem) => {
    setEditingCohort(cohort);
    editCohortForm.setFieldsValue({
      name: cohort.name,
      description: cohort.description || "",
      color: cohort.color || "",
      sort_order: cohort.sort_order,
      is_active: Boolean(cohort.is_active),
    });
  };

  const applyCohortEdit = async () => {
    if (!selectedProjectId || !editingCohort) return;
    try {
      const values = await editCohortForm.validateFields();
      setRunningAction(true);
      await api.updateProjectCohort(selectedProjectId, editingCohort.id, {
        name: normalizeWord(values.name),
        description: values.description,
        color: values.color,
        sort_order: values.sort_order,
        is_active: values.is_active,
      });
      message.success("Cohort updated");
      setEditingCohort(null);
      await loadProjectDetail(selectedProjectId);
    } catch (e) {
      if (e instanceof Error && e.message.includes("validate")) return;
      message.error(describeApiError(e));
    } finally {
      setRunningAction(false);
    }
  };

  if (sessionRole === "guest") {
    return (
      <div className="project-manager-shell">
        <Card bordered={false} className="algo-guard-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Project Manager Requires Login
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Project、cohort 和 analytics 属于持续性工程空间。当前系统对 guest 的任务和时序数据做了会话级隔离，但 project 工作区并不是同等级的隔离单元，因此这里对 guest 收口为不可用，避免不同访客之间出现工程信息串扰。
            </Typography.Paragraph>
          </Space>
        </Card>
      </div>
    );
  }

  const flowCards = [
    {
      index: 1,
      title: "选项目",
      copy: "先固定一个项目工作区，中观分析只围绕这一个项目展开。",
    },
    {
      index: 2,
      title: "建分组 + 入词",
      copy: "至少准备 2 个 cohort 并完成入词，随后直接去 Analytics Center 一键运行。",
    },
  ];

  const readinessItems = [
    {
      label: "Project",
      ready: hasProject,
      copy: hasProject ? `当前项目：${selectedProject?.name || `#${selectedProjectId}`}` : "还没有选中项目。",
    },
    {
      label: "Cohorts",
      ready: activeCohorts.length >= 2,
      copy: activeCohorts.length >= 2 ? `已有 ${activeCohorts.length} 个 active cohorts。` : "建议至少准备 2 个 active cohorts。",
    },
    {
      label: "Terms",
      ready: hasEnoughTerms,
      copy: hasEnoughTerms ? `已有 ${totalTerms} 个项目词项。` : "至少要有 2 个词项。",
    },
    {
      label: "Time-Series Evidence",
      ready: hasEvidenceSeries,
      copy: hasEvidenceSeries ? `${termsWithPoints} 个词已有时序证据。` : "还缺少时序证据，Temporal 模块会受限。",
    },
    {
      label: "Linked Tasks",
      ready: linkedTasks > 0,
      copy: linkedTasks > 0 ? `已绑定 ${linkedTasks} 个任务。` : "建议至少绑定一个任务，增强证据链。",
    },
  ];

  return (
    <div className="project-manager-shell">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          bordered={false}
          className="project-manager-hero"
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void refreshOverview()} loading={loadingOverview || loadingDetail}>
              Sync Workspace
            </Button>
          }
        >
          <div className="pm-hero-topline">Meso Workflow</div>
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>
            Project Manager 现在只做中观准备
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 18 }}>
            最小使用方式只有 2 步：先选项目，再完成“建分组 + 入词”。例外修正和任务绑定都放到可选区，不干扰第一次跑通。
          </Typography.Paragraph>
          <div className="pm-hero-actions">
            <Select
              showSearch
              style={{ minWidth: 280 }}
              value={selectedProjectId}
              placeholder="Select project"
              onChange={setSelectedProjectId}
              options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
            />
            <Tag color={readyForAnalytics ? "green" : "blue"}>{readyForAnalytics ? "Ready for Analytics" : "Still Preparing"}</Tag>
            {selectedProject ? <Tag color="geekblue">{selectedProject.name}</Tag> : null}
          </div>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Terms" value={totalTerms} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Active Cohorts" value={activeCohorts.length} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Time-Series Coverage" value={`${(coverageRatio * 100).toFixed(1)}%`} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Linked Tasks" value={linkedTasks} />
              </Card>
            </Col>
          </Row>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={15}>
            <Card className="pm-card" title="答辩时就按这 2 步讲">
              <div className="pm-flow-grid">
                {flowCards.map((item) => (
                  <FlowCard key={item.index} index={item.index} title={item.title} copy={item.copy} />
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card className="pm-card" title="Readiness For Analytics">
              <div className="pm-status-list">
                {readinessItems.map((item) => (
                  <div key={item.label} className="pm-status-row">
                    <div>
                      <div className="pm-status-label">{item.label}</div>
                      <div className="pm-status-copy">{item.copy}</div>
                    </div>
                    <ReadinessChip ready={item.ready} />
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>

        <Card className="pm-card" title="Step 1. 选项目" loading={loadingOverview}>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
              <Form
                layout="vertical"
                form={createProjectForm}
                onFinish={async (values) => {
                  setRunningAction(true);
                  try {
                    await api.createProject(values.name, values.description);
                    message.success("Project created");
                    createProjectForm.resetFields();
                    await refreshOverview();
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Row gutter={12}>
                  <Col span={10}>
                    <Form.Item name="name" label="New Project Name" rules={[{ required: true, min: 2 }]}>
                      <Input placeholder="e.g. tech-neologism-v1" />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item name="description" label="Description">
                      <Input placeholder="optional" />
                    </Form.Item>
                  </Col>
                  <Col span={4}>
                    <Form.Item label=" ">
                      <Button htmlType="submit" type="primary" icon={<PlusOutlined />} block loading={runningAction}>
                        Create
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </Col>
            <Col xs={24} xl={10}>
              <div className="pm-stage-note">
                <div className="pm-stage-note-title">Current Project</div>
                <div className="pm-stage-note-copy">
                  先固定一个项目工作区。后面的 cohorts、词项和任务证据都只服务于这个项目，避免结构混杂。
                </div>
                {selectedProject ? (
                  <div className="pm-selected-project">
                    <strong>{selectedProject.name}</strong>
                    {selectedProject.description ? ` · ${selectedProject.description}` : ""}
                  </div>
                ) : (
                  <div className="pm-stage-note-copy">No project selected yet.</div>
                )}
              </div>
            </Col>
          </Row>
        </Card>

        <Card className="pm-card" title="Step 2A. 建分组（最简）" loading={loadingDetail}>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                只做两件事：先点推荐分组，或者补一个你自己的组名。颜色、排序这些都自动处理，不需要第一次就理解。
              </Typography.Paragraph>
              <Space wrap style={{ marginBottom: 16 }}>
                <Button onClick={() => void createRecommendedCohorts()} loading={runningAction} disabled={!selectedProjectId}>
                  一键创建推荐分组
                </Button>
                {recommendedCohortDefs.map((item) => (
                  <Button key={item.value} onClick={() => void createRecommendedCohorts([item.value])} disabled={!selectedProjectId} loading={runningAction}>
                    {item.label}
                  </Button>
                ))}
              </Space>
              <Form
                form={createCohortForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedProjectId) {
                    message.warning("Select a project first");
                    return;
                  }
                  setRunningAction(true);
                  try {
                    await api.createProjectCohort(selectedProjectId, {
                      name: normalizeWord(values.name),
                    });
                    message.success("Cohort created");
                    createCohortForm.resetFields();
                    await loadProjectDetail(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Form.Item name="name" label="自定义分组名" rules={[{ required: true, min: 1 }]}>
                  <Input placeholder="例如 policy_terms" />
                </Form.Item>
                <Button htmlType="submit" type="primary" icon={<PlusOutlined />} loading={runningAction} disabled={!selectedProjectId}>
                  Add Cohort
                </Button>
              </Form>
            </Col>
            <Col xs={24} xl={14}>
              <div className="pm-cohort-grid">
                {projectCohorts.map((row) => (
                  <div key={row.id} className="pm-cohort-card">
                    <div className="pm-cohort-card-head">
                      <Tag color={row.color || "blue"}>{row.name}</Tag>
                      <Space size={4}>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEditCohort(row)} />
                        <Popconfirm title="Delete this cohort?" onConfirm={() => void removeCohort(row)}>
                          <Button danger size="small" icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    </div>
                    <div className="pm-cohort-card-meta">
                      <span>{cohortSizeMap.get(row.id) || 0} terms</span>
                      <span>{Boolean(row.is_active) ? "active" : "inactive"}</span>
                    </div>
                    <div className="pm-cohort-card-copy">{row.description || "No description yet."}</div>
                  </div>
                ))}
                {projectCohorts.length === 0 ? <div className="pm-cohort-card pm-cohort-card-empty">Create the first cohort to define the meso taxonomy.</div> : null}
              </div>
            </Col>
          </Row>
        </Card>

        <Card className="pm-card" title="Step 2B. 入词（最简）" loading={loadingDetail}>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Recommended usage"
                  description="这一步只做一件事：把一批词纳入项目，并直接归到一个已存在的 cohort。若 cohort 还没定义，先回到 Stage 2。"
              />
              <Form
                form={intakeForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedProjectId) {
                    message.warning("Select a project first");
                    return;
                  }
                  if (!values.target_cohort) {
                    message.warning("Choose a target cohort first");
                    return;
                  }
                  const words = splitWords(values.words);
                  if (words.length === 0) {
                    message.warning("Please input at least one word");
                    return;
                  }
                  setRunningAction(true);
                  try {
                    const resp = await api.addProjectTerms(selectedProjectId, words, normalizeWord(values.target_cohort));
                    message.success(`Added ${resp.added} term(s)`);
                    intakeForm.setFieldValue("words", "");
                    await loadProjectDetail(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
                initialValues={{ target_cohort: activeCohortNames[0] }}
              >
                <Form.Item name="target_cohort" label="Target Cohort" rules={[{ required: true }]}>
                  <Select showSearch placeholder="Select an existing cohort" options={intakeCohortOptions} />
                </Form.Item>
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="支持文件一键导入"
                  description="txt / csv / xlsx / 其它文本型文件都可以直接上传。系统会先自动抽取词，再直接放进上面选中的分组。"
                />
                <Space wrap style={{ marginBottom: 16 }}>
                  <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()} loading={importingFile} disabled={!selectedProjectId || activeCohorts.length === 0}>
                    上传词表并自动入组
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importTermsFromFile(file);
                    }}
                  />
                </Space>
                {lastImportInfo ? (
                  <Alert type="info" showIcon style={{ marginBottom: 16 }} message={lastImportInfo} />
                ) : null}
                <Form.Item name="words" label="Terms (comma / newline separated)" rules={[{ required: true }]}>
                  <Input.TextArea rows={4} placeholder="ai, transformer, diffusion model" />
                </Form.Item>
                <Button htmlType="submit" type="primary" loading={runningAction} disabled={!selectedProjectId || activeCohorts.length === 0}>
                  Add Terms To Cohort
                </Button>
              </Form>
            </Col>
            <Col xs={24} xl={14}>
              <Card size="small" className="pm-subcard" title="Current Project Terms">
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={projectTerms.slice(0, 10)}
                  pagination={false}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No terms yet" /> }}
                  columns={[
                    { title: "Word", dataIndex: "canonical", width: 180 },
                    {
                      title: "Primary Cohort",
                      width: 160,
                      render: (_: unknown, row: ProjectTermItem) =>
                        row.primary_cohort ? <Tag color="blue">{row.primary_cohort}</Tag> : <Tag>unassigned</Tag>,
                    },
                    {
                      title: "All Cohorts",
                      render: (_: unknown, row: ProjectTermItem) => {
                        const tags = row.cohorts || [];
                        if (!tags.length) return <Typography.Text type="secondary">-</Typography.Text>;
                        return (
                          <Space size={[4, 4]} wrap>
                            {tags.map((cohort) => (
                              <Tag key={`${row.term_id}:${cohort.cohort_id}`} color={cohort.cohort_color || "blue"}>
                                {`${cohort.cohort_name} (${cohort.weight.toFixed(2)})`}
                              </Tag>
                            ))}
                          </Space>
                        );
                      },
                    },
                    {
                      title: "Action",
                      width: 92,
                      render: (_: unknown, row: ProjectTermItem) => (
                        <Button
                          size="small"
                          onClick={() =>
                            membershipForm.setFieldsValue({
                              term_id: row.term_id,
                              cohort_id: row.cohorts?.[0]?.cohort_id,
                              membership_weight: row.cohorts?.[0]?.weight || 1,
                              confidence: row.cohorts?.[0]?.confidence || 0.95,
                              source: row.cohorts?.[0]?.source || "manual",
                            })
                          }
                        >
                          Calibrate
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </Card>

        <Collapse
          className="pm-detail-collapse"
          items={[
            {
              key: "enhance",
              label: "可选：例外修正与证据绑定（答辩推荐）",
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Alert
                    type="info"
                    showIcon
                    message="什么时候需要打开这里"
                    description="第一次搭链路时不用先管这里。只有当你要修边界词、多归属词，或者要补强答辩里的结果来源时，再打开这个区域。"
                  />
                  <Card className="pm-card" title="A. 例外词修正" loading={loadingDetail}>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} xl={10}>
                        <Form
                          form={membershipForm}
                          layout="vertical"
                          initialValues={{ membership_weight: 1, confidence: 0.95, source: "manual" }}
                          onFinish={async (values) => {
                            if (!selectedProjectId) {
                              message.warning("Select a project first");
                              return;
                            }
                            if (!values.term_id) {
                              message.warning("Select an existing term first");
                              return;
                            }
                            if (!values.cohort_id) {
                              message.warning("Select an existing cohort first");
                              return;
                            }
                            setRunningAction(true);
                            try {
                              const resp = await api.upsertProjectMemberships(selectedProjectId, [
                                {
                                  term_id: values.term_id,
                                  cohort_id: values.cohort_id,
                                  membership_weight: values.membership_weight,
                                  confidence: values.confidence,
                                  source: values.source,
                                  note: values.note,
                                },
                              ]);
                              message.success(`Upserted ${resp.upserted} membership mapping(s)`);
                              membershipForm.setFieldsValue({
                                term_id: undefined,
                                cohort_id: undefined,
                                membership_weight: 1,
                                confidence: 0.95,
                                source: "manual",
                                note: "",
                              });
                              await loadProjectDetail(selectedProjectId);
                            } catch (e) {
                              message.error(describeApiError(e));
                            } finally {
                              setRunningAction(false);
                            }
                          }}
                        >
                          <Form.Item name="term_id" label="Term" rules={[{ required: true }]}>
                            <Select showSearch placeholder="Select term" options={termOptions} />
                          </Form.Item>
                          <Form.Item name="cohort_id" label="Assign To Cohort" rules={[{ required: true }]}>
                            <Select showSearch placeholder="Select cohort" options={cohortOptions} />
                          </Form.Item>
                          <Row gutter={12}>
                            <Col span={8}>
                              <Form.Item name="membership_weight" label="Weight">
                                <InputNumber min={0.01} max={10} step={0.05} style={{ width: "100%" }} />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item name="confidence" label="Confidence">
                                <InputNumber min={0.01} max={1} step={0.01} style={{ width: "100%" }} />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item name="source" label="Source">
                                <Select
                                  options={[
                                    { value: "manual", label: "manual" },
                                    { value: "analyst-rule", label: "analyst-rule" },
                                    { value: "llm", label: "llm" },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Form.Item name="note" label="Note">
                            <Input.TextArea rows={2} placeholder="why this term needs a manual correction" />
                          </Form.Item>
                          <Space>
                            <Button htmlType="submit" type="primary" icon={<SaveOutlined />} loading={runningAction} disabled={!selectedProjectId || !projectTerms.length || !activeCohorts.length}>
                              Save Calibration
                            </Button>
                            <Button
                              onClick={() =>
                                membershipForm.setFieldsValue({
                                  term_id: undefined,
                                  cohort_id: undefined,
                                  membership_weight: 1,
                                  confidence: 0.95,
                                  source: "manual",
                                  note: "",
                                })
                              }
                            >
                              Reset
                            </Button>
                          </Space>
                        </Form>
                      </Col>
                      <Col xs={24} xl={14}>
                        <Card size="small" className="pm-subcard" title="Membership Registry">
                          <Table
                            rowKey="id"
                            size="small"
                            dataSource={projectMemberships.slice(0, 12)}
                            pagination={false}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No memberships yet" /> }}
                            columns={[
                              { title: "Term", dataIndex: "canonical", width: 170 },
                              {
                                title: "Cohort",
                                dataIndex: "cohort_name",
                                width: 150,
                                render: (v: string, row: ProjectMembershipItem) => <Tag color={row.cohort_color || "blue"}>{v}</Tag>,
                              },
                              { title: "Weight", dataIndex: "membership_weight", width: 90, render: (v: number) => v.toFixed(2) },
                              { title: "Conf", dataIndex: "confidence", width: 90, render: (v: number) => v.toFixed(2) },
                              { title: "Source", dataIndex: "source", width: 120 },
                              {
                                title: "",
                                width: 56,
                                render: (_: unknown, row: ProjectMembershipItem) => (
                                  <Popconfirm title="Delete this mapping?" onConfirm={() => void removeMembership(row)}>
                                    <Button danger size="small" icon={<DeleteOutlined />} />
                                  </Popconfirm>
                                ),
                              },
                            ]}
                          />
                        </Card>
                      </Col>
                    </Row>
                  </Card>

                  <Card className="pm-card" title="B. 绑定证据任务" loading={loadingOverview || loadingDetail}>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} xl={10}>
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 16 }}
                          message="为什么建议绑定任务"
                          description="这样后面在 Analytics Center 里可以回答“这些中观结果来自哪些任务和时序数据”，答辩时更稳。"
                        />
                        <Space.Compact style={{ width: "100%" }}>
                          <Select
                            showSearch
                            style={{ width: "100%" }}
                            value={bindTaskId || undefined}
                            placeholder="Select a task"
                            options={taskOptions}
                            onChange={setBindTaskId}
                          />
                          <Button icon={<LinkOutlined />} type="primary" disabled={!selectedProjectId || !bindTaskId} loading={runningAction} onClick={() => void bindTask()}>
                            Bind
                          </Button>
                        </Space.Compact>
                      </Col>
                      <Col xs={24} xl={14}>
                        <Card size="small" className="pm-subcard" title="Linked Evidence Tasks">
                          <Table
                            rowKey="task_id"
                            size="small"
                            dataSource={projectTasks.slice(0, 10)}
                            pagination={false}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No linked tasks yet" /> }}
                            columns={[
                              {
                                title: "Task",
                                dataIndex: "display_name",
                                render: (_: unknown, row: TaskListItem) => row.display_name || row.task_id,
                              },
                              { title: "Type", dataIndex: "task_type", width: 130 },
                              {
                                title: "Status",
                                dataIndex: "status",
                                width: 110,
                                render: (value: string) => <Tag color={value === "SUCCESS" ? "green" : value === "FAILED" ? "red" : "blue"}>{value}</Tag>,
                              },
                            ]}
                          />
                        </Card>
                      </Col>
                    </Row>
                  </Card>
                </Space>
              ),
            },
          ]}
        />

        <Card className="pm-card pm-handoff-card" bordered={false}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} xl={16}>
              <div className="pm-handoff-title">准备完成后进入结果页</div>
              <div className="pm-handoff-copy">
                这里准备结构，Analytics Center 负责出结果。答辩时你可以直接说：先在 Project Manager 建项目和分组，再去结果页一键跑中观分析。
              </div>
              <Space wrap style={{ marginTop: 12 }}>
                <Tag color={readyForAnalytics ? "green" : "orange"}>{readyForAnalytics ? "Structure ready" : "Need more setup"}</Tag>
                <Tag color={hasEvidenceSeries ? "blue" : "default"}>{hasEvidenceSeries ? "Temporal evidence ready" : "Temporal evidence still weak"}</Tag>
              </Space>
            </Col>
            <Col xs={24} xl={8}>
              <Space direction="vertical" style={{ width: "100%" }}>
                <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => goToApp("analytics")} disabled={!hasProject}>
                  Open Analytics Center
                </Button>
                <Typography.Text type="secondary">
                  推荐条件：至少 2 个 terms、2 个 active cohorts。时序证据不足也能先跑结构和差异分析。
                </Typography.Text>
              </Space>
            </Col>
          </Row>
        </Card>
      </Space>

      <Modal
        title={`Edit Cohort${editingCohort ? ` · ${editingCohort.name}` : ""}`}
        open={Boolean(editingCohort)}
        onCancel={() => setEditingCohort(null)}
        onOk={() => void applyCohortEdit()}
        okButtonProps={{ loading: runningAction }}
      >
        <Form form={editCohortForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 1 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="color" label="Color">
                <Input placeholder="#2f7cf6" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sort_order" label="Sort Order">
                <InputNumber min={0} max={10000} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="is_active" label="Status">
            <Select
              options={[
                { value: true, label: "active" },
                { value: false, label: "inactive" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
