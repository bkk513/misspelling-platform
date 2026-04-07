"""文件说明：传播仿真算法适配模块，负责基于拼写演化数据执行网络化 ABM 传播仿真。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import date
from typing import Any

import networkx as nx
import numpy as np
import pandas as pd

from .types import AlgorithmDataset

EPS = 1e-8
METRIC_EPS = 1e-24
STATE_UNKNOWN = 0
STATE_ERROR = 1
STATE_RIGHT = 2
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
    return {
        "rmse": rmse,
        "mae": mae,
        "r2": r2,
        "peak_actual": float(actual.max()) if len(actual) else 0.0,
        "peak_predicted": float(predicted.max()) if len(predicted) else 0.0,
        "peak_time_gap": float(abs(peak_idx_actual - peak_idx_pred)),
        "tail_actual": float(actual[-1]) if len(actual) else 0.0,
        "tail_predicted": float(predicted[-1]) if len(predicted) else 0.0,
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
    right: np.ndarray
    error: np.ndarray
    total: np.ndarray
    error_share: np.ndarray
    error_share_fit: np.ndarray
    error_share_amplification: float
    error_seed_floor: float
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


def build_simulation_dataset(dataset: AlgorithmDataset, trend_window: int = 3) -> SimulationDataset:
    # 仿真先把“正确拼写 / 错拼总量 / 错拼占比 / 热度”提炼出来，后面的 ABM 只依赖这份标准化输入。
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
    seed_floor = min(0.02, max(0.001, raw_peak * 2.5 if raw_peak > EPS else 0.001))
    total_max = max(float(total_series.max()) if len(total_series) else 0.0, EPS)
    salience = total_series / total_max
    years = [int(year) for year in dataset.years]
    dates = [date(int(year), 1, 1) for year in years]
    warnings = list(dataset.warnings)
    if variant_matrix.shape[0] == 0:
        warnings.append("simulation_missing_error_variants")

    return SimulationDataset(
        word=str(dataset.word or "simulation").strip().lower() or "simulation",
        years=years,
        labels=_year_labels(years),
        dates=dates,
        right=right_series,
        error=error_series,
        total=total_series,
        error_share=error_share,
        error_share_fit=error_share_fit,
        error_share_amplification=float(amplification),
        error_seed_floor=float(seed_floor),
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
    # 这里把前端选择的拓扑参数转换成真实网络，仿真的传播结构就在这一步确定。
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
        edges = np.asarray(list(self.graph.edges()), dtype=np.int32)
        if edges.size == 0:
            self.edge_src = np.zeros((0,), dtype=np.int32)
            self.edge_dst = np.zeros((0,), dtype=np.int32)
        else:
            self.edge_src = np.concatenate([edges[:, 0], edges[:, 1]])
            self.edge_dst = np.concatenate([edges[:, 1], edges[:, 0]])

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
        return {
            "n_agents": float(self.n_agents),
            "edges": float(self.graph.number_of_edges()),
            "avg_degree": float(self.degree.mean()) if len(self.degree) else 0.0,
            "density": float(nx.density(self.graph)),
            "clustering": float(nx.average_clustering(self.graph)) if self.graph.number_of_nodes() > 1 else 0.0,
            "degree_gini": gini,
        }

    def _initialize_states(self, params: ABMParameters, rng: np.random.Generator) -> np.ndarray:
        states = np.full(self.n_agents, STATE_UNKNOWN, dtype=np.int8)
        n_error = min(max(int(round(params.seed_error_frac * self.n_agents)), 1), self.n_agents)
        n_right = min(max(int(round(params.seed_right_frac * self.n_agents)), 1), max(1, self.n_agents - n_error))

        ranked = np.argsort(-self.degree)
        error_candidates = ranked[: max(n_error * 3, n_error)]
        right_candidates = ranked[::-1][: max(n_right * 3, n_right)]

        error_idx = rng.choice(error_candidates, size=n_error, replace=False)
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
            weights=(states[self.edge_src] == STATE_ERROR).astype(float),
            minlength=self.n_agents,
        )
        right_hits = np.bincount(
            self.edge_dst,
            weights=(states[self.edge_src] == STATE_RIGHT).astype(float),
            minlength=self.n_agents,
        )
        return error_hits / self.degree_safe, right_hits / self.degree_safe

    def _step(self, states: np.ndarray, t: int, params: ABMParameters, rng: np.random.Generator) -> np.ndarray:
        # 每个时间步都依据邻居状态、词项热度、阶段增益和节点中心性来更新代理状态。
        new_states = states.copy()
        local_error, local_right = self._neighbor_ratios(states)
        salience_t = float(np.clip(self.dataset.salience[t], 0.0, 1.0))
        phase_boost = 1.0 + (params.beta_phase if t >= self.phase_break_index else 0.0)
        total_active = float(np.mean(states != STATE_UNKNOWN))
        activation = float((0.30 + 0.70 * salience_t) ** max(params.alpha_salience, 1e-6))
        hub_amp = 1.0 + params.gamma_hub * self.degree_norm

        unknown_idx = np.flatnonzero(states == STATE_UNKNOWN)
        if unknown_idx.size > 0:
            # 未接触者可能被错误形式吸引，也可能在正确形式影响下直接进入正确状态。
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
            # 已错拼的代理在校对、规范压力和群体活跃度共同作用下可能被纠正。
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
            # 已正确的代理也可能遗忘退回未知，或在错误传播压力下复发成错拼。
            p_forget = np.clip(
                params.p_forget * (1.0 - salience_t) * (1.0 - local_right[right_idx]),
                0.0,
                0.70,
            )
            p_relapse = np.clip(
                0.002 * phase_boost + 0.35 * params.p_copy_error * local_error[right_idx] * phase_boost,
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
            # 每个年份先按真实总量补足“活跃代理”数量，再执行一次状态传播更新。
            active_target = float(self.dataset.total[t]) / max(float(self.dataset.total.max()), EPS)
            unknown_idx = np.flatnonzero(states == STATE_UNKNOWN)
            target_active_nodes = int(round(active_target * self.n_agents))
            current_active_nodes = int(np.count_nonzero(states != STATE_UNKNOWN))
            if target_active_nodes > current_active_nodes and unknown_idx.size > 0:
                need = min(target_active_nodes - current_active_nodes, int(unknown_idx.size))
                chosen = rng.choice(unknown_idx, size=need, replace=False)
                local_error_share = float(
                    self.dataset.error_share[max(0, t - 1)] if t > 0 else self.dataset.error_share[0]
                )
                error_seed_mask = rng.random(need) < np.clip(local_error_share, self.dataset.error_seed_floor, 0.95)
                states[chosen[error_seed_mask]] = STATE_ERROR
                states[chosen[~error_seed_mask]] = STATE_RIGHT

            right_counts[t] = float(np.count_nonzero(states == STATE_RIGHT))
            error_counts[t] = float(np.count_nonzero(states == STATE_ERROR))
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
            target_active_nodes = int(round(active_target * self.n_agents))
            current_active_nodes = int(np.count_nonzero(states != STATE_UNKNOWN))
            if target_active_nodes > current_active_nodes and unknown_idx.size > 0:
                need = min(target_active_nodes - current_active_nodes, int(unknown_idx.size))
                chosen = rng.choice(unknown_idx, size=need, replace=False)
                local_error_share = float(
                    self.dataset.error_share[max(0, t - 1)] if t > 0 else self.dataset.error_share[0]
                )
                error_seed_mask = rng.random(need) < np.clip(local_error_share, self.dataset.error_seed_floor, 0.95)
                states[chosen[error_seed_mask]] = STATE_ERROR
                states[chosen[~error_seed_mask]] = STATE_RIGHT

            history.append(states.copy())
            right_counts[t] = float(np.count_nonzero(states == STATE_RIGHT))
            error_counts[t] = float(np.count_nonzero(states == STATE_ERROR))
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
        tail_zero_penalty = 0.0
        if empirical_tail > 1.0 and simulated_tail < max(0.10 * empirical_tail, 0.5):
            tail_zero_penalty = 25.0 + 6.0 * (empirical_tail - simulated_tail)
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

        def sample_params() -> ABMParameters:
            return ABMParameters(
                p_self_error=float(rng.uniform(0.001, 0.080)),
                p_copy_error=float(rng.uniform(0.020, 0.700)),
                p_copy_right=float(rng.uniform(0.020, 0.700)),
                p_proofread=float(rng.uniform(0.010, 0.700)),
                p_forget=float(rng.uniform(0.001, 0.150)),
                p_norm=float(rng.uniform(0.010, 0.700)),
                alpha_salience=float(rng.uniform(0.30, 2.40)),
                beta_phase=float(rng.uniform(0.00, 1.20)),
                gamma_hub=float(rng.uniform(0.00, 1.80)),
                seed_error_frac=float(rng.uniform(0.003, 0.060)),
                seed_right_frac=float(rng.uniform(0.003, 0.120)),
            )

        def perturb(params: ABMParameters, scale: float) -> ABMParameters:
            arr = np.array(list(asdict(params).values()), dtype=float)
            lower = np.array([0.001, 0.020, 0.020, 0.010, 0.001, 0.010, 0.30, 0.00, 0.00, 0.003, 0.003])
            upper = np.array([0.080, 0.700, 0.700, 0.700, 0.150, 0.700, 2.40, 1.20, 1.80, 0.060, 0.120])
            sigma = scale * np.array([0.010, 0.080, 0.080, 0.080, 0.020, 0.080, 0.25, 0.18, 0.22, 0.010, 0.020])
            arr = np.clip(arr + rng.normal(0.0, sigma), lower, upper)
            return ABMParameters(*[float(item) for item in arr])

        candidate_pool: list[tuple[float, ABMParameters]] = []
        # 拟合分三步走：先随机粗筛，再围绕最优点扰动细调，最后用更高重复次数做精炼比较。
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
        rows.append(
            {
                "variant": payload.variant_names[int(idx)],
                "total_mass": float(totals[int(idx)]),
                "peak_year": int(payload.years[peak_idx]) if payload.years else None,
                "peak_value": float(series[peak_idx]) if len(series) else 0.0,
                "final_value": float(series[-1]) if len(series) else 0.0,
            }
        )
    return rows


def _scenario_catalog(params: ABMParameters) -> list[tuple[str, str, str, ABMParameters]]:
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
        ("proofread_boost", "Proofreading Boost", "#0f766e", proofread),
        ("norm_guard", "Norm Guard", "#b45309", norm_guard),
        ("combined_control", "Combined Control", "#7c3aed", combined),
    ]


def run_simulation(
    dataset: AlgorithmDataset,
    topology: str = "watts_strogatz",
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
) -> dict[str, Any]:
    # 这个总入口负责串起数据预处理、参数拟合、基线仿真、干预情景比较和前端所需摘要字段。
    sim_dataset = build_simulation_dataset(dataset, trend_window=trend_window)
    phase_break_index = _detect_phase_break(sim_dataset.error_share)
    phase_break_year = int(sim_dataset.years[phase_break_index]) if sim_dataset.years else None
    intervention_start_index = phase_break_index
    if intervention_year is not None and sim_dataset.years:
        intervention_start_index = next(
            (idx for idx, year in enumerate(sim_dataset.years) if int(year) >= int(intervention_year)),
            phase_break_index,
        )

    model = NetworkSpellingABM(
        dataset=sim_dataset,
        phase_break_index=phase_break_index,
        n_agents=n_agents,
        topology=topology,
        base_seed=random_seed,
        ws_k=ws_k,
        ws_p=ws_p,
        ba_m=ba_m,
    )
    best_params, best_score, best_series = model.fit(
        search_rounds=search_rounds,
        repeats=repeats,
        seed=random_seed,
        fit_profile=fit_profile,
    )

    metrics = {
        "right": _compute_metrics(sim_dataset.right, best_series["right_mean"]),
        "error": _compute_metrics(sim_dataset.error, best_series["error_mean"]),
        "error_share": _compute_metrics(sim_dataset.error_share, best_series["share_mean"]),
    }
    network_summary = model.graph_summary()
    variant_breakdown = _variant_breakdown(sim_dataset)

    scenarios: list[dict[str, Any]] = []
    scenario_rows: list[dict[str, Any]] = []
    for key, label, color, scenario_params in _scenario_catalog(best_params):
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
                "start_year": int(sim_dataset.years[intervention_start_index]) if sim_dataset.years else None,
                "final_error_reduction": improvement,
                "final_error_share": float(share_mean[-1]) if len(share_mean) else 0.0,
                "rows": [
                    {
                        "year": int(sim_dataset.years[idx]),
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
    best_scenario = max(scenarios, key=lambda item: float(item.get("final_error_reduction") or 0.0), default=None)

    return {
        "word": sim_dataset.word,
        "summary": {
            "word": sim_dataset.word,
            "topology": str(model.topology),
            "points": len(sim_dataset.years),
            "source": sim_dataset.source,
            "n_agents": int(model.n_agents),
            "search_rounds": int(search_rounds),
            "repeats": int(repeats),
            "fit_profile": str(fit_profile),
            "trend_window": int(trend_window),
            "ws_k": int(ws_k),
            "ws_p": float(ws_p),
            "ba_m": int(ba_m),
            "random_seed": int(random_seed),
            "error_share_amplification": float(sim_dataset.error_share_amplification),
            "error_seed_floor": float(sim_dataset.error_seed_floor),
            "phase_break_index": int(phase_break_index),
            "phase_break_year": phase_break_year,
            "phase_break_label": str(sim_dataset.labels[phase_break_index]) if sim_dataset.labels else "",
            "intervention_year": int(sim_dataset.years[intervention_start_index]) if sim_dataset.years else None,
            "best_score": float(best_score),
            "error_rmse": float(metrics["error"]["rmse"]),
            "error_r2": float(metrics["error"]["r2"]),
            "right_r2": float(metrics["right"]["r2"]),
            "share_rmse": float(metrics["error_share"]["rmse"]),
            "share_r2": float(metrics["error_share"]["r2"]),
            "actual_error_peak_year": int(sim_dataset.years[actual_error_peak_idx]) if sim_dataset.years else None,
            "predicted_error_peak_year": int(sim_dataset.years[predicted_error_peak_idx]) if sim_dataset.years else None,
            "best_scenario": best_scenario["label"] if isinstance(best_scenario, dict) else None,
            "best_scenario_gain": float(best_scenario["final_error_reduction"]) if isinstance(best_scenario, dict) else 0.0,
        },
        "metrics_summary": metrics,
        "best_params": asdict(best_params),
        "network_summary": network_summary,
        "variant_breakdown": variant_breakdown,
        "series_rows": series_rows,
        "scenario_rows": scenario_rows,
        "interventions": scenarios,
        "warnings": sim_dataset.warnings,
        "mode": dataset.mode,
        "impl": "chaunbofangzhen_vectorized_port",
    }
