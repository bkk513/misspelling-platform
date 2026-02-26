import hashlib
import math
import random
from datetime import date, timedelta

from ..db.data_sources_repo import ensure_data_source
from ..db.time_series_repo import (
    create_series,
    ensure_term,
    ensure_variant,
    get_series_points_for_task,
    insert_series_points,
    list_series_by_task,
)


def _seed(task_id: str, label: str) -> int:
    return int.from_bytes(hashlib.sha256(f"{task_id}:{label}".encode("utf-8")).digest()[:8], "big")


def _build_points(task_id: str, label: str, count: int, scale: float):
    rng = random.Random(_seed(task_id, label))
    start = date(2020, 1, 1)
    points = []
    for i in range(count):
        trend = 6.0 + (i * 0.12 if i < count * 0.55 else count * 0.12 * 0.55 + (i - count * 0.55) * 0.02)
        wobble = math.sin(i / 4.5 + (rng.random() * 0.7)) * 1.8 + math.cos(i / 11.0) * 0.8
        noise = rng.uniform(-0.45, 0.45)
        value = max(0.01, (trend + wobble + noise) * scale)
        points.append({"t": start + timedelta(days=i), "value": round(value, 6)})
    return points


def _persist_stub_bundle(task_id: str, task_type: str, canonical: str, point_count: int, variant_words: list[str] | None = None):
    source_id = ensure_data_source()
    term_id = ensure_term(canonical=canonical, category="custom", language="en")
    variant_specs = [("correct", None, 1.00)]
    selected = []
    if variant_words:
        seen = {canonical}
        for item in variant_words:
            norm = str(item).strip().lower()
            if not norm or norm in seen:
                continue
            seen.add(norm)
            selected.append(norm)
            if len(selected) >= 5:
                break
    if not selected:
        selected = [f"{canonical}e", f"{canonical}{canonical[-1:] or 'x'}"]
    for idx, variant_text in enumerate(selected):
        scale = max(0.2, 0.72 - (idx * 0.12))
        variant_specs.append((variant_text, ensure_variant(term_id, variant_text), scale))

    csv_rows = []
    for variant_label, variant_id, scale in variant_specs:
        points = _build_points(task_id, variant_label, point_count, scale)
        series_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="day",
            window_start=points[0]["t"],
            window_end=points[-1]["t"],
            units="relative_freq",
            meta={
                "stub": True,
                "task_id": task_id,
                "task_type": task_type,
                "canonical": canonical,
                "variant": variant_label,
            },
        )
        insert_series_points(series_id, points)
        csv_rows.extend(
            {"time": str(p["t"]), "variant": variant_label, "value": p["value"]}
            for p in points
        )
    return {"variants": [v[0] for v in variant_specs], "csv_rows": csv_rows}


def persist_word_analysis_stub_timeseries(task_id: str, word: str, variants: list[str] | None = None):
    return _persist_stub_bundle(task_id, "word-analysis", (word or "word").lower(), 60, variant_words=variants)


def persist_simulation_stub_timeseries(task_id: str, n: int, steps: int):
    count = max(30, min(90, int(steps or 0) if steps is not None else 60))
    canonical = f"sim-{str(task_id)[:8]}"
    _persist_stub_bundle(task_id, "simulation-run", canonical, count)


def get_task_timeseries_summary(task_id: str):
    rows = list_series_by_task(task_id)
    if not rows:
        return {"task_id": task_id, "items": [], "variants": [], "point_count": 0}
    items = [dict(r) for r in rows]
    return {
        "task_id": task_id,
        "source": items[0]["source_name"],
        "word": items[0]["canonical"],
        "granularity": items[0]["granularity"],
        "variants": [r["variant"] for r in items],
        "point_count": int(sum(int(r["point_count"]) for r in items)),
        "items": items,
    }


def get_task_timeseries_points(task_id: str, variant: str = "correct"):
    series_id, rows = get_series_points_for_task(task_id, variant or "correct")
    return {
        "task_id": task_id,
        "variant": variant or "correct",
        "series_id": series_id,
        "items": [{"time": str(r["t"]), "value": float(r["value"])} for r in rows],
    }
