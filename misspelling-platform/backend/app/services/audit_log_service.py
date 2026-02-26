import json
from typing import Any

from ..db.audit_logs_repo import insert_audit_log, list_audit_logs


def record_audit(
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    meta: dict[str, Any] | None = None,
    actor_user_id: int | None = None,
) -> None:
    insert_audit_log(
        action=action,
        target_type=target_type,
        target_id=target_id,
        meta_json=json.dumps(meta) if meta is not None else None,
        actor_user_id=actor_user_id,
    )


def record_audit_error(source: str, message: str, meta: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {"level": "ERROR", "message": message}
    if meta:
        payload.update(meta)
    record_audit(action="ERROR", target_type=source, target_id=payload.get("word"), meta=payload)


def _normalize_jsonish(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except Exception:
            return str(value)
    if isinstance(value, str):
        s = value.strip()
        if s.startswith("{") or s.startswith("["):
            try:
                return json.loads(s)
            except Exception:
                return value
    return value


def list_audit_logs_payload(limit: int = 100) -> dict[str, Any]:
    rows = list_audit_logs(max(1, min(int(limit), 500)))
    return {
        "items": [
            {
                "id": row["id"],
                "actor_user_id": row["actor_user_id"],
                "action": row["action"],
                "target_type": row["target_type"],
                "target_id": row["target_id"],
                "meta": _normalize_jsonish(row["meta_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    }
