import hashlib
import math
import random
from datetime import date, timedelta

from ..db.data_sources_repo import ensure_data_source, ensure_data_source_configured
from ..db.time_series_repo import (
    create_series,
    ensure_term,
    ensure_variant,
    get_series_points_for_task,
    insert_series_points,
    list_series_by_task,
)
from .gbnc_service import (
    get_gbnc_series_payload,
    get_gbnc_series_points_payload,
    pull_gbnc_series_to_db,
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


def persist_word_analysis_gbnc_timeseries(
    task_id: str,
    word: str,
    variants: list[str] | None = None,
    *,
    start_year: int = 1900,
    end_year: int = 2019,
    corpus: str = "eng_2019",
    smoothing: int = 3,
):
    y0 = max(1500, min(2050, int(start_year)))
    y1 = max(y0, min(2050, int(end_year)))
    sm = max(0, min(50, int(smoothing)))
    pull = pull_gbnc_series_to_db(
        term=(word or "word").lower(),
        variants=list(variants or []),
        start_year=y0,
        end_year=y1,
        corpus=str(corpus or "eng_2019"),
        smoothing=sm,
        actor=f"task:{task_id}",
    )
    items = [it for it in (pull.get("items") or []) if int(it.get("point_count") or 0) > 0]
    if not items:
        raise ValueError("gbnc returned no points")

    source_id = ensure_data_source_configured("gbnc", "year", {"provider": "google-ngram-viewer"})
    canonical = str(pull.get("term") or word or "word").strip().lower()
    term_id = ensure_term(canonical=canonical, category="custom", language="en")
    csv_rows = []
    persisted_variants: list[str] = []
    source_kind = "cache" if pull.get("cached") else "external"

    for item in items:
        series_id = int(item["series_id"])
        meta = get_gbnc_series_payload(series_id) or {}
        points_payload = get_gbnc_series_points_payload(series_id) or {"items": []}
        variant = str(item.get("variant") or meta.get("variant") or "").strip().lower()
        points_src = points_payload.get("items") or []
        if not variant or not points_src:
            continue
        variant_id = None if variant == canonical else ensure_variant(term_id, variant, variant_type="external")
        mapped = []
        for p in points_src:
            t = str(p.get("time") or "")[:10]
            year = int(t[:4]) if t[:4].isdigit() else None
            if year is None:
                continue
            mapped.append({"t": date(year, 1, 1), "value": float(p.get("value") or 0.0)})
        if not mapped:
            continue
        create_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="year",
            window_start=mapped[0]["t"],
            window_end=mapped[-1]["t"],
            units=str(meta.get("units") or "relative_frequency"),
            meta={
                "task_id": task_id,
                "task_type": "word-analysis",
                "variant": variant,
                "term": canonical,
                "source_kind": source_kind,
                "gbnc": True,
                "gbnc_series_id": series_id,
                "corpus": str(corpus or "eng_2019"),
                "smoothing": sm,
                "start_year": y0,
                "end_year": y1,
            },
        )
        insert_series_points(create_id, mapped)
        persisted_variants.append(variant)
        csv_rows.extend({"time": str(p["t"]), "variant": variant, "value": p["value"]} for p in mapped)

    if not csv_rows:
        raise ValueError("gbnc returned no usable points")
    return {"variants": persisted_variants, "csv_rows": csv_rows, "source_kind": source_kind}


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
