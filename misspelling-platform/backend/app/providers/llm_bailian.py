import json
import os
import re
from typing import Any

import requests

from ..services.audit_log_service import record_audit_error


def _base_url() -> str:
    return os.getenv("BAILIAN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")


def _model() -> str:
    return os.getenv("BAILIAN_MODEL", "qwen-plus")


def _api_key() -> str:
    return os.getenv("DASHSCOPE_API_KEY", "").strip() or os.getenv("BAILIAN_API_KEY", "").strip()


def _timeout() -> float:
    try:
        return max(1.0, float(os.getenv("BAILIAN_TIMEOUT_SEC", "8")))
    except Exception:
        return 8.0


def _normalize(word: str) -> str:
    s = (word or "").strip().lower().replace("_", "-")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*-\s*", "-", s)
    return s


def _extract_variants(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        v = payload.get("variants")
        return v if isinstance(v, list) else []
    if isinstance(payload, list):
        return payload
    return []


def _parse_content(content: Any) -> list[str]:
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        content = "\n".join(parts)
    if not isinstance(content, str):
        return []
    text = content.strip()
    if not text:
        return []
    try:
        return _extract_variants(json.loads(text))
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return _extract_variants(json.loads(match.group(0)))
            except Exception:
                return []
    return []


def _sanitize_error_message(text: str) -> str:
    if not text:
        return ""
    masked = text
    for secret in (
        os.getenv("DASHSCOPE_API_KEY", "").strip(),
        os.getenv("BAILIAN_API_KEY", "").strip(),
    ):
        if secret:
            masked = masked.replace(secret, "***")
    masked = re.sub(r"Bearer\s+[A-Za-z0-9._-]+", "Bearer ***", masked, flags=re.IGNORECASE)
    return masked[:500]


def suggest_variants_with_meta(word: str, k: int = 20) -> dict[str, Any]:
    canonical = _normalize(word)
    if not canonical:
        return {"variants": [], "error": None, "disabled": True}
    api_key = _api_key()
    if not api_key:
        return {"variants": [], "error": "api key not configured", "disabled": True}
    try:
        resp = requests.post(
            f"{_base_url()}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _model(),
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a spelling-variant assistant for scientific platform demos. "
                            "Return strict JSON only: {\"variants\":[...]}."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Target word: {canonical}\n"
                            f"Return up to {max(1, min(int(k), 50))} plausible misspelling variants only. "
                            "Do not include the original word."
                        ),
                    },
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
            timeout=_timeout(),
        )
        resp.raise_for_status()
        data = resp.json()
        content = (((data.get("choices") or [{}])[0]).get("message") or {}).get("content")
        raw = _parse_content(content)
        out: list[str] = []
        seen = {canonical}
        for item in raw:
            if not isinstance(item, str):
                continue
            norm = _normalize(item)
            if not norm or norm in seen:
                continue
            seen.add(norm)
            out.append(norm)
            if len(out) >= max(1, min(int(k), 50)):
                break
        return {"variants": out, "error": None, "disabled": False}
    except Exception as exc:
        error_text = _sanitize_error_message(str(exc))
        record_audit_error(
            source="llm_bailian",
            message="variant suggestion failed",
            meta={"word": canonical, "error": error_text},
        )
        return {"variants": [], "error": error_text or "request failed", "disabled": False}


def suggest_variants(word: str, k: int = 20) -> list[str]:
    return list(suggest_variants_with_meta(word, k).get("variants") or [])
