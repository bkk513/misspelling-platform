from typing import Any

from fastapi import APIRouter, Depends

from .auth_deps import require_admin_user
from ..db.time_series_repo import list_gbnc_series
from ..db.users_repo import list_user_roles, list_users
from ..services.audit_log_service import list_audit_logs_payload
from ..services.lexicon_service import admin_add_variants_payload

router = APIRouter()


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
