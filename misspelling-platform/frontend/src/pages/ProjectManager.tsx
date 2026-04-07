/* 文件说明：项目管理页面，负责维护项目、项目词项及其关联任务。 */

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  describeApiError,
  type ProjectItem,
  type ProjectTermsResponse,
  type ProjectAddTermsResponse,
} from "../lib/api";
import "./algorithmStudio.css";
import "./projectManager.css";

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

type ProjectTermItem = ProjectTermsResponse["items"][number];
type AutoBoundTaskItem = ProjectAddTermsResponse["auto_bound_tasks"][number];

export function ProjectManagerPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
  const [projectTerms, setProjectTerms] = useState<ProjectTermItem[]>([]);
  const [autoBoundTasks, setAutoBoundTasks] = useState<AutoBoundTaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);

  const [createProjectForm] = Form.useForm<{ name: string; description?: string }>();
  const [addTermsForm] = Form.useForm<{ words: string }>();

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const resp = await api.listProjects(150);
      const nextProjects = resp.items || [];
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((item) => item.id === current)) return current;
        return nextProjects[0]?.id;
      });
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const loadProjectTerms = async (projectId: number) => {
    setLoading(true);
    try {
      const termResp = await api.listProjectTerms(projectId);
      setProjectTerms(termResp.items || []);
    } catch (e) {
      message.error(describeApiError(e));
      setProjectTerms([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTerms([]);
      setAutoBoundTasks([]);
      return;
    }
    void loadProjectTerms(selectedProjectId);
  }, [selectedProjectId]);

  if (sessionRole === "guest") {
    return (
      <div className="project-manager-shell">
        <Card bordered={false} className="algo-guard-card">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              项目管理需要登录
            </Typography.Title>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              登录后可创建项目、选择项目并添加词。已跑过的词任务会自动绑定到项目。
            </Typography.Paragraph>
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
            <Button icon={<ReloadOutlined />} onClick={() => void refreshProjects()} loading={loading}>
              刷新
            </Button>
          }
        >
          <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 6 }}>
            项目管理
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            最简流程：创建/选择项目，然后添加词。系统会自动复用并绑定这些词已有的任务结果。
          </Typography.Paragraph>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="创建 / 选择项目" loading={loading}>
              <Form
                layout="vertical"
                form={createProjectForm}
                onFinish={async (values) => {
                  setRunningAction(true);
                  try {
                    await api.createProject(values.name, values.description);
                    message.success("项目已创建");
                    createProjectForm.resetFields();
                    await refreshProjects();
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Row gutter={12}>
                  <Col span={10}>
                    <Form.Item name="name" label="项目名" rules={[{ required: true, min: 2 }]}>
                      <Input placeholder="例如：拼写演化项目A" />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item name="description" label="说明">
                      <Input placeholder="可选" />
                    </Form.Item>
                  </Col>
                  <Col span={4}>
                    <Form.Item label=" ">
                      <Button htmlType="submit" type="primary" icon={<PlusOutlined />} block loading={runningAction}>
                        创建
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>

              <Typography.Text type="secondary">当前项目</Typography.Text>
              <Select
                showSearch
                style={{ width: "100%", marginTop: 8 }}
                value={selectedProjectId}
                placeholder="选择项目"
                onChange={setSelectedProjectId}
                options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
              />
              {selectedProject ? (
                <Typography.Paragraph style={{ marginTop: 10, marginBottom: 0 }}>
                  <strong>{selectedProject.name}</strong>
                  {selectedProject.description ? ` · ${selectedProject.description}` : ""}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="secondary">暂无可选项目</Typography.Text>
              )}
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="添加词（自动绑定已有任务）" loading={loading}>
              <Form
                form={addTermsForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedProjectId) {
                    message.warning("请先选择项目");
                    return;
                  }
                  const words = splitWords(values.words);
                  if (words.length === 0) {
                    message.warning("请至少输入一个词");
                    return;
                  }
                  setRunningAction(true);
                  try {
                    const resp = await api.addProjectTerms(selectedProjectId, words, "custom");
                    setAutoBoundTasks(resp.auto_bound_tasks || []);
                    message.success(`新增 ${resp.added} 个词，自动绑定 ${resp.auto_bound_count} 个已有任务`);
                    addTermsForm.resetFields();
                    await loadProjectTerms(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  } finally {
                    setRunningAction(false);
                  }
                }}
              >
                <Form.Item name="words" label="词列表（逗号或换行分隔）" rules={[{ required: true }]}>
                  <Input.TextArea rows={4} placeholder="ai, transformer, diffusion model" />
                </Form.Item>
                <Button htmlType="submit" type="primary" loading={runningAction}>
                  批量添加
                </Button>
              </Form>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="项目词列表" loading={loading}>
              <Table
                rowKey="id"
                size="small"
                dataSource={projectTerms}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: "词", dataIndex: "canonical" },
                ]}
              />
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="本次自动绑定任务" loading={loading}>
              <Table
                rowKey="task_id"
                size="small"
                dataSource={autoBoundTasks}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: "添加词后会显示自动复用的任务" }}
                columns={[
                  { title: "词", dataIndex: "word", width: 160 },
                  { title: "算法", dataIndex: "task_type", width: 160 },
                  { title: "任务ID", dataIndex: "task_id" },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
