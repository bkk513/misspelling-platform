import { PlusOutlined, ThunderboltOutlined, HistoryOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  InputNumber,
  Row,
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
import { loadVariants, mergeVariants, saveVariants, type SuggestedVariant } from "../lib/variantStore";

function heuristicSuggest(word: string) {
  const base = word.trim().toLowerCase();
  if (!base) return [];
  return [
    `${base}-ai`,
    `${base}e`,
    `${base}${base.slice(-1) || "x"}`,
    base.replace(/e/g, "") || `${base}x`
  ];
}

// Parameter templates
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
    name: 'Quick Analysis',
    description: 'Fast analysis with default settings (1800-2019, smoothing=3)',
    icon: '⚡',
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: 'eng_2019' },
  },
  {
    name: 'High Precision',
    description: 'Detailed analysis with minimal smoothing (1800-2019, smoothing=0)',
    icon: '🎯',
    params: { startYear: 1800, endYear: 2019, smoothing: 0, corpus: 'eng_2019' },
  },
  {
    name: 'Recent Trends',
    description: 'Focus on modern usage (2000-2019, smoothing=2)',
    icon: '📈',
    params: { startYear: 2000, endYear: 2019, smoothing: 2, corpus: 'eng_2019' },
  },
  {
    name: 'Historical Deep Dive',
    description: 'Long-term historical analysis (1500-2019, smoothing=5)',
    icon: '📚',
    params: { startYear: 1500, endYear: 2019, smoothing: 5, corpus: 'eng_2019' },
  },
  {
    name: 'US English Focus',
    description: 'US English corpus with standard settings (1800-2019)',
    icon: '🇺🇸',
    params: { startYear: 1800, endYear: 2019, smoothing: 3, corpus: 'eng_us_2019' },
  },
];

export function WordAnalysisWorkbenchPage() {
  const [word, setWord] = useState("demo");
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
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();

  useEffect(() => {
    setVariants(loadVariants(word));
    // Load last used parameters from localStorage
    const lastParams = localStorage.getItem('word-analysis-last-params');
    if (lastParams) {
      try {
        const parsed = JSON.parse(lastParams);
        if (parsed.word === word) {
          setStartYear(parsed.startYear || 1900);
          setEndYear(parsed.endYear || 2019);
          setSmoothing(parsed.smoothing || 3);
          setCorpus(parsed.corpus || 'eng_2019');
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [word]);

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
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem('word-analysis-last-params', JSON.stringify(params));
  };

  const suggest = async () => {
    if (!word.trim()) {
      message.warning("Please input word first.");
      return;
    }
    setBusy(true);
    try {
      const resp = await api.suggestVariants(word, 20);
      const merged = mergeVariants(variants, resp.variants || [], resp.source || "cache");
      setVariants(merged);
      saveVariants(word, merged);
      message.success(`Loaded ${resp.variants?.length || 0} variants from ${resp.source || "cache"}.`);
    } catch {
      const merged = mergeVariants(variants, heuristicSuggest(word), "heuristic");
      setVariants(merged);
      saveVariants(word, merged);
      message.info("Suggest API unavailable, switched to local heuristic variants.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!turnstileToken) {
      message.warning("Please complete Turnstile verification first.");
      return;
    }
    saveCurrentParams(); // Save parameters before running
    setBusy(true);
    try {
      const resp = await api.createWordAnalysis(word, {
        startYear,
        endYear,
        smoothing,
        corpus,
        variants: selected
      }, turnstileToken);
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
        variants: selected
      });
      const warn = (resp.warnings || []).join(", ");
      setGbncInfo(
        `source=${resp.source} cache_hit=${resp.cache_hit} points=${resp.point_count || 0}` +
          `${resp.error_reason ? ` error=${resp.error_reason}` : ""}` +
          `${warn ? ` warnings=${warn}` : ""}`
      );
      if (resp.source === "STUB") {
        message.warning("GBNC pull degraded to STUB source.");
      } else {
        message.success("GBNC pull completed.");
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const addManual = () => {
    const text = manual.trim();
    if (!text) return;
    const merged = mergeVariants(variants, [text], "manual");
    setVariants(merged);
    saveVariants(word, merged);
    setManual("");
  };

  const toggle = (value: string, checked: boolean) => {
    const next = variants.map((v) => (v.value === value ? { ...v, selected: checked } : v));
    setVariants(next);
    saveVariants(word, next);
  };

  const remove = (value: string) => {
    const next = variants.filter((v) => v.value !== value);
    setVariants(next);
    saveVariants(word, next);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Word Analysis Workbench">
        {/* Parameter Templates */}
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ marginBottom: 8, display: 'block' }}>
            Parameter Templates
          </Typography.Text>
          <Space wrap>
            {templates.map((template) => (
              <Tooltip key={template.name} title={template.description}>
                <Button
                  size="small"
                  onClick={() => loadTemplate(template)}
                  icon={template.icon ? <span>{template.icon}</span> : undefined}
                >
                  {template.name}
                </Button>
              </Tooltip>
            ))}
            <Tooltip title="Load last used parameters for this word">
              <Button
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => {
                  const lastParams = localStorage.getItem('word-analysis-last-params');
                  if (lastParams) {
                    try {
                      const parsed = JSON.parse(lastParams);
                      if (parsed.word === word) {
                        setStartYear(parsed.startYear);
                        setEndYear(parsed.endYear);
                        setSmoothing(parsed.smoothing);
                        setCorpus(parsed.corpus);
                        message.success('Loaded last used parameters');
                      } else {
                        message.info('No saved parameters for this word');
                      }
                    } catch {
                      message.error('Failed to load saved parameters');
                    }
                  } else {
                    message.info('No saved parameters found');
                  }
                }}
              >
                Load Last Used
              </Button>
            </Tooltip>
          </Space>
        </div>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Typography.Text>Word</Typography.Text>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              status={!word.trim() ? 'error' : undefined}
            />
            {!word.trim() && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                Word is required
              </Typography.Text>
            )}
          </Col>
          <Col xs={12} md={4}>
            <Typography.Text>Start Year</Typography.Text>
            <InputNumber
              min={1500}
              max={2026}
              value={startYear}
              onChange={(v) => setStartYear(v || 1900)}
              style={{ width: "100%" }}
              status={startYear >= endYear ? 'error' : undefined}
            />
          </Col>
          <Col xs={12} md={4}>
            <Typography.Text>End Year</Typography.Text>
            <InputNumber
              min={1500}
              max={2026}
              value={endYear}
              onChange={(v) => setEndYear(v || 2019)}
              style={{ width: "100%" }}
              status={startYear >= endYear ? 'error' : undefined}
            />
            {startYear >= endYear && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                End year must be greater than start year
              </Typography.Text>
            )}
          </Col>
          <Col xs={12} md={4}>
            <Typography.Text>Smoothing</Typography.Text>
            <InputNumber
              min={0}
              max={50}
              value={smoothing}
              onChange={(v) => setSmoothing(v || 3)}
              style={{ width: "100%" }}
            />
          </Col>
          <Col xs={12} md={4}>
            <Typography.Text>Corpus</Typography.Text>
            <Select
              value={corpus}
              onChange={setCorpus}
              options={[
                { value: "eng_2019", label: "eng_2019" },
                { value: "eng_us_2019", label: "eng_us_2019" }
              ]}
              style={{ width: "100%" }}
            />
          </Col>
        </Row>
        <Space style={{ marginTop: 12 }}>
          <Button loading={busy} onClick={() => void suggest()}>Suggest Variants</Button>
          <Button loading={busy} onClick={() => void gbncPull()}>Pull GBNC Preview</Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={busy}
            onClick={() => void run()}
            disabled={!turnstileToken || !word.trim() || startYear >= endYear || selected.length === 0}
          >
            Run Word Analysis
          </Button>
        </Space>
        {selected.length === 0 && (
          <Typography.Text type="warning" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            ⚠️ Please select at least one variant before running analysis
          </Typography.Text>
        )}
        <div style={{ marginTop: 12 }}>
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            refreshKey={turnstileNonce}
            onTokenChange={setTurnstileToken}
          />
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
          Run uses GBNC parameters + selected variants. If network/provider fails, backend records fallback provenance in task result.
        </Typography.Paragraph>
        {gbncInfo && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
            {gbncInfo}
          </Typography.Paragraph>
        )}
      </Card>

      <Card title="Variant Selection">
        <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Manual variant" onPressEnter={addManual} />
          <Button icon={<PlusOutlined />} onClick={addManual}>Add</Button>
        </Space.Compact>
        <Space direction="vertical" style={{ width: "100%" }}>
          {variants.map((item) => (
            <Row key={item.value} align="middle" justify="space-between" style={{ borderBottom: "1px solid #f0f0f0", padding: "8px 0" }}>
              <Col>
                <Space>
                  <Checkbox checked={item.selected} onChange={(e) => toggle(item.value, e.target.checked)} />
                  <Typography.Text>{item.value}</Typography.Text>
                  <Tag>{item.source}</Tag>
                </Space>
              </Col>
              <Col><Button size="small" danger onClick={() => remove(item.value)}>Remove</Button></Col>
            </Row>
          ))}
          {variants.length === 0 && <Typography.Text type="secondary">No variants yet. Click Suggest Variants or add manually.</Typography.Text>}
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
          Selected variants: {selected.length ? selected.join(", ") : "(none)"}
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
