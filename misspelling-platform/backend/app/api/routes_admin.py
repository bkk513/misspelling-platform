import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db.audit_logs_repo import insert_audit_log, list_audit_logs
from ..db.data_sources_repo import list_data_sources
from ..db.users_repo import create_user, get_user_by_id, list_users, update_user_active, update_user_password
from ..services.auth_service import hash_password
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


@router.get("/api/admin/settings")
def admin_settings(current=Depends(require_admin)):
    return {
        "allow_guest": True,
        "llm_enabled": bool((os.getenv("BAILIAN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()),
        "gbnc_enabled": True,
        "admin_token_compat": False,
    }
