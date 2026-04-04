import json
import csv
import os
from datetime import date
from pathlib import Path
from typing import Any

from ..db.task_artifacts_repo import list_artifacts, upsert_artifact
from ..db.tasks_repo import get_task_owner

OUTPUT_ROOT = Path("/app/outputs")
DELTA_T_SOURCE_REL = Path("Prediction of public perception bias(Fig6)") / "1.CFC_prediction" / "figures"


def build_output_dir(task_id: str) -> Path:
    out_dir = OUTPUT_ROOT / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def build_output_file(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename


def _candidate_source_roots() -> list[Path]:
    env_root = str(os.getenv("MISSPELLING_BEHAVIORS_REPO") or "").strip()
    candidates = [
        Path(env_root) if env_root else None,
        Path("/srv/apps/misspelling_behaviors-main"),
        Path("/app/misspelling_behaviors-main"),
    ]
    out: list[Path] = []
    seen: set[str] = set()
    for item in candidates:
        if item is None:
            continue
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def find_delta_t_source_figure(word: str) -> Path | None:
    normalized = str(word or "").strip().lower()
    if not normalized:
        return None
    candidate_names = []
    for base in {
        normalized,
        normalized.replace(" ", "_"),
        normalized.replace("-", "_"),
    }:
        clean = str(base or "").strip("_")
        if not clean:
            continue
        candidate_names.extend(
            [
                f"{clean}_300dpi.jpg",
                f"{clean}_300dpi.jpeg",
                f"{clean}_300dpi.png",
            ]
        )

    for root in _candidate_source_roots():
        figure_dir = root / DELTA_T_SOURCE_REL
        if not figure_dir.exists():
            continue
        by_name = {path.name.lower(): path for path in figure_dir.iterdir() if path.is_file()}
        for name in candidate_names:
            hit = by_name.get(name.lower())
            if hit is not None:
                return hit
    return None


def write_simulation_csv(rows: list[dict], out_csv: Path) -> None:
    fieldnames = list(rows[0].keys()) if rows else [
        "year",
        "right_actual",
        "error_actual",
        "right_simulated",
        "error_simulated",
        "error_share_actual",
        "error_share_simulated",
        "right_std",
        "error_std",
        "share_std",
    ]
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def write_simulation_preview_png(payload: dict[str, Any], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    rows = list(payload.get("series_rows") or [])
    scenarios = list(payload.get("interventions") or [])
    summary = dict(payload.get("summary") or {})
    network = dict(payload.get("network_summary") or {})
    word = str(payload.get("word") or "Simulation").strip() or "Simulation"

    fig = plt.figure(figsize=(13.8, 10.2), constrained_layout=True)
    grid = fig.add_gridspec(3, 2, width_ratios=[1.2, 1.0], height_ratios=[1.2, 1.0, 0.82])
    ax_fit = fig.add_subplot(grid[0, :])
    ax_share = fig.add_subplot(grid[1, 0])
    ax_scenario = fig.add_subplot(grid[1, 1])
    ax_meta = fig.add_subplot(grid[2, :])

    if not rows:
        ax_fit.text(0.5, 0.5, "No simulation series", ha="center", va="center", fontsize=13)
        ax_fit.set_axis_off()
        ax_share.set_axis_off()
        ax_scenario.set_axis_off()
        ax_meta.set_axis_off()
        fig.savefig(out_png, format="png", dpi=180)
        plt.close(fig)
        return

    years = [int(row.get("year") or 0) for row in rows]
    x = np.arange(len(years), dtype=float)
    right_actual = np.asarray([float(row.get("right_actual") or 0.0) for row in rows], dtype=float)
    error_actual = np.asarray([float(row.get("error_actual") or 0.0) for row in rows], dtype=float)
    right_sim = np.asarray([float(row.get("right_simulated") or 0.0) for row in rows], dtype=float)
    error_sim = np.asarray([float(row.get("error_simulated") or 0.0) for row in rows], dtype=float)
    share_actual = np.asarray([float(row.get("error_share_actual") or 0.0) for row in rows], dtype=float)
    share_sim = np.asarray([float(row.get("error_share_simulated") or 0.0) for row in rows], dtype=float)
    right_std = np.asarray([float(row.get("right_std") or 0.0) for row in rows], dtype=float)
    error_std = np.asarray([float(row.get("error_std") or 0.0) for row in rows], dtype=float)
    share_std = np.asarray([float(row.get("share_std") or 0.0) for row in rows], dtype=float)
    phase_break_year = summary.get("phase_break_year")
    phase_break_index = 0
    if isinstance(phase_break_year, (int, float)):
        try:
            phase_break_index = years.index(int(phase_break_year))
        except Exception:
            phase_break_index = 0

    fit_colors = {
        "right": "#245b9c",
        "right_fill": "#9db7d8",
        "error": "#b23a48",
        "error_fill": "#eab0b8",
        "share": "#117864",
        "baseline": "#4b5563",
    }

    ax_fit_error = ax_fit.twinx()
    right_obs_line = ax_fit.plot(x, right_actual, color=fit_colors["right"], linewidth=2.4, label="Observed correct")[0]
    right_sim_line = ax_fit.plot(x, right_sim, color=fit_colors["right"], linestyle="--", linewidth=2.0, label="Simulated correct")[0]
    ax_fit.fill_between(
        x,
        np.maximum(right_sim - right_std, 0.0),
        right_sim + right_std,
        color=fit_colors["right_fill"],
        alpha=0.18,
    )
    error_obs_line = ax_fit_error.plot(
        x,
        error_actual,
        color=fit_colors["error"],
        linewidth=2.4,
        label="Observed error",
    )[0]
    error_sim_line = ax_fit_error.plot(
        x,
        error_sim,
        color=fit_colors["error"],
        linestyle="--",
        linewidth=2.0,
        label="Simulated error",
    )[0]
    ax_fit_error.fill_between(
        x,
        np.maximum(error_sim - error_std, 0.0),
        error_sim + error_std,
        color=fit_colors["error_fill"],
        alpha=0.20,
    )
    ax_fit.axvline(float(phase_break_index), color="#334155", linestyle=":", linewidth=1.4, alpha=0.9)
    ax_fit.set_title("Observed vs Simulated Trajectories", fontsize=14, fontweight="bold")
    ax_fit.set_ylabel("Correct Frequency", fontsize=11)
    ax_fit_error.set_ylabel("Error Frequency", fontsize=11)
    ax_fit.grid(alpha=0.18, linestyle=":")
    ax_fit.legend(
        [right_obs_line, right_sim_line, error_obs_line, error_sim_line],
        ["Observed correct", "Simulated correct", "Observed error", "Simulated error"],
        loc="upper left",
        frameon=False,
        ncol=2,
        fontsize=9,
    )
    ax_fit.tick_params(labelsize=10)
    ax_fit_error.tick_params(labelsize=10)

    ax_share.plot(x, share_actual, color=fit_colors["share"], linewidth=2.3, label="Observed error share")
    ax_share.plot(x, share_sim, color=fit_colors["share"], linestyle="--", linewidth=2.0, label="Simulated error share")
    ax_share.fill_between(x, np.maximum(share_sim - share_std, 0.0), np.minimum(share_sim + share_std, 1.0), color="#a7e2d8", alpha=0.28)
    ax_share.axvline(float(phase_break_index), color="#334155", linestyle=":", linewidth=1.4, alpha=0.9)
    ax_share.set_title("Phase Shift and Error Share", fontsize=13, fontweight="bold")
    ax_share.set_ylabel("Share", fontsize=11)
    ax_share.set_xlabel("Year", fontsize=11)
    ax_share.grid(alpha=0.18, linestyle=":")
    ax_share.legend(loc="upper left", frameon=False, fontsize=9)
    ax_share.tick_params(labelsize=10)

    ax_scenario.plot(x, error_sim, color=fit_colors["baseline"], linewidth=2.2, label="Baseline error")
    for item in scenarios[:3]:
        key = str(item.get("key") or "").strip()
        color = str(item.get("color") or "#0f766e")
        label = str(item.get("label") or key).strip() or key
        points = list(item.get("rows") or [])
        if not points:
            continue
        y = np.asarray([float(point.get("error_mean") or 0.0) for point in points], dtype=float)
        ax_scenario.plot(x, y, color=color, linewidth=2.0, label=label)
    ax_scenario.axvline(float(phase_break_index), color="#334155", linestyle=":", linewidth=1.4, alpha=0.9)
    ax_scenario.set_title("Intervention Scenarios", fontsize=13, fontweight="bold")
    ax_scenario.set_ylabel("Error Frequency", fontsize=11)
    ax_scenario.set_xlabel("Year", fontsize=11)
    ax_scenario.grid(alpha=0.18, linestyle=":")
    ax_scenario.legend(loc="upper left", frameon=False, fontsize=9)
    ax_scenario.tick_params(labelsize=10)

    ax_meta.set_axis_off()
    meta_lines = [
        ("Topology", str(summary.get("topology") or "--")),
        ("Fit Profile", str(summary.get("fit_profile") or "--")),
        ("Phase Break", str(summary.get("phase_break_year") or "--")),
        ("Best Score", f"{float(summary.get('best_score') or 0.0):.4f}"),
        ("Right R²", f"{float(summary.get('right_r2') or 0.0):.4f}"),
        ("Error R²", f"{float(summary.get('error_r2') or 0.0):.4f}"),
        ("Share RMSE", f"{float(summary.get('share_rmse') or 0.0):.6f}"),
        (
            "Share Basis",
            "observed scale"
            if float(summary.get("error_share_amplification") or 1.0) <= 1.0001
            else f"×{float(summary.get('error_share_amplification') or 1.0):.1f}",
        ),
        ("Agents", str(int(summary.get("n_agents") or 0) or "--")),
        ("Avg Degree", f"{float(network.get('avg_degree') or 0.0):.2f}"),
    ]
    ax_meta.text(
        0.02,
        0.97,
        word,
        fontsize=24,
        fontweight="bold",
        color="white",
        va="top",
        ha="left",
        bbox={"facecolor": "#148758", "edgecolor": "none", "pad": 8},
    )
    ax_meta.text(
        0.02,
        0.84,
        "Group-Level Spelling Diffusion Dashboard",
        fontsize=11,
        color="#475569",
        ha="left",
    )
    left_col = meta_lines[:5]
    right_col = meta_lines[5:]
    y_left = 0.70
    y_right = 0.70
    for label, value in left_col:
        ax_meta.text(0.03, y_left, label, fontsize=10, color="#64748b", ha="left")
        ax_meta.text(0.23, y_left, value, fontsize=12, fontweight="bold", color="#0f172a", ha="left")
        y_left -= 0.11
    for label, value in right_col:
        ax_meta.text(0.53, y_right, label, fontsize=10, color="#64748b", ha="left")
        ax_meta.text(0.75, y_right, value, fontsize=12, fontweight="bold", color="#0f172a", ha="left")
        y_right -= 0.11
    ax_meta.text(
        0.03,
        0.008,
        "The simulation now fits the observed error-share scale directly and uses phase-aware network diffusion for interpretation.",
        fontsize=8.6,
        color="#64748b",
        ha="left",
        va="bottom",
        wrap=True,
    )

    tick_positions = np.linspace(0, len(years) - 1, min(7, len(years))).astype(int)
    tick_labels = [str(years[idx]) for idx in tick_positions]
    for axis in (ax_fit, ax_share, ax_scenario):
        axis.set_xlim(0, max(0, len(years) - 1))
        axis.set_xticks(tick_positions)
        axis.set_xticklabels(tick_labels, rotation=0)

    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def write_simulation_animation_gif(
    payload: dict[str, Any],
    out_gif: Path,
    *,
    ws_k: int = 8,
    ws_p: float = 0.08,
    ba_m: int = 4,
    random_seed: int = 42,
    max_agents: int = 420,
    fps: int = 6,
    frame_step: int = 1,
    max_frames: int = 64,
) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation, PillowWriter
    from matplotlib.colors import LinearSegmentedColormap
    import networkx as nx
    import numpy as np

    from ..algos.simulation_adapter import (
        ABMParameters,
        NetworkSpellingABM,
        SimulationDataset,
        STATE_ERROR,
        STATE_RIGHT,
        STATE_UNKNOWN,
    )
    try:
        from scipy.ndimage import gaussian_filter
    except Exception:
        gaussian_filter = None

    rows = list(payload.get("series_rows") or [])
    summary = dict(payload.get("summary") or {})
    best_params_raw = dict(payload.get("best_params") or {})
    if not rows or not best_params_raw:
        return

    years = [int(row.get("year") or 0) for row in rows]
    labels = [str(row.get("label") or year) for row, year in zip(rows, years)]
    right_actual = np.asarray([float(row.get("right_actual") or 0.0) for row in rows], dtype=float)
    error_actual = np.asarray([float(row.get("error_actual") or 0.0) for row in rows], dtype=float)
    total = right_actual + error_actual
    total_max = max(float(total.max()) if len(total) else 0.0, 1e-12)
    error_share = np.asarray([float(row.get("error_share_actual") or 0.0) for row in rows], dtype=float)
    amplification = max(float(summary.get("error_share_amplification") or 1.0), 1.0)
    error_share_fit = np.clip(error_share * amplification, 0.0, 0.25)

    sim_dataset = SimulationDataset(
        word=str(payload.get("word") or "simulation"),
        years=years,
        labels=labels,
        dates=[date(int(year), 1, 1) for year in years],
        right=right_actual,
        error=error_actual,
        total=total,
        error_share=error_share,
        error_share_fit=error_share_fit,
        error_share_amplification=amplification,
        error_seed_floor=float(summary.get("error_seed_floor") or 0.001),
        salience=np.divide(total, total_max, out=np.zeros_like(total), where=total_max > 0),
        variant_names=[],
        variant_matrix=np.zeros((0, len(years)), dtype=float),
        source=str(summary.get("source") or ""),
        warnings=[],
    )
    params = ABMParameters(**{key: float(best_params_raw.get(key) or 0.0) for key in best_params_raw.keys()})
    display_agents = int(min(max_agents, max(260, int(summary.get("n_agents") or max_agents))))
    phase_break_index = int(summary.get("phase_break_index") or 0)
    topology = str(summary.get("topology") or "watts_strogatz")
    model = NetworkSpellingABM(
        dataset=sim_dataset,
        phase_break_index=phase_break_index,
        n_agents=display_agents,
        topology=topology,
        base_seed=int(random_seed),
        ws_k=int(ws_k),
        ws_p=float(ws_p),
        ba_m=int(ba_m),
    )
    _, _, _, history = model.simulate_once_with_history(params=params, seed=int(random_seed))
    curve_right = np.asarray([float(row.get("right_simulated") or 0.0) for row in rows], dtype=float)
    curve_error = np.asarray([float(row.get("error_simulated") or 0.0) for row in rows], dtype=float)
    curve_share = np.asarray([float(row.get("error_share_simulated") or 0.0) for row in rows], dtype=float)
    dates = np.asarray(sim_dataset.dates)

    def _simple_blur(arr: np.ndarray, rounds: int = 2) -> np.ndarray:
        out = arr.copy()
        for _ in range(max(1, int(rounds))):
            out = (
                out
                + np.roll(out, 1, 0)
                + np.roll(out, -1, 0)
                + np.roll(out, 1, 1)
                + np.roll(out, -1, 1)
                + np.roll(np.roll(out, 1, 0), 1, 1)
                + np.roll(np.roll(out, 1, 0), -1, 1)
                + np.roll(np.roll(out, -1, 0), 1, 1)
                + np.roll(np.roll(out, -1, 0), -1, 1)
            ) / 9.0
        return out

    def _build_intensity_maps(pos_array: np.ndarray, state_history: list[np.ndarray], heat_grid: int, sigma: float):
        xmin, ymin = pos_array.min(axis=0)
        xmax, ymax = pos_array.max(axis=0)
        pad_x = (xmax - xmin) * 0.06 + 1e-6
        pad_y = (ymax - ymin) * 0.06 + 1e-6
        xedges = np.linspace(xmin - pad_x, xmax + pad_x, heat_grid + 1)
        yedges = np.linspace(ymin - pad_y, ymax + pad_y, heat_grid + 1)

        error_maps: list[np.ndarray] = []
        right_maps: list[np.ndarray] = []
        for states in state_history:
            error_idx = np.where(states == STATE_ERROR)[0]
            right_idx = np.where(states == STATE_RIGHT)[0]
            if len(error_idx) > 0:
                heat_e, _, _ = np.histogram2d(pos_array[error_idx, 1], pos_array[error_idx, 0], bins=[yedges, xedges])
            else:
                heat_e = np.zeros((heat_grid, heat_grid), dtype=float)
            if len(right_idx) > 0:
                heat_r, _, _ = np.histogram2d(pos_array[right_idx, 1], pos_array[right_idx, 0], bins=[yedges, xedges])
            else:
                heat_r = np.zeros((heat_grid, heat_grid), dtype=float)

            if gaussian_filter is not None:
                heat_e = gaussian_filter(heat_e, sigma=sigma)
                heat_r = gaussian_filter(heat_r, sigma=sigma)
            else:
                rounds = max(1, int(round(sigma)))
                heat_e = _simple_blur(heat_e, rounds=rounds)
                heat_r = _simple_blur(heat_r, rounds=rounds)
            error_maps.append(heat_e)
            right_maps.append(heat_r)

        extent = [xedges[0], xedges[-1], yedges[0], yedges[-1]]
        return np.stack(error_maps), np.stack(right_maps), np.asarray(extent, dtype=float)

    positions: dict[int, tuple[float, float]]
    if topology == "grid":
        width = int(np.ceil(np.sqrt(model.n_agents)))
        positions = {i: (i % width, -(i // width)) for i in range(model.n_agents)}
    elif topology in {"watts_strogatz", "newman_watts"}:
        positions = nx.kamada_kawai_layout(model.graph)
    else:
        positions = nx.spring_layout(model.graph, seed=17, k=1.8 / np.sqrt(max(model.n_agents, 4)), iterations=140)

    state_colors = {
        STATE_UNKNOWN: "#d8dee9",
        STATE_ERROR: "#c74a5f",
        STATE_RIGHT: "#3d6ea8",
    }
    degrees = np.asarray([model.graph.degree(i) for i in range(model.n_agents)], dtype=float)
    node_sizes = 14 + 34 * (degrees / max(float(degrees.max()) if len(degrees) else 1.0, 1.0))
    hub_nodes = [node for node, _ in sorted(model.graph.degree, key=lambda item: item[1], reverse=True)[:4]]
    frame_idx = np.arange(0, len(dates), max(1, int(frame_step)))
    if max_frames and len(frame_idx) > max_frames:
        keep = np.linspace(0, len(frame_idx) - 1, max_frames).astype(int)
        frame_idx = frame_idx[keep]

    pos_array = np.asarray([positions[i] for i in range(model.n_agents)], dtype=float)
    error_maps, right_maps, heat_extent = _build_intensity_maps(pos_array, history, heat_grid=140, sigma=2.0)
    vmax_error = max(1e-6, float(np.quantile(error_maps, 0.995)))
    vmax_right = max(1e-6, float(np.quantile(right_maps, 0.995)))
    unknown_series = np.array([np.mean(states == STATE_UNKNOWN) for states in history], dtype=float)
    error_node_series = np.array([np.mean(states == STATE_ERROR) for states in history], dtype=float)
    right_node_series = np.array([np.mean(states == STATE_RIGHT) for states in history], dtype=float)

    fig = plt.figure(figsize=(16.4, 10.4))
    grid = fig.add_gridspec(3, 2, width_ratios=[1.12, 1.0], height_ratios=[1.04, 0.92, 0.98], wspace=0.16, hspace=0.22)
    ax_net = fig.add_subplot(grid[:, 0])
    ax_curve = fig.add_subplot(grid[0, 1])
    ax_heat = fig.add_subplot(grid[1, 1])
    ax_share = fig.add_subplot(grid[2, 1])

    nx.draw_networkx_edges(model.graph, pos=positions, ax=ax_net, width=0.22, alpha=0.06, edge_color="#7f7f7f")
    nodes = nx.draw_networkx_nodes(
        model.graph,
        pos=positions,
        ax=ax_net,
        node_color=[state_colors[s] for s in history[0]],
        node_size=node_sizes,
        linewidths=0.28,
        edgecolors="white",
    )
    ax_net.set_title("A. Network Propagation View", fontsize=14, fontweight="bold")
    ax_net.set_xticks([])
    ax_net.set_yticks([])
    for spine in ax_net.spines.values():
        spine.set_visible(False)
    for hub in hub_nodes:
        x, y = positions[hub]
        ax_net.text(x, y + 0.03, f"H{hub}", fontsize=8, ha="center", va="bottom", color="#333333")
    net_note = ax_net.text(
        0.02,
        0.02,
        "",
        transform=ax_net.transAxes,
        ha="left",
        va="bottom",
        fontsize=10,
        bbox={"boxstyle": "round,pad=0.34", "fc": "white", "ec": "#bbbbbb", "alpha": 0.92},
    )

    err_cmap = LinearSegmentedColormap.from_list("err_flow", ["#ffffff", "#f7cad1", "#e58a99", "#c74a5f"])
    right_cmap = LinearSegmentedColormap.from_list("right_flow", ["#ffffff", "#dfeaf7", "#8fb5dd", "#3d6ea8"])
    error_im = ax_heat.imshow(error_maps[frame_idx[0]], extent=heat_extent, origin="lower", cmap=err_cmap, alpha=0.95, vmin=0.0, vmax=vmax_error)
    right_im = ax_heat.imshow(right_maps[frame_idx[0]], extent=heat_extent, origin="lower", cmap=right_cmap, alpha=0.42, vmin=0.0, vmax=vmax_right)
    ax_heat.scatter(pos_array[:, 0], pos_array[:, 1], s=3.5, color="#2d2d2d", alpha=0.16)
    ax_heat.set_title("B. Diffusion Heat Field", fontsize=13, fontweight="bold")
    ax_heat.set_xticks([])
    ax_heat.set_yticks([])
    for spine in ax_heat.spines.values():
        spine.set_visible(False)

    curve_marker = ax_curve.axvline(dates[frame_idx[0]], color="#0f172a", linewidth=1.3)
    ax_curve.plot(dates, right_actual, color="#3d6ea8", linewidth=2.3, label="Right actual")
    ax_curve.plot(dates, curve_right, color="#3d6ea8", linestyle="--", linewidth=2.0, label="Right simulated")
    ax_curve.plot(dates, error_actual, color="#c74a5f", linewidth=2.3, label="Error actual")
    ax_curve.plot(dates, curve_error, color="#c74a5f", linestyle="--", linewidth=2.0, label="Error simulated")
    ax_curve.axvspan(dates[phase_break_index], dates[-1], color="#f0f0f0", alpha=0.55)
    ax_curve.axvline(dates[phase_break_index], color="#444444", linestyle=":", linewidth=1.4, label="Phase break")
    ax_curve.set_title("C. Macro Trajectories", fontsize=13, fontweight="bold")
    ax_curve.set_ylabel("Frequency", fontsize=11)
    ax_curve.grid(alpha=0.22)
    ax_curve.legend(fontsize=9, ncol=2, loc="upper right", frameon=False)
    ax_curve.tick_params(labelsize=10)

    share_marker = ax_share.axvline(dates[frame_idx[0]], color="#0f172a", linewidth=1.3)
    share_point = ax_share.scatter([dates[frame_idx[0]]], [curve_share[frame_idx[0]]], color="#7f5aa2", s=35, zorder=4)
    ax_share.stackplot(
        dates,
        unknown_series,
        error_node_series,
        right_node_series,
        colors=[state_colors[STATE_UNKNOWN], state_colors[STATE_ERROR], state_colors[STATE_RIGHT]],
        alpha=0.34,
        labels=["Unknown nodes", "Error nodes", "Right nodes"],
    )
    ax_share.plot(dates, error_share, color="#7f5aa2", linewidth=2.0, label="Error share actual")
    ax_share.plot(dates, curve_share, color="#7f5aa2", linestyle="--", linewidth=1.8, label="Error share simulated")
    ax_share.axvspan(dates[phase_break_index], dates[-1], color="#f0f0f0", alpha=0.55)
    ax_share.axvline(dates[phase_break_index], color="#444444", linestyle=":", linewidth=1.2)
    ax_share.set_title("D. Error Share and Node Composition", fontsize=13, fontweight="bold")
    ax_share.set_ylabel("Share / Node Proportion", fontsize=11)
    ax_share.set_xlabel("Year", fontsize=11)
    ax_share.set_ylim(0.0, 1.0)
    ax_share.grid(alpha=0.22)
    ax_share.legend(fontsize=8.6, loc="upper right", frameon=False, ncol=2)
    ax_share.tick_params(labelsize=10)

    fig.colorbar(error_im, ax=ax_heat, fraction=0.045, pad=0.02).set_label("Error intensity", fontsize=10)
    fig.suptitle(f"{str(payload.get('word') or 'Simulation')} propagation replay", fontsize=16, fontweight="bold", y=0.985)

    def update(frame_no: int):
        idx = int(frame_idx[frame_no])
        states = history[idx]
        nodes.set_color([state_colors[s] for s in states])
        error_im.set_data(error_maps[idx])
        right_im.set_data(right_maps[idx])
        curve_marker.set_xdata([dates[idx], dates[idx]])
        share_marker.set_xdata([dates[idx], dates[idx]])
        share_point.set_offsets(np.c_[[dates[idx]], [curve_share[idx]]])
        net_note.set_text(
            f"{str(dates[idx])[:10]}\n"
            f"Unknown={int(np.sum(states == STATE_UNKNOWN))}  "
            f"Error={int(np.sum(states == STATE_ERROR))}  "
            f"Right={int(np.sum(states == STATE_RIGHT))}\n"
            f"Pred share={curve_share[idx]:.3f} | Real share={error_share[idx]:.3f}"
        )
        return nodes, error_im, right_im, curve_marker, share_marker, share_point, net_note

    animation = FuncAnimation(
        fig,
        update,
        frames=len(frame_idx),
        interval=int(1000 / max(1, int(fps))),
        blit=False,
        repeat=True,
    )
    animation.save(out_gif, writer=PillowWriter(fps=int(fps)), dpi=110)
    plt.close(fig)
    fig, ax = plt.subplots(figsize=(10, 5.6))
    ax.text(0.5, 0.6, title, ha="center", va="center", fontsize=12, fontweight="bold")
    ax.text(0.5, 0.45, message, ha="center", va="center", fontsize=10)
    ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def _extract_pcmci_plot_payload(source: dict[str, Any]) -> tuple[Any, Any, list[str]] | None:
    try:
        import numpy as np
    except Exception:
        return None

    val_matrix = source.get("tigramite_val_matrix")
    graph = source.get("tigramite_graph")
    var_names_raw = source.get("var_names") or []
    if not isinstance(val_matrix, list) or not isinstance(graph, list):
        return None

    val_arr = np.asarray(val_matrix, dtype=float)
    graph_arr = np.asarray(graph)
    if val_arr.ndim != 3 or graph_arr.ndim != 3 or val_arr.shape != graph_arr.shape:
        return None

    var_names = [str(name) for name in var_names_raw] if isinstance(var_names_raw, list) else []
    if len(var_names) != val_arr.shape[0]:
        var_names = [f"V{i + 1}" for i in range(val_arr.shape[0])]
    return val_arr, graph_arr, var_names


def write_pcmci_preview_png(payload: dict[str, Any], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from tigramite import plotting as tp

    plot_payload = _extract_pcmci_plot_payload(payload)
    if plot_payload is None:
        _write_pcmci_placeholder_png(out_png, "PCMCI Network", "No Tigramite plot payload in result.")
        return

    val_matrix, graph, var_names = plot_payload
    tp.plot_graph(
        figsize=(8, 6),
        val_matrix=val_matrix,
        graph=graph,
        var_names=var_names,
        link_colorbar_label="edges",
        node_colorbar_label="nodes",
        show_autodependency_lags=False,
        save_name=str(out_png),
        arrow_linewidth=7,
        cmap_edges="YlGnBu",
        cmap_nodes="Oranges",
        vmin_edges=0,
        vmax_edges=1,
        vmin_nodes=-0.2,
        vmax_nodes=1,
    )
    plt.close("all")


def write_pcmci_window_network_png(window: dict[str, Any], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from tigramite import plotting as tp

    plot_payload = _extract_pcmci_plot_payload(window)
    if plot_payload is None:
        _write_pcmci_placeholder_png(out_png, "Window Causal Network", "No Tigramite plot payload in this window.")
        return

    val_matrix, graph, var_names = plot_payload
    tp.plot_graph(
        figsize=(8, 6),
        val_matrix=val_matrix,
        graph=graph,
        var_names=var_names,
        link_colorbar_label="edges",
        node_colorbar_label="nodes",
        show_autodependency_lags=False,
        save_name=str(out_png),
        arrow_linewidth=7,
        cmap_edges="YlGnBu",
        cmap_nodes="Oranges",
        vmin_edges=0,
        vmax_edges=1,
        vmin_nodes=-0.2,
        vmax_nodes=1,
    )
    plt.close("all")


def write_pcmci_window_timeseries_png(window: dict[str, Any], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from tigramite import plotting as tp

    plot_payload = _extract_pcmci_plot_payload(window)
    if plot_payload is None:
        _write_pcmci_placeholder_png(out_png, "Window Time-Series Graph", "No Tigramite plot payload in this window.")
        return

    val_matrix, graph, var_names = plot_payload
    tp.plot_time_series_graph(
        figsize=(10, 5),
        val_matrix=val_matrix,
        graph=graph,
        var_names=var_names,
        link_colorbar_label="edges",
        save_name=str(out_png),
        arrow_linewidth=5,
        cmap_edges="YlGnBu",
        vmin_edges=0,
        vmax_edges=1.0,
    )
    plt.close("all")


def write_mrnmr_preview_png(metrics: list[dict], summary: dict, out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    plt.rcParams["font.family"] = "Times New Roman"
    fig, axes = plt.subplots(1, 2, figsize=(12.8, 4.8))
    ax1, ax2 = axes

    years = [int(row.get("year") or 0) for row in metrics or []]
    mr = [float(row.get("MR") or 0.0) for row in metrics or []]
    nmr = [float(row.get("NMR") or 0.0) for row in metrics or []]
    density = [float(row.get("density") or 0.0) for row in metrics or []]

    if not years:
        ax1.text(0.5, 0.5, "No MR/NMR points", ha="center", va="center", fontsize=11)
        ax1.set_axis_off()
        ax2.set_axis_off()
    else:
        color_map = np.linspace(0, 1, len(years))
        scatter = ax1.scatter(nmr, mr, c=color_map, cmap="viridis", alpha=0.85, marker="x")
        cbar = fig.colorbar(scatter, ax=ax1, fraction=0.05, pad=0.04)
        cbar.set_label("Time Index", fontsize=9)
        ax1.set_xlabel("NMR (Nomenclature-to-Misspelling Ratio)", fontsize=10, fontweight="bold")
        ax1.set_ylabel("MR (Misspelling Ratio)", fontsize=10, fontweight="bold")
        ax1.set_title("MR vs NMR", fontsize=11, fontweight="bold")
        ax1.grid(linestyle=":", linewidth=0.8, alpha=0.3)

        ax2.plot(years, density, color="black", linewidth=1.7, label="Kernel density")
        tipping_year = summary.get("tipping_year")
        steady_year = summary.get("steady_year")
        if tipping_year:
            ax2.axvline(float(tipping_year), linestyle="--", color="#f59e0b", linewidth=1.2, label="Tipping point")
        if steady_year:
            ax2.axvline(
                float(steady_year),
                linestyle="--",
                color="#dc2626",
                linewidth=1.2,
                label="Initial steady state",
            )
        ax2.set_xlabel("Year", fontsize=10, fontweight="bold")
        ax2.set_ylabel("Kernel Density", fontsize=10, fontweight="bold")
        ax2.set_title("Steady-State Density Track", fontsize=11, fontweight="bold")
        ax2.grid(linestyle=":", linewidth=0.8, alpha=0.3)
        ax2.legend(frameon=False, fontsize=8, loc="upper right")

    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def write_delta_t_preview_png(payload: dict[str, Any], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.font_manager import FontProperties
    from matplotlib.patches import Rectangle

    plt.rcParams["font.family"] = "Times New Roman"
    fig, ax = plt.subplots(figsize=(5.6, 3.4))
    series = dict(payload.get("series") or {})
    summary = dict(payload.get("summary") or {})
    word = str(payload.get("word") or "DeltaT Bias").strip() or "DeltaT Bias"
    years = [int(v) for v in (series.get("years") or [])]
    actual_total = [float(v) for v in (series.get("actual_total") or [])]
    predicted_curve = [float(v) for v in (series.get("predicted_counterfactual") or series.get("predicted_correct") or [])]
    origin_year = summary.get("origin_year")
    base_year = int(summary.get("base_year") or (years[0] if years else 0) or 0)
    actual_mutation_year = summary.get("actual_mutation_year")
    predicted_mutation_year = summary.get("predicted_mutation_year")
    delta_t_years = summary.get("delta_t_years")
    if not years:
        ax.text(0.5, 0.5, "No DeltaT series", ha="center", va="center", fontsize=11)
        ax.set_axis_off()
    else:
        color = "#148758"
        x = list(range(len(years)))
        tipping_index = max(0, int(origin_year or years[0]) - base_year)
        actual_index = max(0, int(actual_mutation_year or years[0]) - base_year)
        predicted_index = max(0, int(predicted_mutation_year or years[0]) - base_year)
        ax.grid(False)
        ax.fill_between(x, actual_total, [-0.01] * len(actual_total), facecolor=color, alpha=0.13)
        ax.plot(x, predicted_curve, linewidth=2.0, color=color)
        ymin = min(-0.01, min(actual_total + predicted_curve))
        ymax = max(max(actual_total), max(predicted_curve), 0.02)
        if isinstance(actual_mutation_year, (int, float)) and isinstance(predicted_mutation_year, (int, float)):
            left = float(min(actual_index, predicted_index))
            width = abs(float(predicted_index) - float(actual_index))
            rect = Rectangle((left, ymin), width, ymax - ymin, facecolor="black", edgecolor="none", alpha=0.08)
            ax.add_patch(rect)
        ax.vlines(float(actual_index), ymin, ymax, color="black", linestyle="--", linewidth=0.6, alpha=0.2)
        ax.vlines(float(predicted_index), ymin, ymax, color="black", linestyle="--", linewidth=0.6, alpha=0.2)
        if (
            isinstance(actual_mutation_year, (int, float))
            and isinstance(predicted_mutation_year, (int, float))
            and isinstance(delta_t_years, (int, float))
        ):
            ax.text(
                float(actual_index),
                ymin + ((ymax - ymin) / 2.0),
                f"Δt = {int(round(float(delta_t_years)))}",
                rotation=90,
                ha="right",
                va="center",
                color="black",
                fontsize=8,
            )
        ax.set_xlim(float(tipping_index), float(len(years)))
        ax.set_ylim(ymin, ymax)
        ax.set_xlabel("Year", fontsize=10, fontweight="bold")
        ax.set_ylabel("Normalized Frenquency", fontsize=10, fontweight="bold")
        title_obj = ax.set_title(word, fontweight="bold")
        title_obj.set_color("white")
        title_obj.set_bbox({"facecolor": color, "alpha": 1, "edgecolor": "none"})
        title_obj.set_fontproperties(FontProperties(size=13, weight="bold"))
        ax.spines["top"].set_linewidth(0.9)
        ax.spines["left"].set_linewidth(0.9)
        ax.spines["right"].set_linewidth(0.9)
        ax.spines["bottom"].set_linewidth(0.9)
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def write_word_analysis_csv(rows: list[dict], out_csv: Path) -> None:
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["time", "variant", "value"])
        w.writeheader()
        w.writerows(rows)


def write_rows_csv(rows: list[dict], out_csv: Path, fieldnames: list[str] | None = None) -> None:
    if not rows:
        names = fieldnames or []
        with out_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=names)
            if names:
                w.writeheader()
        return
    names = fieldnames or list(rows[0].keys())
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=names)
        w.writeheader()
        w.writerows(rows)


def write_json_file(payload: dict, out_json: Path) -> None:
    with out_json.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def register_artifact(
    task_id: str,
    kind: str,
    filename: str,
    path: Path,
    content_type: str | None = None,
) -> None:
    size = path.stat().st_size if path.exists() else None
    owner_user_id = get_task_owner(task_id)
    meta = {}
    if content_type:
        meta["content_type"] = content_type
    if size is not None:
        meta["bytes"] = size
    upsert_artifact(
        task_id=task_id,
        kind=kind,
        filename=filename,
        path=str(path),
        meta_json=json.dumps(meta) if meta else None,
        owner_user_id=owner_user_id,
    )


def register_simulation_artifacts(
    task_id: str,
    out_csv: Path,
    out_png: Path,
    out_json: Path | None = None,
    out_gif: Path | None = None,
) -> None:
    register_artifact(task_id, "csv", "result.csv", out_csv, "text/csv")
    register_artifact(task_id, "png", "preview.png", out_png, "image/png")
    if out_json is not None:
        register_artifact(task_id, "json", "result.json", out_json, "application/json")
    if out_gif is not None and out_gif.exists():
        register_artifact(task_id, "gif", "propagation.gif", out_gif, "image/gif")


def register_word_analysis_artifact(task_id: str, out_csv: Path) -> None:
    register_artifact(task_id, "csv", "result.csv", out_csv, "text/csv")


def list_task_artifacts_payload(task_id: str) -> dict:
    rows = list_artifacts(task_id, include_all=True)
    return {
        "task_id": task_id,
        "items": [
            {
                "task_id": row["task_id"],
                "kind": row["kind"],
                "filename": row["filename"],
                "path": row["path"],
                "meta_json": row["meta_json"],
                "created_at": row["created_at"],
            }
            for row in rows
        ],
    }
