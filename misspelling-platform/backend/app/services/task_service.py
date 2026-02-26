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


def _task_display_name(task_type: str | None, params: Any) -> str | None:
    payload = _normalize_jsonish(params)
    if not isinstance(payload, dict):
        return task_type
    if task_type == "word-analysis":
        word = str(payload.get("word") or "").strip()
        return f"word-analysis: {word}" if word else "word-analysis"
    if task_type == "simulation-run":
        n = payload.get("n")
        steps = payload.get("steps")
        parts = []
        if n is not None:
            parts.append(f"n={n}")
        if steps is not None:
            parts.append(f"steps={steps}")
        return "simulation-run" + (f": {' '.join(parts)}" if parts else "")
    return str(task_type or "")

def create_word_analysis_task(
    word: str,
    celery_task,
    *,
    start_year: int | None = None,
    end_year: int | None = None,
    smoothing: int | None = None,
    corpus: str | None = None,
    variants: list[str] | None = None,
) -> dict:
    """
    Called by routes_tasks.py: create_word_analysis_task(word, demo_analysis)
    1) enqueue celery task
    2) persist QUEUED row into MySQL
    3) return {"task_id": <id>}
    """
    task_id = str(uuid4())
    params = {"word": word}
    if start_year is not None:
        params["start_year"] = int(start_year)
    if end_year is not None:
        params["end_year"] = int(end_year)
    if smoothing is not None:
        params["smoothing"] = max(0, min(50, int(smoothing)))
    if corpus:
        params["corpus"] = str(corpus).strip()
    if variants:
        cleaned = []
        seen = set()
        for raw in variants:
            v = str(raw).strip()
            if not v:
                continue
            key = v.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(v)
            if len(cleaned) >= 12:
                break
        if cleaned:
            params["variants"] = cleaned

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
        celery_task.apply_async(args=[word, params], task_id=task_id)
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
                SELECT task_id, task_type, status, params_json, result_json, error_text
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
        "display_name": _task_display_name(row.get("task_type"), row.get("params_json")),
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
                "display_name": _task_display_name(r.get("task_type"), r.get("params_json")),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    }
