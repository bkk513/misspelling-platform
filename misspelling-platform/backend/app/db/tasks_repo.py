"""tasks table repository functions (implemented in later M1 commits)."""
import json

from sqlalchemy import text

from .core import get_engine

def set_task_running(task_id: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE tasks SET status='RUNNING', updated_at=CURRENT_TIMESTAMP WHERE task_id=:task_id"),
            {"task_id": task_id},
        )

def set_task_success(task_id: str, result):
    if isinstance(result, str):
        result_json = result
    else:
        result_json = json.dumps(result)
    with get_engine().begin() as conn:
        conn.execute(
            text("""
                UPDATE tasks
                SET status='SUCCESS',
                    result_json=:result_json,
                    error_text=NULL,
                    updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id
            """),
            {"task_id": task_id, "result_json": result_json},
        )

def set_task_failure(task_id: str, error_text: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("""
                UPDATE tasks
                SET status='FAILURE',
                    error_text=:error_text,
                    updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id
            """),
            {"task_id": task_id, "error_text": error_text[:60000]},
        )
