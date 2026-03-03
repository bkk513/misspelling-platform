import json

from sqlalchemy import text

from .core import get_engine


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


def list_recent_audit_logs(limit: int = 50, action_prefix: str | None = None):
    sql = """
        SELECT id, actor_user_id, action, target_type, target_id, meta_json, created_at
        FROM audit_logs
    """
    params: dict[str, object] = {"limit": limit}
    if action_prefix:
        sql += " WHERE action LIKE :action_prefix"
        params["action_prefix"] = f"{action_prefix}%"
    sql += " ORDER BY id DESC LIMIT :limit"
    with get_engine().begin() as conn:
        return conn.execute(text(sql), params).mappings().all()


def insert_audit_log(
    action: str,
    actor_user_id: int | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    meta: dict | None = None,
):
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
                "meta_json": json.dumps(meta) if meta is not None else None,
            },
        )
