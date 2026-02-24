import time, os, json
from .celery_app import celery_app
import os, json
from sqlalchemy import create_engine, text
from celery.signals import task_success, task_failure
import uuid
from pathlib import Path
from .celery_app import celery_app

_engine = create_engine(os.getenv("DATABASE_URL"), pool_pre_ping=True)

@celery_app.task(bind=True)
def demo_analysis(self, word: str):
    task_id = self.request.id

    # 标记 RUNNING
    with _engine.begin() as conn:
        conn.execute(
            text("UPDATE tasks SET status='RUNNING' WHERE task_id=:task_id"),
            {"task_id": task_id},
        )

    try:
        # 模拟耗时工作 + 进度
        for i in range(5):
            time.sleep(1)
            self.update_state(state="PROGRESS", meta={"step": i + 1, "total": 5})

        result = {"word": word, "message": "analysis done", "dummy_metric": 42}

        # 写 SUCCESS + result_json
        with _engine.begin() as conn:
            conn.execute(
                text("""
                    UPDATE tasks
                    SET status='SUCCESS', result_json=:result_json, error_text=NULL
                    WHERE task_id=:task_id
                """),
                {"task_id": task_id, "result_json": json.dumps(result)},
            )

        return result

    except Exception as e:
        # 写 FAILURE + error_text
        with _engine.begin() as conn:
            conn.execute(
                text("""
                    UPDATE tasks
                    SET status='FAILURE', error_text=:error_text
                    WHERE task_id=:task_id
                """),
                {"task_id": task_id, "error_text": str(e)},
            )
        raise
@task_success.connect(sender=demo_analysis)
def _on_success(sender=None, result=None, **kwargs):
    task_id = kwargs.get("task_id")
    with _engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE tasks
                SET status='SUCCESS', result_json=:result_json
                WHERE task_id=:task_id
            """),
            {"task_id": task_id, "result_json": json.dumps(result)},
        )

@task_failure.connect(sender=demo_analysis)
def _on_failure(sender=None, exception=None, traceback=None, **kwargs):
    task_id = kwargs.get("task_id")
    with _engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE tasks
                SET status='FAILURE', error_text=:error_text
                WHERE task_id=:task_id
            """),
            {"task_id": task_id, "error_text": str(exception)},
        )
@celery_app.task(bind=True)
def simulation_run(self, n: int = 30, steps: int = 50):
    task_id = self.request.id

    # DB: RUNNING
    with _engine.begin() as conn:
        conn.execute(text("UPDATE tasks SET status='RUNNING' WHERE task_id=:task_id"), {"task_id": task_id})

    try:
        # 这里先用“假仿真”：生成一个简单的时间序列结果，后续再换成论文代码
        series = [{"t": t, "errors": (t % 10), "correct": (t * 2) % 17} for t in range(steps)]

        out_dir = Path("/app/outputs") / task_id
        out_dir.mkdir(parents=True, exist_ok=True)
        out_csv = out_dir / "result.csv"

        # 写 CSV
        import csv
        with out_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["t", "errors", "correct"])
            w.writeheader()
            w.writerows(series)

        result = {
            "n": n,
            "steps": steps,
            "files": {
                "csv": f"/api/files/{task_id}/result.csv"
            },
            "preview": series[:5],
        }

        with _engine.begin() as conn:
            conn.execute(
                text("""
                    UPDATE tasks
                    SET status='SUCCESS', result_json=:result_json, error_text=NULL
                    WHERE task_id=:task_id
                """),
                {"task_id": task_id, "result_json": json.dumps(result)},
            )

        return result

    except Exception as e:
        with _engine.begin() as conn:
            conn.execute(
                text("UPDATE tasks SET status='FAILURE', error_text=:error_text WHERE task_id=:task_id"),
                {"task_id": task_id, "error_text": str(e)},
            )
        raise
