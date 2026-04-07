import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

from sqlalchemy import bindparam, text

from ..db.core import get_engine
from ..celery_app import celery_app
from .task_event_service import record_task_event, record_task_failure, record_task_queued

OUTPUT_ROOT = Path("/app/outputs")
ACTIVE_TASK_STATES = {"QUEUED", "RUNNING", "PROGRESS"}
PENDING_STALE_TIMEOUT_MINUTES = 30


def build_output_path(task_id: str, filename: str) -> Path:
    return OUTPUT_ROOT / task_id / filename


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_guest_key(guest_key: str | None) -> str:
    return str(guest_key or "").strip()[:64]


def _is_today_utc(value: Any) -> bool:
    today = datetime.now(timezone.utc).date()
    if value is None:
        return False
    if hasattr(value, "date"):
        try:
            return value.date() == today
        except Exception:
            pass
    text_value = str(value)
    if len(text_value) >= 10:
        try:
            return datetime.strptime(text_value[:10], "%Y-%m-%d").date() == today
        except Exception:
            return False
    return False


def _can_access_row(
    owner_user_id: int | None,
    row_guest_key: str | None,
    created_at: Any,
    current_user: dict | None,
    guest_key: str | None,
) -> bool:
    if _is_admin(current_user):
        return True
    user_id = _owner_id(current_user)
    if user_id is not None:
        return owner_user_id == user_id
    if owner_user_id is not None:
        return False
    request_guest_key = _normalize_guest_key(guest_key)
    if not request_guest_key:
        return False
    if _normalize_guest_key(row_guest_key) != request_guest_key:
        return False
    return _is_today_utc(created_at)


def _scope_clause(current_user: dict | None, scope: str | None, guest_key: str | None) -> tuple[str, dict[str, Any]]:
    if _is_admin(current_user):
        if scope == "all":
            return "1=1", {}
        if scope == "guest":
            return "owner_user_id IS NULL", {}
        if scope and scope.startswith("user:"):
            try:
                user_id = int(scope.split(":", 1)[1])
            except Exception:
                user_id = _owner_id(current_user)
            return "owner_user_id = :owner_user_id", {"owner_user_id": user_id}
        return "1=1", {}

    user_id = _owner_id(current_user)
    if user_id is not None:
        return "owner_user_id = :owner_user_id", {"owner_user_id": user_id}

    safe_guest_key = _normalize_guest_key(guest_key)
    if not safe_guest_key:
        return "1=0", {}
    return "owner_user_id IS NULL AND guest_key=:guest_key AND created_at >= UTC_DATE()", {"guest_key": safe_guest_key}


def _cleanup_old_guest_tasks() -> None:
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT task_id
                    FROM tasks
                    WHERE owner_user_id IS NULL
                      AND created_at < UTC_DATE()
                      AND status <> 'DELETED'
                    ORDER BY id ASC
                    LIMIT 5000
                    """
                )
            )
            .mappings()
            .all()
        )
        task_ids = [str(r["task_id"]) for r in rows]
        if not task_ids:
            return

        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='DELETED',
                    deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP),
                    updated_at=CURRENT_TIMESTAMP
                WHERE task_id IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM task_events WHERE task_id IN :task_ids").bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM task_artifacts WHERE task_id IN :task_ids").bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text("DELETE FROM report_exports WHERE owner_user_id IS NULL AND task_id IN :task_ids").bindparams(
                bindparam("task_ids", expanding=True)
            ),
            {"task_ids": task_ids},
        )
        conn.execute(
            text(
                """
                DELETE p FROM time_series_points p
                JOIN time_series s ON s.id = p.series_id
                WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.meta_json, '$.task_id')), 'null') IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )
        conn.execute(
            text(
                """
                DELETE FROM time_series
                WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')), 'null') IN :task_ids
                """
            ).bindparams(bindparam("task_ids", expanding=True)),
            {"task_ids": task_ids},
        )


def _insert_queued_task(
    task_id: str,
    task_type: str,
    params: dict[str, Any],
    owner_user_id: int | None,
    guest_key: str | None,
) -> None:
    safe_guest_key = _normalize_guest_key(guest_key) if owner_user_id is None else None
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO tasks (task_id, task_type, status, params_json, owner_user_id, guest_key)
                VALUES (:task_id, :task_type, :status, :params_json, :owner_user_id, :guest_key)
                ON DUPLICATE KEY UPDATE
                  status=VALUES(status),
                  params_json=VALUES(params_json),
                  owner_user_id=VALUES(owner_user_id),
                  guest_key=VALUES(guest_key),
                  updated_at=CURRENT_TIMESTAMP
                """
            ),
            {
                "task_id": task_id,
                "task_type": task_type,
                "status": "QUEUED",
                "params_json": json.dumps(params),
                "owner_user_id": owner_user_id,
                "guest_key": safe_guest_key,
            },
        )


def _mark_task_enqueue_failure(task_id: str, task_type: str, error_text: str) -> None:
    with get_engine().begin() as conn:
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
    record_task_failure(task_id, task_type, error_text)


def create_word_analysis_task(
    word: str,
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
    extra_params: dict[str, Any] | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    params = {"word": word}
    if extra_params:
        params.update(extra_params)
    _insert_queued_task(task_id, "word-analysis", params, owner_user_id, guest_key)
    record_task_queued(task_id, "word-analysis", params)
    try:
        celery_task.apply_async(args=[params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "word-analysis", str(exc))
        raise
    return {"task_id": task_id}


def create_simulation_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "simulation-run", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "simulation-run", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "simulation-run", str(exc))
        raise
    return {"task_id": task_id}


def create_pcmci_causal_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "pcmci-causal", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "pcmci-causal", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "pcmci-causal", str(exc))
        raise
    return {"task_id": task_id}


def create_mrnmr_steady_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "mrnmr-steady", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "mrnmr-steady", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "mrnmr-steady", str(exc))
        raise
    return {"task_id": task_id}


def create_delta_t_null_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "deltaT-null", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "deltaT-null", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "deltaT-null", str(exc))
        raise
    return {"task_id": task_id}


def create_meso_analysis_task(
    params: dict[str, Any],
    celery_task,
    owner_user_id: int | None = None,
    guest_key: str | None = None,
) -> dict:
    if owner_user_id is None:
        _cleanup_old_guest_tasks()
    task_id = str(uuid4())
    safe_params = dict(params)
    _insert_queued_task(task_id, "meso-analysis", safe_params, owner_user_id, guest_key)
    record_task_queued(task_id, "meso-analysis", safe_params)
    try:
        celery_task.apply_async(args=[safe_params], task_id=task_id)
    except Exception as exc:
        _mark_task_enqueue_failure(task_id, "meso-analysis", str(exc))
        raise
    return {"task_id": task_id}


def retry_task_payload(
    task_id: str,
    celery_task_map: dict[str, Any],
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, task_type, status, params_json, owner_user_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return {"ok": False, "reason": "NOT_FOUND", "task_id": task_id}
    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"ok": False, "reason": "FORBIDDEN", "task_id": task_id}

    status = str(row["status"] or "").upper()
    if status in ("QUEUED", "RUNNING", "PROGRESS"):
        return {"ok": False, "reason": "TASK_ACTIVE", "task_id": task_id}

    task_type = str(row["task_type"])
    params = _normalize_jsonish(row["params_json"])
    if not isinstance(params, dict):
        return {"ok": False, "reason": "PARAMS_INVALID", "task_id": task_id}

    if task_type == "word-analysis":
        task = celery_task_map.get("word-analysis")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        extra = {k: v for k, v in params.items() if k != "word"}
        created = create_word_analysis_task(
            str(params.get("word", "demo")),
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
            extra_params=extra,
        )
    elif task_type == "simulation-run":
        task = celery_task_map.get("simulation-run")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_simulation_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "pcmci-causal":
        task = celery_task_map.get("pcmci-causal")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_pcmci_causal_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "mrnmr-steady":
        task = celery_task_map.get("mrnmr-steady")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_mrnmr_steady_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "deltaT-null":
        task = celery_task_map.get("deltaT-null")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_delta_t_null_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    elif task_type == "meso-analysis":
        task = celery_task_map.get("meso-analysis")
        if task is None:
            return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}
        created = create_meso_analysis_task(
            params,
            task,
            owner_user_id=row.get("owner_user_id"),
            guest_key=row.get("guest_key"),
        )
    else:
        return {"ok": False, "reason": "TASK_TYPE_UNSUPPORTED", "task_id": task_id}

    new_task_id = str(created["task_id"])
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE tasks SET parent_task_id=:parent_task_id WHERE task_id=:task_id"),
            {"task_id": new_task_id, "parent_task_id": task_id},
        )
    return {"ok": True, "task_id": new_task_id, "parent_task_id": task_id, "task_type": task_type}


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


def _task_state(value: Any) -> str:
    return str(value or "").strip().upper()


def _serialize_json_for_db(value: Any) -> str:
    normalized = _normalize_jsonish(value)
    try:
        return json.dumps(normalized, ensure_ascii=False)
    except Exception:
        return json.dumps(str(normalized), ensure_ascii=False)


def _extract_celery_error_text(result: Any, default: str) -> str:
    try:
        info = result.info
    except Exception:
        info = None
    if isinstance(info, BaseException):
        msg = str(info).strip()
        return msg or default
    if isinstance(info, dict):
        for key in ("error", "message", "exc_message", "reason"):
            raw = info.get(key)
            msg = str(raw or "").strip()
            if msg:
                return msg
    msg = str(info or "").strip()
    return msg or default


def _is_stale_pending(created_at: Any, updated_at: Any, timeout_minutes: int = PENDING_STALE_TIMEOUT_MINUTES) -> bool:
    reference = updated_at or created_at
    if reference is None:
        return False
    if isinstance(reference, datetime):
        ref_dt = reference
    else:
        text_value = str(reference)
        try:
            ref_dt = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
        except Exception:
            return False
    if ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - ref_dt >= timedelta(minutes=int(timeout_minutes))


def _persist_terminal_state_from_celery(task_id: str, state: str, result: Any) -> dict[str, Any]:
    celery_state = _task_state(state)
    if celery_state == "SUCCESS":
        normalized_result = _normalize_jsonish(getattr(result, "result", None))
        result_json = _serialize_json_for_db(normalized_result)
        with get_engine().begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET status='SUCCESS',
                        result_json=COALESCE(:result_json, result_json),
                        error_text=NULL,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE task_id=:task_id AND status IN ('QUEUED', 'RUNNING', 'PROGRESS')
                    """
                ),
                {"task_id": task_id, "result_json": result_json},
            )
        return {"state": "SUCCESS", "result": normalized_result, "error": None}

    if celery_state in {"FAILURE", "REVOKED"}:
        error_text = _extract_celery_error_text(
            result,
            default="Task failed in worker." if celery_state == "FAILURE" else "Task was revoked in worker.",
        )
        mapped_state = "FAILURE" if celery_state == "FAILURE" else "REVOKED"
        with get_engine().begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET status=:status,
                        error_text=:error_text,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE task_id=:task_id AND status IN ('QUEUED', 'RUNNING', 'PROGRESS')
                    """
                ),
                {"task_id": task_id, "status": mapped_state, "error_text": error_text},
            )
        return {"state": mapped_state, "error": error_text}

    return {"state": celery_state}


def _promote_running_state(task_id: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='RUNNING', updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id AND status='QUEUED'
                """
            ),
            {"task_id": task_id},
        )


def _mark_stale_pending_failure(task_id: str) -> str:
    message = (
        "Task stayed in pending state for too long and likely stalled; "
        "please retry this task."
    )
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='FAILURE',
                    error_text=:error_text,
                    updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id AND status IN ('QUEUED', 'RUNNING', 'PROGRESS')
                """
            ),
            {"task_id": task_id, "error_text": message},
        )
    return message


def _reconcile_task_state(
    task_id: str,
    db_state: Any,
    created_at: Any,
    updated_at: Any,
    async_result_factory,
) -> dict[str, Any]:
    current_state = _task_state(db_state)
    if async_result_factory is None or current_state not in ACTIVE_TASK_STATES:
        return {"state": current_state}

    try:
        result = async_result_factory(task_id)
    except Exception:
        return {"state": current_state}

    try:
        info = result.info
    except Exception:
        info = None
    payload: dict[str, Any] = {"state": current_state}
    if info is not None:
        payload["progress"] = _normalize_jsonish(info)

    celery_state = _task_state(getattr(result, "state", ""))
    if celery_state in {"SUCCESS", "FAILURE", "REVOKED"}:
        payload.update(_persist_terminal_state_from_celery(task_id, celery_state, result))
        return payload

    if celery_state in {"STARTED", "RETRY"} and current_state == "QUEUED":
        _promote_running_state(task_id)
        payload["state"] = "RUNNING"
        return payload

    if celery_state == "PENDING" and _is_stale_pending(created_at, updated_at):
        payload["state"] = "FAILURE"
        payload["error"] = _mark_stale_pending_failure(task_id)
        return payload

    return payload


def _task_display_name(task_type: str, params: Any) -> str:
    if task_type == "word-analysis" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"word-analysis: {word}"
    if task_type == "simulation-run" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        topology = str(params.get("topology", "")).strip() or "topology"
        return f"simulation-run: {word} ({topology})"
    if task_type == "pcmci-causal" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"pcmci-causal: {word}"
    if task_type == "mrnmr-steady" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"mrnmr-steady: {word}"
    if task_type == "deltaT-null" and isinstance(params, dict):
        word = str(params.get("word", "")).strip() or "word"
        return f"deltaT-null: {word}"
    if task_type == "meso-analysis" and isinstance(params, dict):
        project_id = int(params.get("project_id") or 0)
        return f"meso-analysis: project#{project_id or '?'}"
    return task_type


def get_task_owner(task_id: str) -> int | None:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text("SELECT owner_user_id FROM tasks WHERE task_id=:task_id LIMIT 1"),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return row["owner_user_id"]


def get_task_guest_key(task_id: str) -> str | None:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text("SELECT guest_key FROM tasks WHERE task_id=:task_id LIMIT 1"),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return row.get("guest_key")


def get_task_payload(
    task_id: str,
    async_result_factory=None,
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, status, params_json, result_json, error_text, owner_user_id,
                           parent_task_id, guest_key, created_at, updated_at
                    FROM tasks
                    WHERE task_id=:task_id
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )

    if not row:
        if async_result_factory is None:
            return {"task_id": task_id, "state": "NOT_FOUND"}
        res = async_result_factory(task_id)
        payload = {"task_id": task_id, "state": res.state}
        if res.successful():
            payload["result"] = _normalize_jsonish(res.result)
        return payload

    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"task_id": task_id, "state": "NOT_FOUND"}

    payload: Dict[str, Any] = {
        "task_id": row["task_id"],
        "state": _task_state(row["status"]),
        "params": _normalize_jsonish(row["params_json"]),
        "result": _normalize_jsonish(row["result_json"]),
        "error": _normalize_jsonish(row["error_text"]),
        "parent_task_id": row.get("parent_task_id"),
    }

    reconciled = _reconcile_task_state(
        task_id=task_id,
        db_state=row.get("status"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        async_result_factory=async_result_factory,
    )
    payload["state"] = reconciled.get("state", payload["state"])
    if "progress" in reconciled:
        payload["progress"] = reconciled["progress"]
    if "result" in reconciled:
        payload["result"] = reconciled["result"]
    if "error" in reconciled:
        payload["error"] = reconciled["error"]
    return payload


def list_task_payload(
    limit: int = 20,
    current_user: dict | None = None,
    scope: str | None = None,
    guest_key: str | None = None,
    async_result_factory=None,
) -> Dict[str, Any]:
    limit = max(1, min(int(limit), 200))
    if _owner_id(current_user) is None:
        _cleanup_old_guest_tasks()
    scope_where, scope_params = _scope_clause(current_user, scope, guest_key)
    with get_engine().begin() as conn:
        rows = (
            conn.execute(
                text(
                    f"""
                    SELECT task_id, task_type, status, params_json, created_at, updated_at, owner_user_id,
                           parent_task_id, guest_key
                    FROM tasks
                    WHERE status <> 'DELETED' AND ({scope_where})
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit, **scope_params},
            )
            .mappings()
            .all()
        )
    resolver = async_result_factory or celery_app.AsyncResult
    items: list[dict[str, Any]] = []
    for r in rows:
        reconciled = _reconcile_task_state(
            task_id=str(r["task_id"]),
            db_state=r.get("status"),
            created_at=r.get("created_at"),
            updated_at=r.get("updated_at"),
            async_result_factory=resolver,
        )
        item = {
            "task_id": r["task_id"],
            "task_type": r["task_type"],
            "status": reconciled.get("state", _task_state(r.get("status"))),
            "display_name": _task_display_name(r["task_type"], _normalize_jsonish(r["params_json"])),
            "params_json": _normalize_jsonish(r["params_json"]),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "owner_user_id": r.get("owner_user_id"),
            "parent_task_id": r.get("parent_task_id"),
        }
        if "progress" in reconciled:
            item["progress"] = reconciled["progress"]
        items.append(item)
    return {"items": items}


def _delete_task_with_relations(task_id: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='DELETED', deleted_at=COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id},
        )
        conn.execute(text("DELETE FROM task_events WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(text("DELETE FROM task_artifacts WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(text("DELETE FROM report_exports WHERE task_id=:task_id"), {"task_id": task_id})
        conn.execute(
            text(
                """
                DELETE p FROM time_series_points p
                JOIN time_series s ON s.id = p.series_id
                WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(s.meta_json, '$.task_id')), 'null') = :task_id
                """
            ),
            {"task_id": task_id},
        )
        conn.execute(
            text("DELETE FROM time_series WHERE NULLIF(JSON_UNQUOTE(JSON_EXTRACT(meta_json, '$.task_id')), 'null') = :task_id"),
            {"task_id": task_id},
        )


def delete_task_payload(task_id: str, current_user: dict | None = None, guest_key: str | None = None) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, status, owner_user_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return {"task_id": task_id, "deleted": False, "reason": "NOT_FOUND"}
    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"task_id": task_id, "deleted": False, "reason": "FORBIDDEN"}
    if str(row["status"]).upper() in ("RUNNING", "QUEUED", "PROGRESS"):
        return {"task_id": task_id, "deleted": False, "reason": "TASK_ACTIVE"}

    _delete_task_with_relations(task_id)
    return {"task_id": task_id, "deleted": True}


def pause_task_payload(task_id: str, current_user: dict | None = None, guest_key: str | None = None) -> Dict[str, Any]:
    with get_engine().begin() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT task_id, task_type, status, owner_user_id, guest_key, created_at
                    FROM tasks
                    WHERE task_id=:task_id
                    LIMIT 1
                    """
                ),
                {"task_id": task_id},
            )
            .mappings()
            .first()
        )
    if not row:
        return {"task_id": task_id, "paused": False, "reason": "NOT_FOUND"}
    if not _can_access_row(
        row.get("owner_user_id"),
        row.get("guest_key"),
        row.get("created_at"),
        current_user,
        guest_key,
    ):
        return {"task_id": task_id, "paused": False, "reason": "FORBIDDEN"}

    status = str(row.get("status") or "").upper()
    if status in {"SUCCESS", "FAILURE", "DELETED"}:
        return {"task_id": task_id, "paused": False, "reason": "TASK_TERMINAL", "state": status}
    if status in {"PAUSED", "REVOKED"}:
        return {"task_id": task_id, "paused": True, "reason": "ALREADY_PAUSED", "state": status}

    try:
        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")
    except Exception:
        pass

    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE tasks
                SET status='PAUSED', updated_at=CURRENT_TIMESTAMP
                WHERE task_id=:task_id
                """
            ),
            {"task_id": task_id},
        )
    record_task_event(
        task_id,
        "PAUSED",
        f"{row.get('task_type') or 'task'} paused",
        {"task_type": row.get("task_type"), "previous_status": status},
    )
    return {"task_id": task_id, "paused": True, "state": "PAUSED", "previous_status": status}


def bulk_delete_task_payload(
    task_ids: list[str],
    current_user: dict | None = None,
    guest_key: str | None = None,
) -> Dict[str, Any]:
    deleted: list[str] = []
    skipped: list[dict[str, str]] = []
    for task_id in task_ids:
        item = delete_task_payload(task_id, current_user, guest_key)
        if item.get("deleted"):
            deleted.append(task_id)
        else:
            skipped.append({"task_id": task_id, "reason": str(item.get("reason") or "UNKNOWN")})
    return {"deleted": deleted, "skipped": skipped, "requested": len(task_ids)}
