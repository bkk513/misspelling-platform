import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from ..db.users_repo import (
    count_users,
    create_user,
    ensure_user_role,
    get_user_by_id,
    get_user_by_username,
    list_user_roles,
)


def _token_secret() -> bytes:
    return os.getenv("AUTH_TOKEN_SECRET", "change-me-in-production").encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return "pbkdf2_sha256$120000$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, rounds, salt_b64, digest_b64 = encoded.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + pad).encode("ascii"))


def issue_access_token(user_id: int, username: str, roles: list[str], ttl_seconds: int = 8 * 3600) -> str:
    payload = {
        "uid": user_id,
        "sub": username,
        "roles": roles,
        "exp": int(time.time()) + ttl_seconds,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(_token_secret(), raw, hashlib.sha256).digest()
    return f"{_b64encode(raw)}.{_b64encode(sig)}"


def decode_access_token(token: str):
    try:
        raw_part, sig_part = token.split(".", 1)
        raw = _b64decode(raw_part)
        sig = _b64decode(sig_part)
        expected = hmac.new(_token_secret(), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(raw.decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def authenticate_user(username: str, password: str):
    row = get_user_by_username(username)
    if not row:
        return None
    if int(row["is_active"] or 0) != 1:
        return None
    if not verify_password(password, str(row["password_hash"])):
        return None
    roles = list_user_roles(int(row["id"]))
    if not roles:
        roles = ["admin"] if int(row["is_admin"] or 0) == 1 else ["user"]
        for role in roles:
            ensure_user_role(int(row["id"]), role)
    return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "roles": roles,
    }


def get_me_from_payload(payload: dict):
    user_id = int(payload.get("uid", 0))
    if user_id <= 0:
        return None
    row = get_user_by_id(user_id)
    if not row:
        return None
    roles = list_user_roles(user_id)
    return {
        "id": int(row["id"]),
        "username": str(row["username"]),
        "is_active": bool(row["is_active"]),
        "roles": roles,
    }


def ensure_init_admin_from_env() -> None:
    username = (os.getenv("INIT_ADMIN_USERNAME") or "").strip()
    password = (os.getenv("INIT_ADMIN_PASSWORD") or "").strip()
    if not username or not password:
        return

    existing = get_user_by_username(username)
    if existing:
        ensure_user_role(int(existing["id"]), "admin")
        return

    is_first_user = count_users() == 0
    user_id = create_user(username=username, password_hash=hash_password(password), is_admin=True)
    if is_first_user:
        ensure_user_role(user_id, "admin")
