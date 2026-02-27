import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { goToTask } from "../app/router";
import { LineChart } from "../components/LineChart";
import { api, describeApiError, type TaskListItem, type TimeSeriesMeta } from "../lib/api";

export function TimeSeriesExplorerPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [taskId, setTaskId] = useState("");
  const [variant, setVariant] = useState("correct");
  const [meta, setMeta] = useState<TimeSeriesMeta | null>(null);
  const [points, setPoints] = useState<Array<{ time: string; value: number }>>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const rows = (await api.listTasks(80)).items ?? [];
      setTasks(rows);
      if (!taskId && rows.length > 0) setTaskId(rows[0].task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  useEffect(() => {
    if (!taskId) return;
    api
      .getTimeSeriesMeta(taskId)
      .then((m) => {
        setMeta(m);
        const nextVariant = m.variants?.[0] || "correct";
        setVariant(nextVariant);
      })
      .catch((e) => {
        setMeta(null);
        setPoints([]);
        message.warning(describeApiError(e));
      });
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !variant) return;
    api
      .getTimeSeriesPoints(taskId, variant)
      .then((resp) => setPoints(resp.items ?? []))
      .catch((e) => {
        setPoints([]);
        message.warning(describeApiError(e));
      });
  }, [taskId, variant]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Time Series Explorer" extra={<Button icon={<ReloadOutlined />} onClick={() => void loadTasks()} loading={loading}>Refresh Tasks</Button>}>
        <Space wrap>
          <Select
            showSearch
            style={{ width: 380 }}
            placeholder="Select task"
            value={taskId || undefined}
            onChange={setTaskId}
            options={tasks.map((t) => ({ value: t.task_id, label: `${t.task_type} | ${t.task_id.slice(0, 12)}...` }))}
          />
          <Select
            style={{ width: 220 }}
            value={variant}
            onChange={setVariant}
            options={(meta?.variants || ["correct"]).map((v) => ({ value: v, label: v }))}
          />
          <Button onClick={() => taskId && goToTask(taskId)}>Open Task Detail</Button>
        </Space>
        {meta ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
            source={meta.source} | word={meta.word} | granularity={meta.granularity} | variants={meta.variants.length} | points={meta.point_count}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
            未写入时序数据，或该任务尚未完成。
          </Typography.Paragraph>
        )}
      </Card>

      <Card title="Series Chart">
        <LineChart points={points} title={`Time Series (${variant})`} />
      </Card>

      <Card title="Series Inventory">
        <Table
          size="small"
          rowKey="series_id"
          dataSource={meta?.items ?? []}
          pagination={false}
          columns={[
            { title: "Series ID", dataIndex: "series_id" },
            { title: "Variant", dataIndex: "variant", render: (v: string) => <Tag>{v}</Tag> },
            { title: "Points", dataIndex: "point_count" },
            { title: "Window", render: (_: unknown, row: { window_start?: string; window_end?: string }) => `${row.window_start || "-"} ~ ${row.window_end || "-"}` }
          ]}
        />
      </Card>
    </Space>
  );
}
