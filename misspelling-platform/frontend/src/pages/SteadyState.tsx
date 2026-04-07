import {
  ApartmentOutlined,
  DotChartOutlined,
  LinkOutlined,
  RiseOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { LineChart } from "../components/LineChart";
import { AlgorithmTermBuilder } from "../components/AlgorithmTermBuilder";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError } from "../lib/api";
import { asObject, fetchArtifactJson, taskStateTone } from "./algorithmStudioShared";
import "./algorithmStudio.css";

type MetricRow = {
  year: number;
  misspelling: number;
  correct: number;
  signal_total: number;
  noise_misspelling: number;
  MR: number;
  NMR: number;
  density: number;
};

export function SteadyStatePage() {
  const [word, setWord] = useState("internet");
  const [variants, setVariants] = useState<string[]>([]);
  const [originYear, setOriginYear] = useState<number | undefined>(undefined);
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [polyDegree, setPolyDegree] = useState(20);

  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [latestTaskState, setLatestTaskState] = useState("");
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  const previewUrl = latestTaskId && latestTaskState.toUpperCase() === "SUCCESS" ? api.fileUrl(latestTaskId, "preview.png") : "";
  const peakDensity = useMemo(
    () => rows.reduce((best, row) => (row.density > best.density ? row : best), rows[0] || { year: 0, density: 0 } as MetricRow),
    [rows]
  );

  const signalNoiseSeries = useMemo(
    () => [
      {
        name: "Signal = correct + misspellings",
        points: rows.map((row) => ({ time: String(row.year), value: row.signal_total })),
        color: "#135bdb",
      },
      {
        name: "Noise = misspellings",
        points: rows.map((row) => ({ time: String(row.year), value: row.noise_misspelling })),
        color: "#d97706",
      },
      {
        name: "Correct only",
        points: rows.map((row) => ({ time: String(row.year), value: row.correct })),
        color: "#148758",
      },
    ],
    [rows]
  );

  const ratioSeries = useMemo(
    () => [
      {
        name: "MR",
        points: rows.map((row) => ({ time: String(row.year), value: row.MR })),
        color: "#135bdb",
      },
      {
        name: "NMR",
        points: rows.map((row) => ({ time: String(row.year), value: row.NMR })),
        color: "#148758",
      },
      {
        name: "Density",
        points: rows.map((row) => ({ time: String(row.year), value: row.density })),
        color: "#c2410c",
      },
    ],
    [rows]
  );

  const loadPreview = async (taskId = latestTaskId) => {
    if (!taskId) {
      message.info("请先运行一次 Steady State 任务。");
      return;
    }
    setBusy(true);
    try {
      const detail = await api.getTask(taskId);
      const result = asObject(detail.result);
      const artifact = await fetchArtifactJson(taskId);
      const metrics = Array.isArray(artifact?.metrics)
        ? (artifact.metrics as Array<Record<string, unknown>>)
        : Array.isArray(result?.metrics_preview)
          ? (result.metrics_preview as Array<Record<string, unknown>>)
          : [];
      setLatestTaskState(String(detail.state || ""));
      setSummary(asObject(artifact?.summary) || asObject(result?.summary));
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item)) : []);
      setRows(
        metrics.map((row) => ({
          year: Number(row.year ?? 0) || 0,
          misspelling: Number(row.misspelling ?? 0) || 0,
          correct: Number(row.correct ?? 0) || 0,
          signal_total: Number(row.signal_total ?? 0) || 0,
          noise_misspelling: Number(row.noise_misspelling ?? 0) || 0,
          MR: Number(row.MR ?? 0) || 0,
          NMR: Number(row.NMR ?? 0) || 0,
          density: Number(row.density ?? 0) || 0,
        }))
      );
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!latestTaskId) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const detail = await api.getTask(latestTaskId);
        if (cancelled) return;
        const state = String(detail.state || "");
        setLatestTaskState(state);
        if (state.toUpperCase() === "SUCCESS") {
          await loadPreview(latestTaskId);
          return;
        }
        if (state.toUpperCase() === "FAILURE") {
          return;
        }
      } catch {
        // ignore transient polling errors
      }
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void poll();
        }, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [latestTaskId]);

  const run = async () => {
    if (turnstileEnabled && !turnstileToken) {
      message.warning("请先完成人机验证。");
      return;
    }
    if (originYear === undefined) {
      message.info("建议先填写传播起点年份，或点击“建议传播起点”由系统填入。");
    }
    setBusy(true);
    try {
      const effectiveStartYear =
        typeof originYear === "number" ? Math.min(startYear, originYear) : startYear;
      const resp = await api.createMrnmrSteady(
        word,
        {
          startYear: effectiveStartYear,
          endYear,
          smoothing,
          variants,
          originYear,
          polyDegree,
        },
        turnstileToken
      );
      setLatestTaskId(resp.task_id);
      setLatestTaskState("QUEUED");
      setRows([]);
      setWarnings([]);
      setSummary(null);
      message.success(`MR/NMR task queued: ${resp.task_id}`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
      setTurnstileNonce((value) => value + 1);
    }
  };

  return (
    <div className="algo-studio-shell">
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Card bordered={false} className="algo-hero-card">
          <div className="algo-hero-head">
            <div>
              <div className="algo-kicker">
                <DotChartOutlined />
                Algorithms / MR-NMR
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                Steady-State Trajectory Analysis
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                这一页现在明确把建模逻辑写清楚了：信号是“正确拼写 + 全部错拼”的总频率，噪声是“全部错拼”的频率。传播起点不再用抽象 index，而是直接输入单词诞生 / 传播起始年份，再从这个时间点开始追踪 MR、NMR 和稳态密度。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Origin Year</span>
                <div className="algo-hero-note-value">{String(summary?.origin_year ?? originYear ?? "--")}</div>
                <div className="algo-hero-note-copy">稳态分析从这个传播起点开始截取序列。</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Steady Year</span>
                <div className="algo-hero-note-value">{String(summary?.steady_year ?? "--")}</div>
                <div className="algo-hero-note-copy">密度峰值对应的初始稳态年份。</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Signal Definition</div>
              <div className="algo-score-value">Signal</div>
              <div className="algo-score-copy">correct + all misspellings</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Noise Definition</div>
              <div className="algo-score-value">Noise</div>
              <div className="algo-score-copy">all misspellings</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Peak Density</div>
              <div className="algo-score-value">{rows.length ? peakDensity.density.toFixed(3) : "--"}</div>
              <div className="algo-score-copy">{rows.length ? `Observed at ${peakDensity.year}` : "运行后显示密度峰值。"}</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Points</div>
              <div className="algo-score-value">{String((summary?.points ?? rows.length) || "--")}</div>
              <div className="algo-score-copy">从传播起点之后进入稳态分析的时间点数量。</div>
            </div>
          </div>
        </Card>

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={15}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <RiseOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Execution Console</strong>
                    <span>词项、错拼组合、传播起点和算法运行控制。</span>
                  </div>
                </div>
              }
            >
              <AlgorithmTermBuilder
                word={word}
                variants={variants}
                originYear={originYear}
                showOriginYear
                startYear={startYear}
                endYear={endYear}
                smoothing={smoothing}
                onWordChange={setWord}
                onVariantsChange={setVariants}
                onOriginYearChange={setOriginYear}
              />

              <div className="algo-parameter-grid" style={{ marginTop: 18 }}>
                <div className="algo-field algo-span-3">
                  <span className="algo-field-label">Start Year</span>
                  <InputNumber min={1500} max={2026} value={startYear} onChange={(value) => setStartYear(value || 1900)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-3">
                  <span className="algo-field-label">End Year</span>
                  <InputNumber min={1500} max={2026} value={endYear} onChange={(value) => setEndYear(value || 2019)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Smoothing</span>
                  <InputNumber min={0} max={50} value={smoothing} onChange={(value) => setSmoothing(value || 3)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Poly Degree</span>
                  <InputNumber min={1} max={60} value={polyDegree} onChange={(value) => setPolyDegree(value || 20)} style={{ width: "100%" }} />
                </div>
              </div>

              <div className="algo-console-actions">
                <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} disabled={turnstileEnabled && !turnstileToken} onClick={() => void run()}>
                  Run MR/NMR
                </Button>
                <Button loading={busy} onClick={() => void loadPreview()}>
                  Refresh Current Preview
                </Button>
                <Button icon={<LinkOutlined />} disabled={!latestTaskId} onClick={() => latestTaskId && goToTask(latestTaskId)}>
                  Open Task Detail
                </Button>
                <Tag color={taskStateTone(latestTaskState)}>{latestTaskState || "IDLE"}</Tag>
                {latestTaskId ? <span className="algo-latest-tag">Task {latestTaskId}</span> : null}
              </div>

              <div style={{ marginTop: 16 }}>
                <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
              </div>

              {warnings.length > 0 ? (
                <Space wrap style={{ marginTop: 14 }}>
                  {warnings.map((warning) => (
                    <Tag key={warning} color="warning">
                      {warning}
                    </Tag>
                  ))}
                </Space>
              ) : null}
            </Card>
          </Col>

          <Col xs={24} xl={9}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <ApartmentOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Paper Baseline</strong>
                    <span>当前只保留 Figure 2，不展示 Figure 5。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-paper-grid">
                <div className="algo-paper-figure">
                  <div className="algo-paper-frame">
                    <img
                      src="https://raw.githubusercontent.com/bkk513/misspelling_behaviors/main/NMR%20MR%20temporal%20analysis%28Fig2%29/figures/SNR_ChatGPT.jpg"
                      alt="paper-mrnmr"
                    />
                  </div>
                  <div className="algo-paper-meta">
                    <Typography.Title level={5} className="algo-paper-title">
                      Figure 2 · MR/NMR Temporal Analysis
                    </Typography.Title>
                    <Typography.Paragraph className="algo-paper-copy">
                      这张图作为论文基线；系统页会把它拆成“信号/噪声”和“MR/NMR/密度”两个更容易读懂的结果层。
                    </Typography.Paragraph>
                  </div>
                </div>
              </div>
            </Card>
          </Col>

          <Col xs={24}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <LinkOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Current Run Evidence</strong>
                    <span>预览图、解释卡片、双图表和逐年指标表。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-preview-grid">
                <div className="algo-preview-frame">
                  {previewUrl ? (
                    <img src={previewUrl} alt="mrnmr-preview" />
                  ) : (
                    <div className="algo-preview-empty">
                      <Empty description="运行 Steady State 后，这里会出现当前预览图。" />
                    </div>
                  )}
                </div>
                <div className="algo-insight-list">
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Steady Year</div>
                    <div className="algo-insight-value">{String(summary?.steady_year ?? "--")}</div>
                    <div className="algo-insight-copy">密度最大的位置，代表初始稳态开始成形。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Signal vs Noise</div>
                    <div className="algo-insight-copy">
                      页面中蓝线是信号总量，橙线是噪声总量，绿线是正确拼写频率。这样就不会再把 MR/NMR 的输入逻辑藏起来。
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Interpretation</div>
                    <div className="algo-insight-copy">
                      如果信号持续放大而噪声占比下降，同时 NMR 抬升并在某个年份密度达到峰值，就说明该词进入了更稳定的拼写传播结构。
                    </div>
                  </div>
                </div>
              </div>

              <Row gutter={[18, 18]} style={{ marginTop: 18 }}>
                <Col xs={24} xl={12}>
                  {rows.length > 0 ? <LineChart title="Signal / Noise Structure" series={signalNoiseSeries} /> : <Empty description="No signal/noise trace yet." />}
                </Col>
                <Col xs={24} xl={12}>
                  {rows.length > 0 ? <LineChart title="MR / NMR / Density" series={ratioSeries} /> : <Empty description="No MR/NMR trace yet." />}
                </Col>
              </Row>

              <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0, marginTop: 18 }}>
                <Table
                  rowKey={(_, index) => String(index)}
                  dataSource={rows}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: "Year", dataIndex: "year", width: 100 },
                    { title: "Signal Total", dataIndex: "signal_total", render: (value: number) => value.toFixed(4) },
                    { title: "Noise", dataIndex: "noise_misspelling", render: (value: number) => value.toFixed(4) },
                    { title: "Correct", dataIndex: "correct", render: (value: number) => value.toFixed(4) },
                    { title: "MR", dataIndex: "MR", width: 96, render: (value: number) => value.toFixed(4) },
                    { title: "NMR", dataIndex: "NMR", width: 96, render: (value: number) => value.toFixed(4) },
                    { title: "Density", dataIndex: "density", width: 110, render: (value: number) => value.toFixed(4) },
                  ]}
                />
              </Card>
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
