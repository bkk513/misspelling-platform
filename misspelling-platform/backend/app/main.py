from fastapi import FastAPI
from sqlalchemy import create_engine, text
import os
import os, json
from sqlalchemy import create_engine, text
from .tasks import demo_analysis, simulation_run
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI(title="Misspelling Platform API (MVP)")

DATABASE_URL = os.getenv("DATABASE_URL", "")
engine = create_engine(os.getenv("DATABASE_URL"), pool_pre_ping=True)
def check_db() -> bool:
    if not DATABASE_URL:
        return False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@app.get("/health")
def health():
    return {"status": "ok", "db": check_db()}

@app.post("/api/tasks/word-analysis")
def create_task(word: str):
    job = demo_analysis.delay(word)

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO tasks (task_id, task_type, status, params_json)
                VALUES (:task_id, :task_type, :status, :params_json)
            """),
            {
                "task_id": job.id,
                "task_type": "word-analysis",
                "status": "QUEUED",
                "params_json": json.dumps({"word": word}),
            },
        )

    return {"task_id": job.id}

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                SELECT task_id, status, params_json, result_json, error_text
                FROM tasks
                WHERE task_id=:task_id
            """),
            {"task_id": task_id},
        ).mappings().first()

    if row:
        payload = {
            "task_id": row["task_id"],
            "state": row["status"],
            "params": row["params_json"],
            "result": row["result_json"],
            "error": row["error_text"],
        }

        # 运行中：附带 celery 进度
        if row["status"] in ("QUEUED", "RUNNING"):
            res = demo_analysis.AsyncResult(task_id)
            try:
                if res.info is not None:
                    payload["progress"] = res.info if isinstance(res.info, (dict, list, str, int, float, bool)) else str(res.info)
            except Exception:
                pass

        return payload

    # fallback：库里没有记录才用 celery
    res = demo_analysis.AsyncResult(task_id)
    payload = {"task_id": task_id, "state": res.state}
    if res.successful():
        payload["result"] = res.result
    return payload


@app.get("/api/tasks")
def list_tasks(limit: int = 20):
    limit = max(1, min(limit, 200))
    with engine.begin() as conn:
        rows = conn.execute(
            text("""
                SELECT task_id, task_type, status, params_json, created_at, updated_at
                FROM tasks
                ORDER BY id DESC
                LIMIT :limit
            """),
            {"limit": limit},
        ).mappings().all()

    return {"items": list(rows)}

@app.post("/api/tasks/simulation-run")
def create_sim_task(n: int = 30, steps: int = 50):
    job = simulation_run.delay(n, steps)

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO tasks (task_id, task_type, status, params_json)
                VALUES (:task_id, :task_type, :status, :params_json)
            """),
            {
                "task_id": job.id,
                "task_type": "simulation-run",
                "status": "QUEUED",
                "params_json": json.dumps({"n": n, "steps": steps}),
            },
        )

    return {"task_id": job.id}

@app.get("/api/files/{task_id}/{filename}")
def download_file(task_id: str, filename: str):
    p = Path("/app/outputs") / task_id / filename
    if not p.exists():
        return {"error": "file not found"}
    return FileResponse(str(p), filename=filename)