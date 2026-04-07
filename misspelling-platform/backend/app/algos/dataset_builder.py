"""文件说明：算法数据集构建模块，负责把词分析任务数据整理成各算法统一使用的数据结构。"""

from typing import Any

from ..db.tasks_repo import get_task_guest_key, get_task_owner
from ..db.time_series_repo import get_series_points_for_task, list_series_by_task
from ..services.gbnc_data_service import pull_gbnc_snapshot_payload
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
    # 算法层不直接查散乱的点数据，而是先把一个任务下的各变体序列整理成统一矩阵结构。
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
    task_type: str,
    word: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
) -> AlgorithmDataset:
    # 算法运行前总会先复用或补拉一次 GBNC 数据，再把结果持久化到时序表，后续多个算法共用同一份输入。
    owner_user_id = get_task_owner(task_id)
    task_guest_key = get_task_guest_key(task_id)
    current_user = {"id": int(owner_user_id), "roles": []} if owner_user_id is not None else None
    pulled = pull_gbnc_snapshot_payload(
        word=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
        guest_key=task_guest_key,
    )
    persist_word_analysis_external_series(
        task_id,
        word,
        pulled,
        task_type=task_type,
        corpus=corpus,
        smoothing=smoothing,
    )
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
