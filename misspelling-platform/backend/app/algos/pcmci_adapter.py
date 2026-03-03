from __future__ import annotations

import math
from typing import Any

import numpy as np

from .types import AlgorithmDataset


def _pearson(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3 or len(y) < 3:
        return 0.0
    x_std = float(np.std(x))
    y_std = float(np.std(y))
    if x_std <= 1e-12 or y_std <= 1e-12:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def _fallback_edges(dataset: AlgorithmDataset, tau_max: int, alpha_level: float) -> list[dict[str, Any]]:
    by_name = {s.variant: np.array(s.values, dtype=float) for s in dataset.series}
    names = list(by_name.keys())
    edges: list[dict[str, Any]] = []
    for src in names:
        for dst in names:
            if src == dst:
                continue
            x = by_name[src]
            y = by_name[dst]
            for lag in range(1, tau_max + 1):
                if len(x) - lag < 3 or len(y) - lag < 3:
                    continue
                score = _pearson(x[:-lag], y[lag:])
                if math.isnan(score) or abs(score) < alpha_level:
                    continue
                edges.append(
                    {
                        "source": src,
                        "target": dst,
                        "lag": lag,
                        "weight": round(score, 6),
                        "p_value": None,
                        "q_value": None,
                        "method": "lag-corr-fallback",
                    }
                )
    edges.sort(key=lambda x: abs(float(x.get("weight") or 0.0)), reverse=True)
    return edges


def run_pcmci(
    dataset: AlgorithmDataset,
    tau_max: int = 8,
    alpha_level: float = 0.01,
    pc_alpha: float | None = None,
) -> dict[str, Any]:
    warnings = list(dataset.warnings)
    matrix = np.array(dataset.matrix, dtype=float)
    if matrix.size == 0:
        return {
            "summary": {"nodes": 0, "edges": 0, "tau_max": tau_max},
            "edges": [],
            "warnings": warnings + ["empty_dataset"],
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    values_tn = matrix.T
    names = [s.variant for s in dataset.series]

    try:
        from tigramite import data_processing as pp
        from tigramite.independence_tests.parcorr import ParCorr
        from tigramite.pcmci import PCMCI

        dataframe = pp.DataFrame(values_tn, datatime={0: np.arange(len(values_tn))}, var_names=names)
        pcmci = PCMCI(dataframe=dataframe, cond_ind_test=ParCorr(significance="analytic"), verbosity=0)
        results = pcmci.run_pcmci(tau_max=int(tau_max), pc_alpha=pc_alpha, alpha_level=float(alpha_level))
        q_matrix = pcmci.get_corrected_pvalues(
            p_matrix=results["p_matrix"],
            tau_max=int(tau_max),
            fdr_method="fdr_bh",
        )
        edges: list[dict[str, Any]] = []
        for src_idx, src in enumerate(names):
            for dst_idx, dst in enumerate(names):
                if src_idx == dst_idx:
                    continue
                for lag in range(1, int(tau_max) + 1):
                    q_val = float(q_matrix[src_idx, dst_idx, lag])
                    if math.isnan(q_val) or q_val > float(alpha_level):
                        continue
                    weight = float(results["val_matrix"][src_idx, dst_idx, lag])
                    edges.append(
                        {
                            "source": src,
                            "target": dst,
                            "lag": lag,
                            "weight": round(weight, 6),
                            "p_value": round(float(results["p_matrix"][src_idx, dst_idx, lag]), 6),
                            "q_value": round(q_val, 6),
                            "method": "pcmci",
                        }
                    )
        edges.sort(key=lambda x: abs(float(x.get("weight") or 0.0)), reverse=True)
        return {
            "summary": {"nodes": len(names), "edges": len(edges), "tau_max": int(tau_max)},
            "edges": edges,
            "warnings": warnings,
            "mode": "real",
            "impl": "internal_rewrite",
        }
    except Exception as exc:
        warnings.append(f"pcmci_failed:{exc}")
        edges = _fallback_edges(dataset, tau_max=int(tau_max), alpha_level=max(alpha_level, 0.05))
        return {
            "summary": {"nodes": len(names), "edges": len(edges), "tau_max": int(tau_max)},
            "edges": edges,
            "warnings": warnings,
            "mode": "stub",
            "impl": "internal_rewrite",
        }


def to_edge_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for edge in payload.get("edges") or []:
        rows.append(
            {
                "source": edge.get("source"),
                "target": edge.get("target"),
                "lag": edge.get("lag"),
                "weight": edge.get("weight"),
                "p_value": edge.get("p_value"),
                "q_value": edge.get("q_value"),
                "method": edge.get("method"),
            }
        )
    return rows

