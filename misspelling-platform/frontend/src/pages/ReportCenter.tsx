import { FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type ProjectItem, type ReportItem, type TaskListItem } from "../lib/api";

export function ReportCenterPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "task" | "project">("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [taskResp, projectResp, reportResp] = await Promise.all([
        api.listTasks(120),
        api.listProjects(100),
        api.listReports(200)
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
  }, []);

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
        <Space wrap>
          <Select
            showSearch
            style={{ width: 420 }}
            placeholder="Select task"
            value={selectedTaskId || undefined}
            onChange={setSelectedTaskId}
            options={tasks.map((t) => ({
              value: t.task_id,
              label: `${t.display_name || t.task_type} (${t.task_id.slice(0, 10)}...)`
            }))}
          />
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
        <Space wrap style={{ marginTop: 12 }}>
          <Select
            allowClear
            style={{ width: 420 }}
            placeholder="Select project (optional)"
            value={selectedProjectId}
            onChange={(v) => setSelectedProjectId(v)}
            options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
          />
          <Button
            icon={<FileTextOutlined />}
            disabled={!selectedProjectId}
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
          dataSource={reports}
          pagination={{ pageSize: 8 }}
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
