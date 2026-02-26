from typing import Any
import secrets

from fastapi import APIRouter, Depends, HTTPException

from .auth_deps import require_admin_user
from ..db.time_series_repo import list_gbnc_series
from ..db.users_repo import (
    create_user,
    ensure_role,
    ensure_user_role,
    get_user_by_id,
    get_user_by_username,
    list_user_roles,
    list_users,
    set_user_active,
    set_user_password_hash,
)
from ..services.audit_log_service import list_audit_logs_payload
from ..services.auth_service import hash_password
from ..services.lexicon_service import admin_add_variants_payload

router = APIRouter()


def _actor_user_id(auth: dict[str, Any] | None) -> int | None:
    try:
        user = (auth or {}).get("user") or {}
        value = user.get("id")
        return int(value) if value is not None else None
    except Exception:
        return None


@router.get("/api/admin/audit-logs")
def get_admin_audit_logs(limit: int = 100, _auth=Depends(require_admin_user)):
    return list_audit_logs_payload(limit)


@router.get("/api/admin/users")
def get_admin_users(limit: int = 100, _auth=Depends(require_admin_user)):
    rows = list_users(limit)
    return {
        "items": [
            {**dict(r), "roles": list_user_roles(int(r["id"]))}
            for r in rows
        ]
    }


@router.get("/api/admin/gbnc-series")
def get_admin_gbnc_series(limit: int = 100, _auth=Depends(require_admin_user)):
    return {"items": [dict(r) for r in list_gbnc_series(limit)]}


@router.post("/api/admin/users")
def post_admin_user_create(payload: dict[str, Any], auth=Depends(require_admin_user)):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "").strip()
    role = str(payload.get("role") or "user").strip().lower()
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required")
    if get_user_by_username(username):
        raise HTTPException(status_code=409, detail="username already exists")
    user_id = create_user(username, hash_password(password), is_admin=(role == "admin"))
    ensure_user_role(user_id, ensure_role("user", "Normal user role"))
    if role == "admin":
        ensure_user_role(user_id, ensure_role("admin", "Administrator role"))
    from ..services.audit_log_service import record_audit
    record_audit("ADMIN_USER_CREATE", "user", str(user_id), {"username": username, "role": role}, actor_user_id=_actor_user_id(auth))
    user = get_user_by_id(user_id)
    return {"ok": True, "user": {**dict(user), "roles": list_user_roles(user_id)}}


@router.post("/api/admin/users/{user_id}/reset-password")
def post_admin_user_reset_password(user_id: int, payload: dict[str, Any] | None = None, auth=Depends(require_admin_user)):
    user = get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    new_password = str((payload or {}).get("password") or "").strip() or f"Temp-{secrets.token_hex(4)}"
    set_user_password_hash(int(user_id), hash_password(new_password))
    from ..services.audit_log_service import record_audit
    record_audit("ADMIN_USER_RESET_PASSWORD", "user", str(user_id), {"username": user["username"]}, actor_user_id=_actor_user_id(auth))
    return {"ok": True, "user_id": int(user_id), "temporary_password": new_password}


@router.patch("/api/admin/users/{user_id}")
def patch_admin_user(user_id: int, payload: dict[str, Any], auth=Depends(require_admin_user)):
    user = get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="user not found")
    if "is_active" not in (payload or {}):
        raise HTTPException(status_code=400, detail="is_active is required")
    is_active = bool(payload.get("is_active"))
    set_user_active(int(user_id), is_active)
    from ..services.audit_log_service import record_audit
    record_audit("ADMIN_USER_SET_ACTIVE", "user", str(user_id), {"is_active": is_active, "username": user["username"]}, actor_user_id=_actor_user_id(auth))
    updated = get_user_by_id(int(user_id))
    return {"ok": True, "user": {**dict(updated), "roles": list_user_roles(int(user_id))}}


@router.post("/api/admin/lexicon/variants")
def post_admin_lexicon_variants(
    payload: dict[str, Any],
    _auth=Depends(require_admin_user),
):
    variants = payload.get("variants") if isinstance(payload.get("variants"), list) else []
    return admin_add_variants_payload(
        term_id=payload.get("term_id"),
        word=payload.get("word"),
        variants=[str(v) for v in variants],
        actor="admin_api",
    )
