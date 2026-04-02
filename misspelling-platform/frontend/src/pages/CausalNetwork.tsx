import {
  ApartmentOutlined,
  DeploymentUnitOutlined,
  LinkOutlined,
  RadarChartOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Slider,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { AlgorithmTermBuilder } from "../components/AlgorithmTermBuilder";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError } from "../lib/api";
import { asObject, fetchArtifactJson, taskStateTone } from "./algorithmStudioShared";
import "./algorithmStudio.css";

type EdgeRow = {
  source: string;
  target: string;
  lag: number;
  weight: number;
  method: string;
};

type WindowResult = {
  window_index: number;
  start_time?: string;
  end_time?: string;
  edge_count?: number;
  network_png?: string;
  timeseries_png?: string;
  top_edges?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
};

function normalizeEdges(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => ({
      source: String(row.source ?? "-"),
      target: String(row.target ?? "-"),
      lag: Number(row.lag ?? 0) || 0,
      weight: Number(row.weight ?? 0) || 0,
      method: String(row.method ?? "-"),
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export function CausalNetworkPage() {
  const [word, setWord] = useState("internet");
  const [variants, setVariants] = useState<string[]>([]);
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [tauMax, setTauMax] = useState(8);
  const [windowSize, setWindowSize] = useState(24);
  const [windowStep, setWindowStep] = useState(0);
  const [alphaLevel, setAlphaLevel] = useState(0.01);

  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [latestTaskState, setLatestTaskState] = useState("");
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [windowResults, setWindowResults] = useState<WindowResult[]>([]);
  const [globalEdges, setGlobalEdges] = useState<EdgeRow[]>([]);
  const [selectedWindowIndex, setSelectedWindowIndex] = useState(0);

  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  const selectedWindow = windowResults[selectedWindowIndex] || null;
  const selectedEdges = useMemo(() => {
    const fromWindow = Array.isArray(selectedWindow?.edges)
      ? normalizeEdges(selectedWindow?.edges as Array<Record<string, unknown>>)
      : Array.isArray(selectedWindow?.top_edges)
        ? normalizeEdges(selectedWindow?.top_edges as Array<Record<string, unknown>>)
        : [];
    return fromWindow.length > 0 ? fromWindow : globalEdges;
  }, [globalEdges, selectedWindow]);
  const strongestEdge = selectedEdges[0];
  const positiveEdges = selectedEdges.filter((row) => row.weight >= 0).length;
  const negativeEdges = selectedEdges.length - positiveEdges;
  const maxAbsWeight = Math.max(0.000001, ...selectedEdges.map((row) => Math.abs(row.weight)));
  const previewUrl =
    latestTaskId && latestTaskState.toUpperCase() === "SUCCESS" && selectedWindow?.network_png
      ? api.fileUrl(latestTaskId, selectedWindow.network_png)
      : "";
  const timeSeriesPreviewUrl =
    latestTaskId && latestTaskState.toUpperCase() === "SUCCESS" && selectedWindow?.timeseries_png
      ? api.fileUrl(latestTaskId, selectedWindow.timeseries_png)
      : "";
  const windowMarks = useMemo(() => {
    if (windowResults.length === 0) return {};
    const keyIndexes = new Set<number>([0, windowResults.length - 1, Math.floor((windowResults.length - 1) / 2)]);
    if (windowResults.length > 4) {
      keyIndexes.add(Math.floor((windowResults.length - 1) * 0.25));
      keyIndexes.add(Math.floor((windowResults.length - 1) * 0.75));
    } else {
      windowResults.forEach((_, index) => keyIndexes.add(index));
    }
    return Object.fromEntries(
      Array.from(keyIndexes)
        .sort((a, b) => a - b)
        .map((index) => {
          const item = windowResults[index];
          return [index, `${item?.start_time || ""}-${item?.end_time || ""}`];
        })
    );
  }, [windowResults]);

  const loadPreview = async (taskId = latestTaskId) => {
    if (!taskId) {
      message.info("请先运行一次 PCMCI 任务。");
      return;
    }
    setBusy(true);
    try {
      const detail = await api.getTask(taskId);
      const result = asObject(detail.result);
      const artifact = await fetchArtifactJson(taskId);
      const nextSummary = asObject(artifact?.summary) || asObject(result?.summary);
      const topLevelEdges = Array.isArray(artifact?.edges)
        ? normalizeEdges(artifact.edges as Array<Record<string, unknown>>)
        : Array.isArray(result?.top_edges)
          ? normalizeEdges(result.top_edges as Array<Record<string, unknown>>)
          : [];
      const nextWindows = Array.isArray(artifact?.window_results)
        ? (artifact.window_results as WindowResult[])
        : Array.isArray(result?.window_results)
          ? (result.window_results as WindowResult[])
          : [];
      setLatestTaskState(String(detail.state || ""));
      setSummary(nextSummary);
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item)) : []);
      setGlobalEdges(topLevelEdges);
      setWindowResults(nextWindows);
      setSelectedWindowIndex(nextWindows.length > 0 ? nextWindows.length - 1 : 0);
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
        // keep last visible state
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
    setBusy(true);
    try {
      const resp = await api.createPcmciCausal(
        word,
        {
          startYear,
          endYear,
          smoothing,
          variants,
          tauMax,
          windowSize,
          windowStep,
          alphaLevel,
        },
        turnstileToken
      );
      setLatestTaskId(resp.task_id);
      setLatestTaskState("QUEUED");
      setSummary(null);
      setWarnings([]);
      setWindowResults([]);
      setGlobalEdges([]);
      setSelectedWindowIndex(0);
      message.success(`PCMCI task queued: ${resp.task_id}`);
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
                <DeploymentUnitOutlined />
                Algorithms / PCMCI
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                Causal Network Reconstruction
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                这一页现在只保留真正需要看的三层信息：词项与参数、论文基线图、按时间窗口滑动的 Tigramite 因果图。窗口滑块会直接切换 `{`1-24 / 1-48 / 1-72`}` 这类累计区间的网络结果，方便解释因果结构如何随传播阶段演化。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Current Task</span>
                <div className="algo-hero-note-value">{latestTaskId ? latestTaskId.slice(0, 8) : "--"}</div>
                <div className="algo-hero-note-copy">Task state: {latestTaskState || "idle"}</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Window Focus</span>
                <div className="algo-hero-note-value">
                  {selectedWindow ? `${selectedWindow.start_time} - ${selectedWindow.end_time}` : "--"}
                </div>
                <div className="algo-hero-note-copy">当前正在查看的 Tigramite 网络窗口。</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Dominant Edge</div>
              <div className="algo-score-value">{strongestEdge ? `${strongestEdge.source} → ${strongestEdge.target}` : "--"}</div>
              <div className="algo-score-copy">当前窗口中 |weight| 最大的因果边。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Window Count</div>
              <div className="algo-score-value">{windowResults.length || String(summary?.windows ?? "--")}</div>
              <div className="algo-score-copy">本次任务持久化的滑动窗口数量。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Positive vs Negative</div>
              <div className="algo-score-value">{selectedEdges.length ? `${positiveEdges}/${negativeEdges}` : "--"}</div>
              <div className="algo-score-copy">当前窗口中正负权重边的数量分布。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Window Step</div>
              <div className="algo-score-value">{windowStep === 0 ? "same as size" : windowStep}</div>
              <div className="algo-score-copy">`0` 表示每次按 window size 递增，直接生成累计窗口。</div>
            </div>
          </div>
        </Card>

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={15}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <RadarChartOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Execution Console</strong>
                    <span>词项、错拼变体、窗口参数和任务控制台。</span>
                  </div>
                </div>
              }
            >
              <AlgorithmTermBuilder
                word={word}
                variants={variants}
                startYear={startYear}
                endYear={endYear}
                smoothing={smoothing}
                onWordChange={setWord}
                onVariantsChange={setVariants}
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
                  <span className="algo-field-label">Tau Max</span>
                  <InputNumber min={1} max={24} value={tauMax} onChange={(value) => setTauMax(value || 8)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Window Size</span>
                  <InputNumber min={3} max={300} value={windowSize} onChange={(value) => setWindowSize(value || 24)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Window Step</span>
                  <InputNumber min={0} max={300} value={windowStep} onChange={(value) => setWindowStep(typeof value === "number" ? value : 0)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Alpha Level</span>
                  <InputNumber min={0.0001} max={1} step={0.001} value={alphaLevel} onChange={(value) => setAlphaLevel(value || 0.01)} style={{ width: "100%" }} />
                </div>
              </div>

              <div className="algo-console-actions">
                <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} disabled={turnstileEnabled && !turnstileToken} onClick={() => void run()}>
                  Run PCMCI
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
                    <span>当前只保留 Figure 1，避免证据层过载。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-paper-grid">
                <div className="algo-paper-figure">
                  <div className="algo-paper-frame">
                    <img
                      src="https://raw.githubusercontent.com/bkk513/misspelling_behaviors/main/Causal%20network%20reconstruction%28Fig1%29/figures/20240814.png"
                      alt="paper-causal-network"
                    />
                  </div>
                  <div className="algo-paper-meta">
                    <Typography.Title level={5} className="algo-paper-title">
                      Figure 1 · Causal Network Reconstruction
                    </Typography.Title>
                    <Typography.Paragraph className="algo-paper-copy">
                      用作论文静态基线。系统页展示的是同一逻辑下按传播窗口切开的动态因果网络，而不是单独一张静态截图。
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
                    <strong>Window Explorer</strong>
                    <span>滑动查看不同累计窗口的 Tigramite 网络和对应的时序图。</span>
                  </div>
                </div>
              }
            >
              {windowResults.length > 0 ? (
                <>
                  <div className="algo-window-toolbar">
                    <div>
                      <div className="algo-window-range">
                        {selectedWindow ? `${selectedWindow.start_time} - ${selectedWindow.end_time}` : "--"}
                      </div>
                      <div className="algo-window-copy">
                        鼠标滚轮也可以切换窗口；`window step = 0` 时系统按 `window size` 自动累积。
                      </div>
                    </div>
                    <Tag color="blue">
                      {selectedWindow ? `edges ${selectedWindow.edge_count ?? selectedEdges.length}` : `windows ${windowResults.length}`}
                    </Tag>
                  </div>

                  <div
                    className="algo-window-slider-wrap"
                    onWheel={(event) => {
                      if (windowResults.length <= 1) return;
                      event.preventDefault();
                      setSelectedWindowIndex((current) => {
                        const delta = event.deltaY > 0 ? 1 : -1;
                        return Math.max(0, Math.min(windowResults.length - 1, current + delta));
                      });
                    }}
                  >
                    <Slider
                      min={0}
                      max={Math.max(0, windowResults.length - 1)}
                      value={selectedWindowIndex}
                      onChange={(value) => setSelectedWindowIndex(Number(value))}
                      marks={windowMarks}
                      tooltip={{ formatter: (value) => {
                        const item = windowResults[Number(value) || 0];
                        return item ? `${item.start_time} - ${item.end_time}` : "";
                      } }}
                    />
                  </div>

                  <div className="algo-window-grid">
                    <div className="algo-preview-frame">
                      {previewUrl ? (
                        <img src={previewUrl} alt="pcmci-window-network" />
                      ) : (
                        <div className="algo-preview-empty">
                          <Empty description="当前窗口还没有网络图。" />
                        </div>
                      )}
                    </div>
                    <div className="algo-preview-frame algo-preview-secondary">
                      {timeSeriesPreviewUrl ? (
                        <img src={timeSeriesPreviewUrl} alt="pcmci-window-timeseries" />
                      ) : (
                        <div className="algo-preview-empty">
                          <Empty description="当前窗口还没有时序图。" />
                        </div>
                      )}
                    </div>
                    <div className="algo-insight-list">
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">What Matters</div>
                        <div className="algo-insight-value">{strongestEdge ? strongestEdge.weight.toFixed(3) : "--"}</div>
                        <div className="algo-insight-copy">
                          先看当前窗口最强因果边，再看它的 lag，再判断这个窗口是否进入稳定结构。
                        </div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Lag Depth</div>
                        <div className="algo-insight-value">{selectedEdges.length ? Math.max(...selectedEdges.map((row) => row.lag)) : "--"}</div>
                        <div className="algo-insight-copy">该窗口中实际被保留的最大滞后深度。</div>
                      </div>
                      <div className="algo-insight-card">
                        <div className="algo-insight-label">Interpretation</div>
                        <div className="algo-insight-copy">
                          左图是本窗口的网络结构，右图是同一窗口下的时序因果图。答辩时直接解释“哪个变体在什么滞后下影响谁”即可。
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="algo-preview-empty">
                  <Empty description="运行 PCMCI 后，这里会出现可滑动的窗口网络结果。" />
                </div>
              )}

              <Row gutter={[18, 18]} style={{ marginTop: 18 }}>
                <Col xs={24} xl={10}>
                  <div className="algo-ranked-list">
                    {selectedEdges.slice(0, 8).map((row, index) => (
                      <div className="algo-ranked-item" key={`${row.source}-${row.target}-${row.lag}-${index}`}>
                        <div className="algo-ranked-head">
                          <span>{row.source} → {row.target}</span>
                          <span>{row.weight.toFixed(4)}</span>
                        </div>
                        <div className="algo-ranked-track">
                          <div
                            className="algo-ranked-fill"
                            style={{
                              width: `${Math.max(6, (Math.abs(row.weight) / maxAbsWeight) * 100)}%`,
                              background: row.weight >= 0 ? "var(--mp-primary-500)" : "var(--mp-accent-600)",
                            }}
                          />
                        </div>
                        <div className="algo-subtle">lag={row.lag} · {row.method}</div>
                      </div>
                    ))}
                    {selectedEdges.length === 0 ? <Empty description="当前窗口没有可展示的因果边。" /> : null}
                  </div>
                </Col>
                <Col xs={24} xl={14}>
                  <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0 }}>
                    <Table
                      rowKey={(_, index) => String(index)}
                      dataSource={selectedEdges}
                      pagination={{ pageSize: 8 }}
                      columns={[
                        { title: "Source", dataIndex: "source" },
                        { title: "Target", dataIndex: "target" },
                        { title: "Lag", dataIndex: "lag", width: 88 },
                        {
                          title: "Weight",
                          dataIndex: "weight",
                          width: 120,
                          render: (value: number) => value.toFixed(4),
                        },
                        { title: "Method", dataIndex: "method", width: 160 },
                      ]}
                    />
                  </Card>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
