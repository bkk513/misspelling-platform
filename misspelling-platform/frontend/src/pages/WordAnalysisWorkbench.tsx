/* 文件说明：词分析工作台页面，负责配置词项、拉取词频并发起各类算法任务。 */

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
import { api, describeApiError } from "../lib/api";
import "./algorithmStudio.css";

type SuggestedVariant = {
  value: string;
  source: "llm" | "cache" | "heuristic" | "dictionary" | "manual";
  selected: boolean;
  cacheId?: number;
};

function heuristicSuggest(word: string) {
  const base = word.trim().toLowerCase();
  if (!base) return [];
  return [`${base}-ai`, `${base}e`, `${base}${base.slice(-1) || "x"}`, base.replace(/e/g, "") || `${base}x`];
}

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
    name: "快速分析",
    description: "默认参数快速运行（1800-2019, smoothing=3）",
    icon: "⚡",
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: "eng_2019" }
  },
  {
    name: "高精度",
    description: "低平滑细粒度分析（1800-2019, smoothing=0）",
    icon: "🎯",
    params: { startYear: 1800, endYear: 2019, smoothing: 0, corpus: "eng_2019" }
  },
  {
    name: "近年趋势",
    description: "聚焦近年变化（2000-2019, smoothing=2）",
    icon: "📈",
    params: { startYear: 2000, endYear: 2019, smoothing: 2, corpus: "eng_2019" }
  },
  {
    name: "历史深挖",
    description: "长时间范围分析（1500-2019, smoothing=5）",
    icon: "📚",
    params: { startYear: 1500, endYear: 2019, smoothing: 5, corpus: "eng_2019" }
  },
  {
    name: "美式英语",
    description: "使用 eng_us_2019 语料",
    icon: "🇺🇸",
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: "eng_us_2019" }
  }
];

export function WordAnalysisWorkbenchPage() {
  const [word, setWord] = useState("demo");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [corpus, setCorpus] = useState("eng_2019");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
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
          setStartYear(parsed.startYear || 1900);
          setEndYear(parsed.endYear || 2019);
          setSmoothing(parsed.smoothing || 3);
          setCorpus(parsed.corpus || "eng_2019");
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
      message.success(`Loaded ${resp.variants?.length || 0} variants from ${resp.source || "cache"}.`);
    } catch {
      const merged = mergeVariants(variants, heuristicSuggest(word), "heuristic");
      setVariants(merged);
      message.info("Suggest API unavailable, switched to local heuristic variants.");
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

  const addManual = async () => {
    const text = manual.trim();
    if (!text) return;

    if (cacheEnabled) {
      setBusy(true);
      try {
        await api.saveVariantCache(word, [text], "manual");
        await loadCache(word);
        message.success("Variant saved to your cache.");
      } catch (e) {
        message.error(describeApiError(e));
      } finally {
        setBusy(false);
      }
    } else {
      const merged = mergeVariants(variants, [text], "manual");
      setVariants(merged);
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
            message="访客模式"
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
                这个入口页现在沿用算法模块的展示语言。你在这里完成单词录入、参数模板加载、变体推荐、个人 cache 复用和 GBNC 数据预拉取，然后再提交真正的分析任务。
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
              <div className="algo-score-label">Smoothing</div>
              <div className="algo-score-value">{smoothing}</div>
              <div className="algo-score-copy">GBNC 查询时的平滑参数。</div>
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
              <Typography.Text strong>参数模板</Typography.Text>
              <Tooltip title="读取这个词上次使用的参数">
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
                          message.success("已加载上次参数");
                        } else {
                          message.info("这个词暂无历史参数");
                        }
                      } catch {
                        message.error("读取历史参数失败");
                      }
                    } else {
                      message.info("暂无历史参数");
                    }
                  }}
                >
                  加载上次参数
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
              <span className="algo-field-label">Start Year</span>
              <InputNumber
                min={1500}
                max={2026}
                value={startYear}
                onChange={(v) => setStartYear(v || 1900)}
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
                onChange={(v) => setEndYear(v || 2019)}
                style={{ width: "100%" }}
                status={startYear >= endYear ? "error" : undefined}
              />
            </div>
            <div className="algo-field algo-span-1">
              <span className="algo-field-label">Smoothing</span>
              <InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v || 3)} style={{ width: "100%" }} />
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
              />
            </div>
          </div>

          <div className="algo-console-actions">
            <Button loading={busy} onClick={() => void suggest()}>
              推荐变体
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={() => void run()}
              disabled={(turnstileEnabled && !turnstileToken) || !word.trim() || startYear >= endYear || selected.length === 0}
            >
              运行 Word Analysis
            </Button>
          </div>

          <div style={{ marginTop: 16 }}>
            <TurnstileWidget siteKey={turnstileSiteKey} refreshKey={turnstileNonce} onTokenChange={setTurnstileToken} />
          </div>
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
            <Input value={manual} onChange={(e) => setManual(e.target.value)} onPressEnter={() => void addManual()} placeholder="手动添加变体" />
            <Button icon={<PlusOutlined />} onClick={() => void addManual()} loading={busy}>
              添加
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
