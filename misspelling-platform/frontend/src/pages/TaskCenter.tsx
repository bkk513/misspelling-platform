import { CopyOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined, RocketOutlined, SearchOutlined } from "@ant-design/icons";
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

function parseTaskParams(paramsJson: unknown): Record<string, unknown> {
  if (!paramsJson) return {};
  if (typeof paramsJson === "object" && !Array.isArray(paramsJson)) return paramsJson as Record<string, unknown>;
  if (typeof paramsJson === "string") {
    try {
      const parsed = JSON.parse(paramsJson);
      return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function taskWord(row: TaskListItem) {
  const params = parseTaskParams(row.params_json);
  const word = String(params.word || "").trim();
  return word || "-";
}

export function TaskCenterPage() {
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listTasks(160);
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
      const word = taskWord(row).toLowerCase();
      if (type !== "all" && row.task_type !== type) return false;
      if (status !== "all" && row.status !== status) return false;
      if (q) {
        const query = q.toLowerCase();
        if (!row.task_id.toLowerCase().includes(query) && !word.includes(query)) return false;
      }
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
    <div className="enterprise-page-shell">
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">
              <RocketOutlined />
              Task Operations
            </div>
            <Typography.Title level={2} className="enterprise-hero-title">
              Task Center
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              这里不改任务管理逻辑，只把筛选、批量操作和列表展示统一到和算法页一致的控制台风格。顶部看全局规模，下面做检索、进入详情或清理历史任务。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Visible Tasks</span>
              <div className="enterprise-meta-value">{filtered.length}</div>
              <div className="enterprise-meta-copy">当前筛选条件下的任务数量。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Selected Rows</span>
              <div className="enterprise-meta-value">{selectedRowKeys.length}</div>
              <div className="enterprise-meta-copy">可用于批量删除的已选任务数。</div>
            </div>
          </div>
        </div>

        <div className="enterprise-stat-grid">
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">Algorithms</div>
            <div className="enterprise-stat-value">{types.length}</div>
            <div className="enterprise-stat-copy">当前任务列表中涉及的算法类型数。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">Statuses</div>
            <div className="enterprise-stat-value">{statuses.length}</div>
            <div className="enterprise-stat-copy">当前列表中的状态类别数。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">Search</div>
            <div className="enterprise-stat-value">{q ? "ACTIVE" : "IDLE"}</div>
            <div className="enterprise-stat-copy">按 `word / task_id` 检索历史任务。</div>
          </div>
          <div className="enterprise-stat-card">
            <div className="enterprise-stat-label">Refresh</div>
            <div className="enterprise-stat-value">{loading ? "RUNNING" : "READY"}</div>
            <div className="enterprise-stat-copy">任务列表拉取状态。</div>
          </div>
        </div>
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <SearchOutlined />
            <div className="enterprise-section-copy">
              <strong>Filters</strong>
              <span>按任务类型、状态、时间范围和关键字筛选。</span>
            </div>
          </div>
        }
        extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>Refresh Now</Button>}
      >
        <Space wrap>
          <Input placeholder="Search word/task_id" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          <Select value={type} onChange={setType} style={{ width: 200 }} options={[{ value: "all", label: "All Algorithms" }, ...types.map((v) => ({ value: v, label: v }))]} />
          <Select value={status} onChange={setStatus} style={{ width: 180 }} options={[{ value: "all", label: "All Status" }, ...statuses.map((v) => ({ value: v, label: v }))]} />
          <DatePicker.RangePicker onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button onClick={() => { setQ(""); setType("all"); setStatus("all"); setRange(null); }}>
            Clear Filters
          </Button>
        </Space>
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <RocketOutlined />
            <div className="enterprise-section-copy">
              <strong>Task Ledger</strong>
              <span>查看详情、复制任务号或清理历史记录。</span>
            </div>
          </div>
        }
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
              width: 320,
              render: (_: unknown, row: TaskListItem) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{taskWord(row)}</Typography.Text>
                  <Typography.Text code style={{ fontSize: 12 }}>{row.task_id}</Typography.Text>
                </Space>
              )
            },
            { title: "Algorithm", dataIndex: "task_type", width: 190 },
            { title: "Status", dataIndex: "status", width: 130, render: (v: string) => <Tag color={color(v)}>{v}</Tag> },
            { title: "Created", dataIndex: "created_at", width: 190, sorter: (a: TaskListItem, b: TaskListItem) => String(a.created_at || "").localeCompare(String(b.created_at || "")) },
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
    </div>
  );
}
