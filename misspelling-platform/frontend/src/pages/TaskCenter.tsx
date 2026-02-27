import { CopyOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError, type TaskListItem } from "../lib/api";

function color(status: string) {
  const v = status.toUpperCase();
  if (v === "SUCCESS") return "green";
  if (v === "FAILURE") return "red";
  if (v === "RUNNING" || v === "PROGRESS") return "processing";
  if (v === "DELETED") return "default";
  return "blue";
}

export function TaskCenterPage() {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<[string, string] | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listTasks(120);
      setItems(list.items ?? []);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    return items.filter((row) => {
      if (type !== "all" && row.task_type !== type) return false;
      if (status !== "all" && row.status !== status) return false;
      if (q && !row.task_id.includes(q) && !row.task_type.includes(q)) return false;
      if (range && row.created_at) {
        const d = dayjs(row.created_at);
        if (d.isBefore(dayjs(range[0])) || d.isAfter(dayjs(range[1]).endOf("day"))) return false;
      }
      return true;
    });
  }, [items, q, range, status, type]);

  const types = Array.from(new Set(items.map((x) => x.task_type)));
  const statuses = Array.from(new Set(items.map((x) => x.status)));

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Task Filters" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>Refresh Now</Button>}>
        <Space wrap>
          <Input placeholder="Search task_id/type" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <Select value={type} onChange={setType} style={{ width: 180 }} options={[{ value: "all", label: "All Types" }, ...types.map((v) => ({ value: v, label: v }))]} />
          <Select value={status} onChange={setStatus} style={{ width: 180 }} options={[{ value: "all", label: "All Status" }, ...statuses.map((v) => ({ value: v, label: v }))]} />
          <DatePicker.RangePicker onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
        </Space>
      </Card>
      <Card title="Task Center">
        <Table
          rowKey="task_id"
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            { title: "Task ID", dataIndex: "task_id", render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
            { title: "Type", dataIndex: "task_type" },
            { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={color(v)}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at", sorter: (a: TaskListItem, b: TaskListItem) => String(a.created_at || "").localeCompare(String(b.created_at || "")) },
            {
              title: "Action",
              render: (_: unknown, row: TaskListItem) => (
                <Space>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => goToTask(row.task_id)}>Detail</Button>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => navigator.clipboard?.writeText(row.task_id).then(() => message.success("Task ID copied"))}>Copy</Button>
                  <Popconfirm
                    title="Delete task"
                    description="The task will be soft-deleted and removed from active lists."
                    onConfirm={async () => {
                      try {
                        const resp = await api.deleteTask(row.task_id);
                        if (!resp.deleted) {
                          message.warning(resp.reason || "Delete rejected");
                          return;
                        }
                        message.success("Task deleted");
                        await refresh();
                      } catch (e) {
                        message.error(describeApiError(e));
                      }
                    }}
                  >
                    <Button size="small" icon={<DeleteOutlined />} danger>Delete</Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
