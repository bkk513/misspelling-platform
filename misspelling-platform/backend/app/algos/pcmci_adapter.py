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


def _sanitize_tau_max(tau_max: int, points_count: int) -> int:
    safe_points = max(0, int(points_count))
    if safe_points < 4:
        return 0
    safe_tau = max(1, int(tau_max))
    return min(safe_tau, safe_points - 2)


def _build_window_ranges(total_points: int, window_size: int | None, window_step: int | None) -> list[tuple[int, int]]:
    if total_points <= 0:
        return []
    if total_points < 2:
        return [(0, total_points)]

    if window_size is None or int(window_size) <= 0:
        safe_size = min(total_points, 2)
    else:
        safe_size = max(2, min(int(window_size), total_points))

    if window_step is None or int(window_step) <= 0:
        safe_step = max(1, safe_size)
    else:
        safe_step = max(1, int(window_step))

    windows: list[tuple[int, int]] = []
    end = safe_size
    while end <= total_points:
        windows.append((0, end))
        end += safe_step

    final_window = (0, total_points)
    if not windows or windows[-1] != final_window:
        windows.append(final_window)
    return windows


def _extract_edges(
    names: list[str],
    val_matrix: np.ndarray,
    p_matrix: np.ndarray | None,
    q_matrix: np.ndarray | None,
    tau_max: int,
    alpha_level: float,
    method: str,
) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for src_idx, src in enumerate(names):
        for dst_idx, dst in enumerate(names):
            if src_idx == dst_idx:
                continue
            for lag in range(1, int(tau_max) + 1):
                q_val = float(q_matrix[src_idx, dst_idx, lag]) if q_matrix is not None else float("nan")
                p_val = float(p_matrix[src_idx, dst_idx, lag]) if p_matrix is not None else float("nan")
                if q_matrix is not None and (math.isnan(q_val) or q_val > float(alpha_level)):
                    continue
                weight = float(val_matrix[src_idx, dst_idx, lag])
                if math.isnan(weight):
                    continue
                edges.append(
                    {
                        "source": src,
                        "target": dst,
                        "lag": lag,
                        "weight": round(weight, 6),
                        "p_value": None if math.isnan(p_val) else round(p_val, 6),
                        "q_value": None if math.isnan(q_val) else round(q_val, 6),
                        "method": method,
                    }
                )
    edges.sort(key=lambda row: abs(float(row.get("weight") or 0.0)), reverse=True)
    return edges


def _fallback_edges_matrix(
    values_tn: np.ndarray,
    names: list[str],
    tau_max: int,
    alpha_level: float,
) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for src_idx, src in enumerate(names):
        for dst_idx, dst in enumerate(names):
            if src_idx == dst_idx:
                continue
            x = values_tn[:, src_idx]
            y = values_tn[:, dst_idx]
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
    edges.sort(key=lambda row: abs(float(row.get("weight") or 0.0)), reverse=True)
    return edges


def _fallback_edges(dataset: AlgorithmDataset, tau_max: int, alpha_level: float) -> list[dict[str, Any]]:
    by_name = {s.variant: np.array(s.values, dtype=float) for s in dataset.series}
    names = list(by_name.keys())
    if not names:
        return []
    stacked = np.column_stack([by_name[name] for name in names])
    return _fallback_edges_matrix(stacked, names, tau_max=tau_max, alpha_level=alpha_level)


def _serialize_float_matrix(values: np.ndarray) -> list[Any]:
    safe = np.nan_to_num(np.asarray(values, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    return safe.tolist()


def _serialize_graph_matrix(values: np.ndarray) -> list[Any]:
    return np.asarray(values).astype(str).tolist()


def _build_plot_payload(
    names: list[str],
    val_matrix: np.ndarray,
    graph: np.ndarray,
) -> dict[str, Any]:
    return {
        "var_names": [str(name) for name in names],
        "tigramite_val_matrix": _serialize_float_matrix(val_matrix),
        "tigramite_graph": _serialize_graph_matrix(graph),
    }


def _build_plot_payload_from_edges(
    names: list[str],
    edges: list[dict[str, Any]],
    tau_max: int,
) -> dict[str, Any]:
    node_count = max(1, len(names))
    lag_count = max(1, int(tau_max) + 1)
    val_matrix = np.zeros((node_count, node_count, lag_count), dtype=float)
    graph = np.full((node_count, node_count, lag_count), "", dtype=object)
    idx_by_name = {name: idx for idx, name in enumerate(names)}

    for row in edges:
        src = idx_by_name.get(str(row.get("source") or ""))
        dst = idx_by_name.get(str(row.get("target") or ""))
        if src is None or dst is None or src == dst:
            continue
        try:
            lag = int(row.get("lag") or 0)
        except Exception:
            lag = 0
        if lag < 0 or lag >= lag_count:
            continue
        try:
            weight = float(row.get("weight") or 0.0)
        except Exception:
            weight = 0.0
        if not math.isfinite(weight):
            weight = 0.0
        val_matrix[src, dst, lag] = weight
        if lag > 0:
            graph[src, dst, lag] = "o-o"

    return _build_plot_payload(
        names=names,
        val_matrix=val_matrix,
        graph=graph,
    )


def _window_series_payload(
    names: list[str],
    times: list[str],
    values_tn: np.ndarray,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for var_idx, name in enumerate(names):
        points = []
        for point_idx, label in enumerate(times):
            points.append({"time": str(label), "value": round(float(values_tn[point_idx, var_idx]), 6)})
        rows.append({"variant": name, "points": points})
    return rows


def _build_window_payload(
    window_index: int,
    start: int,
    end: int,
    times: list[str],
    names: list[str],
    values_tn: np.ndarray,
    edges: list[dict[str, Any]],
    tau_max: int,
    mode: str,
    method: str,
    plot_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_end = max(start + 1, end)
    window_values = values_tn[start:safe_end, :]
    window_times = times[start:safe_end]
    payload = {
        "window_index": int(window_index),
        "start_index": int(start),
        "end_index": int(safe_end - 1),
        "start_time": str(window_times[0]) if window_times else "",
        "end_time": str(window_times[-1]) if window_times else "",
        "tau_max": int(tau_max),
        "mode": mode,
        "method": method,
        "edge_count": len(edges),
        "network_png": f"pcmci_window_{window_index:03d}_network.png",
        "timeseries_png": f"pcmci_window_{window_index:03d}_timeseries.png",
        "top_edges": edges[:20],
        "edges": edges[:500],
        "series": _window_series_payload(names, window_times, window_values),
    }
    if plot_payload:
        payload.update(plot_payload)
    return payload


def run_pcmci(
    dataset: AlgorithmDataset,
    tau_max: int = 8,
    alpha_level: float = 0.01,
    pc_alpha: float | None = None,
    window_size: int | None = None,
    window_step: int | None = None,
) -> dict[str, Any]:
    warnings = list(dataset.warnings)
    matrix = np.array(dataset.matrix, dtype=float)
    if matrix.size == 0:
        return {
            "summary": {"nodes": 0, "edges": 0, "tau_max": tau_max, "windows": 0},
            "edges": [],
            "window_results": [],
            "warnings": warnings + ["empty_dataset"],
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    values_tn = matrix.T
    names = [s.variant for s in dataset.series]
    if values_tn.ndim != 2 or values_tn.shape[0] < 3 or values_tn.shape[1] < 2:
        warnings.append("insufficient_points_or_variables")
        return {
            "summary": {"nodes": len(names), "edges": 0, "tau_max": 0, "windows": 0},
            "edges": [],
            "window_results": [],
            "warnings": warnings,
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    if len(dataset.labels) == len(values_tn):
        times = [str(label) for label in dataset.labels]
    elif len(dataset.years) == len(values_tn):
        times = [str(v) for v in dataset.years]
    else:
        times = [str(i) for i in range(len(values_tn))]
    try:
        from sklearn.preprocessing import MinMaxScaler

        values_tn = MinMaxScaler(feature_range=(0, 1)).fit_transform(values_tn)
    except Exception as exc:
        warnings.append(f"minmax_scaler_failed:{exc}")

    safe_tau = _sanitize_tau_max(int(tau_max), len(values_tn))
    if safe_tau < 1:
        warnings.append("tau_max_too_large_for_series")
        return {
            "summary": {"nodes": len(names), "edges": 0, "tau_max": 0, "windows": 0},
            "edges": [],
            "window_results": [],
            "warnings": warnings,
            "mode": "stub",
            "impl": "internal_rewrite",
        }

    ranges = _build_window_ranges(len(values_tn), window_size=window_size, window_step=window_step)
    effective_window_size = (ranges[0][1] - ranges[0][0]) if ranges else len(values_tn)
    effective_window_step = (ranges[1][0] - ranges[0][0]) if len(ranges) > 1 else effective_window_size

    try:
        from tigramite import data_processing as pp
        from tigramite.independence_tests.parcorr import ParCorr
        from tigramite.pcmci import PCMCI

        window_results: list[dict[str, Any]] = []
        for window_index, (start, end) in enumerate(ranges):
            window_values = values_tn[start:end, :]
            window_tau = _sanitize_tau_max(safe_tau, len(window_values))
            if window_tau < 1:
                warnings.append(f"window_{window_index}_too_short")
                empty_plot_payload = _build_plot_payload_from_edges(
                    names=names,
                    edges=[],
                    tau_max=0,
                )
                window_results.append(
                    _build_window_payload(
                        window_index=window_index,
                        start=start,
                        end=end,
                        times=times,
                        names=names,
                        values_tn=values_tn,
                        edges=[],
                        tau_max=0,
                        mode="stub",
                        method="insufficient-window",
                        plot_payload=empty_plot_payload,
                    )
                )
                continue
            try:
                window_df = pp.DataFrame(window_values, datatime={0: np.arange(len(window_values))}, var_names=names)
                window_pcmci = PCMCI(dataframe=window_df, cond_ind_test=ParCorr(significance="analytic"), verbosity=0)
                window_run = window_pcmci.run_pcmci(tau_max=window_tau, pc_alpha=pc_alpha, alpha_level=float(alpha_level))
                window_q = window_pcmci.get_corrected_pvalues(
                    p_matrix=window_run["p_matrix"],
                    tau_max=window_tau,
                    fdr_method="fdr_bh",
                )
                window_graph = window_pcmci.get_graph_from_pmatrix(
                    p_matrix=window_q,
                    alpha_level=float(alpha_level),
                    tau_min=0,
                    tau_max=window_tau,
                    link_assumptions=None,
                )
                window_plot_payload = _build_plot_payload(
                    names=names,
                    val_matrix=window_run["val_matrix"],
                    graph=window_graph,
                )
                window_edges = _extract_edges(
                    names=names,
                    val_matrix=window_run["val_matrix"],
                    p_matrix=window_run["p_matrix"],
                    q_matrix=window_q,
                    tau_max=window_tau,
                    alpha_level=float(alpha_level),
                    method="pcmci",
                )
                window_results.append(
                    _build_window_payload(
                        window_index=window_index,
                        start=start,
                        end=end,
                        times=times,
                        names=names,
                        values_tn=values_tn,
                        edges=window_edges,
                        tau_max=window_tau,
                        mode="real",
                        method="pcmci",
                        plot_payload=window_plot_payload,
                    )
                )
            except Exception as exc:
                warnings.append(f"pcmci_window_failed:{window_index}:{exc}")
                fallback_edges = _fallback_edges_matrix(
                    window_values,
                    names=names,
                    tau_max=max(1, window_tau),
                    alpha_level=max(float(alpha_level), 0.05),
                )
                fallback_plot_payload = _build_plot_payload_from_edges(
                    names=names,
                    edges=fallback_edges,
                    tau_max=max(1, window_tau),
                )
                window_results.append(
                    _build_window_payload(
                        window_index=window_index,
                        start=start,
                        end=end,
                        times=times,
                        names=names,
                        values_tn=values_tn,
                        edges=fallback_edges,
                        tau_max=max(1, window_tau),
                        mode="stub",
                        method="lag-corr-fallback",
                        plot_payload=fallback_plot_payload,
                    )
                )

        full_window = next(
            (
                row
                for row in reversed(window_results)
                if int(row.get("start_index") or 0) == 0 and int(row.get("end_index") or -1) == len(values_tn) - 1
            ),
            None,
        )
        if full_window:
            edges = [
                dict(item)
                for item in (
                    full_window.get("edges")
                    or full_window.get("top_edges")
                    or []
                )
            ]
            plot_payload = {
                "var_names": full_window.get("var_names") or names,
                "tigramite_val_matrix": full_window.get("tigramite_val_matrix")
                or _serialize_float_matrix(np.zeros((len(names), len(names), safe_tau + 1), dtype=float)),
                "tigramite_graph": full_window.get("tigramite_graph")
                or _serialize_graph_matrix(np.full((len(names), len(names), safe_tau + 1), "", dtype=object)),
            }
            top_level_mode = str(full_window.get("mode") or "real")
        else:
            warnings.append("missing_full_window_result")
            edges = _fallback_edges(dataset, tau_max=safe_tau, alpha_level=max(alpha_level, 0.05))
            plot_payload = _build_plot_payload_from_edges(
                names=names,
                edges=edges,
                tau_max=safe_tau,
            )
            top_level_mode = "stub"
        return {
            "summary": {
                "nodes": len(names),
                "edges": len(edges),
                "tau_max": safe_tau,
                "windows": len(window_results),
                "window_size": int(effective_window_size),
                "window_step": int(max(1, effective_window_step)),
            },
            "edges": edges,
            "window_results": window_results,
            "warnings": warnings,
            "mode": top_level_mode,
            "impl": "internal_rewrite",
            **plot_payload,
        }
    except Exception as exc:
        warnings.append(f"pcmci_failed:{exc}")
        edges = _fallback_edges(dataset, tau_max=safe_tau, alpha_level=max(alpha_level, 0.05))
        fallback_plot_payload = _build_plot_payload_from_edges(
            names=names,
            edges=edges,
            tau_max=safe_tau,
        )
        window_results: list[dict[str, Any]] = []
        for window_index, (start, end) in enumerate(ranges):
            fallback_tau = _sanitize_tau_max(safe_tau, end - start)
            fallback_edges = _fallback_edges_matrix(
                values_tn[start:end, :],
                names=names,
                tau_max=fallback_tau,
                alpha_level=max(float(alpha_level), 0.05),
            )
            fallback_window_plot_payload = _build_plot_payload_from_edges(
                names=names,
                edges=fallback_edges,
                tau_max=fallback_tau,
            )
            window_results.append(
                _build_window_payload(
                    window_index=window_index,
                    start=start,
                    end=end,
                    times=times,
                    names=names,
                    values_tn=values_tn,
                    edges=fallback_edges,
                    tau_max=fallback_tau,
                    mode="stub",
                    method="lag-corr-fallback",
                    plot_payload=fallback_window_plot_payload,
                )
            )
        return {
            "summary": {
                "nodes": len(names),
                "edges": len(edges),
                "tau_max": safe_tau,
                "windows": len(window_results),
                "window_size": int(effective_window_size),
                "window_step": int(max(1, effective_window_step)),
            },
            "edges": edges,
            "window_results": window_results,
            "warnings": warnings,
            "mode": "stub",
            "impl": "internal_rewrite",
            **fallback_plot_payload,
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
