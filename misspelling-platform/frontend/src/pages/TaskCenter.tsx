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

function parseTaskParams(paramsJson: string | null): Record<string, unknown> {
  if (!paramsJson) return {};
  try {
    return JSON.parse(paramsJson);
  } catch {
    return {};
  }
}

export function TaskCenterPage() {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [scope, setScope] = useState<string>("default");
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const nextScope = scope === "default" ? undefined : (scope as "all" | "guest");
      const list = await api.listTasks(120, nextScope);
      setItems(list.items ?? []);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [scope]);

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
          <Select
            value={scope}
            onChange={setScope}
            style={{ width: 180 }}
            options={[
              { value: "default", label: "Scope: Default" },
              { value: "guest", label: "Scope: Guest" },
              { value: "all", label: "Scope: All (Admin)" }
            ]}
          />
          <DatePicker.RangePicker onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button onClick={() => { setQ(""); setType("all"); setStatus("all"); setRange(null); setScope("default"); }}>
            Clear Filters
          </Button>
        </Space>
      </Card>
      <Card
        title="Task Center"
        extra={
          <Space>
            <Typography.Text type="secondary">Selected: {selectedRowKeys.length}</Typography.Text>
            <Popconfirm
              title="Delete selected tasks"
              description="Only accessible tasks will be deleted."
              disabled={selectedRowKeys.length === 0}
              onConfirm={async () => {
                if (selectedRowKeys.length === 0) return;
                try {
                  const resp = await api.bulkDeleteTasks(selectedRowKeys.map((v) => String(v)));
                  if (resp.deleted.length > 0) message.success(`Deleted ${resp.deleted.length} task(s)`);
                  if (resp.skipped.length > 0) message.warning(`Skipped ${resp.skipped.length} task(s)`);
                  setSelectedRowKeys([]);
                  await refresh();
                } catch (e) {
                  message.error(describeApiError(e));
                }
              }}
            >
              <Button danger disabled={selectedRowKeys.length === 0}>Delete Selected</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          rowKey="task_id"
          dataSource={filtered}
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((v) => String(v)))
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: "Task",
              render: (_: unknown, row: TaskListItem) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{row.display_name || row.task_type}</Typography.Text>
                  <Typography.Text code style={{ fontSize: 12 }}>{row.task_id}</Typography.Text>
                </Space>
              )
            },
            { title: "Type", dataIndex: "task_type", width: 180 },
            {
              title: "Parameters",
              key: "params",
              width: 300,
              render: (_: unknown, row: TaskListItem) => {
                const params = parseTaskParams(row.params_json);
                const word = params.word as string | undefined;
                const variants = params.variants as string[] | string | undefined;
                const corpus = params.corpus as string | undefined;
                const startYear = params.start_year as number | undefined;
                const endYear = params.end_year as number | undefined;

                const variantArray = Array.isArray(variants)
                  ? variants
                  : typeof variants === 'string'
                    ? variants.split(',').map(v => v.trim()).filter(Boolean)
                    : [];

                return (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    {word && (
                      <Typography.Text code style={{ fontSize: 12 }}>
                        word: {word}
                      </Typography.Text>
                    )}
                    {variantArray.length > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        variants: {variantArray.slice(0, 3).join(', ')}
                        {variantArray.length > 3 && ` +${variantArray.length - 3} more`}
                      </Typography.Text>
                    )}
                    <Space size={4}>
                      {corpus && <Tag size="small">{corpus}</Tag>}
                      {startYear && endYear && (
                        <Tag size="small" color="blue">{startYear}-{endYear}</Tag>
                      )}
                    </Space>
                  </Space>
                );
              },
            },
            { title: "Status", dataIndex: "status", width: 120, render: (v: string) => <Tag color={color(v)}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at", width: 180, sorter: (a: TaskListItem, b: TaskListItem) => String(a.created_at || "").localeCompare(String(b.created_at || "")) },
            {
              title: "Action",
              width: 280,
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
