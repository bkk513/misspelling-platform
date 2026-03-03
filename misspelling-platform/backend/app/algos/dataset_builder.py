from typing import Any

from ..db.tasks_repo import get_task_owner
from ..db.time_series_repo import get_series_points_for_task, list_series_by_task
from ..services.gbnc_service import pull_gbnc_with_fallback
from ..services.timeseries_service import persist_word_analysis_external_series
from .types import AlgorithmDataset, AlgorithmSeries


def _normalize_points(rows: list[dict[str, Any]]) -> dict[int, float]:
    out: dict[int, float] = {}
    for row in rows:
        value = float(row.get("value") or 0.0)
        raw_time = str(row.get("t") or "")
        year_text = raw_time.split("-", 1)[0].strip()
        try:
            year = int(year_text)
        except Exception:
            continue
        out[year] = value
    return out


def _load_dataset_from_task(task_id: str) -> tuple[list[str], list[int], list[AlgorithmSeries], str]:
    rows = list_series_by_task(task_id, include_all=True)
    if not rows:
        return [], [], [], "STUB"

    variants = [str(r.get("variant") or "correct") for r in rows]
    points_map: dict[str, dict[int, float]] = {}
    years: set[int] = set()
    source = str(rows[0].get("source_name") or "STUB")

    for variant in variants:
        _, points = get_series_points_for_task(task_id, variant, include_all=True)
        norm = _normalize_points([dict(p) for p in points])
        points_map[variant] = norm
        years.update(norm.keys())

    years_sorted = sorted(years)
    series: list[AlgorithmSeries] = []
    for variant in variants:
        values = [float(points_map.get(variant, {}).get(y, 0.0)) for y in years_sorted]
        series.append(AlgorithmSeries(variant=variant, values=values))
    return variants, years_sorted, series, source


def build_algorithm_dataset(
    task_id: str,
    word: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
) -> AlgorithmDataset:
    owner_user_id = get_task_owner(task_id)
    pulled = pull_gbnc_with_fallback(
        term=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        actor_user_id=owner_user_id,
    )
    persist_word_analysis_external_series(task_id, word, pulled)
    var_names, years, series, source_name = _load_dataset_from_task(task_id)
    return AlgorithmDataset(
        task_id=task_id,
        word=word,
        variants=var_names,
        years=years,
        series=series,
        source=source_name,
        warnings=[str(v) for v in (pulled.get("warnings") or [])],
        fallback_reason=pulled.get("error_reason"),
    )

