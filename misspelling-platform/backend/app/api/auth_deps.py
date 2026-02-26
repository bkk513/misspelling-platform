import os

from fastapi import Header, HTTPException

from ..services.audit_log_service import record_audit
from ..services.auth_service import get_me_from_token


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    prefix = "bearer "
    return authorization[len(prefix) :].strip() if authorization.lower().startswith(prefix) else ""


def get_current_user_optional(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    if not token:
        return None
    user = get_me_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    return user


def require_admin_user(
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
):
    user = get_current_user_optional(authorization)
    if user:
        roles = {str(r).lower() for r in (user.get("roles") or [])}
        if "admin" not in roles:
            raise HTTPException(status_code=403, detail="admin role required")
        return {"auth_mode": "bearer", "user": user}

    compat_enabled = str(os.getenv("ALLOW_ADMIN_TOKEN_COMPAT", "0")).strip().lower() in {"1", "true", "yes"}
    configured = (os.getenv("ADMIN_TOKEN", "") or "").strip()
    if compat_enabled and configured and x_admin_token == configured:
        record_audit("ADMIN_TOKEN_COMPAT_USED", "auth", None, {"deprecated": True})
        return {"auth_mode": "admin_token_compat", "user": {"username": "compat-admin", "roles": ["admin"]}}

    raise HTTPException(status_code=401, detail="admin bearer token required")

