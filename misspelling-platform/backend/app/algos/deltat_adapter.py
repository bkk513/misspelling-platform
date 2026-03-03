from __future__ import annotations

from typing import Any

import numpy as np

from .types import AlgorithmDataset


def _safe_div(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    out = np.zeros_like(a, dtype=float)
    mask = np.abs(b) > 1e-12
    out[mask] = a[mask] / b[mask]
    return out


def _event_indices(values: np.ndarray, quantile: float) -> list[int]:
    if len(values) < 3:
        return []
    diff = np.abs(np.diff(values))
    threshold = float(np.quantile(diff, quantile))
    return [int(i + 1) for i, v in enumerate(diff) if float(v) >= threshold]


def _bootstrap_event_mean(
    values: np.ndarray,
    samples: int,
    quantile: float,
    rng: np.random.Generator,
) -> float | None:
    if len(values) < 3:
        return None
    idx_values: list[float] = []
    n = len(values)
    for _ in range(max(10, int(samples))):
        weights = rng.dirichlet(np.ones(n))
        weighted = values * weights
        events = _event_indices(weighted, quantile=quantile)
        if events:
            idx_values.append(float(np.mean(events)))
    if not idx_values:
        return None
    return float(np.mean(idx_values))


def run_delta_t(
    dataset: AlgorithmDataset,
    bootstrap_samples: int = 500,
    event_threshold_quantile: float = 0.9,
    random_seed: int = 42,
) -> dict[str, Any]:
    warnings = list(dataset.warnings)
    if not dataset.series or not dataset.years:
        return {
            "summary": {"points": 0, "observed_events": 0},
            "delta_t_stats": {"mean": None, "std": None},
            "events": [],
            "warnings": warnings + ["empty_dataset"],
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    correct = np.array(dataset.series[0].values, dtype=float)
    if len(dataset.series) > 1:
        miss = np.sum(np.array([s.values for s in dataset.series[1:]], dtype=float), axis=0)
    else:
        miss = np.zeros_like(correct)
        warnings.append("single_variant_dataset")
    ratio = _safe_div(miss, miss + correct)

    q = float(max(0.5, min(0.99, event_threshold_quantile)))
    observed_idx = _event_indices(ratio, q)
    rng = np.random.default_rng(int(random_seed))
    observed_mean = float(np.mean(observed_idx)) if observed_idx else None
    observed_boot = _bootstrap_event_mean(ratio, bootstrap_samples, q, rng)
    null_boot = _bootstrap_event_mean(np.array(ratio[rng.permutation(len(ratio))]), bootstrap_samples, q, rng)

    delta_values: list[float] = []
    if observed_boot is not None and null_boot is not None:
        delta_values.append(observed_boot - null_boot)

    events = [{"year": int(dataset.years[i]), "index": int(i)} for i in observed_idx]
    return {
        "summary": {
            "points": len(dataset.years),
            "observed_events": len(observed_idx),
            "threshold_quantile": q,
            "bootstrap_samples": int(bootstrap_samples),
        },
        "delta_t_stats": {
            "observed_mean_index": observed_mean,
            "bootstrap_observed_mean_index": observed_boot,
            "bootstrap_null_mean_index": null_boot,
            "mean": float(np.mean(delta_values)) if delta_values else None,
            "std": float(np.std(delta_values)) if delta_values else None,
        },
        "events": events,
        "warnings": warnings,
        "mode": dataset.mode,
        "impl": "internal_rewrite",
    }


def to_event_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload.get("events") or []:
        rows.append({"year": item.get("year"), "index": item.get("index")})
    return rows

