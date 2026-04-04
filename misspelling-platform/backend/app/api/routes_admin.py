import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text

from ..db.audit_logs_repo import insert_audit_log, list_audit_logs
from ..db.core import get_engine
from ..db.data_sources_repo import list_data_sources
from ..db.users_repo import create_user, get_user_by_id, list_users, update_user_active, update_user_password
from ..providers.llm_bailian import is_llm_configured
from ..services.auth_service import hash_password
from ..services.diagnostics_service import get_admin_diagnostics_payload
from ..services.lexicon_service import admin_delete_variant_cache_payload, admin_list_variant_cache_payload
from .auth_deps import require_admin

router = APIRouter()


class CreateUserBody(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    role: str = Field(default="user")


class ResetPasswordBody(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class UpdateUserBody(BaseModel):
    is_active: bool


class AdminPurgeBody(BaseModel):
    scope: str = Field(pattern="^(guest|user)$")
    user_id: int | None = None
    what: list[str] = Field(default_factory=lambda: ["tasks", "series", "artifacts", "lexicon"])


def _scope_sql(scope: str, user_id: int | None):
    if scope == "guest":
        return "owner_user_id IS NULL", {}
    if scope == "user" and user_id and user_id > 0:
        return "owner_user_id = :owner_user_id", {"owner_user_id": user_id}
    raise HTTPException(status_code=400, detail="user scope requires user_id")


@router.get("/api/admin/users")
def admin_users(limit: int = 50, current=Depends(require_admin)):
    safe_limit = max(1, min(limit, 200))
    rows = list_users(safe_limit)
    return {
        "items": [
            {
                "id": int(r["id"]),
                "username": str(r["username"]),
                "is_active": bool(r["is_active"]),
                "is_admin": bool(r["is_admin"]),
                "roles": [x for x in str(r["roles"] or "").split(",") if x],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@router.post("/api/admin/users")
def admin_create_user(body: CreateUserBody, current=Depends(require_admin)):
    role = "admin" if body.role == "admin" else "user"
    try:
        user_id = create_user(body.username, hash_password(body.password), is_admin=(role == "admin"))
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"create user failed: {exc}")
    insert_audit_log(
        action="ADMIN_CREATE_USER",
        actor_user_id=current["id"],
        target_type="user",
        target_id=str(user_id),
        meta={"username": body.username, "role": role},
    )
    row = get_user_by_id(user_id)
    return {"id": user_id, "username": row["username"], "role": role}


@router.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, body: ResetPasswordBody, current=Depends(require_admin)):
    row = get_user_by_id(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="user not found")
    update_user_password(user_id, hash_password(body.new_password))
    insert_audit_log(
        action="ADMIN_RESET_PASSWORD",
        actor_user_id=current["id"],
        target_type="user",
        target_id=str(user_id),
    )
    return {"ok": True, "user_id": user_id}


@router.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, body: UpdateUserBody, current=Depends(require_admin)):
    row = get_user_by_id(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="user not found")
    update_user_active(user_id, body.is_active)
    insert_audit_log(
        action="ADMIN_UPDATE_USER",
        actor_user_id=current["id"],
        target_type="user",
        target_id=str(user_id),
        meta={"is_active": body.is_active},
    )
    return {"ok": True, "user_id": user_id, "is_active": body.is_active}


@router.get("/api/admin/audit-logs")
def admin_audit_logs(limit: int = 100, current=Depends(require_admin)):
    safe_limit = max(1, min(limit, 500))
    rows = list_audit_logs(safe_limit)
    return {
        "items": [
            {
                "id": int(r["id"]),
                "actor_user_id": r["actor_user_id"],
                "action": r["action"],
                "target_type": r["target_type"],
                "target_id": r["target_id"],
                "meta_json": r["meta_json"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    }


@router.get("/api/admin/data-sources")
def admin_data_sources(limit: int = 50, current=Depends(require_admin)):
    safe_limit = max(1, min(limit, 200))
    rows = list_data_sources(safe_limit)
    return {"items": [dict(r) for r in rows]}


@router.get("/api/admin/variant-cache")
def admin_variant_cache(limit: int = 300, user_id: int | None = None, word: str | None = None, current=Depends(require_admin)):
    return admin_list_variant_cache_payload(limit=limit, user_id=user_id, word=word)


@router.delete("/api/admin/variant-cache/{entry_id}")
def admin_delete_variant_cache(entry_id: int, current=Depends(require_admin)):
    return admin_delete_variant_cache_payload(entry_id=entry_id, actor_user_id=int(current["id"]))


@router.get("/api/admin/settings")
def admin_settings(current=Depends(require_admin)):
    return {
        "allow_guest": True,
        "llm_enabled": is_llm_configured(),
        "gbnc_enabled": True,
        "admin_token_compat": False,
    }


@router.get("/api/admin/diagnostics")
def admin_diagnostics(current=Depends(require_admin)):
    payload = get_admin_diagnostics_payload()
    return payload


@router.post("/api/admin/purge")
def admin_purge(body: AdminPurgeBody, current=Depends(require_admin)):
    scope_where, scope_params = _scope_sql(body.scope, body.user_id)
    targets = {str(v).strip().lower() for v in (body.what or []) if str(v).strip()}
    deleted_counts = {"tasks": 0, "series": 0, "artifacts": 0, "lexicon": 0}

    with get_engine().begin() as conn:
        task_rows = (
            conn.execute(
                text(f"SELECT task_id FROM tasks WHERE {scope_where}"),
                scope_params,
            )
            .mappings()
            .all()
        )
        task_ids = [str(r["task_id"]) for r in task_rows]

        if "tasks" in targets and task_ids:
            conn.execute(
                text(
                    """
                    UPDATE tasks
                    SET status='DELETED', updated_at=CURRENT_TIMESTAMP
                    WHERE task_id IN :task_ids
                    """
                ).bindparams(bindparam("task_ids", expanding=True)),
                {"task_ids": task_ids},
            )
            conn.execute(
                text("DELETE FROM task_events WHERE task_id IN :task_ids").bindparams(bindparam("task_ids", expanding=True)),
                {"task_ids": task_ids},
            )
            deleted_counts["tasks"] = len(task_ids)

        if "artifacts" in targets:
            result = conn.execute(text(f"DELETE FROM task_artifacts WHERE {scope_where}"), scope_params)
            deleted_counts["artifacts"] = int(result.rowcount or 0)

        if "series" in targets:
            conn.execute(
                text(
                    f"""
                    DELETE p FROM time_series_points p
                    JOIN time_series s ON s.id = p.series_id
                    WHERE {scope_where.replace('owner_user_id', 's.owner_user_id')}
                    """
                ),
                scope_params,
            )
            result = conn.execute(text(f"DELETE FROM time_series WHERE {scope_where}"), scope_params)
            deleted_counts["series"] = int(result.rowcount or 0)

        if "lexicon" in targets:
            conn.execute(text(f"DELETE FROM lexicon_variants WHERE {scope_where}"), scope_params)
            result = conn.execute(text(f"DELETE FROM lexicon_terms WHERE {scope_where}"), scope_params)
            deleted_counts["lexicon"] = int(result.rowcount or 0)
            conn.execute(text(f"DELETE FROM variant_cache_entries WHERE {scope_where}"), scope_params)

    insert_audit_log(
        action="ADMIN_PURGE",
        actor_user_id=current["id"],
        target_type=body.scope,
        target_id=str(body.user_id) if body.user_id else None,
        meta={
            "what": sorted(targets),
            "deleted_counts": deleted_counts,
        },
    )
    return {"ok": True, "scope": body.scope, "user_id": body.user_id, "deleted": deleted_counts}
