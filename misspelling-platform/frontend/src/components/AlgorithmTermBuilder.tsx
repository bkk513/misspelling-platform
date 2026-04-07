/* 文件说明：算法词项构建组件，负责管理词、变体、年份等算法输入参数。 */

import {
  CalendarOutlined,
  DatabaseOutlined,
  LockOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Button, Input, InputNumber, Space, Tag, Tooltip, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { OriginYearSuggestResponse, VariantCacheItem } from "../lib/api";
import { api, describeApiError } from "../lib/api";

type SuggestedVariant = {
  value: string;
  source: "llm" | "cache" | "heuristic" | "dictionary";
};

function normalizeWord(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function uniqVariants(word: string, values: string[]) {
  const canonical = normalizeWord(word);
  const out: string[] = [];
  for (const raw of values) {
    const cleaned = normalizeWord(raw);
    if (!cleaned || cleaned === canonical || out.includes(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

function parseManualValues(value: string) {
  return uniqVariants("", value.split(/[\n,，;；\s]+/g).filter(Boolean));
}

export function AlgorithmTermBuilder({
  word,
  variants,
  originYear,
  showOriginYear = false,
  startYear,
  endYear,
  smoothing,
  corpus,
  onWordChange,
  onVariantsChange,
  onOriginYearChange,
}: {
  word: string;
  variants: string[];
  originYear?: number | null;
  showOriginYear?: boolean;
  startYear?: number;
  endYear?: number;
  smoothing?: number;
  corpus?: string;
  onWordChange: (value: string) => void;
  onVariantsChange: (values: string[]) => void;
  onOriginYearChange?: (value?: number) => void;
}) {
  const [manualInput, setManualInput] = useState("");
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadingCache, setLoadingCache] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [loadingOriginYear, setLoadingOriginYear] = useState(false);
  const [cacheItems, setCacheItems] = useState<VariantCacheItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedVariant[]>([]);
  const [originSuggestion, setOriginSuggestion] = useState<OriginYearSuggestResponse | null>(null);

  const normalizedWord = useMemo(() => normalizeWord(word), [word]);
  const selectedSet = useMemo(() => new Set(uniqVariants(normalizedWord, variants)), [normalizedWord, variants]);
  const cacheVariants = useMemo(
    () => uniqVariants(normalizedWord, (cacheItems || []).map((item) => String(item.variant || ""))),
    [cacheItems, normalizedWord]
  );
  const originWarnings = useMemo(
    () => (originSuggestion?.warnings || []).filter((warning) => String(warning || "").trim() !== "origin_year_route_404_fallback"),
    [originSuggestion]
  );
  const originSourceLabel = useMemo(() => {
    const source = String(originSuggestion?.source || "").trim().toLowerCase();
    if (source === "gbnc") return "GBNC";
    if (source === "llm") return "LLM";
    if (source === "seed") return "Seed";
    return source ? source : "heuristic";
  }, [originSuggestion]);

  useEffect(() => {
    void api
      .me()
      .then(() => setCacheEnabled(true))
      .catch(() => setCacheEnabled(false))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    setSuggestions([]);
    setOriginSuggestion(null);
    if (!authChecked || !cacheEnabled || !normalizedWord) {
      setCacheItems([]);
      return;
    }
    setLoadingCache(true);
    void api
      .listVariantCache(normalizedWord, 100)
      .then((resp) => setCacheItems(resp.items || []))
      .catch(() => setCacheItems([]))
      .finally(() => setLoadingCache(false));
  }, [authChecked, cacheEnabled, normalizedWord]);

  const mergeVariants = (incoming: string[]) => {
    onVariantsChange(uniqVariants(normalizedWord, [...variants, ...incoming]));
  };

  const removeVariant = (value: string) => {
    const target = normalizeWord(value);
    onVariantsChange(uniqVariants(normalizedWord, variants.filter((item) => normalizeWord(item) !== target)));
  };

  const addManualValues = () => {
    const parsed = parseManualValues(manualInput);
    if (parsed.length === 0) {
      message.info("请输入要加入算法的错拼变体。");
      return;
    }
    mergeVariants(parsed);
    setManualInput("");
  };

  const importCache = () => {
    if (!cacheEnabled) {
      message.info("Guest 目前不能读取个人 variant cache。");
      return;
    }
    if (cacheVariants.length === 0) {
      message.info("当前单词在 cache 中还没有可导入的错拼项。");
      return;
    }
    mergeVariants(cacheVariants);
    message.success(`已导入 ${cacheVariants.length} 个 cache 变体。`);
  };

  const fetchSuggestions = async () => {
    if (!normalizedWord) {
      message.info("请先输入 canonical word。");
      return;
    }
    setLoadingSuggest(true);
    try {
      const resp = await api.suggestVariants(normalizedWord, 12, { persist: false, preferCache: true });
      const next = uniqVariants(normalizedWord, resp.variants || []).map((value) => ({
        value,
        source: resp.source || "llm",
      }));
      setSuggestions(next);
      if (next.length === 0) {
        message.info("当前没有拿到新的推荐变体。");
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingSuggest(false);
    }
  };

  const fetchOriginYear = async () => {
    if (!showOriginYear || !onOriginYearChange) return;
    if (!normalizedWord) {
      message.info("请先输入 canonical word。");
      return;
    }
    setLoadingOriginYear(true);
    try {
      const resp = await api.suggestOriginYear(normalizedWord, {
        variants,
        startYear,
        endYear,
        smoothing,
        corpus,
      });
      setOriginSuggestion(resp);
      if (typeof resp.suggested_year === "number") {
        onOriginYearChange(resp.suggested_year);
        message.success(`建议起点年份已填入：${resp.suggested_year}`);
      } else {
        message.info("当前没有拿到明确的起始年份建议。");
      }
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoadingOriginYear(false);
    }
  };

  return (
    <div className="algo-term-builder">
      <div className="algo-term-grid">
        <div className="algo-field algo-span-5">
          <span className="algo-field-label">Canonical Word</span>
          <Input value={word} onChange={(e) => onWordChange(e.target.value)} placeholder="internet" />
        </div>

        <div className="algo-field algo-span-7">
          <span className="algo-field-label">Variant Intake</span>
          <Space wrap>
            <Button icon={<DatabaseOutlined />} loading={loadingCache} onClick={importCache} disabled={!normalizedWord}>
              导入 Cache
            </Button>
            <Button icon={<RobotOutlined />} loading={loadingSuggest} onClick={() => void fetchSuggestions()} disabled={!normalizedWord}>
              LLM 推荐
            </Button>
            {showOriginYear ? (
              <Button
                icon={<CalendarOutlined />}
                loading={loadingOriginYear}
                onClick={() => void fetchOriginYear()}
                disabled={!normalizedWord}
              >
                建议传播起点
              </Button>
            ) : null}
            {!cacheEnabled && authChecked ? (
              <Tag icon={<LockOutlined />} color="default">
                Guest 不读取个人 cache
              </Tag>
            ) : null}
          </Space>
        </div>

        <div className="algo-field algo-span-8">
          <span className="algo-field-label">已选错拼词</span>
          <div className="algo-token-box">
            {selectedSet.size > 0 ? (
              Array.from(selectedSet).map((variant) => (
                <Tag key={variant} closable onClose={(e) => {
                  e.preventDefault();
                  removeVariant(variant);
                }}>
                  {variant}
                </Tag>
              ))
            ) : (
              <Typography.Text type="secondary">当前还没有选入错拼变体，算法将只使用正确拼写序列。</Typography.Text>
            )}
          </div>
        </div>

        <div className="algo-field algo-span-4">
          <span className="algo-field-label">Manual Add</span>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="interent, internte"
              onPressEnter={addManualValues}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={addManualValues}>
              添加
            </Button>
          </Space.Compact>
        </div>

        {showOriginYear ? (
          <div className="algo-field algo-span-4">
            <span className="algo-field-label">Propagation Origin Year</span>
            <InputNumber
              min={1500}
              max={2026}
              value={originYear ?? undefined}
              onChange={(value) => onOriginYearChange?.(typeof value === "number" ? value : undefined)}
              style={{ width: "100%" }}
              placeholder="例如 1969"
            />
          </div>
        ) : null}
      </div>

      {cacheVariants.length > 0 ? (
        <div className="algo-term-strip">
          <span className="algo-term-strip-label">Cache</span>
          <div className="algo-term-strip-items">
            {cacheVariants.map((variant) => (
              <Button
                key={`cache-${variant}`}
                size="small"
                type={selectedSet.has(variant) ? "primary" : "default"}
                onClick={() => mergeVariants([variant])}
              >
                {variant}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="algo-term-strip">
          <span className="algo-term-strip-label">LLM</span>
          <div className="algo-term-strip-items">
            {suggestions.map((item) => (
              <Tooltip key={`suggest-${item.value}`} title={`source: ${item.source}`}>
                <Button
                  size="small"
                  type={selectedSet.has(item.value) ? "primary" : "default"}
                  onClick={() => mergeVariants([item.value])}
                >
                  {item.value}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
      ) : null}

      {showOriginYear && originSuggestion ? (
        <div className="algo-origin-note">
          <div className="algo-origin-head">
            <strong>Origin-Year Suggestion</strong>
            <Tag color="blue">{originSourceLabel}</Tag>
          </div>
          <Typography.Paragraph className="algo-origin-copy">
            {originSuggestion.reasoning || "系统会优先尝试 LLM 的词义起点建议，在不可用时再退回本地语料证据。"}
          </Typography.Paragraph>
          <Space wrap>
            {typeof originSuggestion.suggested_year === "number" ? <Tag color="success">Suggested {originSuggestion.suggested_year}</Tag> : null}
            {typeof originSuggestion.basis_year === "number" ? <Tag>Basis {originSuggestion.basis_year}</Tag> : null}
            {typeof originSuggestion.correct_first_year === "number" ? <Tag>Correct first year {originSuggestion.correct_first_year}</Tag> : null}
          </Space>
          {originWarnings.length > 0 ? (
            <Space wrap style={{ marginTop: 10 }}>
              {originWarnings.map((warning) => (
                <Tag key={warning} color="warning">
                  {warning}
                </Tag>
              ))}
            </Space>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
