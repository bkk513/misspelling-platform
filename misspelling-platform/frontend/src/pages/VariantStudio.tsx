import { PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Input, Progress, Space, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { loadVariants, mergeVariants, saveVariants, type SuggestedVariant } from "../lib/variantStore";

function heuristic(word: string) {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  return [w, `${w}-official`, `${w}s`, `${w}e`];
}

// Levenshtein distance algorithm
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
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Calculate confidence score for a variant
function scoreVariant(variant: string, word: string): number {
  let score = 100;

  // Edit distance penalty
  const distance = levenshteinDistance(variant.toLowerCase(), word.toLowerCase());
  score -= distance * 10;

  // Length difference penalty
  const lengthDiff = Math.abs(variant.length - word.length);
  score -= lengthDiff * 5;

  // First letter match bonus
  if (variant[0]?.toLowerCase() === word[0]?.toLowerCase()) {
    score += 10;
  }

  // Common prefix bonus
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

export function VariantStudioPage() {
  const [word, setWord] = useState("demo");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<SuggestedVariant[]>(() => loadVariants("demo"));

  const selected = useMemo(() => items.filter((x) => x.selected).length, [items]);

  // Sort items by confidence score
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const scoreA = scoreVariant(a.value, word);
      const scoreB = scoreVariant(b.value, word);
      return scoreB - scoreA;
    });
  }, [items, word]);

  const reload = (nextWord = word) => {
    setItems(loadVariants(nextWord));
  };

  const suggest = async () => {
    setBusy(true);
    try {
      const resp = await api.suggestVariants(word, 20);
      const next = mergeVariants(items, resp.variants || [], resp.source || "cache");
      setItems(next);
      saveVariants(word, next);
      message.success(`Loaded ${resp.variants?.length || 0} variants.`);
    } catch {
      const next = mergeVariants(items, heuristic(word), "heuristic");
      setItems(next);
      saveVariants(word, next);
      message.warning("Suggest endpoint unavailable. Used local heuristic results.");
    } finally {
      setBusy(false);
    }
  };

  const addManual = () => {
    const text = input.trim();
    if (!text) return;
    const next = mergeVariants(items, [text], "manual");
    setItems(next);
    saveVariants(word, next);
    setInput("");
  };

  const setSelected = (value: string, checked: boolean) => {
    const next = items.map((v) => (v.value === value ? { ...v, selected: checked } : v));
    setItems(next);
    saveVariants(word, next);
  };

  const remove = (value: string) => {
    const next = items.filter((v) => v.value !== value);
    setItems(next);
    saveVariants(word, next);
  };

  const selectTopN = (n: number) => {
    const topVariants = sortedItems.slice(0, n).map(v => v.value);
    const next = items.map((v) => ({
      ...v,
      selected: topVariants.includes(v.value),
    }));
    setItems(next);
    saveVariants(word, next);
    message.success(`Selected top ${n} variants`);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Variant Studio" extra={<Button onClick={() => reload()}>{`Reload ${word}`}</Button>}>
        <Space wrap>
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="term" style={{ width: 240 }} />
          <Button loading={busy} onClick={() => void suggest()}>Suggest Variants</Button>
          <Button onClick={() => selectTopN(5)}>Select Top 5</Button>
          <Button onClick={() => selectTopN(10)}>Select Top 10</Button>
          <Button icon={<SaveOutlined />} onClick={() => message.success("Saved to local variant cache.")}>Save to Lexicon Cache</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Selected: {selected} / {items.length}. Variants are sorted by confidence score (edit distance + pattern matching).
        </Typography.Paragraph>
      </Card>
      <Card title="Manual Add">
        <Space.Compact style={{ width: "100%" }}>
          <Input value={input} onChange={(e) => setInput(e.target.value)} onPressEnter={addManual} placeholder="new variant" />
          <Button icon={<PlusOutlined />} onClick={addManual}>Add</Button>
        </Space.Compact>
      </Card>
      <Card title="Variant List">
        <Table
          rowKey="value"
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
              width: 200,
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
                      strokeColor={score >= 70 ? '#52c41a' : score >= 40 ? '#faad14' : '#ff4d4f'}
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
              width: 100,
              render: (_: unknown, row: SuggestedVariant) => (
                <Button size="small" danger onClick={() => remove(row.value)}>Remove</Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
