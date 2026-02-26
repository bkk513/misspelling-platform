import json
import csv
from pathlib import Path

from ..db.task_artifacts_repo import list_artifacts, upsert_artifact

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


def write_word_analysis_csv(rows: list[dict], out_csv: Path) -> None:
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["time", "variant", "value"])
        w.writeheader()
        w.writerows(rows)


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


def register_artifact(
    task_id: str,
    kind: str,
    filename: str,
    path: Path,
    content_type: str | None = None,
) -> None:
    size = path.stat().st_size if path.exists() else None
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
    )


def register_simulation_artifacts(task_id: str, out_csv: Path, out_png: Path) -> None:
    register_artifact(task_id, "csv", "result.csv", out_csv, "text/csv")
    register_artifact(task_id, "png", "preview.png", out_png, "image/png")


def register_word_analysis_artifacts(task_id: str, out_csv: Path) -> None:
    register_artifact(task_id, "csv", "result.csv", out_csv, "text/csv")


def list_task_artifacts_payload(task_id: str) -> dict:
    rows = list_artifacts(task_id)
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
