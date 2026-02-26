import base64
import hashlib
import hmac
import json
import os
import time

import bcrypt

from ..db.users_repo import (
    create_user,
    ensure_role,
    ensure_user_role,
    get_user_by_id,
    get_user_by_username,
    list_user_roles,
)
from .audit_log_service import record_audit


def _secret() -> bytes:
    return (os.getenv("AUTH_TOKEN_SECRET", "") or "dev-auth-secret").encode("utf-8")


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def issue_access_token(user_id: int, username: str, roles: list[str], ttl_sec: int = 3600 * 12) -> str:
    payload = {"uid": int(user_id), "username": username, "roles": roles, "exp": int(time.time()) + int(ttl_sec)}
    body = _b64e(json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
    sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def parse_access_token(token: str):
    try:
        body, sig = token.split(".", 1)
        exp_sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, exp_sig):
            return None
        payload = json.loads(_b64d(body).decode("utf-8"))
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def login_user(username: str, password: str):
    user = get_user_by_username((username or "").strip())
    if not user or not bool(user.get("is_active")):
        return None
    if not verify_password(password or "", str(user.get("password_hash") or "")):
        return None
    roles = list_user_roles(int(user["id"]))
    token = issue_access_token(int(user["id"]), str(user["username"]), roles)
    record_audit("AUTH_LOGIN", "user", str(user["id"]), {"username": user["username"]})
    return {"access_token": token, "token_type": "bearer", "user": {"id": int(user["id"]), "username": user["username"], "roles": roles}}


def get_me_from_token(token: str):
    payload = parse_access_token(token or "")
    if not payload:
        return None
    user = get_user_by_id(int(payload.get("uid") or 0))
    if not user or not bool(user.get("is_active")):
        return None
    roles = list_user_roles(int(user["id"]))
    return {"id": int(user["id"]), "username": str(user["username"]), "display_name": user.get("display_name"), "roles": roles}


def init_admin_from_env():
    username = (os.getenv("INIT_ADMIN_USERNAME", "") or "").strip()
    password = (os.getenv("INIT_ADMIN_PASSWORD", "") or "").strip()
    if not username or not password:
        return None
    user = get_user_by_username(username)
    if not user:
        user_id = create_user(username, hash_password(password), is_admin=True)
    else:
        user_id = int(user["id"])
    admin_role = ensure_role("admin", "Administrator role")
    user_role = ensure_role("user", "Normal user role")
    ensure_user_role(user_id, admin_role)
    ensure_user_role(user_id, user_role)
    return {"user_id": user_id, "username": username}

