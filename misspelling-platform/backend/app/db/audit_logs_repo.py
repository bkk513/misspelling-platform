from sqlalchemy import text

from .core import get_engine


def insert_audit_log(
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    meta_json: str | None = None,
    actor_user_id: int | None = None,
) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, meta_json)
                VALUES (:actor_user_id, :action, :target_type, :target_id, :meta_json)
                """
            ),
            {
                "actor_user_id": actor_user_id,
                "action": action,
                "target_type": target_type,
                "target_id": target_id,
                "meta_json": meta_json,
            },
        )


def list_audit_logs(limit: int = 100):
    with get_engine().begin() as conn:
        return (
            conn.execute(
                text(
                    """
                    SELECT id, actor_user_id, action, target_type, target_id, meta_json, created_at
                    FROM audit_logs
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            .mappings()
            .all()
        )
