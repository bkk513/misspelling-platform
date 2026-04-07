from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median
from typing import Any

import numpy as np
from fastapi import HTTPException
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from sqlalchemy import bindparam, text

from ..db.audit_logs_repo import insert_audit_log
from ..db.core import get_engine
from ..db.lexicon_repo import list_variants as list_lexicon_variants
from ..db.projects_repo import (
    bind_project_task,
    get_project,
    list_project_tasks,
    list_project_term_memberships,
    list_project_terms,
)
from .variant_review_service import review_misspelling_variants
from ..services.task_service import (
    create_delta_t_null_task,
    create_mrnmr_steady_task,
    create_pcmci_causal_task,
    create_simulation_task,
    create_word_analysis_task,
)

DEFAULT_REQUIRED_TASKS = ["word-analysis", "pcmci-causal", "mrnmr-steady", "deltaT-null"]
OPTIONAL_TASKS = ["simulation-run"]
ACTIVE_TASK_STATES = {"QUEUED", "RUNNING", "PROGRESS"}
SUCCESS_TASK_STATE = "SUCCESS"
TERMINAL_TASK_STATES = {"SUCCESS", "FAILURE", "REVOKED", "DELETED"}
DEFAULT_START_YEAR = 1900
DEFAULT_END_YEAR = 2019
DEFAULT_SMOOTHING = 3
DEFAULT_CORPUS = "eng_2019"
METRIC_LABELS = {
    "avg_misspelling_rate": "Average Misspelling Rate",
    "peak_misspelling_rate": "Peak Misspelling Rate",
    "steady_lag_years": "Stabilization Lag",
    "delta_t_years": "Delta-T",
    "variant_count": "Variant Count",
    "causal_edge_count": "Causal Edge Count",
    "causal_mean_strength": "Causal Mean Strength",
    "causal_window_count": "Causal Window Count",
    "simulation_best_score": "Simulation Best Score",
}


def _normalize_word(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_micro_task_type(value: Any) -> str:
    task_type = str(value or "").strip().lower()
    if task_type in {"causal-work", "casual-work", "causal_work"}:
        return "pcmci-causal"
    return task_type


def _normalize_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except Exception:
            return str(value)
    if isinstance(value, str):
        text_value = value.strip()
        for _ in range(2):
            if not text_value or text_value[0] not in "[{":
                break
            try:
                decoded = json.loads(text_value)
            except Exception:
                break
            if isinstance(decoded, str):
                text_value = decoded
                continue
            return decoded
        return text_value
    return str(value)


def _safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except Exception:
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return float(sum(values) / len(values))


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return float(median(values))


def _std(values: list[float]) -> float | None:
    if len(values) < 2:
        return 0.0 if values else None
    mean_value = float(sum(values) / len(values))
    variance = float(sum((item - mean_value) ** 2 for item in values) / (len(values) - 1))
    return float(math.sqrt(max(0.0, variance)))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def ensure_meso_project_access(project_id: int, current_user: dict | None) -> dict[str, Any]:
    if current_user is None:
        raise HTTPException(status_code=403, detail="login required for analytics workspace")
    row = get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="project not found")
    if _is_admin(current_user):
        return dict(row)
    owner_user_id = row.get("owner_user_id")
    user_id = _owner_id(current_user)
    if user_id is not None and owner_user_id == user_id:
        return dict(row)
    raise HTTPException(status_code=403, detail="forbidden")


def _membership_index(project_id: int) -> tuple[dict[int, list[dict[str, Any]]], dict[str, int]]:
    rows = [dict(row) for row in list_project_term_memberships(project_id)]
    by_term: dict[int, list[dict[str, Any]]] = defaultdict(list)
    category_sizes: dict[str, int] = defaultdict(int)
    for row in rows:
        term_id = int(row.get("term_id") or 0)
        cohort_name = str(row.get("cohort_name") or "custom")
        if term_id <= 0:
            continue
        item = {
            "cohort_id": int(row.get("cohort_id") or 0),
            "cohort_name": cohort_name,
            "weight": float(row.get("membership_weight") or 1.0),
            "confidence": float(row.get("confidence") or 1.0),
            "source": str(row.get("source") or "manual"),
            "color": row.get("cohort_color"),
        }
        by_term[term_id].append(item)
    for term_id, items in by_term.items():
        sorted_items = sorted(items, key=lambda item: (item["weight"], item["confidence"]), reverse=True)
        by_term[term_id] = sorted_items
        if sorted_items:
            category_sizes[sorted_items[0]["cohort_name"]] += 1
    return by_term, dict(category_sizes)


def _resolve_terms(
    project_id: int,
    owner_user_id: int | None,
    cohort_names: list[str] | None,
    term_ids: list[int] | None,
) -> list[dict[str, Any]]:
    selected_cohorts = {_normalize_word(name) for name in (cohort_names or []) if _normalize_word(name)}
    selected_term_ids = {int(value) for value in (term_ids or []) if int(value) > 0}
    memberships_by_term, _ = _membership_index(project_id)
    rows = [dict(row) for row in list_project_terms(project_id)]
    resolved: list[dict[str, Any]] = []
    for row in rows:
        term_id = int(row.get("term_id") or 0)
        canonical = _normalize_word(row.get("canonical"))
        memberships = memberships_by_term.get(term_id, [])
        cohort_names_for_term = [str(item["cohort_name"]) for item in memberships]
        primary_cohort = cohort_names_for_term[0] if cohort_names_for_term else str(row.get("category") or "custom")
        if selected_cohorts and _normalize_word(primary_cohort) not in selected_cohorts:
            continue
        if selected_term_ids and term_id not in selected_term_ids:
            continue
        raw_variants = [
            _normalize_word(item.get("variant"))
            for item in list_lexicon_variants(term_id, owner_user_id=owner_user_id, include_all=False)
            if _normalize_word(item.get("variant")) and _normalize_word(item.get("variant")) != canonical
        ]
        review = review_misspelling_variants(canonical, raw_variants)
        resolved.append(
            {
                "term_id": term_id,
                "canonical": canonical,
                "category": str(row.get("category") or "custom"),
                "primary_cohort": primary_cohort,
                "cohort_names": cohort_names_for_term,
                "variants": sorted(dict.fromkeys([str(item) for item in (review.get("accepted_variants") or [])])),
                "variant_filter_warnings": [str(item) for item in (review.get("warnings") or [])],
            }
        )
    return sorted(resolved, key=lambda item: (item["primary_cohort"], item["canonical"]))


def _common_task_params(term: dict[str, Any], data_source: str) -> dict[str, Any]:
    return {
        "word": term["canonical"],
        "variants": term["variants"],
        "start_year": DEFAULT_START_YEAR,
        "end_year": DEFAULT_END_YEAR,
        "smoothing": DEFAULT_SMOOTHING,
        "corpus": DEFAULT_CORPUS,
        "data_source": str(data_source or "gbnc"),
    }


def _task_data_source(params: dict[str, Any] | None) -> str:
    if not isinstance(params, dict):
        return "gbnc"
    return str(params.get("data_source") or "gbnc").strip().lower() or "gbnc"


def _build_project_task_index(project_id: int) -> tuple[dict[tuple[str, str, str], dict[str, Any]], dict[tuple[str, str, str], dict[str, Any]]]:
    rows = [dict(row) for row in list_project_tasks(project_id, limit=4000)]
    latest_any: dict[tuple[str, str, str], dict[str, Any]] = {}
    latest_success: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        task_type = _normalize_micro_task_type(row.get("task_type"))
        params = _normalize_jsonish(row.get("params_json"))
        result = _normalize_jsonish(row.get("result_json"))
        word = _normalize_word(params.get("word") if isinstance(params, dict) else "")
        if not word or not task_type:
            continue
        data_source = _task_data_source(params if isinstance(params, dict) else {})
        status = str(row.get("status") or "").upper()
        key = (word, task_type, data_source)
        normalized = {
            **row,
            "task_type": task_type,
            "status": status,
            "params": params if isinstance(params, dict) else {},
            "result": result if isinstance(result, dict) else {},
            "word": word,
            "data_source": data_source,
        }
        if key not in latest_any:
            latest_any[key] = normalized
        if status == SUCCESS_TASK_STATE and key not in latest_success:
            latest_success[key] = normalized
    return latest_any, latest_success


def _create_micro_task(
    task_type: str,
    term: dict[str, Any],
    owner_user_id: int | None,
    celery_task_map: dict[str, Any],
    data_source: str,
) -> dict[str, Any]:
    params = _common_task_params(term, data_source)
    if task_type == "word-analysis":
        return create_word_analysis_task(
            term["canonical"],
            celery_task_map[task_type],
            owner_user_id=owner_user_id,
            guest_key=None,
            extra_params={key: value for key, value in params.items() if key != "word"},
        )
    if task_type == "pcmci-causal":
        return create_pcmci_causal_task(
            {
                **params,
                "tau_max": 8,
                "window_size": 24,
                "window_step": 0,
                "alpha_level": 0.01,
                "pc_alpha": None,
            },
            celery_task_map[task_type],
            owner_user_id=owner_user_id,
            guest_key=None,
        )
    if task_type == "mrnmr-steady":
        return create_mrnmr_steady_task(params, celery_task_map[task_type], owner_user_id=owner_user_id, guest_key=None)
    if task_type == "deltaT-null":
        return create_delta_t_null_task(params, celery_task_map[task_type], owner_user_id=owner_user_id, guest_key=None)
    if task_type == "simulation-run":
        return create_simulation_task(
            {
                **params,
                "topology": "auto",
                "n_agents": 720,
                "search_rounds": 36,
                "repeats": 3,
                "fit_profile": "publication",
                "trend_window": 3,
                "ws_k": 8,
                "ws_p": 0.08,
                "ba_m": 4,
                "random_seed": 42,
                "variant_scope": "typo_only",
            },
            celery_task_map[task_type],
            owner_user_id=owner_user_id,
            guest_key=None,
        )
    raise HTTPException(status_code=400, detail=f"unsupported micro task type: {task_type}")


def prepare_meso_tasks_payload(
    project_id: int,
    cohort_names: list[str] | None,
    term_ids: list[int] | None,
    include_simulation: bool,
    data_source: str,
    current_user: dict | None,
    celery_task_map: dict[str, Any],
) -> dict[str, Any]:
    project = ensure_meso_project_access(project_id, current_user)
    owner_user_id = int(project.get("owner_user_id") or 0) or None
    selected_terms = _resolve_terms(project_id, owner_user_id, cohort_names, term_ids)
    if not selected_terms:
        raise HTTPException(status_code=400, detail="no terms selected for meso preparation")

    required_tasks = list(DEFAULT_REQUIRED_TASKS)
    if include_simulation:
        required_tasks.extend(OPTIONAL_TASKS)

    latest_any, _ = _build_project_task_index(project_id)
    created_tasks: list[dict[str, Any]] = []
    reused_tasks: list[dict[str, Any]] = []
    skipped_terms: list[dict[str, Any]] = []
    watched_task_ids: list[str] = []
    task_matrix: list[dict[str, Any]] = []

    for term in selected_terms:
        status_items: list[dict[str, Any]] = []
        missing_variants = not bool(term["variants"])
        for task_type in required_tasks:
            existing = latest_any.get((term["canonical"], task_type, str(data_source or "gbnc").lower()))
            if existing and existing["status"] in ACTIVE_TASK_STATES.union({SUCCESS_TASK_STATE}):
                record = {
                    "task_id": str(existing["task_id"]),
                    "task_type": task_type,
                    "word": term["canonical"],
                    "status": existing["status"],
                    "mode": "reused",
                }
                reused_tasks.append(record)
                status_items.append(record)
                if existing["status"] in ACTIVE_TASK_STATES:
                    watched_task_ids.append(str(existing["task_id"]))
                continue

            if missing_variants:
                status_items.append(
                    {
                        "task_type": task_type,
                        "word": term["canonical"],
                        "status": "SKIPPED",
                        "mode": "skipped",
                        "reason": "missing_variants",
                    }
                )
                continue

            created = _create_micro_task(task_type, term, owner_user_id, celery_task_map, data_source)
            bind_project_task(project_id, str(created["task_id"]))
            record = {
                "task_id": str(created["task_id"]),
                "task_type": task_type,
                "word": term["canonical"],
                "status": "QUEUED",
                "mode": "created",
            }
            created_tasks.append(record)
            status_items.append(record)
            watched_task_ids.append(str(created["task_id"]))

        if any(item.get("status") == "SKIPPED" for item in status_items):
            skipped_terms.append(
                {
                    "term_id": term["term_id"],
                    "canonical": term["canonical"],
                    "primary_cohort": term["primary_cohort"],
                    "reason": "missing_variants",
                }
            )
        task_matrix.append(
            {
                "term_id": term["term_id"],
                "canonical": term["canonical"],
                "primary_cohort": term["primary_cohort"],
                "variants": term["variants"],
                "task_statuses": status_items,
            }
        )

    unique_watch_ids = list(dict.fromkeys(watched_task_ids))
    result = {
        "project_id": project_id,
        "selected_term_count": len(selected_terms),
        "selected_terms": [
            {
                "term_id": term["term_id"],
                "canonical": term["canonical"],
                "primary_cohort": term["primary_cohort"],
                "variants": term["variants"],
            }
            for term in selected_terms
        ],
        "required_micro_tasks": required_tasks,
        "data_source": str(data_source or "gbnc"),
        "created_tasks": created_tasks,
        "reused_tasks": reused_tasks,
        "skipped_terms": skipped_terms,
        "watched_task_ids": unique_watch_ids,
        "task_matrix": task_matrix,
    }
    insert_audit_log(
        action="MESO_PREPARE",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={
            "selected_terms": len(selected_terms),
            "created_tasks": len(created_tasks),
            "reused_tasks": len(reused_tasks),
            "include_simulation": include_simulation,
            "data_source": str(data_source or "gbnc"),
        },
    )
    return result


def _load_word_analysis_points(task_ids: list[str]) -> dict[str, dict[str, dict[int, float]]]:
    if not task_ids:
        return {}
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT
                      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')), 'null') AS task_id,
                      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.variant')), 'null'), lt.canonical) AS variant,
                      YEAR(tp.t) AS year,
                      AVG(tp.value) AS value
                    FROM time_series ts
                    JOIN lexicon_terms lt ON lt.id = ts.term_id
                    JOIN time_series_points tp ON tp.series_id = ts.id
                    WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ts.meta_json, '$.task_id')), 'null') IN :task_ids
                    GROUP BY task_id, variant, YEAR(tp.t)
                    ORDER BY task_id ASC, year ASC, variant ASC
                    """
                ).bindparams(bindparam("task_ids", expanding=True)),
                {"task_ids": task_ids},
            )
            .mappings()
            .all()
        )
    grouped: dict[str, dict[str, dict[int, float]]] = defaultdict(lambda: defaultdict(dict))
    for row in rows:
        grouped[str(row["task_id"])][_normalize_word(row["variant"])][int(row["year"])] = float(row["value"] or 0.0)
    return {task_id: {variant: dict(points) for variant, points in variants.items()} for task_id, variants in grouped.items()}


def _derive_rate_metrics(canonical: str, series_map: dict[str, dict[int, float]]) -> dict[str, Any]:
    normalized_canonical = _normalize_word(canonical)
    year_set = sorted({year for points in series_map.values() for year in points.keys()})
    if not year_set:
        return {
            "avg_misspelling_rate": None,
            "peak_misspelling_rate": None,
            "peak_year": None,
            "first_year": None,
            "last_year": None,
            "observation_years": 0,
        }

    rates: list[tuple[int, float]] = []
    for year in year_set:
        correct_value = float(series_map.get(normalized_canonical, {}).get(year, 0.0))
        miss_value = float(
            sum(value_map.get(year, 0.0) for variant, value_map in series_map.items() if _normalize_word(variant) != normalized_canonical)
        )
        total = correct_value + miss_value
        if total <= 0:
            continue
        rates.append((year, float(miss_value / total)))

    if not rates:
        return {
            "avg_misspelling_rate": None,
            "peak_misspelling_rate": None,
            "peak_year": None,
            "first_year": int(year_set[0]),
            "last_year": int(year_set[-1]),
            "observation_years": 0,
        }

    peak_year, peak_rate = max(rates, key=lambda item: item[1])
    return {
        "avg_misspelling_rate": float(sum(rate for _, rate in rates) / len(rates)),
        "peak_misspelling_rate": float(peak_rate),
        "peak_year": int(peak_year),
        "first_year": int(year_set[0]),
        "last_year": int(year_set[-1]),
        "observation_years": int(len(rates)),
    }


def _summary_of(task_row: dict[str, Any] | None) -> dict[str, Any]:
    if not task_row:
        return {}
    result = task_row.get("result") or {}
    summary = result.get("summary") if isinstance(result, dict) else None
    return summary if isinstance(summary, dict) else {}


def _result_of(task_row: dict[str, Any] | None) -> dict[str, Any]:
    if not task_row:
        return {}
    result = task_row.get("result") or {}
    return result if isinstance(result, dict) else {}


def _float_metric(summary: dict[str, Any], key: str) -> float | None:
    return _safe_float(summary.get(key))


def _int_metric(summary: dict[str, Any], key: str) -> int | None:
    value = summary.get(key)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _cluster_label(center: dict[str, float | None], baselines: dict[str, tuple[float, float]]) -> str:
    parts: list[str] = []
    rate = center.get("avg_misspelling_rate")
    variants = center.get("variant_count")
    steady = center.get("steady_lag_years")
    delta_t = center.get("delta_t_years")
    causal = center.get("causal_mean_strength")

    if rate is not None:
        low, high = baselines.get("avg_misspelling_rate", (rate, rate))
        if rate >= high:
            parts.append("high-misspelling")
        elif rate <= low:
            parts.append("low-misspelling")
        else:
            parts.append("mid-misspelling")
    if variants is not None:
        low, high = baselines.get("variant_count", (variants, variants))
        if variants >= high:
            parts.append("multi-variant")
        elif variants <= low:
            parts.append("few-variant")
    if steady is not None:
        low, high = baselines.get("steady_lag_years", (steady, steady))
        if steady >= high:
            parts.append("late-stable")
        elif steady <= low:
            parts.append("early-stable")
    elif delta_t is not None:
        low, high = baselines.get("delta_t_years", (delta_t, delta_t))
        if delta_t >= high:
            parts.append("high-delta")
        elif delta_t <= low:
            parts.append("low-delta")
    if causal is not None:
        low, high = baselines.get("causal_mean_strength", (causal, causal))
        if causal >= high:
            parts.append("strong-causal")
        elif causal <= low:
            parts.append("weak-causal")

    if not parts:
        return "mixed-pattern"
    return "-".join(parts[:3])


def _nearest_terms(
    rows: list[dict[str, Any]],
    cluster_indices: list[int],
    center_vec: np.ndarray,
    feature_keys: list[str],
    fill_values: dict[str, float],
    scaler: StandardScaler,
) -> list[str]:
    if not cluster_indices:
        return []
    matrix = []
    names = []
    for row_index in cluster_indices:
        row = rows[row_index]
        names.append(str(row["canonical"]))
        matrix.append([float(row.get(key) if row.get(key) is not None else fill_values[key]) for key in feature_keys])
    raw = np.array(matrix, dtype=float)
    scaled = scaler.transform(raw)
    distances = np.linalg.norm(scaled - center_vec, axis=1)
    ranked = [name for _, name in sorted(zip(distances.tolist(), names), key=lambda item: item[0])]
    return ranked[:5]


def _build_category_profiles(feature_rows: list[dict[str, Any]], categories: list[str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    metric_keys = [
        "avg_misspelling_rate",
        "peak_misspelling_rate",
        "steady_lag_years",
        "delta_t_years",
        "variant_count",
        "causal_edge_count",
        "causal_mean_strength",
        "simulation_best_score",
    ]
    profiles: list[dict[str, Any]] = []
    comparison_metrics = [
        {"key": key, "label": METRIC_LABELS.get(key, key)}
        for key in metric_keys
    ]
    heatmap_rows: list[dict[str, Any]] = []
    metric_value_map: dict[str, list[float]] = defaultdict(list)

    for category in categories:
        members = [row for row in feature_rows if str(row.get("primary_cohort") or "custom") == category]
        metric_payload: dict[str, Any] = {}
        representative_terms = [str(item["canonical"]) for item in members[:5]]
        for key in metric_keys:
            values = [float(row[key]) for row in members if row.get(key) is not None]
            metric_payload[key] = {
                "mean": _mean(values),
                "median": _median(values),
                "std": _std(values),
                "non_null": len(values),
            }
            if metric_payload[key]["mean"] is not None:
                metric_value_map[key].append(float(metric_payload[key]["mean"]))
        profiles.append(
            {
                "category": category,
                "term_count": len(members),
                "representative_terms": representative_terms,
                "metrics": metric_payload,
            }
        )

    for profile in profiles:
        values = []
        for metric in comparison_metrics:
            key = metric["key"]
            mean_value = profile["metrics"][key]["mean"]
            scale_values = metric_value_map.get(key) or []
            if mean_value is None or not scale_values:
                score = None
            else:
                min_value = min(scale_values)
                max_value = max(scale_values)
                if math.isclose(min_value, max_value):
                    score = 0.5
                else:
                    score = float((mean_value - min_value) / (max_value - min_value))
            values.append(
                {
                    "key": key,
                    "label": METRIC_LABELS.get(key, key),
                    "mean": mean_value,
                    "score": score,
                }
            )
        heatmap_rows.append({"category": profile["category"], "values": values})

    distributions = []
    for key in ["avg_misspelling_rate", "peak_misspelling_rate", "delta_t_years", "causal_mean_strength"]:
        groups = []
        for category in categories:
            values = [float(row[key]) for row in feature_rows if str(row.get("primary_cohort") or "custom") == category and row.get(key) is not None]
            groups.append({"category": category, "values": values})
        distributions.append({"key": key, "label": METRIC_LABELS.get(key, key), "groups": groups})

    return profiles, {
        "metrics": comparison_metrics,
        "heatmap": heatmap_rows,
        "distributions": distributions,
    }


def _build_cluster_payload(feature_rows: list[dict[str, Any]], cluster_k: int) -> dict[str, Any]:
    feature_keys = [
        "avg_misspelling_rate",
        "peak_misspelling_rate",
        "steady_lag_years",
        "delta_t_years",
        "variant_count",
        "causal_mean_strength",
    ]
    usable_keys = []
    fill_values: dict[str, float] = {}
    for key in feature_keys:
        values = [float(row[key]) for row in feature_rows if row.get(key) is not None]
        if not values:
            continue
        usable_keys.append(key)
        fill_values[key] = float(median(values))

    if not feature_rows or not usable_keys:
        return {
            "k": 0,
            "features": [],
            "feature_labels": {},
            "diagnostics": {"silhouette": None, "pca_explained_variance": []},
            "scatter": [],
            "clusters": [],
        }

    matrix = np.array(
        [
            [float(row.get(key) if row.get(key) is not None else fill_values[key]) for key in usable_keys]
            for row in feature_rows
        ],
        dtype=float,
    )
    scaler = StandardScaler()
    scaled = scaler.fit_transform(matrix)
    sample_count = scaled.shape[0]
    safe_k = max(1, min(int(cluster_k or 3), sample_count))

    if sample_count == 1:
        scatter = [
            {
                "term_id": int(feature_rows[0]["term_id"]),
                "canonical": str(feature_rows[0]["canonical"]),
                "primary_cohort": str(feature_rows[0]["primary_cohort"]),
                "cluster_id": 0,
                "cluster_label": "single-term",
                "x": 0.0,
                "y": 0.0,
            }
        ]
        return {
            "k": 1,
            "features": usable_keys,
            "feature_labels": {key: METRIC_LABELS.get(key, key) for key in usable_keys},
            "diagnostics": {"silhouette": None, "pca_explained_variance": []},
            "scatter": scatter,
            "clusters": [
                {
                    "cluster_id": 0,
                    "label": "single-term",
                    "size": 1,
                    "representative_terms": [str(feature_rows[0]["canonical"])],
                    "centroid": {key: float(matrix[0, idx]) for idx, key in enumerate(usable_keys)},
                }
            ],
        }

    model = KMeans(n_clusters=safe_k, random_state=42, n_init=20)
    labels = model.fit_predict(scaled)
    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(scaled)
    explained = [float(value) for value in pca.explained_variance_ratio_.tolist()]
    silhouette = None
    if len(set(labels.tolist())) > 1:
        silhouette = float(silhouette_score(scaled, labels))

    baselines: dict[str, tuple[float, float]] = {}
    for key in usable_keys:
        values = sorted(float(row[key]) for row in feature_rows if row.get(key) is not None)
        if not values:
            continue
        low_index = max(0, int(len(values) * 0.33) - 1)
        high_index = min(len(values) - 1, int(len(values) * 0.66))
        baselines[key] = (float(values[low_index]), float(values[high_index]))

    scatter = []
    clusters = []
    for cluster_id in sorted(set(labels.tolist())):
        indices = [index for index, label in enumerate(labels.tolist()) if label == cluster_id]
        center_scaled = model.cluster_centers_[cluster_id]
        center_raw = scaler.inverse_transform(center_scaled.reshape(1, -1))[0]
        center_dict = {key: float(center_raw[idx]) for idx, key in enumerate(usable_keys)}
        label_text = _cluster_label(center_dict, baselines)
        for row_index in indices:
            row = feature_rows[row_index]
            scatter.append(
                {
                    "term_id": int(row["term_id"]),
                    "canonical": str(row["canonical"]),
                    "primary_cohort": str(row["primary_cohort"]),
                    "cluster_id": int(cluster_id),
                    "cluster_label": label_text,
                    "x": float(coords[row_index, 0]),
                    "y": float(coords[row_index, 1]),
                }
            )
        clusters.append(
            {
                "cluster_id": int(cluster_id),
                "label": label_text,
                "size": len(indices),
                "representative_terms": _nearest_terms(feature_rows, indices, center_scaled, usable_keys, fill_values, scaler),
                "centroid": center_dict,
                "terms": [str(feature_rows[index]["canonical"]) for index in indices],
            }
        )

    return {
        "k": safe_k,
        "features": usable_keys,
        "feature_labels": {key: METRIC_LABELS.get(key, key) for key in usable_keys},
        "diagnostics": {"silhouette": silhouette, "pca_explained_variance": explained},
        "scatter": sorted(scatter, key=lambda item: (item["cluster_id"], item["canonical"])),
        "clusters": sorted(clusters, key=lambda item: item["cluster_id"]),
    }


def build_meso_result_payload(
    project_id: int,
    owner_user_id: int | None,
    cohort_names: list[str] | None,
    term_ids: list[int] | None,
    cluster_k: int,
    include_simulation: bool,
    data_source: str = "gbnc",
) -> dict[str, Any]:
    selected_terms = _resolve_terms(project_id, owner_user_id, cohort_names, term_ids)
    if not selected_terms:
        raise HTTPException(status_code=400, detail="no terms selected for meso analysis")

    _, latest_success = _build_project_task_index(project_id)
    word_task_ids = [
        str(task["task_id"])
        for term in selected_terms
        for task in [latest_success.get((term["canonical"], "word-analysis", str(data_source or "gbnc").lower()))]
        if task
    ]
    word_series = _load_word_analysis_points(word_task_ids)

    required_tasks = list(DEFAULT_REQUIRED_TASKS)
    if include_simulation:
        required_tasks.extend(OPTIONAL_TASKS)

    feature_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    for term in selected_terms:
        key_source = str(data_source or "gbnc").lower()
        word_task = latest_success.get((term["canonical"], "word-analysis", key_source))
        steady_task = latest_success.get((term["canonical"], "mrnmr-steady", key_source))
        delta_task = latest_success.get((term["canonical"], "deltaT-null", key_source))
        causal_task = latest_success.get((term["canonical"], "pcmci-causal", key_source))
        simulation_task = latest_success.get((term["canonical"], "simulation-run", key_source))

        rates = _derive_rate_metrics(term["canonical"], word_series.get(str(word_task["task_id"]), {}) if word_task else {})
        steady_summary = _summary_of(steady_task)
        delta_summary = _summary_of(delta_task)
        causal_summary = _summary_of(causal_task)
        causal_result = _result_of(causal_task)
        simulation_summary = _summary_of(simulation_task)

        first_year = rates.get("first_year")
        steady_year = _int_metric(steady_summary, "steady_year")
        actual_mutation_year = _int_metric(delta_summary, "actual_mutation_year")
        predicted_mutation_year = _int_metric(delta_summary, "predicted_mutation_year")
        turning_year = actual_mutation_year or predicted_mutation_year

        steady_lag_years = None
        if first_year is not None and steady_year is not None:
            steady_lag_years = float(max(0, steady_year - first_year))

        available_tasks = [
            task_type
            for task_type in required_tasks
            if latest_success.get((term["canonical"], task_type, key_source)) is not None
        ]
        missing_tasks = [task_type for task_type in required_tasks if task_type not in available_tasks]
        if missing_tasks:
            warnings.append(f"partial_micro_results:{term['canonical']}:{','.join(missing_tasks)}")

        feature_rows.append(
            {
                "term_id": int(term["term_id"]),
                "canonical": term["canonical"],
                "primary_cohort": term["primary_cohort"],
                "cohort_names": term["cohort_names"],
                "variant_count": float(len(term["variants"])),
                "avg_misspelling_rate": rates.get("avg_misspelling_rate"),
                "peak_misspelling_rate": rates.get("peak_misspelling_rate"),
                "peak_year": rates.get("peak_year"),
                "first_year": first_year,
                "last_year": rates.get("last_year"),
                "steady_year": steady_year,
                "steady_lag_years": steady_lag_years,
                "turning_point_year": turning_year,
                "delta_t_years": _float_metric(delta_summary, "delta_t_years"),
                "causal_edge_count": float(
                    _int_metric(causal_summary, "edges")
                    or len(causal_result.get("edges") or [])
                    or 0
                ),
                "causal_mean_strength": _mean(
                    [abs(float(edge.get("weight") or 0.0)) for edge in (causal_result.get("edges") or [])]
                ),
                "causal_window_count": float(_int_metric(causal_summary, "windows") or len(causal_result.get("window_results") or []) or 0),
                "simulation_best_score": _float_metric(simulation_summary, "best_score"),
                "simulation_fit_grade": str(simulation_summary.get("fit_grade") or "") or None,
                "micro_ready": not missing_tasks,
                "available_tasks": available_tasks,
                "missing_tasks": missing_tasks,
            }
        )

    feature_rows = sorted(feature_rows, key=lambda item: (str(item["primary_cohort"]), str(item["canonical"])))
    categories = sorted(dict.fromkeys(str(row.get("primary_cohort") or "custom") for row in feature_rows))
    category_profiles, comparison = _build_category_profiles(feature_rows, categories)
    clustering = _build_cluster_payload(feature_rows, cluster_k)

    coverage = {}
    for task_type in required_tasks:
        ready_terms = sum(1 for row in feature_rows if task_type in (row.get("available_tasks") or []))
        coverage[task_type] = {
            "ready_terms": int(ready_terms),
            "coverage_ratio": float(ready_terms / max(1, len(feature_rows))),
        }

    result = {
        "version": "meso-v2",
        "project_id": project_id,
        "summary": {
            "selected_terms": len(feature_rows),
            "selected_categories": len(categories),
            "cluster_k": int(clustering.get("k") or 0),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "required_micro_tasks": required_tasks,
            "data_source": str(data_source or "gbnc"),
            "ready_terms": int(sum(1 for row in feature_rows if row.get("micro_ready"))),
            "ready_ratio": float(sum(1 for row in feature_rows if row.get("micro_ready")) / max(1, len(feature_rows))),
        },
        "selection": {
            "categories": categories,
            "term_ids": [int(term["term_id"]) for term in selected_terms],
            "terms": [
                {
                    "term_id": int(term["term_id"]),
                    "canonical": term["canonical"],
                    "primary_cohort": term["primary_cohort"],
                }
                for term in selected_terms
            ],
        },
        "coverage": {
            "required_micro_tasks": required_tasks,
            "task_coverage": coverage,
            "missing_terms": [
                {
                    "term_id": int(row["term_id"]),
                    "canonical": str(row["canonical"]),
                    "missing_tasks": row.get("missing_tasks") or [],
                }
                for row in feature_rows
                if row.get("missing_tasks")
            ],
        },
        "category_profiles": category_profiles,
        "comparison": comparison,
        "clustering": clustering,
        "feature_rows": feature_rows,
        "warnings": sorted(dict.fromkeys(warnings)),
    }
    return result
