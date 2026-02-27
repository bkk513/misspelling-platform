from fastapi import Header, HTTPException

from ..services.auth_service import decode_access_token, get_me_from_payload


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def get_current_user(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    me = get_me_from_payload(payload)
    if not me:
        raise HTTPException(status_code=401, detail="User not found")
    return me


def require_admin(authorization: str | None = Header(default=None)):
    me = get_current_user(authorization)
    roles = set(me.get("roles") or [])
    if "admin" not in roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return me
