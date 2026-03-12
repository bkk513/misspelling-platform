import json
import csv
import math
from pathlib import Path

from ..db.task_artifacts_repo import list_artifacts, upsert_artifact
from ..db.tasks_repo import get_task_owner

OUTPUT_ROOT = Path("/app/outputs")


def build_output_dir(task_id: str) -> Path:
    out_dir = OUTPUT_ROOT / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def build_output_file(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename


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


def write_pcmci_preview_png(edges: list[dict], out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    plt.rcParams["font.family"] = "Times New Roman"
    fig, ax = plt.subplots(figsize=(10, 5.6))
    top_edges = sorted(edges or [], key=lambda row: abs(float(row.get("weight") or 0.0)), reverse=True)[:12]
    if not top_edges:
        ax.text(0.5, 0.5, "No significant edges", ha="center", va="center", fontsize=12)
        ax.set_axis_off()
    else:
        labels = []
        weights = []
        for row in top_edges:
            src = str(row.get("source") or "-")
            dst = str(row.get("target") or "-")
            lag = row.get("lag")
            labels.append(f"{src}->{dst} (lag={lag})")
            weights.append(float(row.get("weight") or 0.0))
        colors = plt.cm.YlGnBu(np.linspace(0.35, 0.95, len(weights)))
        y = np.arange(len(labels))
        ax.barh(y, weights, color=colors, edgecolor="none", alpha=0.95)
        ax.axvline(0, color="#475569", linestyle="--", linewidth=1.0)
        ax.set_yticks(y)
        ax.set_yticklabels(labels, fontsize=9)
        ax.invert_yaxis()
        ax.set_xlabel("Edge Weight", fontsize=11, fontweight="bold")
        ax.set_ylabel("Links", fontsize=11, fontweight="bold")
        ax.set_title("PCMCI Causal Network (Top Edge Weights)", fontsize=12, fontweight="bold")
        ax.grid(axis="x", linestyle=":", linewidth=0.8, alpha=0.35)
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def write_pcmci_window_network_png(window: dict, out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    plt.rcParams["font.family"] = "Times New Roman"
    edges = list(window.get("top_edges") or window.get("edges") or [])
    series = list(window.get("series") or [])
    nodes = [str(row.get("variant") or "").strip() for row in series if str(row.get("variant") or "").strip()]
    if not nodes:
        node_set = {str(e.get("source") or "").strip() for e in edges} | {str(e.get("target") or "").strip() for e in edges}
        nodes = [n for n in node_set if n]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.set_title(
        f"PCMCI Window Network ({window.get('start_time', '')} -> {window.get('end_time', '')})",
        fontsize=12,
        fontweight="bold",
    )

    if not nodes:
        ax.text(0.5, 0.5, "No nodes / edges in this window", ha="center", va="center", fontsize=11)
        ax.set_axis_off()
        fig.tight_layout()
        fig.savefig(out_png, format="png", dpi=180)
        plt.close(fig)
        return

    radius = 1.0
    theta = np.linspace(0, 2 * np.pi, len(nodes), endpoint=False)
    positions = {
        node: (
            float(radius * np.cos(angle)),
            float(radius * np.sin(angle)),
        )
        for node, angle in zip(nodes, theta, strict=False)
    }

    ax.scatter(
        [positions[n][0] for n in nodes],
        [positions[n][1] for n in nodes],
        s=1000,
        color="#fef3c7",
        edgecolors="#a16207",
        linewidths=1.2,
        zorder=3,
    )
    for node in nodes:
        x, y = positions[node]
        ax.text(x, y, node, ha="center", va="center", fontsize=9, zorder=4)

    max_weight = max((abs(float(edge.get("weight") or 0.0)) for edge in edges), default=1.0)
    for edge in edges[:40]:
        src = str(edge.get("source") or "")
        dst = str(edge.get("target") or "")
        if src not in positions or dst not in positions or src == dst:
            continue
        sx, sy = positions[src]
        tx, ty = positions[dst]
        weight = float(edge.get("weight") or 0.0)
        scale = max(0.6, abs(weight) / max(max_weight, 1e-9))
        color = "#0f766e" if weight >= 0 else "#b91c1c"
        ax.annotate(
            "",
            xy=(tx, ty),
            xytext=(sx, sy),
            arrowprops={
                "arrowstyle": "->",
                "lw": 0.8 + 2.8 * scale,
                "color": color,
                "alpha": 0.72,
                "shrinkA": 28,
                "shrinkB": 28,
            },
            zorder=2,
        )
        mid_x = (sx + tx) / 2.0
        mid_y = (sy + ty) / 2.0
        ax.text(
            mid_x,
            mid_y,
            f"lag {edge.get('lag', '-')}",
            fontsize=7,
            color="#334155",
            ha="center",
            va="center",
            zorder=5,
        )

    ax.set_xlim(-1.35, 1.35)
    ax.set_ylim(-1.35, 1.35)
    ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


def write_pcmci_window_timeseries_png(window: dict, out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.family"] = "Times New Roman"
    series = list(window.get("series") or [])
    fig, ax = plt.subplots(figsize=(11, 5.5))
    title = f"Window Time Series ({window.get('start_time', '')} -> {window.get('end_time', '')})"
    ax.set_title(title, fontsize=12, fontweight="bold")

    if not series:
        ax.text(0.5, 0.5, "No time-series points", ha="center", va="center", fontsize=11)
        ax.set_axis_off()
        fig.tight_layout()
        fig.savefig(out_png, format="png", dpi=180)
        plt.close(fig)
        return

    for item in series:
        variant = str(item.get("variant") or "-")
        points = list(item.get("points") or [])
        x = []
        y = []
        for i, point in enumerate(points):
            x.append(i)
            y.append(float(point.get("value") or 0.0))
        if not y:
            continue
        ax.plot(x, y, linewidth=1.8, marker="o", markersize=2.8, alpha=0.9, label=variant)

    point_count = max((len(list(item.get("points") or [])) for item in series), default=0)
    if point_count > 0:
        step = max(1, math.ceil(point_count / 8))
        tick_idx = list(range(0, point_count, step))
        labels = []
        first_series = list(series[0].get("points") or [])
        for idx in tick_idx:
            if idx < len(first_series):
                labels.append(str(first_series[idx].get("time") or ""))
            else:
                labels.append(str(idx))
        ax.set_xticks(tick_idx)
        ax.set_xticklabels(labels, rotation=35, ha="right")

    ax.set_xlabel("Time")
    ax.set_ylabel("Normalized Value")
    ax.grid(linestyle=":", linewidth=0.8, alpha=0.3)
    ax.legend(frameon=False, fontsize=8, loc="best", ncol=2)
    fig.tight_layout()
    fig.savefig(out_png, format="png", dpi=180)
    plt.close(fig)


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


def write_delta_t_preview_png(events: list[dict], delta_stats: dict, out_png: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.family"] = "Times New Roman"
    fig, ax = plt.subplots(figsize=(10.2, 4.8))
    years = [int(row.get("year") or 0) for row in events or []]
    indices = [float(row.get("index") or 0.0) for row in events or []]
    if not years:
        ax.text(0.5, 0.5, "No detected events", ha="center", va="center", fontsize=11)
        ax.set_axis_off()
    else:
        ax.plot(years, indices, color="#1d4ed8", linewidth=1.8, marker="o", markersize=3.8, label="Observed events")
        ax.fill_between(years, indices, [0.0] * len(indices), color="#1d4ed8", alpha=0.12)
        mean_value = delta_stats.get("mean")
        if isinstance(mean_value, (int, float)):
            ax.axhline(float(mean_value), color="#dc2626", linestyle="--", linewidth=1.2, label="Δt mean")
        ax.set_xlabel("Year", fontsize=10, fontweight="bold")
        ax.set_ylabel("Event Index", fontsize=10, fontweight="bold")
        ax.set_title("DeltaT Event Bias (Observed vs Null Baseline)", fontsize=11, fontweight="bold")
        ax.grid(linestyle=":", linewidth=0.8, alpha=0.3)
        ax.legend(frameon=False, fontsize=8, loc="upper right")
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
