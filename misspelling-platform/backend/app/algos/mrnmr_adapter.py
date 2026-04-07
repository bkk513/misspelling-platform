"""文件说明：MRNMR 稳态分析算法适配模块，负责评估词项演化过程中的稳态与突变信号。"""

from __future__ import annotations

from typing import Any

import numpy as np

from .types import AlgorithmDataset


def _safe_div(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    out = np.zeros_like(a, dtype=float)
    mask = np.abs(b) > 1e-12
    out[mask] = a[mask] / b[mask]
    return out


def _density_scores(nmr: np.ndarray, mr: np.ndarray, bandwidth: str) -> np.ndarray:
    try:
        from scipy.stats import gaussian_kde

        values = np.vstack([nmr, mr])
        kde = gaussian_kde(values, bw_method=bandwidth)
        return kde(values)
    except Exception:
        m_nmr = float(np.mean(nmr))
        m_mr = float(np.mean(mr))
        d = (nmr - m_nmr) ** 2 + (mr - m_mr) ** 2
        return 1.0 / (1.0 + d)


def _origin_index(years: list[int], origin_year: int | None) -> int:
    if not years:
        return 0
    if origin_year is None:
        return 0
    target = int(origin_year)
    for idx, year in enumerate(years):
        if int(year) >= target:
            return idx
    return max(0, len(years) - 1)


def run_mrnmr(
    dataset: AlgorithmDataset,
    origin_year: int | None = None,
    tipping_index: int = 0,
    kde_bandwidth: str = "scott",
    poly_degree: int = 20,
) -> dict[str, Any]:
    warnings = list(dataset.warnings)
    if not dataset.series or not dataset.years:
        return {
            "summary": {
                "points": 0,
                "steady_index": None,
                "tipping_index": int(tipping_index),
                "origin_year": origin_year,
            },
            "metrics": [],
            "warnings": warnings + ["empty_dataset"],
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    absolute_origin_index = _origin_index(dataset.years, origin_year)
    analysis_years = dataset.years[absolute_origin_index:]
    if len(analysis_years) < 3:
        warnings.append("insufficient_points_after_origin")
        return {
            "summary": {
                "points": len(analysis_years),
                "steady_index": None,
                "tipping_index": absolute_origin_index,
                "origin_year": int(dataset.years[absolute_origin_index]),
            },
            "metrics": [],
            "warnings": warnings,
            "mode": dataset.mode,
            "impl": "internal_rewrite",
        }

    correct = np.array(dataset.series[0].values[absolute_origin_index:], dtype=float)
    if len(dataset.series) > 1:
        miss = np.sum(np.array([s.values[absolute_origin_index:] for s in dataset.series[1:]], dtype=float), axis=0)
    else:
        miss = np.zeros_like(correct)
        warnings.append("single_variant_dataset")

    total_signal = miss + correct
    mr = _safe_div(miss, total_signal)
    nmr = _safe_div(correct, miss)
    density = _density_scores(nmr, mr, bandwidth=kde_bandwidth)
    steady_index = int(np.argmax(density)) if len(density) > 0 else 0

    metrics = []
    for idx, year in enumerate(analysis_years):
        metrics.append(
            {
                "year": int(year),
                "misspelling": float(miss[idx]),
                "correct": float(correct[idx]),
                "signal_total": float(total_signal[idx]),
                "noise_misspelling": float(miss[idx]),
                "MR": float(mr[idx]),
                "NMR": float(nmr[idx]),
                "density": float(density[idx]),
            }
        )

    origin_year_value = int(analysis_years[0])
    return {
        "summary": {
            "points": len(analysis_years),
            "origin_index": absolute_origin_index,
            "origin_year": origin_year_value,
            "tipping_index": absolute_origin_index,
            "tipping_year": origin_year_value,
            "steady_index": steady_index,
            "steady_year": int(analysis_years[steady_index]),
            "poly_degree": int(poly_degree),
            "signal_definition": "correct_frequency + sum(misspelling_frequency)",
            "noise_definition": "sum(misspelling_frequency)",
        },
        "metrics": metrics,
        "warnings": warnings,
        "mode": dataset.mode,
        "impl": "internal_rewrite",
    }


def to_metric_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in payload.get("metrics") or []:
        rows.append(
            {
                "year": item.get("year"),
                "misspelling": item.get("misspelling"),
                "correct": item.get("correct"),
                "signal_total": item.get("signal_total"),
                "noise_misspelling": item.get("noise_misspelling"),
                "MR": item.get("MR"),
                "NMR": item.get("NMR"),
                "density": item.get("density"),
            }
        )
    return rows
