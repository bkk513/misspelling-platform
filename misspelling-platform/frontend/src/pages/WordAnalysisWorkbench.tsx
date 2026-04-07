import { PlusOutlined, ThunderboltOutlined, HistoryOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
  message,
  Tooltip
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { api, describeApiError, type DataSourceKey } from "../lib/api";
import "./algorithmStudio.css";

type SuggestedVariant = {
  value: string;
  source: "llm" | "cache" | "heuristic" | "dictionary" | "manual";
  selected: boolean;
  cacheId?: number;
};

function mergeVariants(existing: SuggestedVariant[], values: string[], source: SuggestedVariant["source"]) {
  const byValue = new Map(existing.map((v) => [v.value.toLowerCase(), v]));
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!byValue.has(key)) {
      byValue.set(key, { value: cleaned, source, selected: true });
    }
  }
  return Array.from(byValue.values());
}

function rejectedSummary(items: Array<{ variant: string }> | undefined, limit = 6) {
  const values = (items || []).map((item) => String(item.variant || "").trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) return "";
  return values.slice(0, limit).join(", ");
}

interface ParameterTemplate {
  name: string;
  description: string;
  icon?: string;
  params: {
    startYear: number;
    endYear: number;
    smoothing: number;
    corpus: string;
  };
}

const templates: ParameterTemplate[] = [
  {
    name: "Quick Analysis",
    description: "Fast analysis with default settings (1800-2019, smoothing=3)",
    icon: "⚡",
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: "eng_2019" }
  },
  {
    name: "High Precision",
    description: "Detailed analysis with minimal smoothing (1800-2019, smoothing=0)",
    icon: "🎯",
    params: { startYear: 1800, endYear: 2019, smoothing: 0, corpus: "eng_2019" }
  },
  {
    name: "Recent Trends",
    description: "Focus on modern usage (2000-2019, smoothing=2)",
    icon: "📈",
    params: { startYear: 2000, endYear: 2019, smoothing: 2, corpus: "eng_2019" }
  },
  {
    name: "Historical Deep Dive",
    description: "Long-term historical analysis (1500-2019, smoothing=5)",
    icon: "📚",
    params: { startYear: 1500, endYear: 2019, smoothing: 5, corpus: "eng_2019" }
  },
  {
    name: "US English Focus",
    description: "US English corpus with standard settings (1800-2019)",
    icon: "🇺🇸",
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: "eng_us_2019" }
  }
];

export function WordAnalysisWorkbenchPage() {
  const [word, setWord] = useState("demo");
  const [dataSource, setDataSource] = useState<DataSourceKey>("gbnc");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [corpus, setCorpus] = useState("eng_2019");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [gbncInfo, setGbncInfo] = useState("");
  const [variants, setVariants] = useState<SuggestedVariant[]>([]);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;

  useEffect(() => {
    void api
      .me()
      .then(() => setCacheEnabled(true))
      .catch(() => setCacheEnabled(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadCache = async (targetWord = word) => {
    if (!cacheEnabled) {
      setVariants([]);
      return;
    }
    setBusy(true);
    try {
      const resp = await api.listVariantCache(targetWord, 200);
      const next = (resp.items || []).map((row) => ({
        value: row.variant,
        source: (row.source || "cache") as SuggestedVariant["source"],
        selected: true,
        cacheId: row.id
      }));
      setVariants(next);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    void loadCache(word);

    const lastParams = localStorage.getItem("word-analysis-last-params");
    if (lastParams) {
      try {
        const parsed = JSON.parse(lastParams);
        if (parsed.word === word) {
          setStartYear(parsed.startYear ?? 1900);
          setEndYear(parsed.endYear ?? 2019);
          setSmoothing(parsed.smoothing ?? 3);
          setCorpus(parsed.corpus || "eng_2019");
          setDataSource((parsed.dataSource || "gbnc") as DataSourceKey);
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [word, cacheEnabled, authChecked]);

  const selected = useMemo(() => variants.filter((v) => v.selected).map((v) => v.value), [variants]);

  const loadTemplate = (template: ParameterTemplate) => {
    setStartYear(template.params.startYear);
    setEndYear(template.params.endYear);
    setSmoothing(template.params.smoothing);
    setCorpus(template.params.corpus);
    message.success(`Loaded template: ${template.name}`);
  };

  const saveCurrentParams = () => {
    const params = {
      word,
      dataSource,
      startYear,
      endYear,
      smoothing,
      corpus,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem("word-analysis-last-params", JSON.stringify(params));
  };

  const suggest = async () => {
    if (!word.trim()) {
      message.warning("Please input word first.");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.suggestVariants(word, 20);
      if (cacheEnabled) {
        await loadCache(word);
      } else {
        const merged = mergeVariants(variants, resp.variants || [], (resp.source || "cache") as SuggestedVariant["source"]);
        setVariants(merged);
      }
      const rejected = rejectedSummary(resp.rejected_variants);
      if (rejected) {
        message.info(`Filtered lexical words: ${rejected}`);
      }
      message.success(`Loaded ${resp.variants?.length || 0} variants from ${resp.source || "cache"}.`);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (turnstileEnabled && !turnstileToken) {
      message.warning("Please complete Turnstile verification first.");
      return;
    }
    saveCurrentParams();
    setBusy(true);
    try {
      const resp = await api.createWordAnalysis(
        word,
        {
          startYear,
          endYear,
          smoothing,
          corpus,
          dataSource,
          variants: selected
        },
        turnstileToken
      );
      message.success(`Task queued: ${resp.task_id}`);
      goToTask(resp.task_id);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
      setTurnstileNonce((v) => v + 1);
    }
  };

  const gbncPull = async () => {
    if (!word.trim()) {
      message.warning("Please input word first.");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.pullGbnc(word, {
        startYear,
        endYear,
        smoothing,
        corpus,
        dataSource,
        variants: selected
      });
      const warn = (resp.warnings || []).join(", ");
      setGbncInfo(
        `source=${resp.source} cache_hit=${resp.cache_hit} points=${resp.point_count || 0}` +
          `${resp.error_reason ? ` error=${resp.error_reason}` : ""}` +
          `${warn ? ` warnings=${warn}` : ""}`
      );
      if (resp.source === "STUB") {
        message.warning(`${String(dataSource).toUpperCase()} pull degraded to STUB source.`);
      } else {
        message.success(`${String(dataSource).toUpperCase()} pull completed.`);
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const text = manual.trim();
    if (!text) return;

    if (cacheEnabled) {
      setBusy(true);
      try {
        const resp = await api.saveVariantCache(word, [text], "manual");
        await loadCache(word);
        const rejected = rejectedSummary(resp.rejected_variants);
        if (resp.saved > 0) {
          message.success("Variant saved to your cache.");
        } else if (rejected) {
          message.warning(`Rejected lexical word: ${rejected}`);
        }
      } catch (e) {
        message.error(describeApiError(e));
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      try {
        const review = await api.reviewVariants(word, [text]);
        const accepted = review.accepted_variants || review.variants || [];
        const rejected = rejectedSummary(review.rejected_variants);
        if (accepted.length > 0) {
          const merged = mergeVariants(variants, accepted, "manual");
          setVariants(merged);
          if (rejected) {
            message.warning(`Rejected lexical word: ${rejected}`);
          }
        } else if (rejected) {
          message.warning(`Rejected lexical word: ${rejected}`);
        }
      } catch (e) {
        message.error(describeApiError(e));
      } finally {
        setBusy(false);
      }
    }

    setManual("");
  };

  const toggle = (value: string, checked: boolean) => {
    setVariants((prev) => prev.map((v) => (v.value === value ? { ...v, selected: checked } : v)));
  };

  const remove = async (row: SuggestedVariant) => {
    if (cacheEnabled) {
      setBusy(true);
      try {
        await api.deleteVariantCache({ ids: row.cacheId ? [row.cacheId] : [], word, variants: [row.value] });
        await loadCache(word);
      } catch (e) {
        message.error(describeApiError(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setVariants((prev) => prev.filter((v) => v.value !== row.value));
  };

  return (
    <div className="algo-studio-shell">
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        {!cacheEnabled && authChecked && (
          <Alert
            type="info"
            showIcon
            message="Guest mode"
            description="Guest 不保存变体缓存；登录用户会将变体写入个人缓存。"
          />
        )}

        <Card bordered={false} className="algo-hero-card">
          <div className="algo-hero-head">
            <div>
              <div className="algo-kicker">
                <ThunderboltOutlined />
                Research Entry / Word Analysis
              </div>
              <Typography.Title level={2} className="algo-hero-title">
                Word Analysis Workbench
              </Typography.Title>
              <Typography.Paragraph className="algo-hero-desc">
                这个入口页现在沿用算法模块的展示语言。你在这里完成单词录入、参数模板加载、变体推荐、个人 cache 复用和数据预拉取，然后再提交真正的分析任务。
              </Typography.Paragraph>
            </div>
            <div className="algo-hero-side">
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Selected Variants</span>
                <div className="algo-hero-note-value">{selected.length}</div>
                <div className="algo-hero-note-copy">当前会进入分析任务的错拼数量。</div>
              </div>
              <div className="algo-hero-note">
                <span className="algo-hero-note-label">Cache Mode</span>
                <div className="algo-hero-note-value" style={{ fontSize: 22 }}>{cacheEnabled ? "PRIVATE" : "GUEST"}</div>
                <div className="algo-hero-note-copy">{cacheEnabled ? "推荐结果可落到个人 cache。" : "Guest 仅保留当前会话内结果。"}</div>
              </div>
            </div>
          </div>

          <div className="algo-score-grid">
            <div className="algo-score-card">
              <div className="algo-score-label">Word</div>
              <div className="algo-score-value" style={{ fontSize: 24 }}>{word.trim() || "--"}</div>
              <div className="algo-score-copy">分析的 canonical word。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Range</div>
              <div className="algo-score-value" style={{ fontSize: 24 }}>{startYear}-{endYear}</div>
              <div className="algo-score-copy">时序采样的分析时间范围。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Data Source</div>
              <div className="algo-score-value">{String(dataSource).toUpperCase()}</div>
              <div className="algo-score-copy">GBNC 适合历史词频，GDELT 适合近年新闻曝光。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Smoothing</div>
              <div className="algo-score-value">{smoothing}</div>
              <div className="algo-score-copy">仅在 GBNC 模式下生效。</div>
            </div>
            <div className="algo-score-card">
              <div className="algo-score-label">Corpus</div>
              <div className="algo-score-value" style={{ fontSize: 22 }}>{corpus}</div>
              <div className="algo-score-copy">当前选中的语料配置。</div>
            </div>
          </div>
        </Card>

        <Card
          className="algo-section-card"
          title={
            <div className="algo-section-title">
              <ThunderboltOutlined />
              <div className="algo-section-title-copy">
                <strong>Analysis Console</strong>
                <span>设置参数模板、输入词项、预拉取语料并发起任务。</span>
              </div>
            </div>
          }
        >
          <div className="algo-origin-note" style={{ marginBottom: 16 }}>
            <div className="algo-origin-head">
              <Typography.Text strong>Parameter Templates</Typography.Text>
              <Tooltip title="Load last used parameters for this word">
                <Button
                  size="small"
                  icon={<HistoryOutlined />}
                  onClick={() => {
                    const lastParams = localStorage.getItem("word-analysis-last-params");
                    if (lastParams) {
                      try {
                        const parsed = JSON.parse(lastParams);
                        if (parsed.word === word) {
                          setStartYear(parsed.startYear);
                          setEndYear(parsed.endYear);
                          setSmoothing(parsed.smoothing);
                          setCorpus(parsed.corpus);
                          setDataSource((parsed.dataSource || "gbnc") as DataSourceKey);
                          message.success("Loaded last used parameters");
                        } else {
                          message.info("No saved parameters for this word");
                        }
                      } catch {
                        message.error("Failed to load saved parameters");
                      }
                    } else {
                      message.info("No saved parameters found");
                    }
                  }}
                >
                  Load Last Used
                </Button>
              </Tooltip>
            </div>
            <Space wrap style={{ marginTop: 12 }}>
              {templates.map((template) => (
                <Tooltip key={template.name} title={template.description}>
                  <Button size="small" onClick={() => loadTemplate(template)} icon={template.icon ? <span>{template.icon}</span> : undefined}>
                    {template.name}
                  </Button>
                </Tooltip>
              ))}
            </Space>
          </div>

          <div className="algo-parameter-grid">
            <div className="algo-field algo-span-5">
              <span className="algo-field-label">Word</span>
              <Input value={word} onChange={(e) => setWord(e.target.value)} status={!word.trim() ? "error" : undefined} />
            </div>
            <div className="algo-field algo-span-2">
              <span className="algo-field-label">Data Source</span>
              <Select
                value={dataSource}
                onChange={(value) => {
                  const next = value as DataSourceKey;
                  setDataSource(next);
                  if (next === "gdelt") {
                    setStartYear((current) => Math.max(current, 2015));
                    setEndYear((current) => Math.min(Math.max(current, 2015), new Date().getFullYear()));
                  }
                }}
                options={[
                  { value: "gbnc", label: "GBNC" },
                  { value: "gdelt", label: "GDELT" },
                ]}
                style={{ width: "100%" }}
              />
            </div>
            <div className="algo-field algo-span-2">
              <span className="algo-field-label">Start Year</span>
              <InputNumber
                min={1500}
                max={2026}
                value={startYear}
                onChange={(v) => setStartYear(v ?? 1900)}
                style={{ width: "100%" }}
                status={startYear >= endYear ? "error" : undefined}
              />
            </div>
            <div className="algo-field algo-span-2">
              <span className="algo-field-label">End Year</span>
              <InputNumber
                min={1500}
                max={2026}
                value={endYear}
                onChange={(v) => setEndYear(v ?? 2019)}
                style={{ width: "100%" }}
                status={startYear >= endYear ? "error" : undefined}
              />
            </div>
            <div className="algo-field algo-span-1">
              <span className="algo-field-label">Smoothing</span>
              <InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v ?? 3)} style={{ width: "100%" }} disabled={dataSource === "gdelt"} />
            </div>
            <div className="algo-field algo-span-2">
              <span className="algo-field-label">Corpus</span>
              <Select
                value={corpus}
                onChange={setCorpus}
                options={[
                  { value: "eng_2019", label: "eng_2019" },
                  { value: "eng_us_2019", label: "eng_us_2019" },
                ]}
                style={{ width: "100%" }}
                disabled={dataSource === "gdelt"}
              />
            </div>
          </div>

          <div className="algo-console-actions">
            <Button loading={busy} onClick={() => void suggest()}>
              Suggest Variants
            </Button>
            <Button loading={busy} onClick={() => void gbncPull()}>
              Pull {String(dataSource).toUpperCase()} Preview
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={() => void run()}
              disabled={(turnstileEnabled && !turnstileToken) || !word.trim() || startYear >= endYear || selected.length === 0}
            >
              Run Word Analysis
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
          </div>
          <Typography.Paragraph className="algo-origin-copy" style={{ marginTop: 12 }}>
            预拉取会先请求当前数据源的时序数据，返回数据来源、命中状态、点数与降级告警，便于运行前确认数据链路。
          </Typography.Paragraph>
          {gbncInfo && <Alert style={{ marginTop: 12 }} type="info" showIcon message={gbncInfo} />}
        </Card>

        <Card
          className="algo-section-card"
          title={
            <div className="algo-section-title">
              <PlusOutlined />
              <div className="algo-section-title-copy">
                <strong>Variant Registry</strong>
                <span>从推荐、cache 与手工输入中维护当前分析的错拼集合。</span>
              </div>
            </div>
          }
        >
          <Space.Compact style={{ width: "100%", marginBottom: 14 }}>
            <Input value={manual} onChange={(e) => setManual(e.target.value)} onPressEnter={() => void addManual()} placeholder="add manual variant" />
            <Button icon={<PlusOutlined />} onClick={() => void addManual()} loading={busy}>
              Add
            </Button>
          </Space.Compact>

          <div className="algo-token-box">
            {variants.map((variant) => (
              <Tag
                key={`${variant.value}:${variant.cacheId || "local"}`}
                closable
                color={variant.selected ? "blue" : "default"}
                onClose={(e) => {
                  e.preventDefault();
                  void remove(variant);
                }}
              >
                <Checkbox checked={variant.selected} onChange={(ev) => toggle(variant.value, ev.target.checked)} style={{ marginRight: 6 }} />
                {variant.value} ({variant.source})
              </Tag>
            ))}
            {variants.length === 0 && <Typography.Text type="secondary">No variants selected.</Typography.Text>}
          </div>
        </Card>
      </Space>
    </div>
  );
}
