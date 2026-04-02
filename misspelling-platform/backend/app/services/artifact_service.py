import json
import csv
import os
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


def write_simulation_csv(series: list[dict], out_csv: Path) -> None:
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["t", "errors", "correct"])
        w.writeheader()
        w.writerows(series)


def write_simulation_preview_png(series: list[dict], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    x = [row["t"] for row in series]
    y_correct = [row["correct"] for row in series]
    y_errors = [row["errors"] for row in series]

    fig, ax = plt.subplots(figsize=(6, 3))
    ax.plot(x, y_correct, label="correct", linewidth=2)
    ax.plot(x, y_errors, label="errors", linewidth=1.5)
    ax.set_xlabel("step")
    ax.set_ylabel("value")
    ax.set_title("Simulation Preview")
    ax.legend(loc="best")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=120)
    plt.close(fig)


def _write_pcmci_placeholder_png(out_png: Path, title: str, message: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
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


def register_simulation_artifacts(task_id: str, out_csv: Path, out_png: Path) -> None:
    register_artifact(task_id, "csv", "result.csv", out_csv, "text/csv")
    register_artifact(task_id, "png", "preview.png", out_png, "image/png")


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
