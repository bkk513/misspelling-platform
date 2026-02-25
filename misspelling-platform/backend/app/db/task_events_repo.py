from sqlalchemy import text

from .core import engine


def insert_event(
    task_id: str,
    event_type: str,
    message: str,
    meta_json: str | None = None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO task_events (task_id, level, message, meta_json)
                VALUES (:task_id, :level, :message, :meta_json)
                """
            ),
            {
                "task_id": task_id,
                "level": event_type,
                "message": message,
                "meta_json": meta_json,
            },
        )


def list_events(task_id: str, limit: int = 200):
    with engine.begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT task_id, ts, level, message, meta_json
                    FROM task_events
                    WHERE task_id=:task_id
                    ORDER BY id ASC
                    LIMIT :limit
                    """
                ),
                {"task_id": task_id, "limit": limit},
            )
            .mappings()
            .all()
        )
