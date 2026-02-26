import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException

from ..services.audit_log_service import list_audit_logs_payload
from ..services.lexicon_service import admin_add_variants_payload

router = APIRouter()


def require_admin_token(x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    configured = os.getenv("ADMIN_TOKEN", "").strip()
    if not configured:
        raise HTTPException(status_code=401, detail="admin token not configured on server")
    if x_admin_token != configured:
        raise HTTPException(status_code=401, detail="invalid admin token")
    return {"auth": "ok"}


@router.get("/api/admin/audit-logs")
def get_admin_audit_logs(limit: int = 100, _auth=Depends(require_admin_token)):
    return list_audit_logs_payload(limit)


@router.post("/api/admin/lexicon/variants")
def post_admin_lexicon_variants(
    payload: dict[str, Any],
    _auth=Depends(require_admin_token),
):
    variants = payload.get("variants") if isinstance(payload.get("variants"), list) else []
    return admin_add_variants_payload(
        term_id=payload.get("term_id"),
        word=payload.get("word"),
        variants=[str(v) for v in variants],
        actor="admin_api",
    )
