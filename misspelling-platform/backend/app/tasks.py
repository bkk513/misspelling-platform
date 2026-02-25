import json
import time
from pathlib import Path

from celery.signals import task_failure, task_success

from .celery_app import celery_app
from .db.tasks_repo import set_task_failure, set_task_running, set_task_success


@celery_app.task(bind=True)
def demo_analysis(self, word: str):
    task_id = self.request.id
    set_task_running(task_id)
    try:
        for i in range(5):
            time.sleep(1)
            self.update_state(state="PROGRESS", meta={"step": i + 1, "total": 5})
        result = {"word": word, "message": "analysis done", "dummy_metric": 42}
        set_task_success(task_id, json.dumps(result))
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
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
    try:
        series = [{"t": t, "errors": (t % 10), "correct": (t * 2) % 17} for t in range(steps)]
        out_dir = Path("/app/outputs") / task_id
        out_dir.mkdir(parents=True, exist_ok=True)
        out_csv = out_dir / "result.csv"
        import csv

        with out_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["t", "errors", "correct"])
            w.writeheader()
            w.writerows(series)
        result = {
            "n": n,
            "steps": steps,
            "files": {"csv": f"/api/files/{task_id}/result.csv"},
            "preview": series[:5],
        }
        set_task_success(task_id, json.dumps(result))
        return result
    except Exception as e:
        set_task_failure(task_id, str(e))
        raise
