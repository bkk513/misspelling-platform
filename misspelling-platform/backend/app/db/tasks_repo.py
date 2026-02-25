from sqlalchemy import text

from .core import engine


def insert_task(task_id: str, task_type: str, status: str, params_json: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO tasks (task_id, task_type, status, params_json)
                VALUES (:task_id, :task_type, :status, :params_json)
                """
            ),
            {
                "task_id": task_id,
                "task_type": task_type,
                "status": status,
                "params_json": params_json,
            },
        )


def get_task(task_id: str):
    with engine.begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT task_id, status, params_json, result_json, error_text
                    FROM tasks
                    WHERE task_id=:task_id
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )


def list_tasks(limit: int):
    with engine.begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT task_id, task_type, status, params_json, created_at, updated_at
                    FROM tasks
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            .mappings()
            .all()
        )


def set_task_running(task_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE tasks SET status='RUNNING' WHERE task_id=:task_id"),
            {"task_id": task_id},
        )


def set_task_success(task_id: str, result_json: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='SUCCESS', result_json=:result_json, error_text=NULL
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id, "result_json": result_json},
        )


def set_task_failure(task_id: str, error_text: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='FAILURE', error_text=:error_text
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id, "error_text": error_text},
        )
