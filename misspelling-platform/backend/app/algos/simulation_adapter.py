from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import date, timedelta
from typing import Any

import networkx as nx
import numpy as np
import pandas as pd

from .types import AlgorithmDataset, AlgorithmSeries

EPS = 1e-8
METRIC_EPS = 1e-24
STATE_UNKNOWN = 0
STATE_ERROR = 1
STATE_RIGHT = 2
AUTO_TOPOLOGY = "auto"
SUPPORTED_TOPOLOGIES = {
    "grid",
    "watts_strogatz",
    "newman_watts",
    "barabasi_albert",
    "dual_barabasi_albert",
}
FIT_PROFILES = {
    "explore": {
        "screen_multiplier": 1.0,
        "screen_repeats_cap": 2,
        "shortlist_size": 16,
        "refine_epochs": 5,
        "refine_candidates_divisor": 4,
        "refine_min_candidates": 14,
        "elite_passes": 1,
        "elite_repeats_boost": 0,
    },
    "research": {
        "screen_multiplier": 1.5,
        "screen_repeats_cap": 3,
        "shortlist_size": 24,
        "refine_epochs": 8,
        "refine_candidates_divisor": 3,
        "refine_min_candidates": 20,
        "elite_passes": 2,
        "elite_repeats_boost": 1,
    },
    "publication": {
        "screen_multiplier": 2.0,
        "screen_repeats_cap": 4,
        "shortlist_size": 32,
        "refine_epochs": 11,
        "refine_candidates_divisor": 2,
        "refine_min_candidates": 28,
        "elite_passes": 3,
        "elite_repeats_boost": 2,
    },
}
DEFAULT_VARIANT_SCOPE = "typo_only"
SUPPORTED_VARIANT_SCOPES = {"typo_only", "competition"}


def _rolling_mean(values: np.ndarray, window: int) -> np.ndarray:
    if int(window) <= 1:
        return np.asarray(values, dtype=float)
    return (
        pd.Series(np.asarray(values, dtype=float))
        .rolling(int(window), min_periods=1, center=True)
        .mean()
        .to_numpy(dtype=float)
    )


def _safe_divide(numerator: np.ndarray, denominator: np.ndarray) -> np.ndarray:
    return np.divide(
        numerator,
        denominator,
        out=np.zeros_like(numerator, dtype=float),
        where=np.asarray(denominator, dtype=float) > EPS,
    )


def _year_labels(years: list[int]) -> list[str]:
    return [str(int(year)) for year in years]


def _label_to_year(label: str) -> int | None:
    text = str(label or "").strip()
    if len(text) >= 4 and text[:4].isdigit():
        try:
            return int(text[:4])
        except Exception:
            return None
    return None


def _label_to_date(label: str) -> date | None:
    text = str(label or "").strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[0].strip()
    if len(text) >= 10:
        text = text[:10]
    try:
        return date.fromisoformat(text)
    except Exception:
        return None


def _compute_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    rmse = float(np.sqrt(np.mean((predicted - actual) ** 2)))
    mae = float(np.mean(np.abs(predicted - actual)))
    ss_res = float(np.sum((actual - predicted) ** 2))
    ss_tot = float(np.sum((actual - actual.mean()) ** 2))
    r2 = float(1.0 - ss_res / ss_tot) if ss_tot > METRIC_EPS else 0.0
    peak_idx_actual = int(np.argmax(actual)) if len(actual) else 0
    peak_idx_pred = int(np.argmax(predicted)) if len(predicted) else 0
    peak_actual = float(actual.max()) if len(actual) else 0.0
    range_actual = float(actual.max() - actual.min()) if len(actual) else 0.0
    mean_abs_actual = float(np.mean(np.abs(actual))) if len(actual) else 0.0
    std_actual = float(np.std(actual)) if len(actual) else 0.0
    smape = (
        float(
            np.mean(
                2.0
                * np.abs(predicted - actual)
                / np.maximum(np.abs(actual) + np.abs(predicted), METRIC_EPS)
            )
        )
        if len(actual)
        else 0.0
    )
    return {
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
        "peak_actual": peak_actual,
        "peak_predicted": float(predicted.max()) if len(predicted) else 0.0,
        "peak_time_gap": float(abs(peak_idx_actual - peak_idx_pred)),
        "tail_actual": float(actual[-1]) if len(actual) else 0.0,
        "tail_predicted": float(predicted[-1]) if len(predicted) else 0.0,
        "mean_abs_actual": mean_abs_actual,
        "std_actual": std_actual,
        "range_actual": range_actual,
        "nrmse_peak": float(rmse / max(peak_actual, METRIC_EPS)),
        "nrmse_mean": float(rmse / max(mean_abs_actual, METRIC_EPS)),
        "nrmse_range": float(rmse / max(range_actual, METRIC_EPS)),
        "smape": smape,
    }


def _detect_phase_break(error_share: np.ndarray) -> int:
    if len(error_share) <= 3:
        return 0
    long_window = min(21, max(5, len(error_share) // 8))
    persistence = min(12, max(3, len(error_share) // 10))
    smoothed = _rolling_mean(np.asarray(error_share, dtype=float), long_window)
    start = max(4, len(smoothed) // 6)
    baseline = float(np.nanmedian(smoothed[:start])) if start > 0 else float(smoothed[0])
    threshold = max(baseline + 0.012, baseline * 1.5)

    for idx in range(start, max(start + 1, len(smoothed) - persistence)):
        if float(np.nanmean(smoothed[idx : idx + persistence])) >= threshold:
            return int(idx)
    return int(np.nanargmax(smoothed))


@dataclass
class SimulationDataset:
    word: str
    years: list[int]
    labels: list[str]
    dates: list[date]
    granularity: str
    right: np.ndarray
    error: np.ndarray
    total: np.ndarray
    error_share: np.ndarray
    error_share_fit: np.ndarray
    error_share_amplification: float
    error_seed_floor: float
    error_peak: float
    right_peak: float
    error_signal_ratio: float
    sparse_signal: bool
    salience: np.ndarray
    variant_names: list[str]
    variant_matrix: np.ndarray
    source: str
    warnings: list[str]


@dataclass
class ABMParameters:
    p_self_error: float
    p_copy_error: float
    p_copy_right: float
    p_proofread: float
    p_forget: float
    p_norm: float
    alpha_salience: float
    beta_phase: float
    gamma_hub: float
    seed_error_frac: float
    seed_right_frac: float


@dataclass
class SimulationVariantScope:
    requested_mode: str
    effective_mode: str
    label: str
    reason: str
    requested_variant_count: int
    retained_variant_count: int
    excluded_variant_count: int
    requested_variants: list[str] = field(default_factory=list)
    retained_variants: list[str] = field(default_factory=list)
    excluded_variants: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _normalize_variant_scope(mode: str | None) -> str:
    value = str(mode or DEFAULT_VARIANT_SCOPE).strip().lower()
    return value if value in SUPPORTED_VARIANT_SCOPES else DEFAULT_VARIANT_SCOPE


def _levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    prev = list(range(len(right) + 1))
    for i, left_ch in enumerate(left, start=1):
        curr = [i]
        for j, right_ch in enumerate(right, start=1):
            insert_cost = curr[j - 1] + 1
            delete_cost = prev[j] + 1
            replace_cost = prev[j - 1] + (0 if left_ch == right_ch else 1)
            curr.append(min(insert_cost, delete_cost, replace_cost))
        prev = curr
    return int(prev[-1])


def _copy_series_item(series: AlgorithmSeries) -> AlgorithmSeries:
    return AlgorithmSeries(variant=str(series.variant), values=[float(value) for value in series.values])


def _prepare_variant_scope(
    dataset: AlgorithmDataset,
    variant_scope: str,
) -> tuple[AlgorithmDataset, SimulationVariantScope]:
    requested_mode = _normalize_variant_scope(variant_scope)
    canonical = str(dataset.word or "").strip().lower()
    warnings = list(dataset.warnings)
    if not dataset.series:
        return dataset, SimulationVariantScope(
            requested_mode=requested_mode,
            effective_mode=requested_mode,
            label="Empty Variant Scope",
            reason="No time series were available for simulation.",
            requested_variant_count=0,
            retained_variant_count=0,
            excluded_variant_count=0,
            warnings=warnings,
        )

    canonical_idx = next(
        (idx for idx, row in enumerate(dataset.series) if str(row.variant or "").strip().lower() == canonical),
        0,
    )
    canonical_series = dataset.series[canonical_idx]
    variant_series = [row for idx, row in enumerate(dataset.series) if idx != canonical_idx]
    requested_variants = [str(row.variant or "").strip().lower() for row in variant_series]
    canonical_values = np.asarray(canonical_series.values, dtype=float)
    canonical_peak = float(np.nanmax(canonical_values)) if canonical_values.size else 0.0
    variant_totals = [float(np.asarray(row.values, dtype=float).sum()) for row in variant_series]
    total_error_mass = max(float(sum(variant_totals)), EPS)

    retained_rows: list[AlgorithmSeries] = []
    excluded_rows: list[dict[str, Any]] = []

    for idx, row in enumerate(variant_series):
        variant = str(row.variant or "").strip().lower()
        values = np.asarray(row.values, dtype=float)
        total_mass = float(values.sum())
        peak_idx = int(np.argmax(values)) if len(values) else 0
        peak_value = float(values[peak_idx]) if len(values) else 0.0
        final_value = float(values[-1]) if len(values) else 0.0
        cluster_share = float(total_mass / max(total_error_mass, EPS))
        peak_ratio_to_right = float(peak_value / max(canonical_peak, EPS))
        other_totals = [value for inner_idx, value in enumerate(variant_totals) if inner_idx != idx]
        runner_up_total = max(other_totals) if other_totals else 0.0
        dominance_ratio = (
            float(total_mass / max(runner_up_total, EPS))
            if runner_up_total > EPS
            else (999999.0 if total_mass > EPS else 0.0)
        )
        edit_distance = _levenshtein_distance(canonical, variant)
        normalized_edit_distance = float(edit_distance / max(len(canonical), len(variant), 1))
        strong_competitor = bool(
            (peak_ratio_to_right >= 0.03 and (cluster_share >= 0.35 or dominance_ratio >= 6.0))
            or (peak_ratio_to_right >= 0.01 and cluster_share >= 0.70)
        )
        evidence = {
            "variant": variant,
            "reason": (
                "excluded_as_strong_orthographic_competitor"
                if strong_competitor
                else "retained_as_typo_like_variant"
            ),
            "peak_year": int(dataset.years[peak_idx]) if dataset.years and len(values) else None,
            "total_mass": total_mass,
            "peak_value": peak_value,
            "final_value": final_value,
            "cluster_share": cluster_share,
            "peak_ratio_to_right": peak_ratio_to_right,
            "dominance_ratio": dominance_ratio,
            "edit_distance": int(edit_distance),
            "normalized_edit_distance": normalized_edit_distance,
        }
        if requested_mode == "typo_only" and strong_competitor:
            excluded_rows.append(evidence)
            continue
        retained_rows.append(row)

    effective_mode = requested_mode
    label = "Typo Cluster Diffusion" if requested_mode == "typo_only" else "Variant Competition Cluster"
    reason = (
        "Default simulation keeps typo-like misspelling variants and excludes strong orthographic competitors so the error state remains a misspelling diffusion cluster."
        if requested_mode == "typo_only"
        else "Competition mode keeps every selected non-canonical variant, including strong orthographic competitors, so the error state represents the full selected variant cluster."
    )
    if requested_mode == "typo_only" and variant_series and not retained_rows:
        retained_rows = list(variant_series)
        effective_mode = "competition"
        label = "Variant Competition Cluster"
        reason = (
            "All selected variants behaved like strong orthographic competitors, so the run fell back to competition mode instead of leaving the error cluster empty."
        )
        warnings.append("simulation_variant_scope_fallback_to_competition")
    elif requested_mode == "typo_only" and excluded_rows:
        warnings.append("simulation_variant_scope_filtered_competitors")

    scoped_dataset = AlgorithmDataset(
        task_id=str(dataset.task_id),
        word=str(dataset.word),
        variants=[str(canonical_series.variant), *[str(row.variant) for row in retained_rows]],
        years=[int(year) for year in dataset.years],
        series=[_copy_series_item(canonical_series), *[_copy_series_item(row) for row in retained_rows]],
        source=str(dataset.source),
        granularity=str(dataset.granularity or "year"),
        time_labels=[str(label) for label in dataset.labels],
        warnings=warnings,
        fallback_reason=dataset.fallback_reason,
    )
    scope = SimulationVariantScope(
        requested_mode=requested_mode,
        effective_mode=effective_mode,
        label=label,
        reason=reason,
        requested_variant_count=len(requested_variants),
        retained_variant_count=len(retained_rows),
        excluded_variant_count=len(excluded_rows),
        requested_variants=requested_variants,
        retained_variants=[str(row.variant or "").strip().lower() for row in retained_rows],
        excluded_variants=excluded_rows,
        warnings=warnings,
    )
    return scoped_dataset, scope


def build_simulation_dataset(dataset: AlgorithmDataset, trend_window: int = 3) -> SimulationDataset:
    canonical = np.asarray(dataset.series[0].values if dataset.series else [], dtype=float)
    variant_names = [str(item.variant or "").strip().lower() for item in dataset.series[1:]]
    if len(dataset.series) > 1:
        variant_matrix = np.asarray([item.values for item in dataset.series[1:]], dtype=float)
    else:
        variant_matrix = np.zeros((0, len(canonical)), dtype=float)

    right_series = _rolling_mean(canonical, trend_window)
    if variant_matrix.size > 0:
        variant_matrix = np.vstack([_rolling_mean(row, trend_window) for row in variant_matrix])
        error_series = variant_matrix.sum(axis=0)
    else:
        error_series = np.zeros_like(right_series)

    total_series = right_series + error_series
    error_share = _safe_divide(error_series, total_series)
    amplification = 1.0
    error_share_fit = error_share.copy()
    raw_peak = float(np.nanmax(error_share)) if len(error_share) else 0.0
    right_peak = float(np.nanmax(right_series)) if len(right_series) else 0.0
    error_peak = float(np.nanmax(error_series)) if len(error_series) else 0.0
    error_signal_ratio = float(error_peak / max(right_peak, EPS))
    share_std = float(np.std(error_share)) if len(error_share) else 0.0
    error_scale = max(error_peak, right_peak * 0.01, 1e-12)
    error_std = float(np.std(error_series)) if len(error_series) else 0.0
    sparse_signal = bool(
        raw_peak < 0.08
        or error_signal_ratio < 0.12
        or share_std < 0.01
        or error_std < error_scale * 0.25
    )
    if sparse_signal:
        seed_floor = min(0.0015, max(2e-5, raw_peak * 0.35 if raw_peak > EPS else 5e-5))
    else:
        seed_floor = min(0.02, max(0.001, raw_peak * 2.5 if raw_peak > EPS else 0.001))
    total_max = max(float(total_series.max()) if len(total_series) else 0.0, EPS)
    salience = total_series / total_max
    years = [int(year) for year in dataset.years]
    granularity = str(dataset.granularity or "year").strip().lower() or "year"
    labels = [str(label) for label in dataset.labels] if len(dataset.labels) == len(years) else _year_labels(years)
    if granularity == "day":
        base_date = date(2000, 1, 1)
        dates = [_label_to_date(label) or (base_date + timedelta(days=idx)) for idx, label in enumerate(labels)]
    else:
        dates = [date(int(year), 1, 1) for year in years]
        labels = _year_labels(years)
    warnings = list(dataset.warnings)
    if variant_matrix.shape[0] == 0:
        warnings.append("simulation_missing_error_variants")

    return SimulationDataset(
        word=str(dataset.word or "simulation").strip().lower() or "simulation",
        years=years,
        labels=labels,
        dates=dates,
        granularity=granularity,
        right=right_series,
        error=error_series,
        total=total_series,
        error_share=error_share,
        error_share_fit=error_share_fit,
        error_share_amplification=float(amplification),
        error_seed_floor=float(seed_floor),
        error_peak=float(error_peak),
        right_peak=float(right_peak),
        error_signal_ratio=float(error_signal_ratio),
        sparse_signal=bool(sparse_signal),
        salience=salience,
        variant_names=variant_names,
        variant_matrix=variant_matrix,
        source=str(dataset.source or "STUB"),
        warnings=warnings,
    )


def _build_graph(
    topology: str,
    n_nodes: int,
    seed: int,
    ws_k: int,
    ws_p: float,
    ba_m: int,
) -> nx.Graph:
    topo = str(topology or "watts_strogatz").strip().lower()
    if topo not in SUPPORTED_TOPOLOGIES:
        topo = "watts_strogatz"

    if topo == "grid":
        width = int(np.ceil(np.sqrt(max(n_nodes, 1))))
        height = int(np.ceil(max(n_nodes, 1) / max(width, 1)))
        graph_2d = nx.grid_2d_graph(height, width)
        mapping = {node: idx for idx, node in enumerate(graph_2d.nodes())}
        graph = nx.relabel_nodes(graph_2d, mapping)
        if graph.number_of_nodes() > n_nodes:
            graph.remove_nodes_from(list(range(n_nodes, graph.number_of_nodes())))
        return nx.convert_node_labels_to_integers(graph)

    if topo == "watts_strogatz":
        k = min(max(2, int(ws_k)), max(2, n_nodes - 1))
        if k % 2 == 1:
            k -= 1
        return nx.connected_watts_strogatz_graph(n=n_nodes, k=max(2, k), p=float(ws_p), tries=200, seed=seed)

    if topo == "newman_watts":
        k = min(max(2, int(ws_k)), max(2, n_nodes - 1))
        if k % 2 == 1:
            k -= 1
        return nx.newman_watts_strogatz_graph(n=n_nodes, k=max(2, k), p=float(ws_p), seed=seed)

    if topo == "barabasi_albert":
        return nx.barabasi_albert_graph(n=n_nodes, m=min(max(1, int(ba_m)), max(1, n_nodes - 1)), seed=seed)

    return nx.dual_barabasi_albert_graph(
        n=n_nodes,
        m1=min(max(1, int(ba_m)), max(1, n_nodes - 1)),
        m2=min(max(2, int(ba_m) + 2), max(1, n_nodes - 1)),
        p=0.5,
        seed=seed,
    )


class NetworkSpellingABM:
    def __init__(
        self,
        dataset: SimulationDataset,
        phase_break_index: int,
        n_agents: int,
        topology: str,
        base_seed: int,
        ws_k: int,
        ws_p: float,
        ba_m: int,
    ) -> None:
        self.dataset = dataset
        self.phase_break_index = int(phase_break_index)
        self.n_agents = int(max(40, n_agents))
        self.topology = str(topology or "watts_strogatz")
        self.base_seed = int(base_seed)
        self.graph = _build_graph(
            topology=self.topology,
            n_nodes=self.n_agents,
            seed=self.base_seed,
            ws_k=ws_k,
            ws_p=ws_p,
            ba_m=ba_m,
        )
        self.nodes = np.arange(self.n_agents, dtype=np.int32)
        self.degree = np.asarray([self.graph.degree(n) for n in self.nodes], dtype=float)
        self.degree_safe = np.where(self.degree > 0, self.degree, 1.0)
        self.degree_norm = self.degree / max(float(self.degree.max()), 1.0)
        activity_rng = np.random.default_rng(self.base_seed + 7919)
        activity_sigma = 0.95 if self.dataset.sparse_signal else 0.55
        raw_weight = activity_rng.lognormal(mean=0.0, sigma=activity_sigma, size=self.n_agents)
        self.node_weight = raw_weight / max(float(raw_weight.mean()), EPS)
        self.total_weight = float(self.node_weight.sum())
        self.sparse_precision_scale = float(
            np.clip(
                max(
                    float(np.max(self.dataset.error_share)) / 0.08 if len(self.dataset.error_share) else 0.0,
                    float(self.dataset.error_signal_ratio) / 0.12,
                ),
                0.05,
                1.0,
            )
        )
        edges = np.asarray(list(self.graph.edges()), dtype=np.int32)
        if edges.size == 0:
            self.edge_src = np.zeros((0,), dtype=np.int32)
            self.edge_dst = np.zeros((0,), dtype=np.int32)
            self.neighbor_weight_safe = np.ones(self.n_agents, dtype=float)
        else:
            self.edge_src = np.concatenate([edges[:, 0], edges[:, 1]])
            self.edge_dst = np.concatenate([edges[:, 1], edges[:, 0]])
            neighbor_weight = np.bincount(
                self.edge_dst,
                weights=self.node_weight[self.edge_src],
                minlength=self.n_agents,
            )
            self.neighbor_weight_safe = np.where(neighbor_weight > 0, neighbor_weight, 1.0)

    def graph_summary(self) -> dict[str, float]:
        degrees = np.asarray([deg for _, deg in self.graph.degree()], dtype=float)
        sorted_degrees = np.sort(degrees)
        n = len(sorted_degrees)
        if n <= 1:
            gini = 0.0
        else:
            gini = float(
                (2.0 * np.sum((np.arange(1, n + 1) * sorted_degrees))) / (n * max(sorted_degrees.sum(), EPS))
                - (n + 1) / n
            )
        sorted_activity = np.sort(self.node_weight)
        if len(sorted_activity) <= 1:
            activity_gini = 0.0
        else:
            activity_gini = float(
                (2.0 * np.sum((np.arange(1, len(sorted_activity) + 1) * sorted_activity)))
                / (len(sorted_activity) * max(sorted_activity.sum(), EPS))
                - (len(sorted_activity) + 1) / len(sorted_activity)
            )
        return {
            "n_agents": float(self.n_agents),
            "edges": float(self.graph.number_of_edges()),
            "avg_degree": float(self.degree.mean()) if len(self.degree) else 0.0,
            "density": float(nx.density(self.graph)),
            "clustering": float(nx.average_clustering(self.graph)) if self.graph.number_of_nodes() > 1 else 0.0,
            "degree_gini": gini,
            "activity_gini": activity_gini,
        }

    def _initialize_states(self, params: ABMParameters, rng: np.random.Generator) -> np.ndarray:
        states = np.full(self.n_agents, STATE_UNKNOWN, dtype=np.int8)
        error_seed_frac = float(params.seed_error_frac)
        right_seed_frac = float(params.seed_right_frac)
        if self.dataset.sparse_signal:
            initial_observed_share = float(self.dataset.error_share[0]) if len(self.dataset.error_share) else 0.0
            error_seed_cap = min(
                0.010,
                max(self.dataset.error_seed_floor * 1.5, initial_observed_share * 1.8, 2.5e-4),
            )
            error_seed_frac = min(error_seed_frac, error_seed_cap)
            right_seed_frac = min(max(right_seed_frac, 0.010), 0.16)
        n_error = int(round(error_seed_frac * self.n_agents))
        if not self.dataset.sparse_signal:
            n_error = max(n_error, 1)
        n_error = min(max(n_error, 0), self.n_agents)
        n_right = min(max(int(round(right_seed_frac * self.n_agents)), 1), max(1, self.n_agents - n_error))

        ranked = np.argsort(-self.degree)
        error_candidates = ranked[: max(n_error * 3, n_error, 1)]
        right_candidates = ranked[::-1][: max(n_right * 3, n_right)]

        if n_error > 0:
            error_idx = rng.choice(error_candidates, size=n_error, replace=False)
        else:
            error_idx = np.zeros((0,), dtype=np.int32)
        remaining = np.setdiff1d(np.arange(self.n_agents), error_idx, assume_unique=False)
        right_pool = np.intersect1d(right_candidates, remaining, assume_unique=False)
        if len(right_pool) < n_right:
            right_idx = rng.choice(remaining, size=n_right, replace=False)
        else:
            right_idx = rng.choice(right_pool, size=n_right, replace=False)

        states[error_idx] = STATE_ERROR
        states[right_idx] = STATE_RIGHT
        return states

    def _neighbor_ratios(self, states: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if self.edge_src.size == 0:
            return np.zeros(self.n_agents, dtype=float), np.zeros(self.n_agents, dtype=float)
        error_hits = np.bincount(
            self.edge_dst,
            weights=(states[self.edge_src] == STATE_ERROR).astype(float) * self.node_weight[self.edge_src],
            minlength=self.n_agents,
        )
        right_hits = np.bincount(
            self.edge_dst,
            weights=(states[self.edge_src] == STATE_RIGHT).astype(float) * self.node_weight[self.edge_src],
            minlength=self.n_agents,
        )
        return error_hits / self.neighbor_weight_safe, right_hits / self.neighbor_weight_safe

    def _state_mass(self, states: np.ndarray, state_value: int | None = None) -> float:
        if state_value is None:
            mask = states != STATE_UNKNOWN
        else:
            mask = states == state_value
        if not np.any(mask):
            return 0.0
        return float(self.node_weight[mask].sum())

    def _seed_error_probability(self, t: int) -> float:
        observed_share = float(self.dataset.error_share[max(0, t - 1)] if t > 0 else self.dataset.error_share[0])
        if not self.dataset.sparse_signal:
            return float(np.clip(max(observed_share, self.dataset.error_seed_floor), 0.0, 0.95))
        sparse_floor = max(self.dataset.error_seed_floor * (0.6 + 0.4 * float(self.dataset.salience[t])), 2e-5)
        return float(np.clip(max(observed_share, sparse_floor), 0.0, 0.12))

    def _select_activation_nodes(
        self,
        unknown_idx: np.ndarray,
        target_mass: float,
        rng: np.random.Generator,
    ) -> np.ndarray:
        if unknown_idx.size == 0 or target_mass <= EPS:
            return np.zeros((0,), dtype=np.int32)
        if self.dataset.sparse_signal and unknown_idx.size > 1:
            inverse_weight = 1.0 / np.maximum(self.node_weight[unknown_idx], 1e-6)
            probabilities = inverse_weight / max(float(inverse_weight.sum()), EPS)
            order = rng.choice(unknown_idx, size=unknown_idx.size, replace=False, p=probabilities)
        else:
            order = rng.permutation(unknown_idx)
        cumulative = np.cumsum(self.node_weight[order])
        take = min(int(np.searchsorted(cumulative, target_mass, side="left")) + 1, int(order.size))
        return order[:take]

    def _step(self, states: np.ndarray, t: int, params: ABMParameters, rng: np.random.Generator) -> np.ndarray:
        new_states = states.copy()
        local_error, local_right = self._neighbor_ratios(states)
        salience_t = float(np.clip(self.dataset.salience[t], 0.0, 1.0))
        phase_boost = 1.0 + (params.beta_phase if t >= self.phase_break_index else 0.0)
        total_active = float(self._state_mass(states) / max(self.total_weight, EPS))
        activation = float((0.30 + 0.70 * salience_t) ** max(params.alpha_salience, 1e-6))
        hub_amp = 1.0 + params.gamma_hub * self.degree_norm

        unknown_idx = np.flatnonzero(states == STATE_UNKNOWN)
        if unknown_idx.size > 0:
            if self.dataset.sparse_signal:
                base_error_floor = (3e-5 + 4e-4 * salience_t) * self.sparse_precision_scale
            else:
                base_error_floor = 0.002 + 0.010 * salience_t
            p_to_error = np.clip(
                base_error_floor
                + activation
                * phase_boost
                * (
                    params.p_self_error * (1.0 - local_right[unknown_idx])
                    + params.p_copy_error * local_error[unknown_idx] * hub_amp[unknown_idx]
                ),
                0.0,
                0.95,
            )
            p_to_right = np.clip(
                activation * (params.p_copy_right * local_right[unknown_idx] * (1.0 + 0.4 * self.degree_norm[unknown_idx])),
                0.0,
                0.95,
            )
            draw = rng.random(unknown_idx.size)
            choose_error = draw < p_to_error
            choose_right = (~choose_error) & (draw < (p_to_error + p_to_right))
            new_states[unknown_idx[choose_error]] = STATE_ERROR
            new_states[unknown_idx[choose_right]] = STATE_RIGHT

        error_idx = np.flatnonzero(states == STATE_ERROR)
        if error_idx.size > 0:
            p_correct = np.clip(
                params.p_proofread * (0.30 + 0.55 * salience_t)
                + params.p_norm * local_right[error_idx]
                + 0.03 * total_active,
                0.0,
                0.94,
            )
            correct_mask = rng.random(error_idx.size) < p_correct
            new_states[error_idx[correct_mask]] = STATE_RIGHT

        right_idx = np.flatnonzero(states == STATE_RIGHT)
        if right_idx.size > 0:
            p_forget = np.clip(
                params.p_forget * (1.0 - salience_t) * (1.0 - local_right[right_idx]),
                0.0,
                0.70,
            )
            relapse_floor = (
                (4e-5 + 2.2e-4 * salience_t) * self.sparse_precision_scale
                if self.dataset.sparse_signal
                else 0.002
            )
            copy_error_weight = 0.22 if self.dataset.sparse_signal else 0.35
            p_relapse = np.clip(
                relapse_floor * phase_boost
                + copy_error_weight * params.p_copy_error * local_error[right_idx] * phase_boost,
                0.0,
                0.70,
            )
            draw = rng.random(right_idx.size)
            forget_mask = draw < p_forget
            relapse_mask = (~forget_mask) & (draw < (p_forget + p_relapse))
            new_states[right_idx[forget_mask]] = STATE_UNKNOWN
            new_states[right_idx[relapse_mask]] = STATE_ERROR

        return new_states

    def simulate_once(
        self,
        params: ABMParameters,
        seed: int,
        intervention_start: int | None = None,
        intervention_params: ABMParameters | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        rng = np.random.default_rng(int(seed))
        states = self._initialize_states(params, rng)
        point_count = len(self.dataset.years)
        right_counts = np.zeros(point_count, dtype=float)
        error_counts = np.zeros(point_count, dtype=float)
        share = np.zeros(point_count, dtype=float)

        for t in range(point_count):
            active_target = float(self.dataset.total[t]) / max(float(self.dataset.total.max()), EPS)
            unknown_idx = np.flatnonzero(states == STATE_UNKNOWN)
            target_active_mass = active_target * self.total_weight
            current_active_mass = self._state_mass(states)
            if target_active_mass > current_active_mass and unknown_idx.size > 0:
                need_mass = min(target_active_mass - current_active_mass, float(self.node_weight[unknown_idx].sum()))
                chosen = self._select_activation_nodes(unknown_idx, need_mass, rng)
                seed_prob = self._seed_error_probability(t)
                error_seed_mask = rng.random(chosen.size) < seed_prob
                states[chosen[error_seed_mask]] = STATE_ERROR
                states[chosen[~error_seed_mask]] = STATE_RIGHT

            right_counts[t] = self._state_mass(states, STATE_RIGHT)
            error_counts[t] = self._state_mass(states, STATE_ERROR)
            share[t] = error_counts[t] / max(right_counts[t] + error_counts[t], EPS)

            if t < point_count - 1:
                effective_params = (
                    intervention_params
                    if intervention_params is not None and intervention_start is not None and t >= int(intervention_start)
                    else params
                )
                states = self._step(states, t, effective_params, rng)

        scale = max(float(self.dataset.total.max()), 1.0) / max(self.n_agents, 1)
        right_series = right_counts * scale
        error_series = error_counts * scale
        sim_total = np.maximum(right_series + error_series, EPS)
        right_series = self.dataset.total * (right_series / sim_total)
        error_series = self.dataset.total * (error_series / sim_total)
        share = np.clip(error_series / np.maximum(right_series + error_series, EPS), 0.0, 1.0)
        right_series = self.dataset.total * (1.0 - share)
        error_series = self.dataset.total * share
        return right_series, error_series, share

    def simulate_once_with_history(
        self,
        params: ABMParameters,
        seed: int,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[np.ndarray]]:
        rng = np.random.default_rng(int(seed))
        states = self._initialize_states(params, rng)
        point_count = len(self.dataset.years)
        right_counts = np.zeros(point_count, dtype=float)
        error_counts = np.zeros(point_count, dtype=float)
        share = np.zeros(point_count, dtype=float)
        history: list[np.ndarray] = []

        for t in range(point_count):
            active_target = float(self.dataset.total[t]) / max(float(self.dataset.total.max()), EPS)
            unknown_idx = np.flatnonzero(states == STATE_UNKNOWN)
            target_active_mass = active_target * self.total_weight
            current_active_mass = self._state_mass(states)
            if target_active_mass > current_active_mass and unknown_idx.size > 0:
                need_mass = min(target_active_mass - current_active_mass, float(self.node_weight[unknown_idx].sum()))
                chosen = self._select_activation_nodes(unknown_idx, need_mass, rng)
                seed_prob = self._seed_error_probability(t)
                error_seed_mask = rng.random(chosen.size) < seed_prob
                states[chosen[error_seed_mask]] = STATE_ERROR
                states[chosen[~error_seed_mask]] = STATE_RIGHT

            history.append(states.copy())
            right_counts[t] = self._state_mass(states, STATE_RIGHT)
            error_counts[t] = self._state_mass(states, STATE_ERROR)
            share[t] = error_counts[t] / max(right_counts[t] + error_counts[t], EPS)

            if t < point_count - 1:
                states = self._step(states, t, params, rng)

        scale = max(float(self.dataset.total.max()), 1.0) / max(self.n_agents, 1)
        right_series = right_counts * scale
        error_series = error_counts * scale
        sim_total = np.maximum(right_series + error_series, EPS)
        right_series = self.dataset.total * (right_series / sim_total)
        error_series = self.dataset.total * (error_series / sim_total)
        share = np.clip(error_series / np.maximum(right_series + error_series, EPS), 0.0, 1.0)
        right_series = self.dataset.total * (1.0 - share)
        error_series = self.dataset.total * share
        return right_series, error_series, share, history

    def simulate_repeated(
        self,
        params: ABMParameters,
        repeats: int,
        seed: int,
        intervention_start: int | None = None,
        intervention_params: ABMParameters | None = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        right_runs: list[np.ndarray] = []
        error_runs: list[np.ndarray] = []
        share_runs: list[np.ndarray] = []
        for repeat_idx in range(max(1, int(repeats))):
            right, error, share = self.simulate_once(
                params=params,
                seed=int(seed) + (1009 * repeat_idx),
                intervention_start=intervention_start,
                intervention_params=intervention_params,
            )
            right_runs.append(right)
            error_runs.append(error)
            share_runs.append(share)

        right_arr = np.vstack(right_runs)
        error_arr = np.vstack(error_runs)
        share_arr = np.vstack(share_runs)
        return (
            right_arr.mean(axis=0),
            error_arr.mean(axis=0),
            share_arr.mean(axis=0),
            right_arr.std(axis=0),
            error_arr.std(axis=0),
            share_arr.std(axis=0),
        )

    def score(self, params: ABMParameters, repeats: int, seed: int) -> tuple[float, dict[str, np.ndarray]]:
        right_mean, error_mean, share_mean, right_std, error_std, share_std = self.simulate_repeated(
            params=params,
            repeats=repeats,
            seed=seed,
        )
        right_rmse = float(np.sqrt(np.mean((right_mean - self.dataset.right) ** 2)))
        error_rmse = float(np.sqrt(np.mean((error_mean - self.dataset.error) ** 2)))
        share_rmse = float(np.sqrt(np.mean((share_mean - self.dataset.error_share) ** 2)))
        peak_gap = abs(float(error_mean.max()) - float(self.dataset.error.max()))
        peak_time_gap = abs(int(np.argmax(error_mean)) - int(np.argmax(self.dataset.error)))
        tail_gap = abs(float(error_mean[-1]) - float(self.dataset.error[-1]))
        empirical_tail = float(np.mean(self.dataset.error[-5:])) if len(self.dataset.error) >= 5 else float(self.dataset.error[-1])
        simulated_tail = float(np.mean(error_mean[-5:])) if len(error_mean) >= 5 else float(error_mean[-1])
        empirical_peak = float(np.max(self.dataset.error)) if len(self.dataset.error) else 0.0
        simulated_peak = float(np.max(error_mean)) if len(error_mean) else 0.0
        tail_zero_penalty = 0.0
        if empirical_tail > METRIC_EPS:
            tail_floor = empirical_tail * (0.22 if self.dataset.sparse_signal else 0.12)
            if simulated_tail < tail_floor:
                ratio = (tail_floor - simulated_tail) / max(empirical_tail, METRIC_EPS)
                tail_zero_penalty += 8.0 * ratio
        if empirical_peak > METRIC_EPS:
            peak_floor = empirical_peak * (0.30 if self.dataset.sparse_signal else 0.45)
            if simulated_peak < peak_floor:
                ratio = (peak_floor - simulated_peak) / max(empirical_peak, METRIC_EPS)
                tail_zero_penalty += 6.0 * ratio
        instability_penalty = float(np.mean(error_std))
        score = (
            2.8 * error_rmse
            + 1.0 * right_rmse
            + 120.0 * share_rmse
            + 0.20 * peak_gap
            + 2.0 * peak_time_gap
            + 0.20 * tail_gap
            + 0.08 * instability_penalty
            + tail_zero_penalty
        )
        return score, {
            "right_mean": right_mean,
            "error_mean": error_mean,
            "share_mean": share_mean,
            "right_std": right_std,
            "error_std": error_std,
            "share_std": share_std,
        }

    def fit(
        self,
        search_rounds: int,
        repeats: int,
        seed: int,
        fit_profile: str = "research",
    ) -> tuple[ABMParameters, float, dict[str, np.ndarray]]:
        rng = np.random.default_rng(int(seed))
        best_params: ABMParameters | None = None
        best_score = float("inf")
        best_series: dict[str, np.ndarray] | None = None
        profile = FIT_PROFILES.get(str(fit_profile or "research").strip().lower(), FIT_PROFILES["research"])
        if self.dataset.sparse_signal:
            lower = np.array([0.0002, 0.005, 0.020, 0.020, 0.0002, 0.020, 0.40, 0.00, 0.00, 0.0000, 0.005])
            upper = np.array([0.030, 0.450, 0.700, 0.800, 0.080, 0.800, 2.80, 1.40, 1.80, 0.012, 0.150])
            sigma = np.array([0.004, 0.050, 0.080, 0.090, 0.010, 0.090, 0.28, 0.20, 0.22, 0.002, 0.025])
        else:
            lower = np.array([0.001, 0.020, 0.020, 0.010, 0.001, 0.010, 0.30, 0.00, 0.00, 0.003, 0.003])
            upper = np.array([0.080, 0.700, 0.700, 0.700, 0.150, 0.700, 2.40, 1.20, 1.80, 0.060, 0.120])
            sigma = np.array([0.010, 0.080, 0.080, 0.080, 0.020, 0.080, 0.25, 0.18, 0.22, 0.010, 0.020])

        def sample_params() -> ABMParameters:
            sampled = np.array([rng.uniform(low, high) for low, high in zip(lower, upper, strict=False)], dtype=float)
            return ABMParameters(*[float(item) for item in sampled])

        def perturb(params: ABMParameters, scale: float) -> ABMParameters:
            arr = np.array(list(asdict(params).values()), dtype=float)
            arr = np.clip(arr + rng.normal(0.0, sigma * scale), lower, upper)
            return ABMParameters(*[float(item) for item in arr])

        candidate_pool: list[tuple[float, ABMParameters]] = []
        screen_repeats = max(1, min(int(repeats), int(profile["screen_repeats_cap"])))
        screen_candidates = max(12, int(round(int(search_rounds) * float(profile["screen_multiplier"]))))
        for _ in range(screen_candidates):
            params = sample_params()
            score, _ = self.score(params=params, repeats=screen_repeats, seed=seed)
            candidate_pool.append((score, params))

        shortlist = [
            params
            for _, params in sorted(candidate_pool, key=lambda item: item[0])[: min(int(profile["shortlist_size"]), len(candidate_pool))]
        ]
        for params in shortlist:
            score, series = self.score(params=params, repeats=repeats, seed=seed)
            if score < best_score:
                best_score = score
                best_params = params
                best_series = series

        assert best_params is not None
        assert best_series is not None

        scale = 1.0
        refine_epochs = int(profile["refine_epochs"])
        refine_divisor = max(1, int(profile["refine_candidates_divisor"]))
        refine_floor = int(profile["refine_min_candidates"])
        for _ in range(refine_epochs):
            for _ in range(max(refine_floor, int(search_rounds) // refine_divisor)):
                params = perturb(best_params, scale=scale)
                score, series = self.score(params=params, repeats=repeats, seed=seed)
                if score < best_score:
                    best_score = score
                    best_params = params
                    best_series = series
            scale *= 0.78

        final_repeats = max(int(repeats), int(repeats) + int(profile["elite_repeats_boost"]))
        for _ in range(int(profile["elite_passes"])):
            elite_candidates = [best_params]
            elite_candidates.extend(perturb(best_params, scale=scale) for _ in range(10))
            for params in elite_candidates:
                score, series = self.score(params=params, repeats=final_repeats, seed=seed + 211)
                if score < best_score:
                    best_score = score
                    best_params = params
                    best_series = series

        return best_params, float(best_score), best_series


def _variant_breakdown(payload: SimulationDataset) -> list[dict[str, Any]]:
    if payload.variant_matrix.size == 0:
        return []
    rows: list[dict[str, Any]] = []
    totals = payload.variant_matrix.sum(axis=1)
    order = np.argsort(-totals)
    for idx in order[: min(6, len(order))]:
        series = payload.variant_matrix[idx]
        peak_idx = int(np.argmax(series)) if len(series) else 0
        peak_label = (
            str(payload.labels[peak_idx])
            if payload.labels and 0 <= peak_idx < len(payload.labels)
            else (str(payload.years[peak_idx]) if payload.years and 0 <= peak_idx < len(payload.years) else "")
        )
        rows.append(
            {
                "variant": payload.variant_names[int(idx)],
                "total_mass": float(totals[int(idx)]),
                "peak_year": _label_to_year(peak_label),
                "peak_time": peak_label,
                "peak_value": float(series[peak_idx]) if len(series) else 0.0,
                "final_value": float(series[-1]) if len(series) else 0.0,
            }
        )
    return rows


def _scenario_catalog(params: ABMParameters) -> list[tuple[str, str, str, ABMParameters, str]]:
    proofread = replace(
        params,
        p_proofread=min(params.p_proofread * 1.30 + 0.015, 0.90),
        p_norm=min(params.p_norm * 1.12 + 0.010, 0.90),
    )
    norm_guard = replace(
        params,
        p_norm=min(params.p_norm * 1.35 + 0.015, 0.90),
        p_copy_error=max(params.p_copy_error * 0.92, 0.01),
    )
    combined = replace(
        params,
        p_proofread=min(params.p_proofread * 1.28 + 0.020, 0.90),
        p_norm=min(params.p_norm * 1.28 + 0.020, 0.90),
        p_copy_error=max(params.p_copy_error * 0.88, 0.01),
    )
    return [
        ("proofread_boost", "Proofreading Boost", "#0f766e", proofread, "platform spellcheck, editor review, assisted correction"),
        ("norm_guard", "Norm Guard", "#b45309", norm_guard, "community moderation, style guide reinforcement, official norm prompts"),
        ("combined_control", "Combined Control", "#7c3aed", combined, "joint platform governance plus educational or editorial intervention"),
    ]


def _benchmark_budget(search_rounds: int, repeats: int) -> tuple[int, int]:
    rounds = max(10, min(36, int(round(max(8, int(search_rounds)) * 0.30))))
    reps = max(1, min(2, int(repeats)))
    return rounds, reps


def _topology_benchmark(
    sim_dataset: SimulationDataset,
    phase_break_index: int,
    search_rounds: int,
    repeats: int,
    random_seed: int,
    ws_k: int,
    ws_p: float,
    ba_m: int,
) -> list[dict[str, Any]]:
    benchmark_rounds, benchmark_repeats = _benchmark_budget(search_rounds, repeats)
    rows: list[dict[str, Any]] = []
    for topo in sorted(SUPPORTED_TOPOLOGIES):
        benchmark_agents, sparse_agent_floor = _recommended_agent_count(
            sim_dataset,
            requested=max(120, min(720, 360 + len(sim_dataset.years) * 4)),
            benchmark=True,
        )
        model = NetworkSpellingABM(
            dataset=sim_dataset,
            phase_break_index=phase_break_index,
            n_agents=benchmark_agents,
            topology=topo,
            base_seed=random_seed,
            ws_k=ws_k,
            ws_p=ws_p,
            ba_m=ba_m,
        )
        params, score, series = model.fit(
            search_rounds=benchmark_rounds,
            repeats=benchmark_repeats,
            seed=random_seed + 17,
            fit_profile="explore",
        )
        metrics = {
            "right": _compute_metrics(sim_dataset.right, series["right_mean"]),
            "error": _compute_metrics(sim_dataset.error, series["error_mean"]),
            "error_share": _compute_metrics(sim_dataset.error_share, series["share_mean"]),
        }
        graph = model.graph_summary()
        rows.append(
            {
                "topology": topo,
                "score": float(score),
                "right_r2": float(metrics["right"]["r2"]),
                "error_r2": float(metrics["error"]["r2"]),
                "share_r2": float(metrics["error_share"]["r2"]),
                "error_nrmse_peak": float(metrics["error"]["nrmse_peak"]),
                "share_nrmse_peak": float(metrics["error_share"]["nrmse_peak"]),
                "avg_degree": float(graph["avg_degree"]),
                "clustering": float(graph["clustering"]),
                "density": float(graph["density"]),
                "benchmark_search_rounds": int(benchmark_rounds),
                "benchmark_repeats": int(benchmark_repeats),
                "benchmark_n_agents": int(model.n_agents),
                "sparse_agent_floor": int(sparse_agent_floor),
                "preview_params": asdict(params),
            }
        )
    rows.sort(key=lambda item: (float(item["score"]), -float(item["share_r2"]), -float(item["error_r2"])))
    for index, row in enumerate(rows, start=1):
        row["rank"] = int(index)
    return rows


def _fit_diagnostics(metrics: dict[str, dict[str, float]]) -> dict[str, Any]:
    right_peak = float(metrics["right"]["peak_actual"])
    error_peak = float(metrics["error"]["peak_actual"])
    share_peak = float(metrics["error_share"]["peak_actual"])
    error_scale = max(error_peak, right_peak * 0.01, 1e-12)
    share_scale = max(share_peak, 0.01, 1e-6)
    error_signal_ratio = float(error_peak / max(right_peak, EPS))
    share_std = float(metrics["error_share"]["std_actual"])
    error_std = float(metrics["error"]["std_actual"])
    sparse_signal = bool(
        share_peak < 0.08
        or error_signal_ratio < 0.12
        or share_std < 0.01
        or error_std < error_scale * 0.25
    )
    tail_scale = max(float(metrics["error"]["tail_actual"]), error_scale * 0.50, 1e-12)
    return {
        "fit_regime": "sparse_signal" if sparse_signal else "standard_signal",
        "fit_regime_label": "Sparse-Signal Regime" if sparse_signal else "Standard Regime",
        "fit_protocol": (
            "right_r2 + error_nrmse_peak + share_nrmse_peak + peak_year_gap"
            if sparse_signal
            else "error_r2 + share_r2 + right_r2"
        ),
        "r2_caution": bool(sparse_signal),
        "r2_caution_reason": (
            "Observed misspelling signal is sparse relative to the canonical trajectory, so raw error/share R² can become unstable and is treated as a reference metric."
            if sparse_signal
            else ""
        ),
        "error_signal_ratio": error_signal_ratio,
        "error_share_peak_actual": share_peak,
        "error_nrmse_peak": float(metrics["error"]["rmse"] / error_scale),
        "share_nrmse_peak": float(metrics["error_share"]["rmse"] / share_scale),
        "error_tail_relative_gap": float(
            abs(float(metrics["error"]["tail_predicted"]) - float(metrics["error"]["tail_actual"])) / tail_scale
        ),
    }


def _signal_strength(diagnostics: dict[str, Any]) -> dict[str, Any]:
    ratio = float(diagnostics.get("error_signal_ratio") or 0.0)
    share_peak = float(diagnostics.get("error_share_peak_actual") or 0.0)
    if ratio >= 0.10 or share_peak >= 0.08:
        return {
            "signal_strength_grade": "strong",
            "signal_strength_label": "Strong Error Signal",
            "signal_strength_reason": "Observed error cluster has enough magnitude to support direct error/share fit assessment.",
        }
    if ratio >= 0.03 or share_peak >= 0.03:
        return {
            "signal_strength_grade": "moderate",
            "signal_strength_label": "Moderate Error Signal",
            "signal_strength_reason": "Observed error cluster is usable for fitting, but error/share metrics are moderately sensitive to noise and preprocessing.",
        }
    return {
        "signal_strength_grade": "weak",
        "signal_strength_label": "Weak Error Signal",
        "signal_strength_reason": "Observed misspelling signal is much smaller than the canonical trajectory, so this word is better used as a sparse-signal case than as the main showcase case.",
    }


def _fit_grade(metrics: dict[str, dict[str, float]], diagnostics: dict[str, Any]) -> str:
    right_r2 = float(metrics["right"]["r2"])
    error_r2 = float(metrics["error"]["r2"])
    share_r2 = float(metrics["error_share"]["r2"])
    if str(diagnostics.get("fit_regime") or "") == "standard_signal":
        if right_r2 >= 0.95 and error_r2 >= 0.90 and share_r2 >= 0.85:
            return "A"
        if right_r2 >= 0.90 and error_r2 >= 0.78 and share_r2 >= 0.68:
            return "B"
        if right_r2 >= 0.82 and error_r2 >= 0.60 and share_r2 >= 0.45:
            return "C"
        return "D"

    error_nrmse = float(diagnostics.get("error_nrmse_peak") or 0.0)
    share_nrmse = float(diagnostics.get("share_nrmse_peak") or 0.0)
    peak_gap = float(metrics["error"]["peak_time_gap"])
    tail_relative_gap = float(diagnostics.get("error_tail_relative_gap") or 0.0)
    if right_r2 >= 0.97 and error_nrmse <= 0.35 and share_nrmse <= 0.50 and peak_gap <= 3 and tail_relative_gap <= 0.60:
        return "A"
    if right_r2 >= 0.93 and error_nrmse <= 0.55 and share_nrmse <= 0.85 and peak_gap <= 6 and tail_relative_gap <= 0.90:
        return "B"
    if right_r2 >= 0.85 and error_nrmse <= 0.85 and share_nrmse <= 1.20 and peak_gap <= 10 and tail_relative_gap <= 1.30:
        return "C"
    return "D"


def _fit_grade_reason(grade: str, metrics: dict[str, dict[str, float]], diagnostics: dict[str, Any]) -> str:
    regime = str(diagnostics.get("fit_regime_label") or "Standard Regime")
    if str(diagnostics.get("fit_regime") or "") == "sparse_signal":
        return (
            f"{regime}: grade={grade} evaluated by right_r2={float(metrics['right']['r2']):.3f}, "
            f"error_nrmse_peak={float(diagnostics['error_nrmse_peak']):.3f}, "
            f"share_nrmse_peak={float(diagnostics['share_nrmse_peak']):.3f}, "
            f"peak_year_gap={float(metrics['error']['peak_time_gap']):.0f}."
        )
    return (
        f"{regime}: grade={grade} evaluated by right_r2={float(metrics['right']['r2']):.3f}, "
        f"error_r2={float(metrics['error']['r2']):.3f}, share_r2={float(metrics['error_share']['r2']):.3f}."
    )


def _recommended_agent_count(payload: SimulationDataset, requested: int, benchmark: bool = False) -> tuple[int, int]:
    requested_agents = max(40, int(requested))
    if not payload.sparse_signal:
        return requested_agents, requested_agents
    peak_share = max(float(np.max(payload.error_share)) if len(payload.error_share) else 0.0, 5e-4)
    multiplier = 1.15 if benchmark else 1.60
    min_agents = 900 if benchmark else 1200
    max_agents = 1200 if benchmark else 2200
    if str(payload.granularity or "year").strip().lower() == "day":
        horizon = max(0, len(payload.years))
        if horizon >= 1600:
            multiplier = 0.85 if benchmark else 1.00
            min_agents = 360 if benchmark else 520
            max_agents = 620 if benchmark else 980
        elif horizon >= 1000:
            multiplier = 0.95 if benchmark else 1.20
            min_agents = 460 if benchmark else 700
            max_agents = 800 if benchmark else 1300
    sparse_floor = int(np.clip(np.ceil(multiplier / peak_share), min_agents, max_agents))
    return max(requested_agents, sparse_floor), sparse_floor


def _effective_search_rounds(payload: SimulationDataset, requested: int) -> int:
    rounds = max(6, int(requested))
    if str(payload.granularity or "year").strip().lower() != "day":
        return rounds
    horizon = max(0, len(payload.years))
    if horizon >= 1600:
        return min(rounds, 10 if payload.sparse_signal else 12)
    if horizon >= 1000:
        return min(rounds, 14 if payload.sparse_signal else 16)
    return rounds


def _resolve_time_index_by_year(payload: SimulationDataset, target_year: int | None, default_index: int) -> int:
    if target_year is None:
        return int(default_index)
    if not payload.labels:
        return int(default_index)
    try:
        safe_target = int(target_year)
    except Exception:
        return int(default_index)
    for idx, label in enumerate(payload.labels):
        label_year = _label_to_year(label)
        if label_year is not None and int(label_year) >= safe_target:
            return int(idx)
    return int(default_index)


def _model_summary(payload: SimulationDataset, topology: str, variant_scope: SimulationVariantScope) -> dict[str, Any]:
    effective_mode = str(variant_scope.effective_mode or DEFAULT_VARIANT_SCOPE)
    if effective_mode == "competition":
        unit_of_analysis = "single canonical word with selected variant competition cluster"
        competition_scope = "right_vs_selected_variant_cluster"
        error_state_definition = "aggregate of all selected non-canonical variants, including strong orthographic competitors"
    else:
        unit_of_analysis = "single canonical word with typo-only misspelling cluster"
        competition_scope = "right_vs_typo_cluster"
        error_state_definition = "aggregate of retained typo-like variants after excluding strong orthographic competitors"
    return {
        "model_family": "complex-contagion-inspired stochastic ABM",
        "model_complexity": "phase-aware aggregate ABM with topology benchmark, activity-weighted nodes, and intervention scenarios",
        "unit_of_analysis": unit_of_analysis,
        "competition_scope": competition_scope,
        "error_state_definition": error_state_definition,
        "node_semantics": "synthetic exposure or writing unit",
        "network_semantics": "synthetic contact network rather than reconstructed real follower graph",
        "state_space": ["unknown", "error_cluster", "right"],
        "observed_variant_count": int(len(payload.variant_names)),
        "requested_variant_count": int(variant_scope.requested_variant_count),
        "retained_variant_count": int(variant_scope.retained_variant_count),
        "excluded_variant_count": int(variant_scope.excluded_variant_count),
        "variant_scope_mode_requested": str(variant_scope.requested_mode),
        "variant_scope_mode_effective": str(variant_scope.effective_mode),
        "variant_scope_label": str(variant_scope.label),
        "variant_scope_reason": str(variant_scope.reason),
        "excluded_variants": [str(item.get("variant") or "") for item in variant_scope.excluded_variants],
        "parameter_count": 11,
        "topology_candidates": int(len(SUPPORTED_TOPOLOGIES)),
        "variant_breakdown_level": "observed_only",
        "activity_weight_scheme": "lognormal heterogeneous activity weights",
        "precision_strategy": "sparse-signal adaptive seeding and weighted-mass counting" if payload.sparse_signal else "standard aggregate counting",
        "topology_family": str(topology or "watts_strogatz"),
        "time_granularity": str(payload.granularity or "year"),
    }


def run_simulation(
    dataset: AlgorithmDataset,
    topology: str = AUTO_TOPOLOGY,
    n_agents: int = 900,
    search_rounds: int = 60,
    repeats: int = 4,
    fit_profile: str = "research",
    trend_window: int = 3,
    random_seed: int = 42,
    ws_k: int = 8,
    ws_p: float = 0.08,
    ba_m: int = 4,
    intervention_year: int | None = None,
    variant_scope: str = DEFAULT_VARIANT_SCOPE,
) -> dict[str, Any]:
    scoped_dataset, scope = _prepare_variant_scope(dataset, variant_scope=variant_scope)
    sim_dataset = build_simulation_dataset(scoped_dataset, trend_window=trend_window)
    effective_search_rounds = _effective_search_rounds(sim_dataset, int(search_rounds))
    runtime_warnings: list[str] = []
    if effective_search_rounds != int(search_rounds):
        runtime_warnings.append("simulation_search_rounds_auto_tuned_for_long_day_series")
    if len(sim_dataset.years) < 4 or len(sim_dataset.total) < 4:
        warnings = list(sim_dataset.warnings)
        warnings.extend(runtime_warnings)
        warnings.append("insufficient_points_for_simulation")
        return {
            "word": sim_dataset.word,
            "summary": {
                "word": sim_dataset.word,
                "points": len(sim_dataset.years),
                "source": sim_dataset.source,
                "time_granularity": str(sim_dataset.granularity or "year"),
                "fit_grade": "N/A",
                "fit_grade_reason": "insufficient_points_for_simulation",
            },
            "metrics_summary": {},
            "best_params": {},
            "network_summary": {},
            "variant_breakdown": _variant_breakdown(sim_dataset),
            "topology_benchmark": [],
            "series_rows": [],
            "scenario_rows": [],
            "interventions": [],
            "variant_scope": asdict(scope),
            "warnings": warnings,
            "mode": dataset.mode,
            "impl": "chaunbofangzhen_vectorized_port",
        }

    phase_break_index = _detect_phase_break(sim_dataset.error_share)
    phase_break_label = str(sim_dataset.labels[phase_break_index]) if sim_dataset.labels else ""
    phase_break_year = _label_to_year(phase_break_label)
    effective_n_agents, sparse_agent_floor = _recommended_agent_count(sim_dataset, requested=n_agents)
    requested_topology = str(topology or AUTO_TOPOLOGY).strip().lower() or AUTO_TOPOLOGY
    if requested_topology not in {*SUPPORTED_TOPOLOGIES, AUTO_TOPOLOGY}:
        requested_topology = AUTO_TOPOLOGY
    topology_benchmark = (
        _topology_benchmark(
            sim_dataset=sim_dataset,
            phase_break_index=phase_break_index,
            search_rounds=effective_search_rounds,
            repeats=repeats,
            random_seed=random_seed,
            ws_k=ws_k,
            ws_p=ws_p,
            ba_m=ba_m,
        )
        if requested_topology == AUTO_TOPOLOGY
        else []
    )
    selected_topology = (
        str(topology_benchmark[0]["topology"])
        if topology_benchmark
        else requested_topology
    )
    intervention_start_index = phase_break_index
    if intervention_year is not None and sim_dataset.years:
        intervention_start_index = _resolve_time_index_by_year(
            sim_dataset,
            target_year=intervention_year,
            default_index=phase_break_index,
        )

    model = NetworkSpellingABM(
        dataset=sim_dataset,
        phase_break_index=phase_break_index,
        n_agents=effective_n_agents,
        topology=selected_topology,
        base_seed=random_seed,
        ws_k=ws_k,
        ws_p=ws_p,
        ba_m=ba_m,
    )
    best_params, best_score, best_series = model.fit(
        search_rounds=effective_search_rounds,
        repeats=repeats,
        seed=random_seed,
        fit_profile=fit_profile,
    )

    metrics = {
        "right": _compute_metrics(sim_dataset.right, best_series["right_mean"]),
        "error": _compute_metrics(sim_dataset.error, best_series["error_mean"]),
        "error_share": _compute_metrics(sim_dataset.error_share, best_series["share_mean"]),
    }
    fit_diagnostics = _fit_diagnostics(metrics)
    signal_strength = _signal_strength(fit_diagnostics)
    fit_grade = _fit_grade(metrics, fit_diagnostics)
    fit_grade_reason = _fit_grade_reason(fit_grade, metrics, fit_diagnostics)
    network_summary = model.graph_summary()
    variant_breakdown = _variant_breakdown(sim_dataset)
    model_summary = _model_summary(sim_dataset, model.topology, scope)

    scenarios: list[dict[str, Any]] = []
    scenario_rows: list[dict[str, Any]] = []
    for key, label, color, scenario_params, application_context in _scenario_catalog(best_params):
        _, error_mean, share_mean, _, error_std, share_std = model.simulate_repeated(
            params=best_params,
            repeats=max(2, repeats),
            seed=random_seed + 97,
            intervention_start=intervention_start_index,
            intervention_params=scenario_params,
        )
        improvement = float(best_series["error_mean"][-1] - error_mean[-1]) if len(error_mean) else 0.0
        scenarios.append(
            {
                "key": key,
                "label": label,
                "color": color,
                "application_context": application_context,
                "start_year": _label_to_year(sim_dataset.labels[intervention_start_index]) if sim_dataset.labels else None,
                "start_time": str(sim_dataset.labels[intervention_start_index]) if sim_dataset.labels else None,
                "final_error_reduction": improvement,
                "final_error_share": float(share_mean[-1]) if len(share_mean) else 0.0,
                "rows": [
                    {
                        "year": int(sim_dataset.years[idx]),
                        "time_label": str(sim_dataset.labels[idx]) if sim_dataset.labels else str(sim_dataset.years[idx]),
                        "error_mean": float(error_mean[idx]),
                        "error_share_mean": float(share_mean[idx]),
                        "error_std": float(error_std[idx]),
                        "share_std": float(share_std[idx]),
                    }
                    for idx in range(len(sim_dataset.years))
                ],
            }
        )

    if sim_dataset.years:
        for idx, year in enumerate(sim_dataset.years):
            row = {
                "year": int(year),
                "time_label": str(sim_dataset.labels[idx]) if sim_dataset.labels else str(year),
                "baseline_error": float(best_series["error_mean"][idx]),
                "baseline_share": float(best_series["share_mean"][idx]),
            }
            for item in scenarios:
                scenario_point = item["rows"][idx]
                row[f"{item['key']}_error"] = float(scenario_point["error_mean"])
                row[f"{item['key']}_share"] = float(scenario_point["error_share_mean"])
            scenario_rows.append(row)

    series_rows = [
        {
            "year": int(sim_dataset.years[idx]),
            "label": sim_dataset.labels[idx],
            "time_label": sim_dataset.labels[idx],
            "right_actual": float(sim_dataset.right[idx]),
            "error_actual": float(sim_dataset.error[idx]),
            "error_share_actual": float(sim_dataset.error_share[idx]),
            "right_simulated": float(best_series["right_mean"][idx]),
            "error_simulated": float(best_series["error_mean"][idx]),
            "error_share_simulated": float(best_series["share_mean"][idx]),
            "right_std": float(best_series["right_std"][idx]),
            "error_std": float(best_series["error_std"][idx]),
            "share_std": float(best_series["share_std"][idx]),
        }
        for idx in range(len(sim_dataset.years))
    ]

    actual_error_peak_idx = int(np.argmax(sim_dataset.error)) if len(sim_dataset.error) else 0
    predicted_error_peak_idx = int(np.argmax(best_series["error_mean"])) if len(best_series["error_mean"]) else 0
    actual_peak_label = (
        str(sim_dataset.labels[actual_error_peak_idx])
        if sim_dataset.labels and 0 <= actual_error_peak_idx < len(sim_dataset.labels)
        else ""
    )
    predicted_peak_label = (
        str(sim_dataset.labels[predicted_error_peak_idx])
        if sim_dataset.labels and 0 <= predicted_error_peak_idx < len(sim_dataset.labels)
        else ""
    )
    actual_peak_year = _label_to_year(actual_peak_label)
    predicted_peak_year = _label_to_year(predicted_peak_label)
    if sim_dataset.granularity == "day":
        left_date = _label_to_date(actual_peak_label)
        right_date = _label_to_date(predicted_peak_label)
        if left_date is not None and right_date is not None:
            error_peak_gap_days: int | None = abs((left_date - right_date).days)
        else:
            error_peak_gap_days = abs(int(actual_error_peak_idx) - int(predicted_error_peak_idx))
    else:
        error_peak_gap_days = None
    best_scenario = max(scenarios, key=lambda item: float(item.get("final_error_reduction") or 0.0), default=None)

    return {
        "word": sim_dataset.word,
        "summary": {
            "word": sim_dataset.word,
            "topology": str(model.topology),
            "points": len(sim_dataset.years),
            "source": sim_dataset.source,
            "requested_n_agents": int(n_agents),
            "n_agents": int(model.n_agents),
            "sparse_agent_floor": int(sparse_agent_floor),
            "search_rounds_requested": int(search_rounds),
            "search_rounds": int(effective_search_rounds),
            "repeats": int(repeats),
            "fit_profile": str(fit_profile),
            "trend_window": int(trend_window),
            "ws_k": int(ws_k),
            "ws_p": float(ws_p),
            "ba_m": int(ba_m),
            "random_seed": int(random_seed),
            "requested_topology": requested_topology,
            "selected_topology": str(model.topology),
            "topology_mode": "auto_select" if requested_topology == AUTO_TOPOLOGY else "manual",
            "error_share_amplification": float(sim_dataset.error_share_amplification),
            "error_seed_floor": float(sim_dataset.error_seed_floor),
            "dataset_sparse_signal": bool(sim_dataset.sparse_signal),
            "phase_break_index": int(phase_break_index),
            "phase_break_year": phase_break_year,
            "phase_break_label": str(sim_dataset.labels[phase_break_index]) if sim_dataset.labels else "",
            "phase_break_time": str(sim_dataset.labels[phase_break_index]) if sim_dataset.labels else "",
            "intervention_year": (
                _label_to_year(sim_dataset.labels[intervention_start_index])
                if sim_dataset.labels
                else None
            ),
            "intervention_time": str(sim_dataset.labels[intervention_start_index]) if sim_dataset.labels else None,
            "best_score": float(best_score),
            "error_rmse": float(metrics["error"]["rmse"]),
            "error_r2": float(metrics["error"]["r2"]),
            "right_r2": float(metrics["right"]["r2"]),
            "share_rmse": float(metrics["error_share"]["rmse"]),
            "share_r2": float(metrics["error_share"]["r2"]),
            "fit_grade": fit_grade,
            "fit_regime": str(fit_diagnostics["fit_regime"]),
            "fit_regime_label": str(fit_diagnostics["fit_regime_label"]),
            "fit_protocol": str(fit_diagnostics["fit_protocol"]),
            "fit_grade_reason": fit_grade_reason,
            "r2_caution": bool(fit_diagnostics["r2_caution"]),
            "r2_caution_reason": str(fit_diagnostics["r2_caution_reason"]),
            "error_signal_ratio": float(fit_diagnostics["error_signal_ratio"]),
            "error_share_peak_actual": float(fit_diagnostics["error_share_peak_actual"]),
            "error_nrmse_peak": float(fit_diagnostics["error_nrmse_peak"]),
            "share_nrmse_peak": float(fit_diagnostics["share_nrmse_peak"]),
            "error_tail_relative_gap": float(fit_diagnostics["error_tail_relative_gap"]),
            "signal_strength_grade": str(signal_strength["signal_strength_grade"]),
            "signal_strength_label": str(signal_strength["signal_strength_label"]),
            "signal_strength_reason": str(signal_strength["signal_strength_reason"]),
            "error_peak_year_gap": (
                abs(int(actual_peak_year) - int(predicted_peak_year))
                if actual_peak_year is not None and predicted_peak_year is not None
                else abs(int(actual_error_peak_idx) - int(predicted_error_peak_idx))
            ),
            "error_peak_time_gap_days": error_peak_gap_days,
            "error_tail_gap": abs(float(best_series["error_mean"][-1]) - float(sim_dataset.error[-1])) if len(sim_dataset.error) else 0.0,
            "mean_error_std": float(np.mean(best_series["error_std"])) if len(best_series["error_std"]) else 0.0,
            "mean_share_std": float(np.mean(best_series["share_std"])) if len(best_series["share_std"]) else 0.0,
            "actual_error_peak_year": actual_peak_year,
            "predicted_error_peak_year": predicted_peak_year,
            "actual_error_peak_time": actual_peak_label,
            "predicted_error_peak_time": predicted_peak_label,
            "best_scenario": best_scenario["label"] if isinstance(best_scenario, dict) else None,
            "best_scenario_gain": float(best_scenario["final_error_reduction"]) if isinstance(best_scenario, dict) else 0.0,
            **model_summary,
        },
        "metrics_summary": metrics,
        "best_params": asdict(best_params),
        "network_summary": network_summary,
        "variant_breakdown": variant_breakdown,
        "topology_benchmark": topology_benchmark,
        "series_rows": series_rows,
        "scenario_rows": scenario_rows,
        "interventions": scenarios,
        "variant_scope": asdict(scope),
        "warnings": list(dict.fromkeys([*sim_dataset.warnings, *scope.warnings, *runtime_warnings])),
        "mode": dataset.mode,
        "impl": "chaunbofangzhen_vectorized_port",
    }
