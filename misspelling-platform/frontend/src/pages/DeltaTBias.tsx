import {
  ApartmentOutlined,
  LinkOutlined,
  NotificationOutlined,
  PartitionOutlined,
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
import { useEffect, useState } from "react";
import { goToTask } from "../app/router";
import { AlgorithmTermBuilder } from "../components/AlgorithmTermBuilder";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError } from "../lib/api";
import { asObject, fetchArtifactJson, taskStateTone } from "./algorithmStudioShared";
import "./algorithmStudio.css";

type DeltaRow = {
  year: number;
  correct: number;
  misspelling_total: number;
  actual_total: number;
  predicted_correct: number;
  correct_share: number;
  actual_bootstrap: number;
  predicted_bootstrap: number;
  actual_focus: number;
  predicted_focus: number;
  actual_mutation: number;
  predicted_mutation: number;
  event_threshold: number;
};

export function DeltaTBiasPage() {
  const [word, setWord] = useState("internet");
  const [variants, setVariants] = useState<string[]>([]);
  const [originYear, setOriginYear] = useState<number | undefined>(undefined);
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [bootstrapSamples, setBootstrapSamples] = useState(500);
  const [eventThresholdQuantile, setEventThresholdQuantile] = useState(0.9);
  const [randomSeed, setRandomSeed] = useState(42);

  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [latestTaskState, setLatestTaskState] = useState("");
  const [rows, setRows] = useState<DeltaRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [deltaStats, setDeltaStats] = useState<Record<string, unknown> | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [latestRunWord, setLatestRunWord] = useState("");
  const [sourceFigureFailed, setSourceFigureFailed] = useState(false);

  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  const previewUrl = latestTaskId && latestTaskState.toUpperCase() === "SUCCESS" ? api.fileUrl(latestTaskId, "preview.png") : "";
  const sourceFigureWord = String(latestRunWord || word || "").trim().toLowerCase();
  const sourceFigureUrl = sourceFigureWord ? `/api/paper-assets/deltat/${encodeURIComponent(sourceFigureWord)}` : "";
  const preferSourceFigure = !previewUrl && latestTaskState.toUpperCase() === "SUCCESS" && !!sourceFigureUrl && !sourceFigureFailed;

  const loadPreview = async (taskId = latestTaskId) => {
    if (!taskId) {
      message.info("请先运行一次 DeltaT 任务。");
      return;
    }
    setBusy(true);
    try {
      const detail = await api.getTask(taskId);
      const result = asObject(detail.result);
      const artifact = await fetchArtifactJson(taskId);
      const events = Array.isArray(artifact?.events)
        ? (artifact.events as Array<Record<string, unknown>>)
        : Array.isArray(result?.events_preview)
          ? (result.events_preview as Array<Record<string, unknown>>)
          : [];
      const payloadWord = String(artifact?.word || result?.word || "").trim().toLowerCase();
      setLatestTaskState(String(detail.state || ""));
      if (payloadWord) setLatestRunWord(payloadWord);
      setSummary(asObject(artifact?.summary) || asObject(result?.summary));
      setDeltaStats(asObject(artifact?.delta_t_stats) || asObject(result?.delta_t_stats));
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item)) : []);
      setRows(
        events.map((row) => ({
          year: Number(row.year ?? 0) || 0,
          correct: Number(row.correct ?? 0) || 0,
          misspelling_total: Number(row.misspelling_total ?? 0) || 0,
          actual_total: Number(row.actual_total ?? 0) || 0,
          predicted_correct: Number(row.predicted_correct ?? 0) || 0,
          correct_share: Number(row.correct_share ?? 0) || 0,
          actual_bootstrap: Number(row.actual_bootstrap ?? 0) || 0,
          predicted_bootstrap: Number(row.predicted_bootstrap ?? 0) || 0,
          actual_focus: Number(row.actual_focus ?? 0) || 0,
          predicted_focus: Number(row.predicted_focus ?? 0) || 0,
          actual_mutation: Number(row.actual_mutation ?? 0) || 0,
          predicted_mutation: Number(row.predicted_mutation ?? 0) || 0,
          event_threshold: Number(row.event_threshold ?? 0) || 0,
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
        // ignore transient polling failures
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

  useEffect(() => {
    setSourceFigureFailed(false);
  }, [latestTaskId, latestRunWord, word]);

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
      const resp = await api.createDeltaTNull(
        word,
        {
          startYear: effectiveStartYear,
          endYear,
          smoothing,
          variants,
          originYear,
          bootstrapSamples,
          eventThresholdQuantile,
          randomSeed,
        },
        turnstileToken
      );
      setLatestTaskId(resp.task_id);
      setLatestRunWord(String(word || "").trim().toLowerCase());
      setSourceFigureFailed(false);
      setLatestTaskState("QUEUED");
      setRows([]);
      setWarnings([]);
      setSummary(null);
      setDeltaStats(null);
      message.success(`DeltaT task queued: ${resp.task_id}`);
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
                <PartitionOutlined />
                Algorithms / DeltaT
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                DeltaT Public Cognition Bias
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                这页现在直接对齐 `Fig6 / 1.CFC_prediction` notebook：先在观测总传播曲线上找 peak-window 和 mutation point，再用 CfC 生成 counterfactual trajectory，再做第二次 Bayesian bootstrap。最终两条 mutation year 的差就是 `Δt`。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Actual Mutation</span>
                <div className="algo-hero-note-value">{String(summary?.actual_mutation_year ?? "--")}</div>
                <div className="algo-hero-note-copy">总传播曲线的成熟 / 变异点。</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Predicted Mutation</span>
                <div className="algo-hero-note-value">{String(summary?.predicted_mutation_year ?? "--")}</div>
                <div className="algo-hero-note-copy">CfC counterfactual trajectory 的 mutation point。</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Δt Years</div>
              <div className="algo-score-value">
                {typeof deltaStats?.delta_t_years === "number" ? Number(deltaStats.delta_t_years).toFixed(1) : "--"}
              </div>
              <div className="algo-score-copy">predicted mutation year - actual mutation year</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Delay Years</div>
              <div className="algo-score-value">
                {typeof deltaStats?.delay_years === "number" ? Number(deltaStats.delay_years).toFixed(1) : "--"}
              </div>
              <div className="algo-score-copy">只保留“认知延迟”的正向年份差。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Origin Year</div>
              <div className="algo-score-value">{String(summary?.origin_year ?? originYear ?? "--")}</div>
              <div className="algo-score-copy">传播起点由词项历史建议或人工输入给出。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Workflow</div>
              <div className="algo-score-value">Notebook</div>
              <div className="algo-score-copy">peak→bootstrap→CfC→bootstrap 的 Fig6 notebook 流程。</div>
            </div>
          </div>
        </Card>

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={15}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <NotificationOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Execution Console</strong>
                    <span>词项、起点建议、bootstrap 参数和任务控制。</span>
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
                  <InputNumber min={1500} max={2026} value={startYear} onChange={(value) => setStartYear(value ?? 1900)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-3">
                  <span className="algo-field-label">End Year</span>
                  <InputNumber min={1500} max={2026} value={endYear} onChange={(value) => setEndYear(value ?? 2019)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Smoothing</span>
                  <InputNumber min={0} max={50} value={smoothing} onChange={(value) => setSmoothing(value ?? 3)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Bootstrap</span>
                  <InputNumber min={100} max={5000} value={bootstrapSamples} onChange={(value) => setBootstrapSamples(value || 500)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Quantile</span>
                  <InputNumber min={0.5} max={0.99} step={0.01} value={eventThresholdQuantile} onChange={(value) => setEventThresholdQuantile(value || 0.9)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Random Seed</span>
                  <InputNumber min={1} max={999999} value={randomSeed} onChange={(value) => setRandomSeed(value || 42)} style={{ width: "100%" }} />
                </div>
              </div>

              <div className="algo-console-actions">
                <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} disabled={turnstileEnabled && !turnstileToken} onClick={() => void run()}>
                  Run DeltaT
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
                    <span>当前只保留 Figure 6 作为外部证据。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-paper-grid">
                <div className="algo-paper-figure">
                  <div className="algo-paper-frame">
                    <img
                      src="https://raw.githubusercontent.com/bkk513/misspelling_behaviors/main/Prediction%20of%20public%20perception%20bias%28Fig6%29/figures/all%20terms_300dpi.png"
                      alt="paper-public-bias"
                    />
                  </div>
                  <div className="algo-paper-meta">
                    <Typography.Title level={5} className="algo-paper-title">
                      Figure 6 · Public Perception Bias
                    </Typography.Title>
                    <Typography.Paragraph className="algo-paper-copy">
                      下方 Current Run Evidence 现在优先展示当前任务按 notebook port 生成的图；如果当前词项没有跑出任务图，才会退回源仓库里现成的 `_300dpi` 原图。
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
                    <span>预览图、解释卡、传播曲线、bootstrap 曲线和逐年表。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-preview-grid">
                <div className="algo-preview-frame">
                  {preferSourceFigure ? (
                    <img
                      src={sourceFigureUrl}
                      alt="delta-t-source-figure"
                      onError={() => setSourceFigureFailed(true)}
                    />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="delta-t-preview" />
                  ) : (
                    <div className="algo-preview-empty">
                      <Empty description="运行 DeltaT 后，这里会出现当前偏差图。" />
                    </div>
                  )}
                </div>
                <div className="algo-insight-list">
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">How To Read</div>
                    <div className="algo-insight-copy">
                      浅色区域是观测总传播曲线，绿色线是 notebook 里的 CfC counterfactual trajectory；两条竖线分别是实际 mutation 和 counterfactual mutation，它们之间的差就是 `Δt`。
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Figure Source</div>
                    <div className="algo-insight-value" style={{ fontSize: 20 }}>
                      {previewUrl ? "Notebook Port" : preferSourceFigure ? "Source Repository" : "Pending"}
                    </div>
                    <div className="algo-insight-copy">
                      {previewUrl
                        ? "当前图像来自本系统按 Fig6 notebook 重新执行后的任务产物。"
                        : preferSourceFigure
                          ? `当前词项 ${sourceFigureWord} 已命中源仓库原图，因此先展示仓库中的现成 figure。`
                          : "运行任务后，这里会显示按 notebook port 生成的当前词项图像。"}
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Actual vs Null</div>
                    <div className="algo-insight-value">
                      {typeof deltaStats?.actual_mutation_year === "number" && typeof deltaStats?.predicted_mutation_year === "number"
                        ? `${deltaStats.actual_mutation_year} → ${deltaStats.predicted_mutation_year}`
                        : "--"}
                    </div>
                    <div className="algo-insight-copy">总传播成熟点到零假设正确拼写成熟点的时间位移。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Time Anchor</div>
                    <div className="algo-insight-copy">
                      {typeof summary?.origin_year === "number"
                        ? `图像从 ${String(summary.origin_year)} 对应的传播起点开始裁切，这个时间点就是当前 tipping year。`
                        : "运行后会显示当前传播起点。"}
                    </div>
                  </div>
                </div>
              </div>

              <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0, marginTop: 18 }}>
                <Table
                  rowKey={(_, index) => String(index)}
                  dataSource={rows}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: "Year", dataIndex: "year", width: 92 },
                    { title: "Actual Total", dataIndex: "actual_total", render: (value: number) => value.toFixed(4) },
                    { title: "CfC Counterfactual", dataIndex: "predicted_correct", render: (value: number) => value.toFixed(4) },
                    { title: "Observed Correct", dataIndex: "correct", render: (value: number) => value.toFixed(4) },
                    { title: "Correct Share", dataIndex: "correct_share", width: 112, render: (value: number) => value.toFixed(4) },
                    { title: "Actual Bootstrap", dataIndex: "actual_bootstrap", width: 118, render: (value: number) => value.toFixed(4) },
                    { title: "Pred Bootstrap", dataIndex: "predicted_bootstrap", width: 118, render: (value: number) => value.toFixed(4) },
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
