import json
import time

from celery.signals import task_failure, task_success

from ..celery_app import celery_app
from ..db.tasks_repo import set_task_failure, set_task_running, set_task_success
from ..services.artifact_service import (
    build_output_dir,
    register_word_analysis_artifacts,
    register_simulation_artifacts,
    write_word_analysis_csv,
    write_simulation_csv,
    write_simulation_preview_png,
)
from ..services.lexicon_service import get_or_suggest_variants
from ..services.task_event_service import (
    record_task_failure,
    record_task_running,
    record_task_success,
)
from ..services.timeseries_service import (
    persist_word_analysis_gbnc_timeseries,
    persist_simulation_stub_timeseries,
    persist_word_analysis_stub_timeseries,
)


@celery_app.task(bind=True)
def demo_analysis(self, word: str, params: dict | None = None):
    task_id = self.request.id
    set_task_running(task_id)
    record_task_running(task_id, "word-analysis")
    try:
        params = dict(params or {})
        params.setdefault("word", word)
        lexicon = get_or_suggest_variants(word, k=20)
        selected_variants = params.get("variants") or lexicon.get("variants") or []
        start_year = int(params.get("start_year") or 1900)
        end_year = int(params.get("end_year") or 2019)
        smoothing = int(params.get("smoothing") or 3)
        corpus = str(params.get("corpus") or "eng_2019")
        for i in range(5):
            time.sleep(1)
            self.update_state(state="PROGRESS", meta={"step": i + 1, "total": 5})
        try:
            ts_bundle = persist_word_analysis_gbnc_timeseries(
                task_id,
                word,
                selected_variants,
                start_year=start_year,
                end_year=end_year,
                corpus=corpus,
                smoothing=smoothing,
            )
        except Exception:
            ts_bundle = persist_word_analysis_stub_timeseries(task_id, word, selected_variants)
            ts_bundle["source_kind"] = "stub"
        out_dir = build_output_dir(task_id)
        out_csv = out_dir / "result.csv"
        write_word_analysis_csv(ts_bundle.get("csv_rows") or [], out_csv)
        register_word_analysis_artifacts(task_id, out_csv)
        result = {
            "word": word,
            "message": "analysis done",
            "dummy_metric": 42,
            "variants_count": max(0, len(ts_bundle.get("variants") or []) - 1),
            "variants": (ts_bundle.get("variants") or [])[1:],
            "variant_source": lexicon.get("source"),
            "time_series_source": ts_bundle.get("source_kind", "stub"),
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
            "artifacts": [{"kind": "csv", "filename": "result.csv"}],
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
