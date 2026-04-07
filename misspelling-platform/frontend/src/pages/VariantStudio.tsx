/* 文件说明：变体工作台页面，负责查看与编辑词项变体及其辅助信息。 */

import {
  CheckCircleOutlined,
  EditOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Input,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../lib/api";
import "./variantStudio.css";

type VariantSource = "llm" | "cache" | "heuristic" | "dictionary" | "manual";

type CacheVariant = {
  id: number;
  variant: string;
  source: VariantSource;
  updatedAt?: string;
};

type RecommendationVariant = {
  value: string;
  source: VariantSource;
  selected: boolean;
};

function heuristic(word: string) {
  const base = normalizeWord(word);
  if (!base) return [];
  return [`${base}s`, `${base}e`, `${base}-official`, base.replace(/e/g, "") || `${base}x`];
}

function normalizeWord(word: string): string {
  return String(word || "").trim().toLowerCase();
}

function normalizeSource(source: string | undefined, fallback: VariantSource = "cache"): VariantSource {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "llm" || normalized === "cache" || normalized === "heuristic" || normalized === "dictionary" || normalized === "manual") {
    return normalized;
  }
  return fallback;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }

  return matrix[b.length][a.length];
}

function scoreVariant(variant: string, word: string): number {
  if (!word) return 0;

  let score = 100;

  const distance = levenshteinDistance(variant.toLowerCase(), word.toLowerCase());
  score -= distance * 10;

  const lengthDiff = Math.abs(variant.length - word.length);
  score -= lengthDiff * 5;

  if (variant[0]?.toLowerCase() === word[0]?.toLowerCase()) {
    score += 10;
  }

  const minLen = Math.min(variant.length, word.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i++) {
    if (variant[i]?.toLowerCase() === word[i]?.toLowerCase()) {
      commonPrefix++;
    } else {
      break;
    }
  }
  if (commonPrefix >= 3) {
    score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreColor(score: number): string {
  if (score >= 70) return "#2fa84f";
  if (score >= 40) return "#d89614";
  return "#d94841";
}

function sourceColor(source: VariantSource): string {
  if (source === "llm") return "geekblue";
  if (source === "dictionary") return "green";
  if (source === "cache") return "default";
  if (source === "manual") return "volcano";
  return "gold";
}

function formatTime(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildRecommendations(
  values: string[],
  source: VariantSource,
  word: string,
  cacheSet: Set<string>,
): RecommendationVariant[] {
  const canonical = normalizeWord(word);
  const byValue = new Map<string, RecommendationVariant>();

  for (const raw of values) {
    const cleaned = normalizeWord(raw);
    if (!cleaned || cleaned === canonical) continue;
    if (byValue.has(cleaned)) continue;
    byValue.set(cleaned, {
      value: cleaned,
      source,
      selected: !cacheSet.has(cleaned),
    });
  }

  return Array.from(byValue.values());
}

export function VariantStudioPage() {
  const [word, setWord] = useState("demo");
  const [manualInput, setManualInput] = useState("");
  const [cacheItems, setCacheItems] = useState<CacheVariant[]>([]);
  const [recommendItems, setRecommendItems] = useState<RecommendationVariant[]>([]);

  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [loadingCache, setLoadingCache] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const normalizedWord = useMemo(() => normalizeWord(word), [word]);

  const cacheVariantSet = useMemo(() => {
    return new Set(cacheItems.map((row) => normalizeWord(row.variant)));
  }, [cacheItems]);

  const sortedCacheItems = useMemo(() => {
    return [...cacheItems].sort((a, b) => scoreVariant(b.variant, normalizedWord) - scoreVariant(a.variant, normalizedWord));
  }, [cacheItems, normalizedWord]);

  const recommendationRows = useMemo(() => {
    return [...recommendItems]
      .map((row) => {
        const normalized = normalizeWord(row.value);
        const score = scoreVariant(normalized, normalizedWord);
        return {
          ...row,
          normalized,
          inCache: cacheVariantSet.has(normalized),
          score,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [recommendItems, normalizedWord, cacheVariantSet]);

  const selectedRecommendationCount = useMemo(() => {
    return recommendationRows.filter((row) => row.selected && !row.inCache).length;
  }, [recommendationRows]);

  const avgCacheScore = useMemo(() => {
    if (sortedCacheItems.length === 0) return 0;
    const total = sortedCacheItems.reduce((sum, row) => sum + scoreVariant(row.variant, normalizedWord), 0);
    return Math.round(total / sortedCacheItems.length);
  }, [sortedCacheItems, normalizedWord]);

  const busy = loadingCache || loadingSuggest || saving || deleting;

  const loadCache = async (targetWord = normalizedWord) => {
    if (!cacheEnabled || !targetWord) {
      setCacheItems([]);
      return;
    }
    setLoadingCache(true);
    try {
      const resp = await api.listVariantCache(targetWord, 300);
      const next = (resp.items || []).map((row) => ({
        id: Number(row.id),
        variant: normalizeWord(row.variant),
        source: normalizeSource(row.source, "cache"),
        updatedAt: row.updated_at,
      }));
      setCacheItems(next);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingCache(false);
    }
  };

  useEffect(() => {
    void api
      .me()
      .then(() => setCacheEnabled(true))
      .catch(() => setCacheEnabled(false))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!authChecked) return;

    if (!normalizedWord) {
      setCacheItems([]);
      setRecommendItems([]);
      return;
    }

    if (cacheEnabled) {
      void loadCache(normalizedWord);
    } else {
      setCacheItems([]);
    }

    setRecommendItems([]);
  }, [authChecked, cacheEnabled, normalizedWord]);

  const fetchRecommendations = async () => {
    if (!normalizedWord) {
      message.warning("Please input a word first.");
      return;
    }

    setLoadingSuggest(true);
    try {
      const resp = await api.suggestVariants(normalizedWord, 20, { persist: false, preferCache: false });
      const source = normalizeSource(resp.source, "llm");
      const next = buildRecommendations(resp.variants || [], source, normalizedWord, cacheVariantSet);
      setRecommendItems(next);
      message.success(`Loaded ${next.length} recommendations from ${source}.`);
    } catch {
      const fallback = buildRecommendations(heuristic(normalizedWord), "heuristic", normalizedWord, cacheVariantSet);
      setRecommendItems(fallback);
      message.warning("Recommend API unavailable. Switched to local heuristic results.");
    } finally {
      setLoadingSuggest(false);
    }
  };

  const addVariantsToCache = async (variants: string[], source: VariantSource) => {
    if (!cacheEnabled) {
      message.info("Login is required to write cache.");
      return;
    }
    if (!normalizedWord) {
      message.warning("Please input a word first.");
      return;
    }

    const cleaned = Array.from(new Set(variants.map((v) => normalizeWord(v)).filter(Boolean))).filter((v) => !cacheVariantSet.has(v));
    if (cleaned.length === 0) {
      message.info("No new variants to add.");
      return;
    }

    setSaving(true);
    try {
      const resp = await api.saveVariantCache(normalizedWord, cleaned, source);
      message.success(`Added ${resp.saved} variants to cache.`);
      await loadCache(normalizedWord);
      const savedSet = new Set(cleaned);
      setRecommendItems((prev) => prev.map((row) => (savedSet.has(normalizeWord(row.value)) ? { ...row, selected: false } : row)));
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const addSelectedRecommendations = async () => {
    const selected = recommendationRows.filter((row) => row.selected && !row.inCache).map((row) => row.value);
    await addVariantsToCache(selected, "llm");
  };

  const addManual = async () => {
    const value = normalizeWord(manualInput);
    if (!value) return;

    if (cacheEnabled) {
      await addVariantsToCache([value], "manual");
    } else {
      setRecommendItems((prev) => {
        const exists = prev.some((row) => normalizeWord(row.value) === value);
        if (exists || value === normalizedWord) return prev;
        return [{ value, source: "manual", selected: true }, ...prev];
      });
      message.success("Added to local list.");
    }

    setManualInput("");
  };

  const fillManualInput = (value: string) => {
    setManualInput(normalizeWord(value));
    message.success("Filled into manual editor.");
  };

  const removeCacheItem = async (row: CacheVariant) => {
    if (!cacheEnabled) return;

    setDeleting(true);
    try {
      const resp = await api.deleteVariantCache({ ids: [row.id], word: normalizedWord, variants: [row.variant] });
      if (resp.deleted > 0) {
        message.success("Deleted from cache.");
      }
      await loadCache(normalizedWord);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setDeleting(false);
    }
  };

  const clearWordCache = async () => {
    if (!cacheEnabled || !normalizedWord) return;

    setDeleting(true);
    try {
      const resp = await api.deleteVariantCache({ word: normalizedWord });
      message.success(`Deleted ${resp.deleted} cached variants.`);
      await loadCache(normalizedWord);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setDeleting(false);
    }
  };

  const toggleRecommendation = (value: string, checked: boolean) => {
    const normalized = normalizeWord(value);
    setRecommendItems((prev) =>
      prev.map((row) => (normalizeWord(row.value) === normalized ? { ...row, selected: checked } : row)),
    );
  };

  const selectTopRecommendations = (n: number) => {
    const keys = recommendationRows
      .filter((row) => !row.inCache)
      .slice(0, n)
      .map((row) => normalizeWord(row.value));
    const selectedSet = new Set(keys);

    setRecommendItems((prev) =>
      prev.map((row) => ({
        ...row,
        selected: selectedSet.has(normalizeWord(row.value)),
      })),
    );
    message.success(`Selected top ${Math.min(n, keys.length)} recommendations.`);
  };

  return (
    <div className="variant-studio-shell">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!cacheEnabled && authChecked && (
          <Alert
            type="info"
            showIcon
            message="Guest mode"
            description="Guest 只能本地查看推荐，不会写入 Variant Cache。登录后可管理个人 cache。"
          />
        )}

        <Card bordered={false} className="variant-studio-hero">
          <Typography.Title level={3} className="variant-studio-title">
            Variant Studio
          </Typography.Title>
          <Typography.Paragraph className="variant-studio-subtitle">
            输入词后查看当前缓存、生成 LLM 推荐，并按需加入或删除。Confidence 评分保留编辑距离逻辑。
          </Typography.Paragraph>

          <Space wrap>
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              prefix={<SearchOutlined />}
              placeholder="Input a canonical word"
              style={{ width: 280 }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void loadCache(normalizedWord)}
              loading={loadingCache}
              disabled={!cacheEnabled || !normalizedWord}
            >
              Reload Cache
            </Button>
            <Button type="primary" icon={<RobotOutlined />} onClick={() => void fetchRecommendations()} loading={loadingSuggest}>
              Fetch LLM Recommendations
            </Button>
            {cacheEnabled && (
              <Button danger icon={<DeleteOutlined />} onClick={() => void clearWordCache()} loading={deleting} disabled={!normalizedWord}>
                Clear Word Cache
              </Button>
            )}
          </Space>

          <div className="variant-studio-metrics">
            <div className="variant-studio-metric">
              <Typography.Text className="metric-label">Cached Variants</Typography.Text>
              <Typography.Title level={4} className="metric-value">
                {sortedCacheItems.length}
              </Typography.Title>
            </div>
            <div className="variant-studio-metric">
              <Typography.Text className="metric-label">Avg Cache Confidence</Typography.Text>
              <Typography.Title level={4} className="metric-value">
                {avgCacheScore}%
              </Typography.Title>
            </div>
            <div className="variant-studio-metric">
              <Typography.Text className="metric-label">Recommendations</Typography.Text>
              <Typography.Title level={4} className="metric-value">
                {recommendationRows.length}
              </Typography.Title>
            </div>
            <div className="variant-studio-metric">
              <Typography.Text className="metric-label">Selected To Add</Typography.Text>
              <Typography.Title level={4} className="metric-value">
                {selectedRecommendationCount}
              </Typography.Title>
            </div>
          </div>
        </Card>

        <Row gutter={[16, 16]} align="top">
          <Col xs={24} xxl={13} xl={14}>
            <Card
              className="variant-studio-card"
              title={
                <Space>
                  <DatabaseOutlined />
                  <span>Cache Inventory</span>
                </Space>
              }
              extra={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void loadCache(normalizedWord)}
                  loading={loadingCache}
                  disabled={!cacheEnabled || !normalizedWord}
                >
                  Refresh
                </Button>
              }
            >
              <Table
                rowKey={(row) => row.id}
                loading={loadingCache}
                dataSource={sortedCacheItems}
                size="small"
                locale={{
                  emptyText: cacheEnabled
                    ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cached variants for this word." />
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="登录后可访问个人缓存。" />,
                }}
                pagination={{ pageSize: 9, showSizeChanger: false }}
                columns={[
                  {
                    title: "Variant",
                    dataIndex: "variant",
                    width: 180,
                    render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
                  },
                  {
                    title: "Confidence",
                    key: "confidence",
                    width: 170,
                    render: (_: unknown, row: CacheVariant) => {
                      const score = scoreVariant(row.variant, normalizedWord);
                      return (
                        <Space className="variant-studio-progress" size={8}>
                          <Progress percent={score} size={[90, 8]} showInfo={false} strokeColor={scoreColor(score)} />
                          <Typography.Text type="secondary">{score}%</Typography.Text>
                        </Space>
                      );
                    },
                  },
                  {
                    title: "Source",
                    dataIndex: "source",
                    width: 110,
                    render: (source: VariantSource) => <Tag color={sourceColor(source)}>{source}</Tag>,
                  },
                  {
                    title: "Updated",
                    dataIndex: "updatedAt",
                    width: 180,
                    render: (value: string | undefined) => (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatTime(value)}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "Action",
                    width: 100,
                    render: (_: unknown, row: CacheVariant) => (
                      <Button
                        size="small"
                        danger
                        onClick={() => void removeCacheItem(row)}
                        loading={deleting}
                        disabled={!cacheEnabled}
                      >
                        Delete
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>

          <Col xs={24} xxl={11} xl={10}>
            <Card
              className="variant-studio-card"
              title={
                <Space>
                  <RobotOutlined />
                  <span>LLM Recommendations</span>
                </Space>
              }
              extra={
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => void addSelectedRecommendations()}
                  loading={saving}
                  disabled={!cacheEnabled || selectedRecommendationCount === 0}
                >
                  Add Selected ({selectedRecommendationCount})
                </Button>
              }
            >
              <div className="variant-studio-recommend-head">
                <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
                  点击推荐项的 <Tag color="default">Use</Tag> 可直接回填到 Manual Add，再微调后加入 cache。
                </Typography.Paragraph>
                <Space.Compact style={{ width: "100%", marginBottom: 10 }}>
                  <Input
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    onPressEnter={() => void addManual()}
                    placeholder="Manual Add: e.g. chatgptt"
                  />
                  <Button icon={<PlusOutlined />} loading={saving} onClick={() => void addManual()} disabled={!normalizedWord}>
                    Add
                  </Button>
                </Space.Compact>
              </div>

              <Space wrap style={{ marginBottom: 12 }}>
                <Tooltip title="按 Confidence 自动勾选前 5 项">
                  <Button onClick={() => selectTopRecommendations(5)} disabled={recommendationRows.length === 0}>
                    Top 5
                  </Button>
                </Tooltip>
                <Tooltip title="按 Confidence 自动勾选前 10 项">
                  <Button onClick={() => selectTopRecommendations(10)} disabled={recommendationRows.length === 0}>
                    Top 10
                  </Button>
                </Tooltip>
                <Button icon={<RobotOutlined />} onClick={() => void fetchRecommendations()} loading={loadingSuggest}>
                  Refresh Recommendations
                </Button>
              </Space>

              <Table
                rowKey={(row) => row.normalized}
                dataSource={recommendationRows}
                loading={loadingSuggest}
                size="small"
                pagination={{ pageSize: 9, showSizeChanger: false }}
                locale={{
                  emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recommendations yet." />,
                }}
                columns={[
                  {
                    title: "Pick",
                    dataIndex: "selected",
                    width: 64,
                    render: (_: unknown, row: { value: string; selected: boolean; inCache: boolean }) => (
                      <Checkbox
                        checked={row.selected && !row.inCache}
                        disabled={row.inCache}
                        onChange={(e) => toggleRecommendation(row.value, e.target.checked)}
                      />
                    ),
                  },
                  {
                    title: "Variant",
                    dataIndex: "value",
                    width: 150,
                    render: (value: string, row: { inCache: boolean }) => (
                      <Space size={6} wrap>
                        <Typography.Text strong className="variant-studio-clickable" onClick={() => fillManualInput(value)}>
                          {value}
                        </Typography.Text>
                        {row.inCache && <Tag color="success">In Cache</Tag>}
                      </Space>
                    ),
                  },
                  {
                    title: "Confidence",
                    dataIndex: "score",
                    width: 170,
                    render: (score: number) => (
                      <Space className="variant-studio-progress" size={8}>
                        <Progress percent={score} size={[90, 8]} showInfo={false} strokeColor={scoreColor(score)} />
                        <Typography.Text type="secondary">{score}%</Typography.Text>
                      </Space>
                    ),
                  },
                  {
                    title: "Source",
                    dataIndex: "source",
                    width: 90,
                    render: (source: VariantSource) => <Tag color={sourceColor(source)}>{source}</Tag>,
                  },
                  {
                    title: "Action",
                    width: 150,
                    render: (_: unknown, row: { value: string; inCache: boolean; source: VariantSource }) => (
                      <Space size={4}>
                        <Button size="small" type="link" icon={<EditOutlined />} onClick={() => fillManualInput(row.value)}>
                          Use
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => void addVariantsToCache([row.value], row.source)}
                          disabled={!cacheEnabled || row.inCache}
                        >
                          Add
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>

        {busy && (
          <Typography.Text type="secondary" className="variant-studio-busy">
            Processing...
          </Typography.Text>
        )}
      </Space>
    </div>
  );
}
