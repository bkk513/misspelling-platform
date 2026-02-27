import { FileTextOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type TaskListItem } from "../lib/api";

type ReportRecord = {
  id: string;
  created_at: string;
  task_count: number;
  status: "DRAFT" | "READY";
};

const KEY = "mp-report-center";

function loadRecords(): ReportRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReportRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ReportCenterPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [records, setRecords] = useState<ReportRecord[]>(() => loadRecords());

  const refreshTasks = async () => {
    try {
      setTasks((await api.listTasks(100)).items ?? []);
    } catch (e) {
      message.error(describeApiError(e));
    }
  };

  useEffect(() => {
    void refreshTasks();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  }, [records]);

  const createDraft = () => {
    if (selected.length === 0) {
      message.warning("Select at least one task.");
      return;
    }
    const next: ReportRecord = {
      id: `RPT-${Date.now()}`,
      created_at: new Date().toISOString(),
      task_count: selected.length,
      status: "DRAFT"
    };
    setRecords((prev) => [next, ...prev]);
    setSelected([]);
    message.success("Report draft created.");
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Report Draft Builder" extra={<Button icon={<FileTextOutlined />} type="primary" onClick={createDraft}>Create Draft</Button>}>
        <Typography.Paragraph type="secondary">
          Select completed tasks to generate a report draft record. PDF rendering service is reserved for next milestone.
        </Typography.Paragraph>
        <Table
          rowKey="task_id"
          size="small"
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          dataSource={tasks}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Task ID", dataIndex: "task_id" },
            { title: "Type", dataIndex: "task_type" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag>{v}</Tag> }
          ]}
        />
      </Card>
      <Card title="Report Records">
        <Table
          rowKey="id"
          size="small"
          dataSource={records}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: "Report ID", dataIndex: "id" },
            { title: "Created", dataIndex: "created_at" },
            { title: "Tasks", dataIndex: "task_count" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={v === "READY" ? "green" : "blue"}>{v}</Tag> }
          ]}
        />
      </Card>
    </Space>
  );
}
