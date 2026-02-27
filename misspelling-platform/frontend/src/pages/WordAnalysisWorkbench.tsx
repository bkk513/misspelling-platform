import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
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
  message
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { goToTask } from "../app/router";
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

export function WordAnalysisWorkbenchPage() {
  const [word, setWord] = useState("demo");
  const [startYear, setStartYear] = useState(1900);
  const [endYear, setEndYear] = useState(2019);
  const [smoothing, setSmoothing] = useState(3);
  const [corpus, setCorpus] = useState("eng_2019");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<SuggestedVariant[]>([]);

  useEffect(() => {
    setVariants(loadVariants(word));
  }, [word]);

  const selected = useMemo(() => variants.filter((v) => v.selected).map((v) => v.value), [variants]);

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
    setBusy(true);
    try {
      const resp = await api.createWordAnalysis(word);
      message.success(`Task queued: ${resp.task_id}`);
      goToTask(resp.task_id);
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
        <Row gutter={16}>
          <Col xs={24} md={8}><Typography.Text>Word</Typography.Text><Input value={word} onChange={(e) => setWord(e.target.value)} /></Col>
          <Col xs={12} md={4}><Typography.Text>Start Year</Typography.Text><InputNumber min={1500} max={2026} value={startYear} onChange={(v) => setStartYear(v || 1900)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>End Year</Typography.Text><InputNumber min={1500} max={2026} value={endYear} onChange={(v) => setEndYear(v || 2019)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Smoothing</Typography.Text><InputNumber min={0} max={50} value={smoothing} onChange={(v) => setSmoothing(v || 3)} style={{ width: "100%" }} /></Col>
          <Col xs={12} md={4}><Typography.Text>Corpus</Typography.Text><Select value={corpus} onChange={setCorpus} options={[{ value: "eng_2019", label: "eng_2019" }, { value: "eng_us_2019", label: "eng_us_2019" }]} style={{ width: "100%" }} /></Col>
        </Row>
        <Space style={{ marginTop: 12 }}>
          <Button loading={busy} onClick={() => void suggest()}>Suggest Variants</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={() => void run()}>Run Word Analysis</Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>
          Current run parameters are prepared for GBNC pull integration. Existing backend remains backward compatible and currently consumes `word`.
        </Typography.Paragraph>
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
