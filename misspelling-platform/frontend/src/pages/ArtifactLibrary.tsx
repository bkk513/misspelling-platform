/* 文件说明：产物库页面，负责查看并下载算法生成的图表、表格和报告文件。 */

import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Image, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError, type TaskArtifactsResponse, type TaskListItem } from "../lib/api";

function parseMeta(meta: unknown): { bytes?: number; content_type?: string } {
  if (!meta) return {};
  if (typeof meta === "object" && !Array.isArray(meta)) return meta as { bytes?: number; content_type?: string };
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as { bytes?: number; content_type?: string };
    } catch {
      return {};
    }
  }
  return {};
}

function taskWord(row: TaskListItem) {
  const params = row.params_json;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const word = String((params as Record<string, unknown>).word || "").trim();
    return word || "-";
  }
  return "-";
}

export function ArtifactLibraryPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskId, setTaskId] = useState("");
  const [wordFilter, setWordFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [payload, setPayload] = useState<TaskArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const list = (await api.listTasks(180)).items ?? [];
      setTasks(list);
      if (!taskId && list.length > 0) setTaskId(list[0].task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((row) => {
      if (wordFilter !== "all" && taskWord(row) !== wordFilter) return false;
      if (typeFilter !== "all" && row.task_type !== typeFilter) return false;
      if (range && row.created_at) {
        const d = dayjs(row.created_at);
        if (d.isBefore(dayjs(range[0])) || d.isAfter(dayjs(range[1]).endOf("day"))) return false;
      }
      return true;
    });
  }, [tasks, wordFilter, typeFilter, range]);

  useEffect(() => {
    if (!taskId) return;
    if (!filteredTasks.some((t) => t.task_id === taskId)) {
      setTaskId(filteredTasks[0]?.task_id || "");
    }
  }, [filteredTasks, taskId]);

  const loadArtifacts = async (targetTaskId: string) => {
    if (!targetTaskId) return;
    setLoading(true);
    try {
      const data = await api.getTaskArtifacts(targetTaskId);
      setPayload(data);
    } catch (e) {
      setPayload(null);
      message.warning(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  useEffect(() => {
    if (!taskId) return;
    void loadArtifacts(taskId);
  }, [taskId]);

  const previewPng = useMemo(() => {
    const hit = payload?.items?.find((x) => x.filename.toLowerCase() === "preview.png");
    return hit ? api.fileUrl(hit.task_id, hit.filename) : "";
  }, [payload]);

  const wordOptions = useMemo(
    () => Array.from(new Set(tasks.map((t) => taskWord(t)).filter((w) => w && w !== "-"))),
    [tasks]
  );
  const typeOptions = useMemo(() => Array.from(new Set(tasks.map((t) => t.task_type))), [tasks]);

  return (
    <div className="enterprise-page-shell">
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">
              <EyeOutlined />
              Evidence / Artifact Library
            </div>
            <Typography.Title level={2} className="enterprise-hero-title">
              Artifact Library
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              这里保留原来的筛选、切换任务、打开详情和下载文件能力，只把界面改成和算法页一致的证据浏览风格，方便从任务直接落到图像和结果文件。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Visible Tasks</span>
              <div className="enterprise-meta-value">{filteredTasks.length}</div>
              <div className="enterprise-meta-copy">当前筛选条件下可选的任务数。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Artifacts</span>
              <div className="enterprise-meta-value">{payload?.items?.length || 0}</div>
              <div className="enterprise-meta-copy">当前任务已登记的工件数量。</div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <ReloadOutlined />
            <div className="enterprise-section-copy">
              <strong>Filters</strong>
              <span>按词项、算法、时间和任务切换当前工件视图。</span>
            </div>
          </div>
        }
        extra={<Button icon={<ReloadOutlined />} onClick={() => taskId ? void loadArtifacts(taskId) : void loadTasks()} loading={loading}>Refresh</Button>}
      >
        <Space wrap>
          <Select
            style={{ width: 180 }}
            value={wordFilter}
            onChange={setWordFilter}
            options={[{ value: "all", label: "Word: All" }, ...wordOptions.map((w) => ({ value: w, label: w }))]}
          />
          <Select
            style={{ width: 220 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[{ value: "all", label: "Algorithm: All" }, ...typeOptions.map((v) => ({ value: v, label: v }))]}
          />
          <Select
            showSearch
            style={{ width: 420 }}
            placeholder="Select task id"
            value={taskId || undefined}
            onChange={setTaskId}
            options={filteredTasks.map((t) => ({ value: t.task_id, label: `${taskWord(t)} | ${t.task_id.slice(0, 12)}...` }))}
          />
          <DatePicker.RangePicker onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button icon={<EyeOutlined />} onClick={() => taskId && goToTask(taskId)} disabled={!taskId}>
            Open Task Detail
          </Button>
        </Space>
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <EyeOutlined />
            <div className="enterprise-section-copy">
              <strong>Artifact Table</strong>
              <span>查看工件类型、文件名、大小与下载入口。</span>
            </div>
          </div>
        }
      >
        <Table
          size="small"
          rowKey={(row) => `${row.task_id}:${row.filename}`}
          dataSource={payload?.items ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Kind", dataIndex: "kind", render: (value: string) => <Tag>{value}</Tag> },
            { title: "Filename", dataIndex: "filename" },
            { title: "Bytes", render: (_: unknown, row: { meta_json?: unknown }) => parseMeta(row.meta_json).bytes ?? "-" },
            { title: "Created", dataIndex: "created_at" },
            {
              title: "Action",
              render: (_: unknown, row: { task_id: string; filename: string }) => (
                <Button size="small" href={api.fileUrl(row.task_id, row.filename)} target="_blank">
                  Download
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <EyeOutlined />
            <div className="enterprise-section-copy">
              <strong>预览</strong>
              <span>优先展示当前任务的 `preview.png`。</span>
            </div>
          </div>
        }
      >
        {previewPng ? <Image src={previewPng} alt="preview.png" /> : <Typography.Text type="secondary">No preview.png for selected task.</Typography.Text>}
      </Card>
    </div>
  );
}
