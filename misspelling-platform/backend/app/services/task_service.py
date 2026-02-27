# ===== compatibility layer for routes_tasks.py imports (M2) =====
import json
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

from sqlalchemy import text

from ..db.core import get_engine
from .task_event_service import record_task_failure, record_task_queued

OUTPUT_ROOT = Path("/app/outputs")


def build_output_path(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename

def create_word_analysis_task(word: str, celery_task) -> dict:
    """
    Called by routes_tasks.py: create_word_analysis_task(word, demo_analysis)
    1) enqueue celery task
    2) persist QUEUED row into MySQL
    3) return {"task_id": <id>}
    """
    task_id = str(uuid4())
    params = {"word": word}

    with get_engine().begin() as conn:
        conn.execute(
            text("""
                INSERT INTO tasks (task_id, task_type, status, params_json)
                VALUES (:task_id, :task_type, :status, :params_json)
                ON DUPLICATE KEY UPDATE
                  status=VALUES(status),
                  params_json=VALUES(params_json),
                  updated_at=CURRENT_TIMESTAMP
            """),
            {
                "task_id": task_id,
                "task_type": "word-analysis",
                "status": "QUEUED",
                "params_json": json.dumps(params),
            },
        )
    record_task_queued(task_id, "word-analysis", params)
    try:
        celery_task.apply_async(args=[word], task_id=task_id)
    except Exception as exc:
        with get_engine().begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET status='FAILURE', error_text=:error_text
                    WHERE task_id=:task_id
                    """
                ),
                {"task_id": task_id, "error_text": str(exc)},
            )
        record_task_failure(task_id, "word-analysis", str(exc))
        raise
    return {"task_id": task_id}


def create_simulation_task(n: int, steps: int, celery_task) -> dict:
    """
    Called by routes_tasks.py: create_simulation_task(n, steps, simulation_run)
    """
    task_id = str(uuid4())
    params = {"n": n, "steps": steps}

    with get_engine().begin() as conn:
        conn.execute(
            text("""
                INSERT INTO tasks (task_id, task_type, status, params_json)
                VALUES (:task_id, :task_type, :status, :params_json)
                ON DUPLICATE KEY UPDATE
                  status=VALUES(status),
                  params_json=VALUES(params_json),
                  updated_at=CURRENT_TIMESTAMP
            """),
            {
                "task_id": task_id,
                "task_type": "simulation-run",
                "status": "QUEUED",
                "params_json": json.dumps(params),
            },
        )
    record_task_queued(task_id, "simulation-run", params)
    try:
        celery_task.apply_async(args=[n, steps], task_id=task_id)
    except Exception as exc:
        with get_engine().begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET status='FAILURE', error_text=:error_text
                    WHERE task_id=:task_id
                    """
                ),
                {"task_id": task_id, "error_text": str(exc)},
            )
        record_task_failure(task_id, "simulation-run", str(exc))
        raise
    return {"task_id": task_id}
def _normalize_jsonish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except Exception:
            return str(value)
    if isinstance(value, str):
        text_value = value.strip()
        # tolerate single or double JSON encoding from hotfix branches
        for _ in range(2):
            if not isinstance(text_value, str):
                break
            if not (text_value.startswith("{") or text_value.startswith("[")):
                break
            try:
                decoded = json.loads(text_value)
            except Exception:
                break
            if isinstance(decoded, str):
                text_value = decoded
                continue
            return decoded
        return text_value
    return str(value)


def get_task_payload(task_id: str, async_result_factory=None) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = conn.execute(
            text("""
                SELECT task_id, status, params_json, result_json, error_text
                FROM tasks
                WHERE task_id=:task_id
            """),
            {"task_id": task_id},
        ).mappings().first()

    if not row:
        if async_result_factory is None:
            return {"task_id": task_id, "state": "NOT_FOUND"}
        res = async_result_factory(task_id)
        payload = {"task_id": task_id, "state": res.state}
        if res.successful():
            payload["result"] = _normalize_jsonish(res.result)
        return payload

    payload: Dict[str, Any] = {
        "task_id": row["task_id"],
        "state": row["status"],
        "params": _normalize_jsonish(row["params_json"]),
        "result": _normalize_jsonish(row["result_json"]),
        "error": _normalize_jsonish(row["error_text"]),
    }
    if async_result_factory is not None and row["status"] in ("QUEUED", "RUNNING"):
        res = async_result_factory(task_id)
        try:
            if res.info is not None:
                payload["progress"] = _normalize_jsonish(res.info)
        except Exception:
            pass
    return payload

def list_task_payload(limit: int = 20) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 200))
    with get_engine().begin() as conn:
        rows = conn.execute(
            text("""
                SELECT task_id, task_type, status, params_json, created_at, updated_at
                FROM tasks
                WHERE status <> 'DELETED'
                ORDER BY id DESC
                LIMIT :limit
            """),
            {"limit": limit},
        ).mappings().all()
    return {
        "items": [
            {
                "task_id": r["task_id"],
                "task_type": r["task_type"],
                "status": r["status"],
                "params_json": _normalize_jsonish(r["params_json"]),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    }


def delete_task_payload(task_id: str) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = conn.execute(
            text("SELECT task_id, status FROM tasks WHERE task_id=:task_id LIMIT 1"),
            {"task_id": task_id},
        ).mappings().first()
        if not row:
            return {"task_id": task_id, "deleted": False, "reason": "NOT_FOUND"}
        if str(row["status"]).upper() in ("RUNNING", "QUEUED", "PROGRESS"):
            return {"task_id": task_id, "deleted": False, "reason": "TASK_ACTIVE"}

        conn.execute(
            text("UPDATE tasks SET status='DELETED', updated_at=CURRENT_TIMESTAMP WHERE task_id=:task_id"),
            {"task_id": task_id},
        )
        conn.execute(text("DELETE FROM task_events WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(text("DELETE FROM task_artifacts WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(
            text(
                """
                DELETE p FROM time_series_points p
                JOIN time_series s ON s.id = p.series_id
                WHERE JSON_UNQUOTE(JSON_EXTRACT(s.meta_json, '$.task_id')) = :task_id
                """
            ),
            {"task_id": task_id},
        )
        conn.execute(
            text(
                "DELETE FROM time_series WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')) = :task_id"
            ),
            {"task_id": task_id},
        )
    return {"task_id": task_id, "deleted": True}
