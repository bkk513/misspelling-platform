import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Divider,
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
  Tooltip,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  describeApiError,
  type ProjectCohortItem,
  type ProjectItem,
  type ProjectMembershipItem,
  type ProjectTermsResponse,
  type TaskListItem
} from "../lib/api";
import "./algorithmStudio.css";
import "./projectManager.css";

type ProjectTermItem = ProjectTermsResponse["items"][number];

type CreateProjectForm = { name: string; description?: string };
type AddTermsForm = { words: string; category?: string };
type CreateCohortForm = { name: string; description?: string; color?: string; sort_order?: number };
type MembershipForm = {
  term_id?: number;
  word?: string;
  cohort_id?: number;
  cohort_name?: string;
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
        .split(/[\n,]+/)
        .map((x) => normalizeWord(x))
        .filter(Boolean)
    )
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

  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [runningAction, setRunningAction] = useState(false);

  const [bindTaskId, setBindTaskId] = useState("");
  const [editingCohort, setEditingCohort] = useState<ProjectCohortItem | null>(null);

  const [createProjectForm] = Form.useForm<CreateProjectForm>();
  const [addTermsForm] = Form.useForm<AddTermsForm>();
  const [createCohortForm] = Form.useForm<CreateCohortForm>();
  const [membershipForm] = Form.useForm<MembershipForm>();
  const [editCohortForm] = Form.useForm<EditCohortForm>();

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

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
        label: `${t.display_name || t.task_type} (${t.task_id.slice(0, 8)}...)`
      })),
    [tasks]
  );

  const termOptions = useMemo(
    () =>
      projectTerms.map((term) => ({
        value: term.term_id,
        label: `${term.canonical} (#${term.term_id})`
      })),
    [projectTerms]
  );

  const cohortOptions = useMemo(
    () =>
      projectCohorts
        .filter((cohort) => Boolean(cohort.is_active))
        .map((cohort) => ({
          value: cohort.id,
          label: cohort.name
        })),
    [projectCohorts]
  );

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
      const [taskResp, termResp, cohortResp, membershipResp] = await Promise.all([
        api.listProjectTasks(projectId, 300),
        api.listProjectTerms(projectId),
        api.listProjectCohorts(projectId),
        api.listProjectMemberships(projectId)
      ]);
      setProjectTasks(taskResp.items || []);
      setProjectTerms(termResp.items || []);
      setProjectCohorts(cohortResp.items || []);
      setProjectMemberships(membershipResp.items || []);
    } catch (e) {
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
      is_active: Boolean(cohort.is_active)
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
        is_active: values.is_active
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

  const activeCohorts = projectCohorts.filter((x) => Boolean(x.is_active)).length;

  const intakeCategoryOptions = useMemo(() => {
    const base = ["technology", "science", "brand", "noun", "common", "custom"];
    const dynamic = projectCohorts.map((cohort) => cohort.name);
    return Array.from(new Set([...dynamic, ...base])).map((value) => ({ value, label: value }));
  }, [projectCohorts]);

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
            <div className="pm-guest-policy">
              <div className="pm-guest-policy-card">
                <strong>Guest can still use</strong>
                <span>Word Analysis、Algorithms、Task Center、Task Detail、own task time-series.</span>
              </div>
              <div className="pm-guest-policy-card">
                <strong>Guest is now blocked from</strong>
                <span>Project creation, cohort engineering, project analytics and project-level reports.</span>
              </div>
            </div>
          </Space>
        </Card>
      </div>
    );
  }

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
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 6 }}>
            Project Manager Studio
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 20 }}>
            这里不再把“建项目、建类别、加词、绑任务、修 membership”拆成离散操作，而是组织成一个完整的工程流。先定义 cohort taxonomy，再把词批量 intake 到目标 cohort，最后绑定任务作为分析证据，供 Analytics Center 做 cohort 级比较。
          </Typography.Paragraph>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Projects" value={projects.length} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Terms" value={projectTerms.length} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Cohorts" value={projectCohorts.length} suffix={<Tag color="blue">{activeCohorts} active</Tag>} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card className="pm-metric-card" bordered={false}>
                <Statistic title="Memberships" value={projectMemberships.length} />
              </Card>
            </Col>
          </Row>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card className="pm-card pm-workflow-card" bordered={false}>
              <div className="pm-workflow-grid">
                {[
                  {
                    title: "1. Define Cohorts",
                    copy: "先建立 cohort taxonomy，给类别命名、上色和排序。"
                  },
                  {
                    title: "2. Intake Terms",
                    copy: "将一批词直接纳入目标 cohort，避免先加词后补 category 的来回跳转。"
                  },
                  {
                    title: "3. Calibrate Membership",
                    copy: "对模糊词做多重 membership、权重和置信度修正。"
                  },
                  {
                    title: "4. Bind Evidence Tasks",
                    copy: "把算法任务绑定回项目，形成可追溯的 cohort 分析证据链。"
                  }
                ].map((item) => (
                  <div key={item.title} className="pm-workflow-item">
                    <AppstoreOutlined />
                    <strong>{item.title}</strong>
                    <span>{item.copy}</span>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card className="pm-card" title="Project Workspace" loading={loadingOverview}>
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

              <Divider style={{ margin: "8px 0 16px" }} />

              <Typography.Text type="secondary">Current Project</Typography.Text>
              <Select
                showSearch
                style={{ width: "100%", marginTop: 6 }}
                value={selectedProjectId}
                placeholder="Select project"
                onChange={setSelectedProjectId}
                options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
              />
              {selectedProject ? (
                <Typography.Paragraph className="pm-selected-project" style={{ marginTop: 10, marginBottom: 0 }}>
                  <strong>{selectedProject.name}</strong>
                  {selectedProject.description ? ` · ${selectedProject.description}` : ""}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">No project selected.</Typography.Text>
              )}
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card className="pm-card" title="Task Evidence Binding" loading={loadingOverview || loadingDetail}>
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
                  Bind Evidence
                </Button>
              </Space.Compact>

              <Typography.Paragraph type="secondary" style={{ marginTop: 14, marginBottom: 10 }}>
                只允许绑定当前项目拥有者自己的任务，避免把别人的算法结果误接到本项目中。
              </Typography.Paragraph>

              <Table
                rowKey="task_id"
                size="small"
                pagination={false}
                dataSource={projectTasks.slice(0, 6)}
                columns={[
                  {
                    title: "Task",
                    dataIndex: "display_name",
                    render: (_: unknown, row: TaskListItem) => row.display_name || row.task_id
                  },
                  { title: "Type", dataIndex: "task_type", width: 130 },
                  {
                    title: "Status",
                    dataIndex: "status",
                    width: 110,
                    render: (value: string) => <Tag color={value === "SUCCESS" ? "green" : value === "FAILED" ? "red" : "blue"}>{value}</Tag>
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card className="pm-card" title="Batch Intake to Cohort" loading={loadingDetail}>
              <Form
                form={addTermsForm}
                layout="vertical"
                initialValues={{ category: "custom" }}
                onFinish={async (values) => {
                  if (!selectedProjectId) {
                    message.warning("Select a project first");
                    return;
                  }
                  const words = splitWords(values.words);
                  if (words.length === 0) {
                    message.warning("Please input at least one word");
                    return;
                  }
                  setRunningAction(true);
                  try {
                    const resp = await api.addProjectTerms(selectedProjectId, words, normalizeWord(values.category));
                    message.success(`Added ${resp.added} term(s)`);
                    addTermsForm.setFieldValue("words", "");
                    await loadProjectDetail(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  先选择一个已有 cohort，再把一批词一次性纳入项目。系统会同时把它们同步到对应 cohort，减少先加词后回头分类的反复操作。
                </Typography.Paragraph>
                <Form.Item name="words" label="Terms (comma/newline separated)" rules={[{ required: true }]}>
                  <Input.TextArea rows={3} placeholder="ai, transformer, diffusion model" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="category" label="Category / Cohort">
                      <Select
                        showSearch
                        allowClear
                        placeholder="custom"
                        options={intakeCategoryOptions}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label=" ">
                      <Button htmlType="submit" type="primary" block loading={runningAction}>
                        Add Terms & Sync Cohort
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card className="pm-card" title="Cohort Blueprint" loading={loadingDetail}>
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
                      description: values.description,
                      color: values.color,
                      sort_order: values.sort_order
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
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  在这里定义项目的类别体系。cohort 一旦建立，后续批量 intake、membership 修正和 analytics 都围绕这套 taxonomy 展开。
                </Typography.Paragraph>
                <Row gutter={12}>
                  <Col span={9}>
                    <Form.Item name="name" label="Name" rules={[{ required: true, min: 1 }]}>
                      <Input placeholder="technology" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="color" label="Color">
                      <Input placeholder="#2f7cf6" />
                    </Form.Item>
                  </Col>
                  <Col span={7}>
                    <Form.Item name="sort_order" label="Order" initialValue={0}>
                      <InputNumber min={0} max={10000} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="description" label="Description">
                  <Input placeholder="optional cohort description" />
                </Form.Item>
                <Button htmlType="submit" type="primary" icon={<PlusOutlined />} loading={runningAction}>
                  Create Cohort
                </Button>
              </Form>

              <Divider style={{ margin: "16px 0" }} />

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
                {projectCohorts.length === 0 ? (
                  <div className="pm-cohort-card pm-cohort-card-empty">Create the first cohort to start building the taxonomy.</div>
                ) : null}
              </div>

              <Divider style={{ margin: "16px 0" }} />

              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 6 }}
                dataSource={projectCohorts}
                columns={[
                  {
                    title: "Cohort",
                    dataIndex: "name",
                    render: (name: string, row: ProjectCohortItem) => (
                      <Tag color={row.color || "blue"}>{name}</Tag>
                    )
                  },
                  {
                    title: "Terms",
                    width: 90,
                    render: (_: unknown, row: ProjectCohortItem) => cohortSizeMap.get(row.id) || 0
                  },
                  {
                    title: "State",
                    width: 90,
                    render: (_: unknown, row: ProjectCohortItem) =>
                      Boolean(row.is_active) ? <Tag color="green">active</Tag> : <Tag>inactive</Tag>
                  },
                  {
                    title: "Actions",
                    width: 130,
                    render: (_: unknown, row: ProjectCohortItem) => (
                      <Space size={4}>
                        <Tooltip title="Edit">
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEditCohort(row)} />
                        </Tooltip>
                        <Popconfirm title="Delete this cohort?" onConfirm={() => void removeCohort(row)}>
                          <Button danger size="small" icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24}>
            <Card className="pm-card" title="Membership Calibration Studio" loading={loadingDetail}>
              <Form
                form={membershipForm}
                layout="vertical"
                initialValues={{ membership_weight: 1, confidence: 0.95, source: "manual" }}
                onFinish={async (values) => {
                  if (!selectedProjectId) {
                    message.warning("Select a project first");
                    return;
                  }
                  if (!values.term_id && !normalizeWord(values.word)) {
                    message.warning("Select an existing term or input a new word");
                    return;
                  }
                  if (!values.cohort_id && !normalizeWord(values.cohort_name)) {
                    message.warning("Select an existing cohort or input a new cohort name");
                    return;
                  }
                  setRunningAction(true);
                  try {
                    const resp = await api.upsertProjectMemberships(selectedProjectId, [
                      {
                        term_id: values.term_id,
                        word: normalizeWord(values.word),
                        cohort_id: values.cohort_id,
                        cohort_name: normalizeWord(values.cohort_name),
                        membership_weight: values.membership_weight,
                        confidence: values.confidence,
                        source: values.source,
                        note: values.note
                      }
                    ]);
                    message.success(`Upserted ${resp.upserted} membership mapping(s)`);
                    membershipForm.setFieldsValue({ term_id: undefined, word: "", note: "" });
                    await loadProjectDetail(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  对跨 cohort 的模糊词在这里做细粒度修正。可以同时指定权重、置信度和来源，形成面向 analytics 的可解释 membership registry。
                </Typography.Paragraph>
                <Row gutter={12}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="term_id" label="Existing Term">
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select term"
                        options={termOptions}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="word" label="Or New Word">
                      <Input placeholder="new term if not in project" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="cohort_id" label="Existing Cohort">
                      <Select showSearch allowClear placeholder="Select cohort" options={cohortOptions} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="cohort_name" label="Or New Cohort Name">
                      <Input placeholder="auto create if missing" />
                    </Form.Item>
                  </Col>
                  <Col xs={12} lg={4}>
                    <Form.Item name="membership_weight" label="Weight">
                      <InputNumber min={0.01} max={10} step={0.05} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} lg={4}>
                    <Form.Item name="confidence" label="Confidence">
                      <InputNumber min={0.01} max={1} step={0.01} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="source" label="Source">
                      <Select
                        options={[
                          { value: "manual", label: "manual" },
                          { value: "llm", label: "llm" },
                          { value: "term-category", label: "term-category" },
                          { value: "analyst-rule", label: "analyst-rule" }
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="note" label="Note">
                  <Input.TextArea rows={2} placeholder="optional note for audit trail" />
                </Form.Item>
                <Space>
                  <Button htmlType="submit" type="primary" icon={<SaveOutlined />} loading={runningAction}>
                    Save Membership
                  </Button>
                  <Button
                    onClick={() =>
                      membershipForm.setFieldsValue({
                        term_id: undefined,
                        word: "",
                        cohort_id: undefined,
                        cohort_name: "",
                        membership_weight: 1,
                        confidence: 0.95,
                        source: "manual",
                        note: ""
                      })
                    }
                  >
                    Reset
                  </Button>
                </Space>
              </Form>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xxl={14}>
            <Card title="Selected Project Terms" className="pm-card" loading={loadingDetail}>
              <Table
                rowKey="id"
                size="small"
                dataSource={projectTerms}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: "Word", dataIndex: "canonical", width: 180 },
                  {
                    title: "Category",
                    dataIndex: "category",
                    width: 120,
                    render: (v: string | null | undefined) => <Tag>{v || "custom"}</Tag>
                  },
                  {
                    title: "Cohorts",
                    render: (_: unknown, row: ProjectTermItem) => {
                      const tags = row.cohorts || [];
                      if (tags.length === 0) return <Typography.Text type="secondary">-</Typography.Text>;
                      return (
                        <Space size={[4, 4]} wrap>
                          {tags.map((cohort) => (
                            <Tag key={`${row.term_id}:${cohort.cohort_id}`} color={cohort.cohort_color || "blue"}>
                              {`${cohort.cohort_name} (${cohort.weight.toFixed(2)})`}
                            </Tag>
                          ))}
                        </Space>
                      );
                    }
                  },
                  {
                    title: "Action",
                    width: 80,
                    render: (_: unknown, row: ProjectTermItem) => (
                      <Button
                        size="small"
                        onClick={() =>
                          membershipForm.setFieldsValue({
                            term_id: row.term_id,
                            word: row.canonical,
                            cohort_id: row.cohorts?.[0]?.cohort_id
                          })
                        }
                      >
                        Assign
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24} xxl={10}>
            <Card title="Membership Registry" className="pm-card" loading={loadingDetail}>
              <Table
                rowKey="id"
                size="small"
                dataSource={projectMemberships}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: "Term", dataIndex: "canonical", width: 170 },
                  {
                    title: "Cohort",
                    dataIndex: "cohort_name",
                    width: 140,
                    render: (v: string, row: ProjectMembershipItem) => <Tag color={row.cohort_color || "blue"}>{v}</Tag>
                  },
                  {
                    title: "Weight",
                    dataIndex: "membership_weight",
                    width: 90,
                    render: (v: number) => v.toFixed(2)
                  },
                  {
                    title: "Conf",
                    dataIndex: "confidence",
                    width: 90,
                    render: (v: number) => v.toFixed(2)
                  },
                  { title: "Source", dataIndex: "source", width: 120 },
                  {
                    title: "",
                    width: 56,
                    render: (_: unknown, row: ProjectMembershipItem) => (
                      <Popconfirm title="Delete this mapping?" onConfirm={() => void removeMembership(row)}>
                        <Button danger size="small" icon={<DeleteOutlined />} />
                      </Popconfirm>
                    )
                  }
                ]}
              />
            </Card>
          </Col>

          <Col xs={24}>
            <Card title="Project Inventory" className="pm-card" loading={loadingOverview}>
              <Table
                rowKey="id"
                size="small"
                dataSource={projects}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: "ID", dataIndex: "id", width: 80 },
                  { title: "Name", dataIndex: "name" },
                  { title: "Description", dataIndex: "description" },
                  {
                    title: "Status",
                    dataIndex: "status",
                    width: 120,
                    render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "default"}>{v}</Tag>
                  },
                  { title: "Created", dataIndex: "created_at", width: 180 }
                ]}
              />
            </Card>
          </Col>
        </Row>
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
                { value: false, label: "inactive" }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
