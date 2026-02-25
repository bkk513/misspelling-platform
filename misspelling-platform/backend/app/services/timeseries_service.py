import hashlib
import math
import random
from datetime import date, timedelta

from ..db.data_sources_repo import ensure_data_source
from ..db.time_series_repo import create_series, ensure_term, ensure_variant, insert_series_points


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


def _persist_stub_bundle(task_id: str, task_type: str, canonical: str, point_count: int):
    source_id = ensure_data_source()
    term_id = ensure_term(canonical=canonical, category="custom", language="en")
    variants = [
        ("correct", None, 1.00),
        ("misspelling_1", ensure_variant(term_id, f"{canonical}e"), 0.68),
        ("misspelling_2", ensure_variant(term_id, f"{canonical}{canonical[-1:] or 'x'}"), 0.52),
    ]
    for variant_label, variant_id, scale in variants:
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


def persist_word_analysis_stub_timeseries(task_id: str, word: str):
    _persist_stub_bundle(task_id, "word-analysis", (word or "word").lower(), 60)


def persist_simulation_stub_timeseries(task_id: str, n: int, steps: int):
    count = max(30, min(90, int(steps or 0) if steps is not None else 60))
    canonical = f"sim-{str(task_id)[:8]}"
    _persist_stub_bundle(task_id, "simulation-run", canonical, count)
