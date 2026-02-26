from __future__ import annotations

import json
import re
from typing import Any


def _extract_json_fragment(text: str) -> list[dict[str, Any]]:
    match = re.search(r"var data = (\[.*?\]);\s*</script>", text, re.S)
    if match:
        try:
            parsed = json.loads(match.group(1))
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def parse_graph_response(content: bytes) -> dict[str, list[float]]:
    text = content.decode("utf-8", errors="ignore")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            rows = parsed
        else:
            rows = []
    except Exception:
        rows = []
    if not rows:
        rows = _extract_json_fragment(text)
    if not rows:
        timeseries = re.findall(r"\"timeseries\": \[(.*?)\]", text)
        terms = re.findall(r"\{\"ngram\": \"(.*?)\"", text)
        return {
            term: [float(v.strip()) for v in series.split(",") if v.strip()]
            for term, series in zip(terms, timeseries)
        }
    out: dict[str, list[float]] = {}
    for row in rows:
        term = str(row.get("ngram", "")).strip()
        series = row.get("timeseries")
        if not term or not isinstance(series, list):
            continue
        values: list[float] = []
        for v in series:
            try:
                values.append(float(v))
            except Exception:
                values.append(0.0)
        out[term] = values
    return out
