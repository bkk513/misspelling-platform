import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Image, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { api, describeApiError, type TaskListItem, type TaskArtifactsResponse } from "../lib/api";

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

export function ArtifactLibraryPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskId, setTaskId] = useState("");
  const [payload, setPayload] = useState<TaskArtifactsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const list = (await api.listTasks(80)).items ?? [];
      setTasks(list);
      if (!taskId && list.length > 0) setTaskId(list[0].task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Artifact Library" extra={<Button icon={<ReloadOutlined />} onClick={() => taskId ? void loadArtifacts(taskId) : void loadTasks()} loading={loading}>Refresh</Button>}>
        <Space wrap>
          <Select
            showSearch
            style={{ width: 380 }}
            placeholder="Select task"
            value={taskId || undefined}
            onChange={setTaskId}
            options={tasks.map((t) => ({ value: t.task_id, label: `${t.task_type} | ${t.task_id.slice(0, 12)}...` }))}
          />
          <Button icon={<EyeOutlined />} onClick={() => taskId && goToTask(taskId)}>Open Task Detail</Button>
        </Space>
      </Card>
      <Card title="Artifact Table">
        <Table
          size="small"
          rowKey={(r) => `${r.task_id}:${r.filename}`}
          dataSource={payload?.items ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Kind", dataIndex: "kind", render: (v: string) => <Tag>{v}</Tag> },
            { title: "Filename", dataIndex: "filename" },
            { title: "Bytes", render: (_: unknown, row: { meta_json?: unknown }) => parseMeta(row.meta_json).bytes ?? "-" },
            { title: "Created", dataIndex: "created_at" },
            { title: "Action", render: (_: unknown, row: { task_id: string; filename: string }) => <Button size="small" href={api.fileUrl(row.task_id, row.filename)} target="_blank">Download</Button> }
          ]}
        />
      </Card>
      <Card title="Preview">
        {previewPng ? <Image src={previewPng} alt="preview.png" /> : <Typography.Text type="secondary">No preview.png for selected task.</Typography.Text>}
      </Card>
    </Space>
  );
}
