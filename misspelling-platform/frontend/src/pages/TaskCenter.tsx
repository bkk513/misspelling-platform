/* 文件说明：任务中心页面，负责查看、筛选、暂停和删除平台中的任务。 */

import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Card, DatePicker, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError, type TaskListItem } from "../lib/api";

function color(status: string) {
  const v = status.toUpperCase();
  if (v === "SUCCESS") return "green";
  if (v === "FAILURE") return "red";
  if (v === "RUNNING" || v === "PROGRESS" || v === "QUEUED") return "processing";
  if (v === "REVOKED") return "orange";
  if (v === "DELETED") return "default";
  return "blue";
}

function isActive(status: string) {
  const v = status.toUpperCase();
  return v === "RUNNING" || v === "PROGRESS" || v === "QUEUED";
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
      const list = await api.listTasks(200);
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

  const doBulkDelete = async (force: boolean) => {
    if (selectedRowKeys.length === 0) return;
    try {
      const resp = await api.bulkDeleteTasks(selectedRowKeys.map((v) => String(v)), { force });
      if (resp.deleted.length > 0) message.success(`已删除 ${resp.deleted.length} 个任务`);
      if (resp.skipped.length > 0) message.warning(`跳过 ${resp.skipped.length} 个任务`);
      setSelectedRowKeys([]);
      await refresh();
    } catch (e) {
      message.error(describeApiError(e));
    }
  };

  return (
    <div className="enterprise-page-shell">
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">
              <SearchOutlined />
              任务管理
            </div>
            <Typography.Title level={2} className="enterprise-hero-title">
              Task Center
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              统一查看任务状态、筛选历史、进入详情，并支持运行中任务的“暂停并删除”。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">当前结果</span>
              <div className="enterprise-meta-value">{filtered.length}</div>
              <div className="enterprise-meta-copy">筛选后可见任务数。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">已选任务</span>
              <div className="enterprise-meta-value">{selectedRowKeys.length}</div>
              <div className="enterprise-meta-copy">用于批量操作。</div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        className="enterprise-section-card"
        title="筛选条件"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Space wrap>
          <Input
            placeholder="按 word / task_id 检索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 260 }}
          />
          <Select
            value={type}
            onChange={setType}
            style={{ width: 210 }}
            options={[{ value: "all", label: "全部类型" }, ...types.map((v) => ({ value: v, label: v }))]}
          />
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 190 }}
            options={[{ value: "all", label: "全部状态" }, ...statuses.map((v) => ({ value: v, label: v }))]}
          />
          <DatePicker.RangePicker
            onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)}
          />
          <Button
            onClick={() => {
              setQ("");
              setType("all");
              setStatus("all");
              setRange(null);
            }}
          >
            清空筛选
          </Button>
        </Space>
      </Card>

      <Card
        className="enterprise-section-card"
        title="任务列表"
        extra={
          <Space>
            <Typography.Text type="secondary">已选: {selectedRowKeys.length}</Typography.Text>
            <Popconfirm
              title="批量删除"
              description="仅删除可访问且非运行中的任务。"
              disabled={selectedRowKeys.length === 0}
              onConfirm={() => void doBulkDelete(false)}
            >
              <Button danger disabled={selectedRowKeys.length === 0}>
                删除已选
              </Button>
            </Popconfirm>
            <Popconfirm
              title="批量暂停并删除"
              description="运行中任务会先暂停（revoke）再删除。"
              disabled={selectedRowKeys.length === 0}
              onConfirm={() => void doBulkDelete(true)}
            >
              <Button icon={<PauseCircleOutlined />} disabled={selectedRowKeys.length === 0}>
                暂停并删除已选
              </Button>
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
            onChange: (keys) => setSelectedRowKeys(keys.map((v) => String(v))),
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: "任务",
              width: 340,
              render: (_: unknown, row: TaskListItem) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{taskWord(row)}</Typography.Text>
                  <Typography.Text code style={{ fontSize: 12 }}>
                    {row.task_id}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: "类型", dataIndex: "task_type", width: 190 },
            {
              title: "状态",
              dataIndex: "status",
              width: 130,
              render: (v: string) => <Tag color={color(v)}>{v}</Tag>,
            },
            {
              title: "创建时间",
              dataIndex: "created_at",
              width: 190,
              sorter: (a: TaskListItem, b: TaskListItem) =>
                String(a.created_at || "").localeCompare(String(b.created_at || "")),
            },
            {
              title: "操作",
              width: 420,
              render: (_: unknown, row: TaskListItem) => (
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => goToTask(row.task_id)}>
                    详情
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(row.task_id)
                        .then(() => message.success("已复制 Task ID"))
                        .catch(() => {})
                    }
                  >
                    复制 ID
                  </Button>
                  <Popconfirm
                    title="删除任务"
                    description="运行中的任务不会被删除。"
                    onConfirm={async () => {
                      try {
                        const resp = await api.deleteTask(row.task_id);
                        if (!resp.deleted) {
                          message.warning(resp.reason || "删除被拒绝");
                          return;
                        }
                        message.success("删除成功");
                        await refresh();
                      } catch (e) {
                        message.error(describeApiError(e));
                      }
                    }}
                  >
                    <Button size="small" icon={<DeleteOutlined />} danger>
                      删除
                    </Button>
                  </Popconfirm>
                  {isActive(row.status) && (
                    <Popconfirm
                      title="暂停并删除运行中任务"
                      description="会先尝试 revoke，再清理任务与关联数据。"
                      onConfirm={async () => {
                        try {
                          const resp = await api.deleteTask(row.task_id, { force: true });
                          if (!resp.deleted) {
                            message.warning(resp.reason || "操作失败");
                            return;
                          }
                          message.success("已暂停并删除任务");
                          await refresh();
                        } catch (e) {
                          message.error(describeApiError(e));
                        }
                      }}
                    >
                      <Button size="small" icon={<PauseCircleOutlined />}>
                        暂停并删除
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
