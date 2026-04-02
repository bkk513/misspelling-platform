import { FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError, type ProjectItem, type ReportItem, type TaskListItem } from "../lib/api";
import "./algorithmStudio.css";

function taskWord(row: TaskListItem) {
  const params = row.params_json;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const word = String((params as Record<string, unknown>).word || "").trim();
    return word || "-";
  }
  return "-";
}

export function ReportCenterPage({ sessionRole }: { sessionRole: "guest" | "user" | "admin" }) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);

  const [taskWordFilter, setTaskWordFilter] = useState<string>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>("all");
  const [taskRange, setTaskRange] = useState<[string, string] | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");

  const [projectCategoryFilter, setProjectCategoryFilter] = useState<string>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
  const [projectTaskRange, setProjectTaskRange] = useState<[string, string] | null>(null);
  const [projectCategories, setProjectCategories] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "task" | "project">("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [taskResp, reportResp, projectResp] = await Promise.all([
        api.listTasks(200),
        api.listReports(300),
        sessionRole === "guest" ? Promise.resolve({ items: [] as ProjectItem[] }) : api.listProjects(120)
      ]);
      setTasks(taskResp.items ?? []);
      setProjects(projectResp.items ?? []);
      setReports(reportResp.items ?? []);
      if (!selectedTaskId && taskResp.items.length > 0) setSelectedTaskId(taskResp.items[0].task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionRole]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectCategories([]);
      return;
    }
    void api
      .listProjectTerms(selectedProjectId)
      .then((resp) => {
        const categories = Array.from(new Set((resp.items || []).map((item) => String(item.category || "uncategorized"))));
        setProjectCategories(categories);
        if (projectCategoryFilter !== "all" && !categories.includes(projectCategoryFilter)) {
          setProjectCategoryFilter("all");
        }
      })
      .catch(() => {
        setProjectCategories([]);
      });
  }, [selectedProjectId, projectCategoryFilter]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((row) => {
      if (taskWordFilter !== "all" && taskWord(row) !== taskWordFilter) return false;
      if (taskTypeFilter !== "all" && row.task_type !== taskTypeFilter) return false;
      if (taskRange && row.created_at) {
        const d = dayjs(row.created_at);
        if (d.isBefore(dayjs(taskRange[0])) || d.isAfter(dayjs(taskRange[1]).endOf("day"))) return false;
      }
      return true;
    });
  }, [tasks, taskWordFilter, taskTypeFilter, taskRange]);

  useEffect(() => {
    if (!selectedTaskId) return;
    if (!filteredTasks.some((t) => t.task_id === selectedTaskId)) {
      setSelectedTaskId(filteredTasks[0]?.task_id || "");
    }
  }, [filteredTasks, selectedTaskId]);

  const reportRows = useMemo(() => {
    const allowedTaskIds = new Set(filteredTasks.map((t) => t.task_id));
    return reports.filter((row) => {
      if (row.task_id && !allowedTaskIds.has(row.task_id)) return false;
      if (selectedProjectId && row.project_id !== selectedProjectId) return false;
      if (projectTaskRange && row.created_at) {
        const d = dayjs(row.created_at);
        if (d.isBefore(dayjs(projectTaskRange[0])) || d.isAfter(dayjs(projectTaskRange[1]).endOf("day"))) return false;
      }
      if (projectCategoryFilter !== "all" && selectedProjectId) {
        const summary = row.summary_json;
        if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
        const maybeCategory = String((summary as Record<string, unknown>).category || "uncategorized");
        if (maybeCategory !== projectCategoryFilter) return false;
      }
      return true;
    });
  }, [reports, filteredTasks, selectedProjectId, projectTaskRange, projectCategoryFilter]);

  const taskWordOptions = useMemo(
    () => Array.from(new Set(tasks.map((t) => taskWord(t)).filter((w) => w && w !== "-"))),
    [tasks]
  );
  const taskTypeOptions = useMemo(() => Array.from(new Set(tasks.map((t) => t.task_type))), [tasks]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title="Report Center"
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>
            Refresh
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          Report exports are persisted in DB (`report_exports`) and stored as HTML artifacts under the existing output path.
        </Typography.Paragraph>

        {sessionRole === "guest" ? (
          <Card bordered={false} className="algo-guard-card" bodyStyle={{ marginBottom: 16 }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Guest 只保留任务级报告导出；项目级报告依赖 project workspace，因此登录后才开放。
            </Typography.Paragraph>
          </Card>
        ) : null}

        <Typography.Text strong>Task Report Filters</Typography.Text>
        <Space wrap style={{ marginTop: 8, marginBottom: 12 }}>
          <Select
            style={{ width: 180 }}
            value={taskWordFilter}
            onChange={setTaskWordFilter}
            options={[{ value: "all", label: "Word: All" }, ...taskWordOptions.map((w) => ({ value: w, label: w }))]}
          />
          <Select
            style={{ width: 200 }}
            value={taskTypeFilter}
            onChange={setTaskTypeFilter}
            options={[{ value: "all", label: "Algorithm: All" }, ...taskTypeOptions.map((v) => ({ value: v, label: v }))]}
          />
          <Select
            showSearch
            style={{ width: 420 }}
            placeholder="Task ID"
            value={selectedTaskId || undefined}
            onChange={setSelectedTaskId}
            options={filteredTasks.map((t) => ({
              value: t.task_id,
              label: `${taskWord(t)} | ${t.task_id.slice(0, 12)}...`
            }))}
          />
          <DatePicker.RangePicker onChange={(v) => setTaskRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button
            icon={<FileTextOutlined />}
            type="primary"
            disabled={!selectedTaskId}
            loading={busy === "task"}
            onClick={async () => {
              if (!selectedTaskId) return;
              setBusy("task");
              try {
                const resp = await api.createTaskReport(selectedTaskId);
                message.success(`Task report generated: ${resp.filename}`);
                window.open(resp.download_url, "_blank", "noopener,noreferrer");
                await refresh();
              } catch (e) {
                message.error(describeApiError(e));
              } finally {
                setBusy("");
              }
            }}
          >
            Generate Task Report
          </Button>
        </Space>

        <Typography.Text strong>Meso Experiment Filters</Typography.Text>
        <Space wrap style={{ marginTop: 8 }}>
          <Select
            style={{ width: 220 }}
            value={projectCategoryFilter}
            onChange={setProjectCategoryFilter}
            options={[{ value: "all", label: "Category: All" }, ...projectCategories.map((v) => ({ value: v, label: v }))]}
          />
          <Select
            allowClear
            style={{ width: 320 }}
            placeholder="Project ID"
            value={selectedProjectId}
            onChange={(v) => setSelectedProjectId(v)}
            options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
          />
          <DatePicker.RangePicker onChange={(v) => setProjectTaskRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button
            icon={<FileTextOutlined />}
            disabled={!selectedProjectId || sessionRole === "guest"}
            loading={busy === "project"}
            onClick={async () => {
              if (!selectedProjectId) return;
              setBusy("project");
              try {
                const resp = await api.createProjectReport(selectedProjectId);
                message.success(`Project report generated: ${resp.filename}`);
                window.open(resp.download_url, "_blank", "noopener,noreferrer");
                await refresh();
              } catch (e) {
                message.error(describeApiError(e));
              } finally {
                setBusy("");
              }
            }}
          >
            Generate Project Report
          </Button>
        </Space>
      </Card>

      <Card title="Report Exports">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={reportRows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Report ID", dataIndex: "id", width: 110 },
            {
              title: "Scope",
              render: (_: unknown, row: ReportItem) =>
                row.project_id ? `project:${row.project_id}` : row.task_id ? `task:${row.task_id}` : "-"
            },
            { title: "Filename", dataIndex: "filename" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={v === "READY" ? "green" : "blue"}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at" },
            {
              title: "Download",
              render: (_: unknown, row: ReportItem) => {
                if (!row.task_id || !row.filename) return "-";
                return (
                  <a href={api.fileUrl(row.task_id, row.filename)} target="_blank" rel="noreferrer">
                    Open
                  </a>
                );
              }
            }
          ]}
        />
      </Card>
    </Space>
  );
}
