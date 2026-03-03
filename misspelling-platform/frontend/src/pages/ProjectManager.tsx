import { LinkOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError, type ProjectItem, type TaskListItem } from "../lib/api";

export function ProjectManagerPage() {
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
  const [projectTasks, setProjectTasks] = useState<TaskListItem[]>([]);
  const [projectTerms, setProjectTerms] = useState<Array<{ canonical: string; category?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createForm] = Form.useForm<{ name: string; description?: string }>();
  const [termForm] = Form.useForm<{ words: string; category?: string }>();
  const [bindTaskId, setBindTaskId] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [projectResp, taskResp] = await Promise.all([api.listProjects(120), api.listTasks(120)]);
      setItems(projectResp.items ?? []);
      setTasks(taskResp.items ?? []);
      if (!selectedProjectId && projectResp.items.length > 0) {
        setSelectedProjectId(projectResp.items[0].id);
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (projectId: number) => {
    try {
      const [taskResp, termResp] = await Promise.all([
        api.listProjectTasks(projectId, 200),
        api.listProjectTerms(projectId)
      ]);
      setProjectTasks(taskResp.items ?? []);
      setProjectTerms((termResp.items ?? []).map((x) => ({ canonical: x.canonical, category: x.category })));
    } catch (e) {
      message.error(describeApiError(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTasks([]);
      setProjectTerms([]);
      return;
    }
    void loadDetail(selectedProjectId);
  }, [selectedProjectId]);

  const taskOptions = useMemo(
    () =>
      tasks.map((t) => ({
        value: t.task_id,
        label: `${t.display_name || t.task_type} (${t.task_id.slice(0, 8)}...)`
      })),
    [tasks]
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="Project Manager"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>
            Refresh
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Projects bind terms and tasks, so analytics/report exports can be generated at meso level without changing task APIs.
        </Typography.Paragraph>
        <Space align="start" wrap>
          <Card size="small" title="Create Project" style={{ width: 420 }}>
            <Form
              form={createForm}
              layout="vertical"
              onFinish={async (values) => {
                try {
                  await api.createProject(values.name, values.description);
                  message.success("Project created");
                  createForm.resetFields();
                  await refresh();
                } catch (e) {
                  message.error(describeApiError(e));
                }
              }}
            >
              <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}>
                <Input placeholder="project name" />
              </Form.Item>
              <Form.Item name="description" label="Description">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Button htmlType="submit" type="primary" icon={<PlusOutlined />}>
                Create
              </Button>
            </Form>
          </Card>
          <Card size="small" title="Select Project" style={{ width: 420 }}>
            <Select
              showSearch
              style={{ width: "100%" }}
              placeholder="Select project"
              value={selectedProjectId}
              onChange={(v) => setSelectedProjectId(v)}
              options={items.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
            />
            <Space.Compact style={{ marginTop: 12, width: "100%" }}>
              <Select
                showSearch
                style={{ width: "100%" }}
                value={bindTaskId || undefined}
                placeholder="Select task to bind"
                options={taskOptions}
                onChange={setBindTaskId}
              />
              <Button
                icon={<LinkOutlined />}
                disabled={!selectedProjectId || !bindTaskId}
                onClick={async () => {
                  if (!selectedProjectId || !bindTaskId) return;
                  try {
                    await api.bindProjectTask(selectedProjectId, bindTaskId);
                    message.success("Task bound to project");
                    setBindTaskId("");
                    await loadDetail(selectedProjectId);
                  } catch (e) {
                    message.error(describeApiError(e));
                  }
                }}
              >
                Bind
              </Button>
            </Space.Compact>
          </Card>
          <Card size="small" title="Add Terms" style={{ width: 420 }}>
            <Form
              form={termForm}
              layout="vertical"
              initialValues={{ category: "custom" }}
              onFinish={async (values) => {
                if (!selectedProjectId) {
                  message.warning("Select project first");
                  return;
                }
                const words = String(values.words || "")
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                if (words.length === 0) {
                  message.warning("Provide at least one word");
                  return;
                }
                try {
                  await api.addProjectTerms(selectedProjectId, words, values.category);
                  message.success("Terms added");
                  termForm.resetFields(["words"]);
                  await loadDetail(selectedProjectId);
                } catch (e) {
                  message.error(describeApiError(e));
                }
              }}
            >
              <Form.Item name="words" label="Terms (comma separated)" rules={[{ required: true }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="category" label="Category">
                <Select
                  options={[
                    { value: "brand", label: "brand" },
                    { value: "science", label: "science" },
                    { value: "common", label: "common" },
                    { value: "custom", label: "custom" }
                  ]}
                />
              </Form.Item>
              <Button htmlType="submit" type="primary">
                Add Terms
              </Button>
            </Form>
          </Card>
        </Space>
      </Card>
      <Card title="Project Inventory">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "Name", dataIndex: "name" },
            { title: "Description", dataIndex: "description" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={v === "ACTIVE" ? "green" : "default"}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at" }
          ]}
        />
      </Card>
      <Card title="Selected Project Terms">
        <Table
          rowKey={(r) => `${r.canonical}:${r.category || "-"}`}
          size="small"
          dataSource={projectTerms}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Word", dataIndex: "canonical" },
            { title: "Category", dataIndex: "category", render: (v: string) => <Tag>{v || "custom"}</Tag> }
          ]}
        />
      </Card>
      <Card title="Selected Project Tasks">
        <Table
          rowKey="task_id"
          size="small"
          dataSource={projectTasks}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Task", dataIndex: "display_name", render: (_: unknown, row: TaskListItem) => row.display_name || row.task_id },
            { title: "Type", dataIndex: "task_type" },
            { title: "Status", dataIndex: "status" },
            { title: "Created", dataIndex: "created_at" }
          ]}
        />
      </Card>
    </Space>
  );
}
