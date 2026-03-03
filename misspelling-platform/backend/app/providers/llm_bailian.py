import json
import os
import time
from typing import Any

import requests

from ..db.audit_logs_repo import insert_audit_log


def _normalize(text: str) -> str:
    v = " ".join(str(text or "").strip().lower().replace("_", "-").split())
    return v.strip("-")


def _heuristic(word: str, k: int) -> list[str]:
    base = _normalize(word)
    if not base:
        return []
    guesses = [
        f"{base}-",
        base.replace("a", ""),
        base.replace("e", ""),
        f"{base}{base[-1:]}",
        f"{base}e",
        base.replace("-", ""),
    ]
    out: list[str] = []
    for g in guesses:
        n = _normalize(g)
        if n and n != base and n not in out:
            out.append(n)
        if len(out) >= k:
            break
    return out


def _parse_llm_content(content: str, fallback_word: str, k: int) -> list[str]:
    content = str(content or "").strip()
    variants: list[str] = []
    if not content:
        return variants
    try:
        payload = json.loads(content)
        if isinstance(payload, dict):
            raw = payload.get("variants") or payload.get("suggestions") or []
            if isinstance(raw, list):
                for item in raw:
                    n = _normalize(str(item))
                    if n and n != _normalize(fallback_word) and n not in variants:
                        variants.append(n)
    except Exception:
        for token in content.replace("\n", ",").split(","):
            n = _normalize(token)
            if n and n != _normalize(fallback_word) and n not in variants:
                variants.append(n)
    return variants[:k]


def suggest_variants(word: str, k: int = 20, actor_user_id: int | None = None) -> dict[str, Any]:
    key = (os.getenv("DASHSCOPE_API_KEY") or os.getenv("BAILIAN_API_KEY") or "").strip()
    base_url = (os.getenv("BAILIAN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").strip().rstrip("/")
    model = (os.getenv("BAILIAN_MODEL") or "qwen-plus").strip()
    timeout = int(os.getenv("BAILIAN_TIMEOUT_SECONDS", "8") or "8")

    if not key:
        variants = _heuristic(word, k)
        return {
            "variants": variants,
            "source": "heuristic",
            "warnings": ["llm_key_missing"],
            "llm_error": None,
        }

    url = f"{base_url}/chat/completions"
    prompt = (
        "Return JSON only: {\"variants\": [..]}. "
        f"Word: {word}. Generate at most {k} misspelling or orthographic variants."
    )
    started = time.time()
    try:
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a strict JSON generator."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        content = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        variants = _parse_llm_content(content, word, k)
        if not variants:
            variants = _heuristic(word, k)
            source = "heuristic"
            warnings = ["llm_empty_response"]
        else:
            source = "llm"
            warnings = []
        insert_audit_log(
            action="LLM_VARIANTS",
            actor_user_id=actor_user_id,
            target_type="llm",
            target_id=model,
            meta={
                "ok": True,
                "provider": "dashscope-compatible",
                "model": model,
                "latency_ms": int((time.time() - started) * 1000),
                "variants_count": len(variants),
                "source": source,
            },
        )
        return {
            "variants": variants,
            "source": source,
            "warnings": warnings,
            "llm_error": None,
        }
    except Exception as exc:
        err = str(exc)
        insert_audit_log(
            action="LLM_VARIANTS",
            actor_user_id=actor_user_id,
            target_type="llm",
            target_id=model,
            meta={
                "ok": False,
                "provider": "dashscope-compatible",
                "model": model,
                "latency_ms": int((time.time() - started) * 1000),
                "error": err,
            },
        )
        return {
            "variants": _heuristic(word, k),
            "source": "heuristic",
            "warnings": ["llm_failed"],
            "llm_error": err[:200],
        }
