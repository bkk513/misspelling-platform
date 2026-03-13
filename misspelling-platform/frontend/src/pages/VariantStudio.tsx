import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Input, Progress, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError } from "../lib/api";

type SuggestedVariant = {
  value: string;
  source: "llm" | "cache" | "heuristic" | "dictionary" | "manual";
  selected: boolean;
  cacheId?: number;
};

function heuristic(word: string) {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  return [w, `${w}-official`, `${w}s`, `${w}e`];
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

export function VariantStudioPage() {
  const [word, setWord] = useState("demo");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<SuggestedVariant[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    void api
      .me()
      .then(() => setCacheEnabled(true))
      .catch(() => setCacheEnabled(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadCache = async (targetWord = word) => {
    if (!cacheEnabled) {
      setItems([]);
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
      setItems(next);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!authChecked) return;
    void loadCache(word);
  }, [word, cacheEnabled, authChecked]);

  const selected = useMemo(() => items.filter((x) => x.selected).length, [items]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const scoreA = scoreVariant(a.value, word);
      const scoreB = scoreVariant(b.value, word);
      return scoreB - scoreA;
    });
  }, [items, word]);

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
        const next = mergeVariants(items, resp.variants || [], (resp.source || "cache") as SuggestedVariant["source"]);
        setItems(next);
      }
      message.success(`Loaded ${resp.variants?.length || 0} variants.`);
    } catch {
      const next = mergeVariants(items, heuristic(word), "heuristic");
      setItems(next);
      message.warning("Suggest endpoint unavailable. Used local heuristic results.");
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    const text = input.trim();
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
      const next = mergeVariants(items, [text], "manual");
      setItems(next);
    }

    setInput("");
  };

  const setSelected = (value: string, checked: boolean) => {
    setItems((prev) => prev.map((v) => (v.value === value ? { ...v, selected: checked } : v)));
  };

  const remove = async (row: SuggestedVariant) => {
    if (cacheEnabled) {
      setBusy(true);
      try {
        const resp = await api.deleteVariantCache({ ids: row.cacheId ? [row.cacheId] : [], word, variants: [row.value] });
        if (resp.deleted > 0) {
          message.success("Deleted from your cache.");
        }
        await loadCache(word);
      } catch (e) {
        message.error(describeApiError(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setItems((prev) => prev.filter((v) => v.value !== row.value));
  };

  const deleteWordCache = async () => {
    if (!cacheEnabled) return;
    setBusy(true);
    try {
      const resp = await api.deleteVariantCache({ word });
      message.success(`Deleted ${resp.deleted} cached variants.`);
      await loadCache(word);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const selectTopN = (n: number) => {
    const topVariants = sortedItems.slice(0, n).map((v) => v.value);
    const next = items.map((v) => ({
      ...v,
      selected: topVariants.includes(v.value)
    }));
    setItems(next);
    message.success(`Selected top ${n} variants`);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {!cacheEnabled && authChecked && (
        <Alert
          type="info"
          showIcon
          message="Guest mode"
          description="Guest 不保存变体缓存；登录用户才会将变体写入个人缓存并支持管理删除。"
        />
      )}

      <Card
        title="Variant Studio"
        extra={
          <Space>
            <Button onClick={() => void loadCache()} disabled={!cacheEnabled}>{`Reload ${word}`}</Button>
            {cacheEnabled && (
              <Button danger icon={<DeleteOutlined />} onClick={() => void deleteWordCache()} loading={busy}>
                Clear This Word Cache
              </Button>
            )}
          </Space>
        }
      >
        <Space wrap>
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="term" style={{ width: 240 }} />
          <Button loading={busy} onClick={() => void suggest()}>Suggest Variants</Button>
          <Button onClick={() => selectTopN(5)}>Select Top 5</Button>
          <Button onClick={() => selectTopN(10)}>Select Top 10</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Selected: {selected} / {items.length}. Variants are sorted by confidence score (edit distance + pattern matching).
        </Typography.Paragraph>
      </Card>
      <Card title="Manual Add">
        <Space.Compact style={{ width: "100%" }}>
          <Input value={input} onChange={(e) => setInput(e.target.value)} onPressEnter={() => void addManual()} placeholder="new variant" />
          <Button icon={<PlusOutlined />} onClick={() => void addManual()} loading={busy}>Add</Button>
        </Space.Compact>
      </Card>
      <Card title="Variant List">
        <Table
          rowKey={(row) => `${row.value}:${row.cacheId || "local"}`}
          size="small"
          dataSource={sortedItems}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: "Use",
              dataIndex: "selected",
              width: 60,
              render: (_: unknown, row: SuggestedVariant) => (
                <Checkbox checked={row.selected} onChange={(e) => setSelected(row.value, e.target.checked)} />
              )
            },
            {
              title: "Variant",
              dataIndex: "value",
              width: 200
            },
            {
              title: "Confidence",
              key: "confidence",
              width: 150,
              render: (_: unknown, row: SuggestedVariant) => {
                const score = scoreVariant(row.value, word);
                return (
                  <Space size={8}>
                    <Progress
                      type="circle"
                      percent={score}
                      width={40}
                      strokeColor={score >= 70 ? "#52c41a" : score >= 40 ? "#faad14" : "#ff4d4f"}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {score}%
                    </Typography.Text>
                  </Space>
                );
              }
            },
            {
              title: "Source",
              dataIndex: "source",
              width: 120,
              render: (v: string) => <Tag>{v}</Tag>
            },
            {
              title: "Action",
              width: 110,
              render: (_: unknown, row: SuggestedVariant) => (
                <Button size="small" danger onClick={() => void remove(row)} loading={busy}>Remove</Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
