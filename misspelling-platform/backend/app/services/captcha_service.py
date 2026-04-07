"""文件说明：验证码服务模块，负责生成和校验注册登录等场景使用的验证码。"""

import hashlib
import os
import random
import uuid

import redis

_CAPTCHA_PREFIX = "mp:captcha:"


def _redis_client():
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    return redis.from_url(redis_url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def issue_captcha() -> dict:
    code = "".join(str(random.randint(0, 9)) for _ in range(4))
    captcha_id = str(uuid.uuid4())
    ttl = int(os.getenv("CAPTCHA_TTL_SECONDS", "180") or "180")
    client = _redis_client()
    client.setex(f"{_CAPTCHA_PREFIX}{captcha_id}", ttl, _hash_code(code))
    return {
        "captcha_id": captcha_id,
        "captcha_text": code,
        "expires_in": ttl,
    }


def verify_captcha(captcha_id: str, captcha_code: str) -> bool:
    if not captcha_id or not captcha_code:
        return False
    client = _redis_client()
    key = f"{_CAPTCHA_PREFIX}{captcha_id}"
    expected = client.get(key)
    if not expected:
        return False
    ok = expected == _hash_code(str(captcha_code).strip())
    if ok:
        client.delete(key)
    return ok
