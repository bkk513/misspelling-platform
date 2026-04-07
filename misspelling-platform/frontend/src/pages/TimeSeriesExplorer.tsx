import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, DatePicker, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { api, describeApiError, type TaskListItem, type TimeSeriesListResponse, type TimeSeriesMeta } from "../lib/api";

function parseTaskWord(row: TaskListItem) {
  const params = row.params_json;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const word = String((params as Record<string, unknown>).word || "").trim();
    return word || "-";
  }
  return "-";
}

export function TimeSeriesExplorerPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [seriesRows, setSeriesRows] = useState<TimeSeriesListResponse["items"]>([]);
  const [wordFilter, setWordFilter] = useState<string>("all");
  const [taskId, setTaskId] = useState("");
  const [range, setRange] = useState<[string, string] | null>(null);
  const [meta, setMeta] = useState<TimeSeriesMeta | null>(null);
  const [seriesMap, setSeriesMap] = useState<Record<string, Array<{ time: string; value: number }>>>({});
  const [loading, setLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState<number[]>([]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [taskResp, seriesResp] = await Promise.all([api.listTasks(240), api.listTimeSeries(300)]);
      const nextTasks = taskResp.items ?? [];
      setTasks(nextTasks);
      setSeriesRows(seriesResp.items ?? []);
      if (!taskId && nextTasks.length > 0) {
        setTaskId(nextTasks[0].task_id);
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((row) => {
      const word = parseTaskWord(row);
      if (wordFilter !== "all" && word !== wordFilter) return false;
      if (range && row.created_at) {
        const d = dayjs(row.created_at);
        if (d.isBefore(dayjs(range[0])) || d.isAfter(dayjs(range[1]).endOf("day"))) return false;
      }
      return true;
    });
  }, [tasks, wordFilter, range]);

  useEffect(() => {
    if (!taskId) return;
    if (!filteredTasks.some((t) => t.task_id === taskId)) {
      setTaskId(filteredTasks[0]?.task_id || "");
    }
  }, [filteredTasks, taskId]);

  const filteredSeriesRows = useMemo(() => {
    const allowedTaskIds = new Set(filteredTasks.map((t) => t.task_id));
    return seriesRows.filter((row) => row.task_id && allowedTaskIds.has(row.task_id));
  }, [seriesRows, filteredTasks]);

  const loadChart = async (targetTaskId: string) => {
    if (!targetTaskId) return;
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
    void loadAll();
  }, []);

  useEffect(() => {
    if (!taskId) return;
    void loadChart(taskId);
  }, [taskId]);

  const wordOptions = useMemo(
    () => Array.from(new Set(tasks.map((t) => parseTaskWord(t)).filter((w) => w && w !== "-"))),
    [tasks]
  );

  return (
    <div className="enterprise-page-shell">
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">
              <ReloadOutlined />
              Evidence / Time Series
            </div>
            <Typography.Title level={2} className="enterprise-hero-title">
              Time Series Explorer
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              时序浏览页现在统一到算法模块的控制台风格。原来的任务过滤、图表刷新、详情跳转和批量删除都保留，只把信息分层和版式重新整理。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Visible Tasks</span>
              <div className="enterprise-meta-value">{filteredTasks.length}</div>
              <div className="enterprise-meta-copy">当前筛选条件下可选的任务数。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Series Rows</span>
              <div className="enterprise-meta-value">{filteredSeriesRows.length}</div>
              <div className="enterprise-meta-copy">当前库存中可见的时序行数。</div>
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
              <span>按词项、任务与时间范围切换当前时序视图。</span>
            </div>
          </div>
        }
        extra={<Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>Refresh</Button>}
      >
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={wordFilter}
            onChange={setWordFilter}
            options={[{ value: "all", label: "Word: All" }, ...wordOptions.map((w) => ({ value: w, label: w }))]}
          />
          <Select
            showSearch
            style={{ width: 420 }}
            placeholder="Select task id"
            value={taskId || undefined}
            onChange={setTaskId}
            options={filteredTasks.map((row) => ({
              value: row.task_id,
              label: `${parseTaskWord(row)} | ${row.task_id.slice(0, 12)}...`,
            }))}
          />
          <DatePicker.RangePicker onChange={(v) => setRange(v ? [v[0]!.format("YYYY-MM-DD"), v[1]!.format("YYYY-MM-DD")] : null)} />
          <Button onClick={() => taskId && goToTask(taskId)} disabled={!taskId}>
            Open Task Detail
          </Button>
          <Button onClick={() => taskId && void loadChart(taskId)} disabled={!taskId}>
            Refresh Chart
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {meta
            ? `source=${meta.source} | word=${meta.word} | granularity=${meta.granularity} | variants=${meta.variants.length} | points=${meta.point_count}`
            : "No time-series data loaded yet."}
        </Typography.Paragraph>
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <ReloadOutlined />
            <div className="enterprise-section-copy">
              <strong>Series Chart</strong>
              <span>展示当前任务下的全部变体时序曲线。</span>
            </div>
          </div>
        }
      >
        {Object.keys(seriesMap).length > 0 ? (
          <TimeSeriesChart
            series={Object.entries(seriesMap).map(([variant, points]) => ({
              name: variant,
              data: points.map((point) => ({ time: point.time, value: point.value })),
            }))}
            title={meta ? `Time Series: ${meta.word}` : "Time Series"}
            height={500}
          />
        ) : (
          <Typography.Text type="secondary">No time series data available. Please select a task.</Typography.Text>
        )}
      </Card>

      <Card
        className="enterprise-section-card"
        title={
          <div className="enterprise-section-title">
            <DeleteOutlined />
            <div className="enterprise-section-copy">
              <strong>Series Inventory</strong>
              <span>查看库存明细，并支持批量删除可访问的时序记录。</span>
            </div>
          </div>
        }
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
                  await loadAll();
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
          dataSource={filteredSeriesRows}
          rowSelection={{
            selectedRowKeys: selectedSeries,
            onChange: (keys) => setSelectedSeries(keys.map((key) => Number(key)).filter((value) => Number.isFinite(value))),
          }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Series ID", dataIndex: "series_id" },
            {
              title: "Task",
              dataIndex: "task_id",
              render: (value: string) => (value ? <Typography.Text code>{value.slice(0, 12)}...</Typography.Text> : "-"),
            },
            { title: "Word", dataIndex: "canonical" },
            { title: "Algorithm", dataIndex: "task_type", render: (value: string) => value || "-" },
            { title: "Variant", dataIndex: "variant", render: (value: string) => <Tag>{value}</Tag> },
            { title: "Source", dataIndex: "source_name" },
            { title: "Points", dataIndex: "point_count" },
            {
              title: "Window",
              render: (_: unknown, row: { window_start?: string; window_end?: string }) =>
                `${row.window_start || "-"} ~ ${row.window_end || "-"}`,
            },
          ]}
        />
      </Card>
    </div>
  );
}
