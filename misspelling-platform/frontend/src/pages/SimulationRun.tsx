import {
  ApartmentOutlined,
  BarChartOutlined,
  LinkOutlined,
  NotificationOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Select,
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
import { api, describeApiError, type DataSourceKey } from "../lib/api";
import { asObject, fetchArtifactJson, taskStateTone } from "./algorithmStudioShared";
import "./algorithmStudio.css";

type SimulationRow = {
  year: number;
  time_label?: string;
  right_actual: number;
  error_actual: number;
  right_simulated: number;
  error_simulated: number;
  error_share_actual: number;
  error_share_simulated: number;
  right_std: number;
  error_std: number;
  share_std: number;
};

type ScenarioCard = {
  key: string;
  label: string;
  color: string;
  application_context?: string;
  start_year?: number;
  start_time?: string;
  final_error_reduction?: number;
  final_error_share?: number;
};

type TopologyBenchmarkRow = {
  rank: number;
  topology: string;
  score: number;
  right_r2: number;
  error_r2: number;
  share_r2: number;
  error_nrmse_peak?: number;
  share_nrmse_peak?: number;
  avg_degree: number;
  clustering: number;
  density: number;
};

type ParameterNote = {
  name: string;
  label: string;
  display_value: string;
  band: string;
  role: string;
  interpretation: string;
  implication?: string;
};

type ChartGuide = {
  key: string;
  title: string;
  explanation: string;
};

const FIT_PRESETS: Record<"explore" | "research" | "publication", { nAgents: number; searchRounds: number; repeats: number; note: string }> = {
  explore: { nAgents: 720, searchRounds: 36, repeats: 3, note: "适合快速探索，通常几十秒到一分多钟完成。" },
  research: { nAgents: 1200, searchRounds: 96, repeats: 6, note: "研究档配置，拟合更稳，通常在 2 到 4 分钟内完成。" },
  publication: { nAgents: 1500, searchRounds: 140, repeats: 7, note: "高精度展示档，优先提高拟合质量，通常在 4 到 9 分钟内完成。" },
};

function formatFrequency(value: number, digits = 6) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1) return value.toFixed(Math.min(2, digits));
  if (abs >= 10 ** -Math.max(2, digits)) return value.toFixed(digits);
  return value.toExponential(2);
}

function formatMetricBadge(value: unknown, digits = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toFixed(digits);
}

export function SimulationRunPage() {
  const [word, setWord] = useState("guarantee");
  const [variants, setVariants] = useState<string[]>([]);
  const [dataSource, setDataSource] = useState<DataSourceKey>("gbnc");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [topology, setTopology] = useState("auto");
  const [fitProfile, setFitProfile] = useState<"explore" | "research" | "publication">("publication");
  const [nAgents, setNAgents] = useState(1500);
  const [searchRounds, setSearchRounds] = useState(140);
  const [repeats, setRepeats] = useState(7);
  const [trendWindow, setTrendWindow] = useState(3);
  const [wsK, setWsK] = useState(8);
  const [wsP, setWsP] = useState(0.08);
  const [baM, setBaM] = useState(4);
  const [randomSeed, setRandomSeed] = useState(42);
  const [interventionYear, setInterventionYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [latestTaskId, setLatestTaskId] = useState("");
  const [latestTaskState, setLatestTaskState] = useState("");
  const [rows, setRows] = useState<SimulationRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [networkSummary, setNetworkSummary] = useState<Record<string, unknown> | null>(null);
  const [variantBreakdown, setVariantBreakdown] = useState<Array<Record<string, unknown>>>([]);
  const [interventions, setInterventions] = useState<ScenarioCard[]>([]);
  const [topologyBenchmark, setTopologyBenchmark] = useState<TopologyBenchmarkRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [animationUrl, setAnimationUrl] = useState("");
  const [overview, setOverview] = useState("");
  const [fitAssessment, setFitAssessment] = useState<string[]>([]);
  const [chartGuide, setChartGuide] = useState<ChartGuide[]>([]);
  const [parameterNotes, setParameterNotes] = useState<ParameterNote[]>([]);
  const [takeaways, setTakeaways] = useState<string[]>([]);

  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  const previewUrl = latestTaskId && latestTaskState.toUpperCase() === "SUCCESS" ? api.fileUrl(latestTaskId, "preview.png") : "";

  const applyPreset = (profile: "explore" | "research" | "publication") => {
    setFitProfile(profile);
    setNAgents(FIT_PRESETS[profile].nAgents);
    setSearchRounds(FIT_PRESETS[profile].searchRounds);
    setRepeats(FIT_PRESETS[profile].repeats);
  };

  const resetEvidence = () => {
    setRows([]);
    setSummary(null);
    setNetworkSummary(null);
    setInterventions([]);
    setTopologyBenchmark([]);
    setVariantBreakdown([]);
    setWarnings([]);
    setAnimationUrl("");
    setOverview("");
    setFitAssessment([]);
    setChartGuide([]);
    setParameterNotes([]);
    setTakeaways([]);
  };

  const loadPreview = async (taskId = latestTaskId) => {
    if (!taskId) {
      message.info("请先运行一次仿真任务。");
      return;
    }
    setBusy(true);
    try {
      const detail = await api.getTask(taskId);
      const result = asObject(detail.result);
      const artifact = await fetchArtifactJson(taskId);
      const explanation = asObject(artifact?.explanation) || asObject(result?.explanation);
      const artifacts = asObject(result?.artifacts);
      setLatestTaskState(String(detail.state || ""));
      setSummary(asObject(artifact?.summary) || asObject(result?.summary));
      setNetworkSummary(asObject(artifact?.network_summary) || asObject(result?.network_summary));
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.map((item) => String(item)) : []);
      setAnimationUrl(typeof artifacts?.gif === "string" ? api.fileUrl(taskId, "propagation.gif") : "");
      setOverview(String(explanation?.overview || ""));
      setFitAssessment(Array.isArray(explanation?.fit_assessment) ? explanation.fit_assessment.map((item) => String(item)) : []);
      setTakeaways(Array.isArray(explanation?.takeaways) ? explanation.takeaways.map((item) => String(item)) : []);
      setChartGuide(
        Array.isArray(explanation?.chart_guide)
          ? explanation.chart_guide
              .filter((item) => !!item && typeof item === "object")
              .map((item) => ({
                key: String((item as Record<string, unknown>).key || ""),
                title: String((item as Record<string, unknown>).title || ""),
                explanation: String((item as Record<string, unknown>).explanation || ""),
              }))
          : []
      );
      setParameterNotes(
        Array.isArray(explanation?.parameter_notes)
          ? explanation.parameter_notes
              .filter((item) => !!item && typeof item === "object")
              .map((item) => ({
                name: String((item as Record<string, unknown>).name || ""),
                label: String((item as Record<string, unknown>).label || ""),
                display_value: String((item as Record<string, unknown>).display_value || ""),
                band: String((item as Record<string, unknown>).band || ""),
                role: String((item as Record<string, unknown>).role || ""),
                interpretation: String((item as Record<string, unknown>).interpretation || ""),
                implication: String((item as Record<string, unknown>).implication || ""),
              }))
          : []
      );
      setVariantBreakdown(
        Array.isArray(artifact?.variant_breakdown)
          ? (artifact.variant_breakdown as Array<Record<string, unknown>>)
          : Array.isArray(result?.variant_breakdown)
            ? (result.variant_breakdown as Array<Record<string, unknown>>)
            : []
      );
      setInterventions(
        (Array.isArray(artifact?.interventions)
          ? artifact.interventions
          : Array.isArray(result?.interventions)
            ? result.interventions
            : []
        ).map((item) => ({
          key: String((item as Record<string, unknown>).key || ""),
          label: String((item as Record<string, unknown>).label || ""),
          color: String((item as Record<string, unknown>).color || "#148758"),
          application_context: String((item as Record<string, unknown>).application_context || ""),
          start_year: Number((item as Record<string, unknown>).start_year ?? 0) || undefined,
          start_time: String((item as Record<string, unknown>).start_time || ""),
          final_error_reduction: Number((item as Record<string, unknown>).final_error_reduction ?? 0) || 0,
          final_error_share: Number((item as Record<string, unknown>).final_error_share ?? 0) || 0,
        }))
      );
      setTopologyBenchmark(
        (
          Array.isArray(artifact?.topology_benchmark)
            ? artifact.topology_benchmark
            : Array.isArray(result?.topology_benchmark)
              ? result.topology_benchmark
              : []
        ).map((item, index) => ({
          rank: Number((item as Record<string, unknown>).rank ?? index + 1) || index + 1,
          topology: String((item as Record<string, unknown>).topology || ""),
          score: Number((item as Record<string, unknown>).score ?? 0) || 0,
          right_r2: Number((item as Record<string, unknown>).right_r2 ?? 0) || 0,
          error_r2: Number((item as Record<string, unknown>).error_r2 ?? 0) || 0,
          share_r2: Number((item as Record<string, unknown>).share_r2 ?? 0) || 0,
          error_nrmse_peak: Number((item as Record<string, unknown>).error_nrmse_peak ?? 0) || 0,
          share_nrmse_peak: Number((item as Record<string, unknown>).share_nrmse_peak ?? 0) || 0,
          avg_degree: Number((item as Record<string, unknown>).avg_degree ?? 0) || 0,
          clustering: Number((item as Record<string, unknown>).clustering ?? 0) || 0,
          density: Number((item as Record<string, unknown>).density ?? 0) || 0,
        }))
      );
      setRows(
        (
          Array.isArray(artifact?.series_rows)
            ? artifact.series_rows
            : Array.isArray(result?.series_rows)
              ? result.series_rows
              : []
        ).map((row) => ({
          year: Number((row as Record<string, unknown>).year ?? 0) || 0,
          time_label: String((row as Record<string, unknown>).time_label || (row as Record<string, unknown>).label || ""),
          right_actual: Number((row as Record<string, unknown>).right_actual ?? 0) || 0,
          error_actual: Number((row as Record<string, unknown>).error_actual ?? 0) || 0,
          right_simulated: Number((row as Record<string, unknown>).right_simulated ?? 0) || 0,
          error_simulated: Number((row as Record<string, unknown>).error_simulated ?? 0) || 0,
          error_share_actual: Number((row as Record<string, unknown>).error_share_actual ?? 0) || 0,
          error_share_simulated: Number((row as Record<string, unknown>).error_share_simulated ?? 0) || 0,
          right_std: Number((row as Record<string, unknown>).right_std ?? 0) || 0,
          error_std: Number((row as Record<string, unknown>).error_std ?? 0) || 0,
          share_std: Number((row as Record<string, unknown>).share_std ?? 0) || 0,
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

  const run = async () => {
    if (turnstileEnabled && !turnstileToken) {
      message.warning("请先完成人机验证。");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.createSimulation(
        word,
        {
          startYear,
          endYear,
          smoothing,
          dataSource,
          variants,
          topology,
          nAgents,
          searchRounds,
          repeats,
          fitProfile,
          trendWindow,
          wsK,
          wsP,
          baM,
          randomSeed,
          interventionYear: interventionYear ?? undefined,
        },
        turnstileToken
      );
      setLatestTaskId(resp.task_id);
      setLatestTaskState("QUEUED");
      resetEvidence();
      message.success(`simulation-run queued: ${resp.task_id}`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
      setTurnstileNonce((v) => v + 1);
    }
  };

  return (
    <div className="algo-studio-shell">
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Card bordered={false} className="algo-hero-card">
          <div className="algo-hero-head">
            <div>
              <div className="algo-kicker">
                <BarChartOutlined />
                Simulation / Diffusion Lab
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                Group Spelling Diffusion Simulation
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                仿真模块会从 `canonical word + misspellings` 构造真实观测曲线，把多个错拼变体先汇总为一个非规范拼写簇，再做阶段化网络 ABM 拟合，输出静态仪表板、传播动图和解释层，方便展示“模型能否拟合”“非规范拼写簇如何传播”“为什么会这样传播”。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Topology</span>
                <div className="algo-hero-note-value" style={{ fontSize: 22 }}>{String(summary?.selected_topology ?? summary?.topology ?? topology)}</div>
                <div className="algo-hero-note-copy">
                  {String(summary?.topology_mode || "").toLowerCase() === "auto_select" ? "自动比较后选出的传播网络。" : "传播网络结构。"}
                </div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Fit Profile</span>
                <div className="algo-hero-note-value" style={{ fontSize: 22 }}>{String(summary?.fit_profile ?? fitProfile)}</div>
                <div className="algo-hero-note-copy">{FIT_PRESETS[fitProfile].note}</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Fit Grade</span>
                <div className="algo-hero-note-value" style={{ fontSize: 22 }}>{String(summary?.fit_grade ?? "--")}</div>
                <div className="algo-hero-note-copy">
                  {String(summary?.fit_regime_label || "").trim()
                    ? `${String(summary?.fit_regime_label)} 下的拟合分级。`
                    : "按拟合质量归档。"}
                </div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Signal Strength</span>
                <div className="algo-hero-note-value" style={{ fontSize: 20 }}>{String(summary?.signal_strength_grade ?? "--").toUpperCase()}</div>
                <div className="algo-hero-note-copy">{String(summary?.signal_strength_label ?? "Observed error signal strength.")}</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Best Score</div>
              <div className="algo-score-value">
                {typeof summary?.best_score === "number" ? Number(summary.best_score).toFixed(3) : "--"}
              </div>
              <div className="algo-score-copy">综合拟合代价，越低越好。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Fit Regime</div>
              <div className="algo-score-value">
                {String(summary?.fit_regime_label ?? "--")}
              </div>
              <div className="algo-score-copy">{String(summary?.fit_protocol ?? "当前拟合评价协议。")}</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Right R²</div>
              <div className="algo-score-value">
                {typeof summary?.right_r2 === "number" ? Number(summary.right_r2).toFixed(3) : "--"}
              </div>
              <div className="algo-score-copy">正确拼写主轨迹拟合优度。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Error NRMSE</div>
              <div className="algo-score-value">{formatMetricBadge(summary?.error_nrmse_peak, 3)}</div>
              <div className="algo-score-copy">按稀疏错拼口径归一化后的错误轨迹偏差。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Share NRMSE</div>
              <div className="algo-score-value">{formatMetricBadge(summary?.share_nrmse_peak, 3)}</div>
              <div className="algo-score-copy">按错误份额峰值归一化后的占比偏差。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Phase Break</div>
              <div className="algo-score-value">{String(summary?.phase_break_time ?? summary?.phase_break_label ?? summary?.phase_break_year ?? "--")}</div>
              <div className="algo-score-copy">传播机制切换点。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Peak Year Gap</div>
              <div className="algo-score-value">{String(summary?.error_peak_time_gap_days ?? summary?.error_peak_year_gap ?? "--")}</div>
              <div className="algo-score-copy">
                {typeof summary?.error_peak_time_gap_days === "number" ? "观测与仿真错误峰值时间差（天）。" : "观测与仿真错误峰值年份差。"}
              </div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Complexity</div>
              <div className="algo-score-value" style={{ fontSize: 18 }}>{String(summary?.parameter_count ?? "--")} params</div>
              <div className="algo-score-copy">{String(summary?.model_complexity ?? "模型复杂度摘要。")}</div>
            </div>
          </div>
          {String(summary?.fit_grade_reason || "").trim() ? (
            <Typography.Paragraph className="algo-origin-copy" style={{ marginTop: 12, marginBottom: 0 }}>
              {String(summary?.fit_grade_reason)}
            </Typography.Paragraph>
          ) : null}
          {String(summary?.signal_strength_reason || "").trim() ? (
            <Typography.Paragraph className="algo-origin-copy" style={{ marginTop: 8, marginBottom: 0 }}>
              {String(summary?.signal_strength_reason)}
            </Typography.Paragraph>
          ) : null}
          {String(summary?.variant_scope_reason || "").trim() ? (
            <Typography.Paragraph className="algo-origin-copy" style={{ marginTop: 8, marginBottom: 0 }}>
              {String(summary?.variant_scope_label || "Variant Scope")}:
              {" "}
              {String(summary?.variant_scope_reason)}
            </Typography.Paragraph>
          ) : null}
        </Card>

        <Row gutter={[18, 18]}>
          <Col xs={24} xl={15}>
            <Card
              className="algo-section-card"
              title={
                <div className="algo-section-title">
                  <NotificationOutlined />
                  <div className="algo-section-title-copy">
                    <strong>Simulation Console</strong>
                    <span>词项输入、精度档位、网络结构和随机性控制。</span>
                  </div>
                </div>
              }
            >
              <AlgorithmTermBuilder
                word={word}
                variants={variants}
                dataSource={dataSource}
                startYear={startYear}
                endYear={endYear}
                smoothing={smoothing}
                onWordChange={setWord}
                onVariantsChange={setVariants}
                onDataSourceChange={(value) => {
                  setDataSource(value);
                  if (value === "gdelt") {
                    setStartYear((current) => Math.max(current, 2015));
                    setEndYear((current) => Math.min(Math.max(current, 2015), new Date().getFullYear()));
                  }
                }}
              />

              <div className="algo-parameter-grid" style={{ marginTop: 18 }}>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Start Year</span>
                  <InputNumber min={1500} max={2026} value={startYear} onChange={(v) => setStartYear(v ?? 1900)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">End Year</span>
                  <InputNumber min={1500} max={2026} value={endYear} onChange={(v) => setEndYear(v ?? 2019)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">GBNC Smoothing</span>
                  <InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v ?? 3)} style={{ width: "100%" }} disabled={dataSource === "gdelt"} />
                </div>
                <div className="algo-field algo-span-3">
                  <span className="algo-field-label">Topology</span>
                  <Select
                    value={topology}
                    onChange={setTopology}
                    options={[
                      { value: "auto", label: "Auto Compare" },
                      { value: "watts_strogatz", label: "Watts-Strogatz" },
                      { value: "newman_watts", label: "Newman-Watts" },
                      { value: "barabasi_albert", label: "Barabasi-Albert" },
                      { value: "dual_barabasi_albert", label: "Dual Barabasi-Albert" },
                      { value: "grid", label: "Grid" },
                    ]}
                  />
                </div>
                <div className="algo-field algo-span-3">
                  <span className="algo-field-label">Fit Profile</span>
                  <Select
                    value={fitProfile}
                    onChange={(value) => applyPreset(value as "explore" | "research" | "publication")}
                    options={[
                      { value: "explore", label: "Explore / Fast" },
                      { value: "research", label: "Research / Default" },
                      { value: "publication", label: "Publication / Deep" },
                    ]}
                  />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Agents</span>
                  <InputNumber min={40} max={6000} value={nAgents} onChange={(v) => setNAgents(v ?? 1200)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Search Rounds</span>
                  <InputNumber min={8} max={800} value={searchRounds} onChange={(v) => setSearchRounds(v ?? 96)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Repeats</span>
                  <InputNumber min={1} max={20} value={repeats} onChange={(v) => setRepeats(v ?? 6)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Trend Window</span>
                  <InputNumber min={1} max={15} value={trendWindow} onChange={(v) => setTrendWindow(v ?? 3)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">WS k</span>
                  <InputNumber min={2} max={40} value={wsK} onChange={(v) => setWsK(v ?? 8)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">WS p</span>
                  <InputNumber min={0} max={1} step={0.01} value={wsP} onChange={(v) => setWsP(v ?? 0.08)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">BA m</span>
                  <InputNumber min={1} max={20} value={baM} onChange={(v) => setBaM(v ?? 4)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Random Seed</span>
                  <InputNumber min={1} max={999999} value={randomSeed} onChange={(v) => setRandomSeed(v ?? 42)} style={{ width: "100%" }} />
                </div>
                <div className="algo-field algo-span-2">
                  <span className="algo-field-label">Intervention Year</span>
                  <InputNumber
                    min={1500}
                    max={2026}
                    value={interventionYear}
                    onChange={(v) => setInterventionYear(v ?? null)}
                    placeholder="phase break"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div className="algo-console-actions">
                <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={() => void run()} disabled={turnstileEnabled && !turnstileToken}>
                  Run Simulation
                </Button>
                <Button loading={busy} onClick={() => void loadPreview()}>
                  Refresh Current Preview
                </Button>
                <Button icon={<LinkOutlined />} onClick={() => latestTaskId && goToTask(latestTaskId)} disabled={!latestTaskId}>
                  Open Task Detail
                </Button>
                <Tag color={taskStateTone(latestTaskState)}>{latestTaskState || "IDLE"}</Tag>
                {latestTaskId ? <span className="algo-latest-tag">Task {latestTaskId}</span> : null}
              </div>

              <div style={{ marginTop: 16 }}>
                <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
              </div>

              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                {FIT_PRESETS[fitProfile].note}
              </Typography.Paragraph>

              {warnings.length > 0 ? (
                <Space wrap style={{ marginTop: 14 }}>
                  {warnings.map((warning) => (
                    <Tag key={warning} color="warning">
                      {warning}
                    </Tag>
                  ))}
                </Space>
              ) : null}
              {warnings.includes("simulation_missing_error_variants") ? (
                <Card size="small" style={{ marginTop: 16, borderColor: "#f59e0b" }}>
                  当前没有纳入可用的错误变体，`error_actual / error_simulated` 会接近 0。
                  这通常不是仿真器坏了，而是该词当前选入的错拼集合为空，或已被非法词过滤器剔除。
                </Card>
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
                    <strong>Model Protocol</strong>
                    <span>高精度拟合、传播动图和参数解释。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-insight-list">
                <div className="algo-insight-card">
                  <div className="algo-insight-label">1. Aggregate Build</div>
                  <div className="algo-insight-copy">默认先识别并剔除强竞争正字法变体，再从正确拼写与错拼簇构造 `right / error / error_share / salience` 四条核心曲线。</div>
                </div>
                <div className="algo-insight-card">
                  <div className="algo-insight-label">2. Phase Detection</div>
                  <div className="algo-insight-copy">从 error share 趋势中自动识别传播机制切换点，再进入阶段化传播建模。</div>
                </div>
                <div className="algo-insight-card">
                  <div className="algo-insight-label">3. Deep Fit</div>
                  <div className="algo-insight-copy">根据精度档位提升参数粗筛、精评和局部精修的深度，在可接受时间内尽量提高拟合质量。</div>
                </div>
                <div className="algo-insight-card">
                  <div className="algo-insight-label">4. Propagation Film</div>
                  <div className="algo-insight-copy">输出节点传播动图，把局部扩散、宏观曲线和时间推进放在统一视图里展示。</div>
                </div>
                <div className="algo-insight-card">
                  <div className="algo-insight-label">5. LLM Interpretation</div>
                  <div className="algo-insight-copy">调用 Qwen 对参数、曲线和干预结果做解释，生成可答辩的自然语言说明。</div>
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
                    <span>展示拟合图、传播动图、曲线阅读说明和参数解释。</span>
                  </div>
                </div>
              }
            >
              <div className="algo-media-grid algo-media-stack">
                <div className="algo-media-card">
                  <div className="algo-preview-frame">
                    {previewUrl ? (
                      <img src={previewUrl} alt="simulation-preview" />
                    ) : (
                      <div className="algo-preview-empty">
                        <Empty description="运行仿真后，这里会出现拟合与干预仪表板。" />
                      </div>
                    )}
                  </div>
                  <div className="algo-media-tools">
                    <div className="algo-preview-caption">静态仪表板用于看拟合质量、phase break 和干预收益。</div>
                    {previewUrl ? (
                      <Button size="small" href={previewUrl} target="_blank" rel="noreferrer">
                        Open Full Size
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="algo-media-card">
                  <div className="algo-preview-frame algo-preview-secondary">
                    {animationUrl ? (
                      <img src={animationUrl} alt="simulation-propagation" />
                    ) : (
                      <div className="algo-preview-empty">
                        <Empty description="运行成功后，这里会生成传播动图。" />
                      </div>
                    )}
                  </div>
                  <div className="algo-media-tools">
                    <div className="algo-preview-caption">传播动图把节点状态、宏观曲线和时间推进联动展示，更适合答辩时解释传播过程。</div>
                    {animationUrl ? (
                      <Button size="small" href={animationUrl} target="_blank" rel="noreferrer">
                        Open Full Size
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="algo-preview-grid" style={{ marginTop: 18 }}>
                <div className="algo-insight-list">
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Phase Break</div>
                    <div className="algo-insight-value">{String(summary?.phase_break_time ?? summary?.phase_break_label ?? summary?.phase_break_year ?? "--")}</div>
                    <div className="algo-insight-copy">传播机制从扩散形成期切换到稳定竞争期的时间点。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Variant Scope</div>
                    <div className="algo-insight-value" style={{ fontSize: 18 }}>{String(summary?.variant_scope_label ?? "--")}</div>
                    <div className="algo-insight-copy">{String(summary?.variant_scope_reason ?? "当前变体聚合口径。")}</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Filtered Variants</div>
                    <div className="algo-insight-value">{String(summary?.excluded_variant_count ?? "--")}</div>
                    <div className="algo-insight-copy">
                      {Array.isArray(summary?.excluded_variants) && (summary?.excluded_variants as unknown[]).length > 0
                        ? (summary?.excluded_variants as unknown[]).map((item) => String(item)).join(", ")
                        : "当前没有被剔除的强竞争变体。"}
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Fit Profile</div>
                    <div className="algo-insight-value">{String(summary?.fit_profile ?? fitProfile)}</div>
                    <div className="algo-insight-copy">决定参数搜索、精评和局部精修的深度。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Data Source</div>
                    <div className="algo-insight-value">{String(summary?.source ?? dataSource).toUpperCase()}</div>
                    <div className="algo-insight-copy">当前观测曲线来自所选数据集；GBNC 偏历史词频，GDELT 偏新闻曝光。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Selected Topology</div>
                    <div className="algo-insight-value">{String(summary?.selected_topology ?? summary?.topology ?? "--")}</div>
                    <div className="algo-insight-copy">
                      {String(summary?.topology_mode || "").toLowerCase() === "auto_select"
                        ? `自动筛选，原始请求为 ${String(summary?.requested_topology ?? topology)}。`
                        : "手动指定的网络拓扑。"}
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Avg Degree</div>
                    <div className="algo-insight-value">
                      {typeof networkSummary?.avg_degree === "number" ? Number(networkSummary.avg_degree).toFixed(2) : "--"}
                    </div>
                    <div className="algo-insight-copy">当前网络平均连接度，越高表示传播接触面越大。</div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Best Intervention</div>
                    <div className="algo-insight-value" style={{ fontSize: 18 }}>{String(summary?.best_scenario ?? "--")}</div>
                    <div className="algo-insight-copy">
                      {typeof summary?.best_scenario_gain === "number"
                        ? `最终错误量减少 ${Number(summary.best_scenario_gain).toExponential(2)}。`
                        : "运行后会显示干预收益最大的纠偏策略。"}
                    </div>
                  </div>
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">ABM Share Scale</div>
                    <div className="algo-insight-value">
                      {typeof summary?.error_share_amplification === "number"
                        ? `×${Number(summary.error_share_amplification).toFixed(1)}`
                        : "--"}
                    </div>
                    <div className="algo-insight-copy">
                      {typeof summary?.error_share_amplification === "number" && Number(summary.error_share_amplification) <= 1.0001
                        ? "当前直接在真实 error share 尺度上拟合，没有额外缩放。"
                        : "如果词项极度稀疏，这里会显示额外的 error share 校正倍数。"}
                    </div>
                  </div>
                </div>

                <div className="algo-insight-list">
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">How To Read This Result</div>
                    <div className="algo-insight-copy">
                      {overview || "运行成功后，这里会给出对整组曲线和传播过程的总解释。"}
                    </div>
                  </div>
                  {chartGuide.slice(0, 4).map((item) => (
                    <div className="algo-insight-card" key={item.key || item.title}>
                      <div className="algo-insight-label">{item.title}</div>
                      <div className="algo-insight-copy">{item.explanation}</div>
                    </div>
                  ))}
                  <div className="algo-insight-card">
                    <div className="algo-insight-label">Variant Pool</div>
                    <div className="algo-insight-copy">
                      {variantBreakdown.length > 0
                        ? variantBreakdown
                            .slice(0, 3)
                            .map((item) => `${String(item.variant || "")} @ ${String(item.peak_time || item.peak_year || "--")}`)
                            .join(" / ")
                        : "当前还没有可展示的错拼变体分布。"}
                    </div>
                  </div>
                </div>
              </div>

              {interventions.length > 0 ? (
                <div className="algo-score-grid" style={{ marginTop: 18 }}>
                  {interventions.slice(0, 3).map((item) => (
                    <div className="algo-score-card" key={item.key} style={{ borderTop: `3px solid ${item.color}` }}>
                      <div className="algo-score-label">{item.label}</div>
                      <div className="algo-score-value">
                        {typeof item.final_error_reduction === "number" ? item.final_error_reduction.toExponential(2) : "--"}
                      </div>
                      <div className="algo-score-copy">
                        {item.start_time ? `从 ${item.start_time} 开始介入；` : typeof item.start_year === "number" ? `从 ${item.start_year} 开始介入；` : ""}
                        {item.application_context ? `${item.application_context}；` : ""}
                        最终错误量净减少值。
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {topologyBenchmark.length > 0 ? (
                <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0, marginTop: 18 }}>
                  <Table
                    rowKey={(row) => `${row.topology}-${row.rank}`}
                    dataSource={topologyBenchmark}
                    pagination={false}
                    columns={[
                      { title: "Rank", dataIndex: "rank", width: 70 },
                      { title: "Topology", dataIndex: "topology", width: 160 },
                      { title: "Score", dataIndex: "score", render: (value: number) => value.toFixed(3) },
                      { title: "Right R²", dataIndex: "right_r2", render: (value: number) => value.toFixed(3) },
                      { title: "Error NRMSE", dataIndex: "error_nrmse_peak", render: (value: number) => formatMetricBadge(value, 3) },
                      { title: "Share NRMSE", dataIndex: "share_nrmse_peak", render: (value: number) => formatMetricBadge(value, 3) },
                      { title: "Clustering", dataIndex: "clustering", render: (value: number) => value.toFixed(3) },
                    ]}
                  />
                </Card>
              ) : null}

              {fitAssessment.length > 0 ? (
                <div className="algo-score-grid" style={{ marginTop: 18 }}>
                  {fitAssessment.map((item, index) => (
                    <div className="algo-score-card" key={`${index}-${item.slice(0, 16)}`}>
                      <div className="algo-score-label">Fit Note {index + 1}</div>
                      <div className="algo-score-copy" style={{ marginTop: 10 }}>{item}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {takeaways.length > 0 ? (
                <div className="algo-score-grid" style={{ marginTop: 18 }}>
                  {takeaways.map((item, index) => (
                    <div className="algo-score-card" key={`${index}-${item.slice(0, 16)}`}>
                      <div className="algo-score-label">Interpretation {index + 1}</div>
                      <div className="algo-score-copy" style={{ marginTop: 10 }}>{item}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {parameterNotes.length > 0 ? (
                <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0, marginTop: 18 }}>
                  <Table
                    rowKey={(row) => row.name}
                    dataSource={parameterNotes}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: "Parameter", dataIndex: "label", width: 180 },
                      { title: "Value", dataIndex: "display_value", width: 100 },
                      { title: "Band", dataIndex: "band", width: 90, render: (value: string) => String(value || "").toUpperCase() },
                      { title: "Role", dataIndex: "role" },
                      { title: "Interpretation", dataIndex: "interpretation" },
                    ]}
                  />
                </Card>
              ) : null}

              <Card className="algo-table-card" bordered={false} bodyStyle={{ padding: 0, marginTop: 18 }}>
                <Table
                  rowKey={(row) => String(row.time_label || row.year)}
                  dataSource={rows}
                  pagination={{ pageSize: 8 }}
                  columns={[
                    { title: "Time", dataIndex: "time_label", width: 130, render: (value: string, row: SimulationRow) => value || String(row.year) },
                    { title: "Index", dataIndex: "year", width: 92 },
                    { title: "Observed Correct", dataIndex: "right_actual", render: (value: number) => formatFrequency(value, 6) },
                    { title: "Observed Error", dataIndex: "error_actual", render: (value: number) => formatFrequency(value, 6) },
                    { title: "Simulated Correct", dataIndex: "right_simulated", render: (value: number) => formatFrequency(value, 6) },
                    { title: "Simulated Error", dataIndex: "error_simulated", render: (value: number) => formatFrequency(value, 6) },
                    { title: "Observed Share", dataIndex: "error_share_actual", render: (value: number) => formatFrequency(value, 4) },
                    { title: "Simulated Share", dataIndex: "error_share_simulated", render: (value: number) => formatFrequency(value, 4) },
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
