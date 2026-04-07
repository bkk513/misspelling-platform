from typing import Any
from datetime import date, datetime

from ..db.tasks_repo import get_task_owner
from ..db.time_series_repo import get_series_points_for_task, list_series_by_task
from ..services.external_data_service import pull_external_snapshot_payload
from ..services.timeseries_service import persist_word_analysis_external_series
from .types import AlgorithmDataset, AlgorithmSeries


def _normalize_granularity(value: Any) -> str:
    raw = str(value or "year").strip().lower()
    return "day" if raw == "day" else "year"


def _parse_point_date(raw_time: Any) -> date | None:
    if isinstance(raw_time, datetime):
        return raw_time.date()
    if isinstance(raw_time, date):
        return raw_time
    text = str(raw_time or "").strip()
    if not text:
        return None
    if " " in text:
        text = text.split(" ", 1)[0].strip()
    if "T" in text:
        text = text.split("T", 1)[0].strip()
    if len(text) >= 10:
        text = text[:10]
    if len(text) == 4 and text.isdigit():
        try:
            return date(int(text), 1, 1)
        except Exception:
            return None
    try:
        return date.fromisoformat(text)
    except Exception:
        return None


def _point_label(point_date: date, granularity: str) -> str:
    if granularity == "day":
        return point_date.isoformat()
    return str(int(point_date.year))


def _normalize_points(rows: list[dict[str, Any]], granularity: str) -> dict[str, float]:
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for row in rows:
        value = float(row.get("value") or 0.0)
        point_date = _parse_point_date(row.get("t"))
        if point_date is None:
            continue
        label = _point_label(point_date, granularity=granularity)
        sums[label] = sums.get(label, 0.0) + value
        counts[label] = counts.get(label, 0) + 1
    return {label: float(sums[label] / max(1, counts[label])) for label in sums}


def _timeline_sort_key(label: str, granularity: str) -> Any:
    if granularity == "day":
        try:
            return date.fromisoformat(str(label))
        except Exception:
            return date.min
    try:
        return int(str(label))
    except Exception:
        return 0


def _load_dataset_from_task(task_id: str) -> tuple[list[str], list[int], list[str], list[AlgorithmSeries], str, str]:
    rows = list_series_by_task(task_id, include_all=True)
    if not rows:
        return [], [], [], [], "STUB", "year"

    variants = [str(r.get("variant") or "correct") for r in rows]
    granularity = _normalize_granularity(rows[0].get("granularity"))
    points_map: dict[str, dict[str, float]] = {}
    labels: set[str] = set()
    source = str(rows[0].get("source_name") or "STUB")

    for variant in variants:
        _, points = get_series_points_for_task(task_id, variant, include_all=True)
        norm = _normalize_points([dict(p) for p in points], granularity=granularity)
        points_map[variant] = norm
        labels.update(norm.keys())

    labels_sorted = sorted(labels, key=lambda item: _timeline_sort_key(item, granularity=granularity))
    if granularity == "day":
        axis_values = [int(idx) for idx in range(len(labels_sorted))]
        time_labels = [str(item) for item in labels_sorted]
    else:
        axis_values = []
        for item in labels_sorted:
            try:
                axis_values.append(int(str(item)))
            except Exception:
                continue
        if len(axis_values) != len(labels_sorted):
            labels_sorted = [str(year) for year in axis_values]
        time_labels = [str(item) for item in axis_values]
    series: list[AlgorithmSeries] = []
    for variant in variants:
        values = [float(points_map.get(variant, {}).get(label, 0.0)) for label in labels_sorted]
        series.append(AlgorithmSeries(variant=variant, values=values))
    return variants, axis_values, time_labels, series, source, granularity


def build_algorithm_dataset(
    task_id: str,
    task_type: str,
    word: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    data_source: str = "gbnc",
) -> AlgorithmDataset:
    owner_user_id = get_task_owner(task_id)
    current_user = {"id": int(owner_user_id), "roles": []} if owner_user_id is not None else None
    pulled = pull_external_snapshot_payload(
        word=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
        data_source=data_source,
    )
    persist_word_analysis_external_series(
        task_id,
        word,
        pulled,
        task_type=task_type,
        corpus=corpus,
        smoothing=smoothing,
    )
    var_names, years, time_labels, series, source_name, granularity = _load_dataset_from_task(task_id)
    return AlgorithmDataset(
        task_id=task_id,
        word=word,
        variants=var_names,
        years=years,
        series=series,
        source=source_name,
        granularity=granularity,
        time_labels=time_labels,
        warnings=[str(v) for v in (pulled.get("warnings") or [])],
        fallback_reason=pulled.get("error_reason"),
    )
