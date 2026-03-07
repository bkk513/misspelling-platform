import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { goToTask } from "../app/router";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { api, describeApiError, type TimeSeriesListResponse, type TimeSeriesMeta } from "../lib/api";

export function TimeSeriesExplorerPage() {
  const [seriesRows, setSeriesRows] = useState<TimeSeriesListResponse["items"]>([]);
  const [taskId, setTaskId] = useState("");
  const [meta, setMeta] = useState<TimeSeriesMeta | null>(null);
  const [seriesMap, setSeriesMap] = useState<Record<string, Array<{ time: string; value: number }>>>({});
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("default");
  const [selectedSeries, setSelectedSeries] = useState<number[]>([]);

  const loadSeries = async () => {
    setLoading(true);
    try {
      const scopeValue = scope === "default" ? undefined : (scope as "all" | "guest");
      const rows = (await api.listTimeSeries(120, scopeValue)).items ?? [];
      setSeriesRows(rows);
      const withTask = rows.find((r) => r.task_id);
      if (!taskId && withTask?.task_id) setTaskId(withTask.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const loadChart = async (targetTaskId: string) => {
    try {
      const m = await api.getTimeSeriesMeta(targetTaskId);
      setMeta(m);
      const variants = m.variants?.length ? m.variants : ["correct"];
      const rows = await Promise.all(
        variants.map(async (variant) => {
          try {
            const resp = await api.getTimeSeriesPoints(targetTaskId, variant);
            return { variant, items: resp.items ?? [] };
          } catch {
            return { variant, items: [] as Array<{ time: string; value: number }> };
          }
        })
      );
      const nextMap: Record<string, Array<{ time: string; value: number }>> = {};
      for (const row of rows) {
        nextMap[row.variant] = row.items;
      }
      setSeriesMap(nextMap);
    } catch (e) {
      setMeta(null);
      setSeriesMap({});
      message.warning(describeApiError(e));
    }
  };

  useEffect(() => {
    void loadSeries();
  }, [scope]);

  useEffect(() => {
    if (!taskId) return;
    void loadChart(taskId);
  }, [taskId]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Time Series Explorer" extra={<Button icon={<ReloadOutlined />} onClick={() => void loadSeries()} loading={loading}>Refresh</Button>}>
        <Space wrap>
          <Select
            showSearch
            style={{ width: 380 }}
            placeholder="Select task"
            value={taskId || undefined}
            onChange={setTaskId}
            options={Array.from(new Set(seriesRows.map((r) => r.task_id).filter(Boolean))).map((id) => ({
              value: id,
              label: String(id).slice(0, 16) + "..."
            }))}
          />
          <Select
            style={{ width: 220 }}
            value={scope}
            onChange={setScope}
            options={[
              { value: "default", label: "Scope: Default" },
              { value: "guest", label: "Scope: Guest" },
              { value: "all", label: "Scope: All (Admin)" }
            ]}
          />
          <Button onClick={() => taskId && goToTask(taskId)}>Open Task Detail</Button>
          <Button onClick={() => taskId && void loadChart(taskId)}>Refresh Chart</Button>
        </Space>
        {meta ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
            source={meta.source} | word={meta.word} | granularity={meta.granularity} | variants={meta.variants.length} |
            points={meta.point_count}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
            δд��ʱ�����ݣ����������δ��ɡ�
          </Typography.Paragraph>
        )}
      </Card>

      <Card title="Series Chart">
        {Object.keys(seriesMap).length > 0 ? (
          <TimeSeriesChart
            series={Object.entries(seriesMap).map(([variant, points]) => ({
              name: variant,
              data: points.map(p => ({ time: p.time, value: p.value }))
            }))}
            title={meta ? `Time Series: ${meta.word}` : "Time Series"}
            height={500}
          />
        ) : (
          <Typography.Text type="secondary">
            No time series data available. Please select a task.
          </Typography.Text>
        )}
      </Card>

      <Card
        title="Series Inventory"
        extra={
          <Space>
            <Typography.Text type="secondary">Selected: {selectedSeries.length}</Typography.Text>
            <Popconfirm
              title="Delete selected series"
              description="Only accessible series will be deleted."
              disabled={selectedSeries.length === 0}
              onConfirm={async () => {
                if (selectedSeries.length === 0) return;
                try {
                  const resp = await api.bulkDeleteSeries(selectedSeries);
                  if (resp.deleted.length > 0) message.success(`Deleted ${resp.deleted.length} series`);
                  if (resp.skipped.length > 0) message.warning(`Skipped ${resp.skipped.length} series`);
                  setSelectedSeries([]);
                  await loadSeries();
                  if (taskId) await loadChart(taskId);
                } catch (e) {
                  message.error(describeApiError(e));
                }
              }}
            >
              <Button icon={<DeleteOutlined />} danger disabled={selectedSeries.length === 0}>
                Delete Selected
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="series_id"
          dataSource={seriesRows}
          rowSelection={{
            selectedRowKeys: selectedSeries,
            onChange: (keys) => setSelectedSeries(keys.map((k) => Number(k)).filter((v) => Number.isFinite(v)))
          }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Series ID", dataIndex: "series_id" },
            {
              title: "Task",
              dataIndex: "task_id",
              render: (v: string) => (v ? <Typography.Text code>{v.slice(0, 12)}...</Typography.Text> : "-")
            },
            { title: "Word", dataIndex: "canonical" },
            { title: "Variant", dataIndex: "variant", render: (v: string) => <Tag>{v}</Tag> },
            { title: "Source", dataIndex: "source_name" },
            { title: "Points", dataIndex: "point_count" },
            {
              title: "Window",
              render: (_: unknown, row: { window_start?: string; window_end?: string }) =>
                `${row.window_start || "-"} ~ ${row.window_end || "-"}`
            }
          ]}
        />
      </Card>
    </Space>
  );
}
