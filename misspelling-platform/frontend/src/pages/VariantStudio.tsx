import { PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Input, Space, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { loadVariants, mergeVariants, saveVariants, type SuggestedVariant } from "../lib/variantStore";

function heuristic(word: string) {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  return [w, `${w}-official`, `${w}s`, `${w}e`];
}

export function VariantStudioPage() {
  const [word, setWord] = useState("demo");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<SuggestedVariant[]>(() => loadVariants("demo"));

  const selected = useMemo(() => items.filter((x) => x.selected).length, [items]);

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

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Variant Studio" extra={<Button onClick={() => reload()}>{`Reload ${word}`}</Button>}>
        <Space wrap>
          <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="term" style={{ width: 240 }} />
          <Button loading={busy} onClick={() => void suggest()}>Suggest Variants</Button>
          <Button icon={<SaveOutlined />} onClick={() => message.success("Saved to local variant cache.")}>Save to Lexicon Cache</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Selected: {selected} / {items.length}. This module is user-side variant curation before task execution.
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
          dataSource={items}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "Use", dataIndex: "selected", render: (_: unknown, row: SuggestedVariant) => <Checkbox checked={row.selected} onChange={(e) => setSelected(row.value, e.target.checked)} /> },
            { title: "Variant", dataIndex: "value" },
            { title: "Source", dataIndex: "source", render: (v: string) => <Tag>{v}</Tag> },
            { title: "Action", render: (_: unknown, row: SuggestedVariant) => <Button size="small" danger onClick={() => remove(row.value)}>Remove</Button> }
          ]}
        />
      </Card>
    </Space>
  );
}
