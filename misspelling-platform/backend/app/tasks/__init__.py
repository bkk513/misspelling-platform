import json
import time

from celery.signals import task_failure, task_success

from ..celery_app import celery_app
from ..db.tasks_repo import set_task_failure, set_task_running, set_task_success
from ..services.artifact_service import (
    build_output_dir,
    register_simulation_artifacts,
    register_word_analysis_artifact,
    write_simulation_csv,
    write_simulation_preview_png,
    write_word_analysis_csv,
)
from ..services.gbnc_service import build_provenance, pull_gbnc_with_fallback
from ..services.task_event_service import (
    record_task_failure,
    record_task_running,
    record_task_success,
)
from ..services.timeseries_service import (
    persist_simulation_stub_timeseries,
    persist_word_analysis_external_series,
)


def _word_params(payload: str | dict):
    if isinstance(payload, dict):
        word = str(payload.get("word") or "demo")
        variants = [str(v).strip().lower() for v in (payload.get("variants") or []) if str(v).strip()]
        return {
            "word": word,
            "start_year": int(payload.get("start_year") or 1900),
            "end_year": int(payload.get("end_year") or 2019),
            "smoothing": int(payload.get("smoothing") or 3),
            "corpus": str(payload.get("corpus") or "eng_2019"),
            "variants": variants,
        }
    return {
        "word": str(payload or "demo"),
        "start_year": 1900,
        "end_year": 2019,
        "smoothing": 3,
        "corpus": "eng_2019",
        "variants": [],
    }


@celery_app.task(bind=True)
def demo_analysis(self, payload: str | dict):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "word-analysis")
    params = _word_params(payload)
    try:
        for i in range(3):
            time.sleep(1)
            self.update_state(state="PROGRESS", meta={"step": i + 1, "total": 3})

        pulled = pull_gbnc_with_fallback(
            term=params["word"],
            variants=params["variants"],
            start_year=params["start_year"],
            end_year=params["end_year"],
            corpus=params["corpus"],
            smoothing=params["smoothing"],
        )
        persisted = persist_word_analysis_external_series(task_id, params["word"], pulled)

        csv_rows: list[dict] = []
        for item in pulled.get("series") or []:
            variant = item.get("variant") or params["word"]
            for point in item.get("points") or []:
                csv_rows.append(
                    {
                        "time": str(point.get("year")),
                        "variant": variant,
                        "value": float(point.get("value") or 0.0),
                    }
                )

        out_dir = build_output_dir(task_id)
        out_csv = out_dir / "result.csv"
        write_word_analysis_csv(csv_rows, out_csv)
        register_word_analysis_artifact(task_id, out_csv)

        provenance = build_provenance(task_id, pulled, params)
        result = {
            "word": params["word"],
            "message": "analysis done",
            "dummy_metric": 42,
            "provenance": provenance,
            "series_count": persisted["series_count"],
            "point_count": persisted["point_count"],
            "variants": persisted["variants"],
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
        }
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, "word-analysis")
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
        record_task_failure(task_id, "word-analysis", str(e))
        raise


@task_success.connect(sender=demo_analysis)
def _on_success(sender=None, result=None, **kwargs):
    task_id = kwargs.get("task_id")
    set_task_success(task_id, json.dumps(result))


@task_failure.connect(sender=demo_analysis)
def _on_failure(sender=None, exception=None, traceback=None, **kwargs):
    task_id = kwargs.get("task_id")
    set_task_failure(task_id, str(exception))


@celery_app.task(bind=True)
def simulation_run(self, n: int = 30, steps: int = 50):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "simulation-run")
    try:
        series = [{"t": t, "errors": (t % 10), "correct": (t * 2) % 17} for t in range(steps)]
        out_dir = build_output_dir(task_id)
        out_csv = out_dir / "result.csv"
        out_png = out_dir / "preview.png"
        write_simulation_csv(series, out_csv)
        write_simulation_preview_png(series, out_png)
        register_simulation_artifacts(task_id, out_csv, out_png)
        result = {
            "n": n,
            "steps": steps,
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
            "preview": series[:5],
        }
        persist_simulation_stub_timeseries(task_id, n, steps)
        set_task_success(task_id, json.dumps(result))
        record_task_success(task_id, "simulation-run")
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
        record_task_failure(task_id, "simulation-run", str(e))
        raise
