import os

import requests

_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _secret_key() -> str:
    return (os.getenv("TURNSTILE_SECRET_KEY") or "").strip()


def is_turnstile_configured() -> bool:
    return bool(_secret_key())


def verify_turnstile_token(token: str, remote_ip: str | None = None) -> tuple[bool, list[str]]:
    secret = _secret_key()
    if not secret:
        return False, ["secret_missing"]
    safe_token = str(token or "").strip()
    if not safe_token:
        return False, ["token_missing"]
    payload: dict[str, str] = {"secret": secret, "response": safe_token}
    if remote_ip:
        payload["remoteip"] = remote_ip
    timeout_seconds = float(os.getenv("TURNSTILE_TIMEOUT_SECONDS", "6") or "6")
    try:
        resp = requests.post(_SITEVERIFY_URL, data=payload, timeout=timeout_seconds)
        resp.raise_for_status()
        body = resp.json()
    except requests.RequestException:
        return False, ["siteverify_request_failed"]
    except ValueError:
        return False, ["siteverify_invalid_json"]
    if bool(body.get("success")):
        return True, []
    codes = [str(v) for v in (body.get("error-codes") or []) if str(v).strip()]
    return False, codes or ["verification_failed"]
