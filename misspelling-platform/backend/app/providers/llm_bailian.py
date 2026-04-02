import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests

from ..db.audit_logs_repo import insert_audit_log

LLM_CONFIG_FILE = Path(os.getenv("LLM_API_KEY_FILE") or "/srv/apps/llm_api_key.txt")


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


def _parse_origin_year_content(content: str, fallback_year: int | None = None) -> dict[str, Any]:
    content = str(content or "").strip()
    suggested_year = fallback_year
    reasoning = ""
    if not content:
        return {"suggested_year": suggested_year, "reasoning": reasoning}
    try:
        payload = json.loads(content)
        if isinstance(payload, dict):
            raw_year = payload.get("suggested_year")
            if raw_year is None:
                raw_year = payload.get("year")
            if raw_year not in (None, ""):
                try:
                    suggested_year = int(raw_year)
                except Exception:
                    suggested_year = fallback_year
            reasoning = str(payload.get("reasoning") or payload.get("reason") or "").strip()
            return {"suggested_year": suggested_year, "reasoning": reasoning}
    except Exception:
        match = re.search(r"(1[5-9]\d{2}|20[0-2]\d)", content)
        if match:
            try:
                suggested_year = int(match.group(1))
            except Exception:
                suggested_year = fallback_year
        reasoning = content[:240].strip()
    return {"suggested_year": suggested_year, "reasoning": reasoning}


def _load_file_backed_llm_config() -> dict[str, str]:
    if not LLM_CONFIG_FILE.exists():
        return {}
    try:
        text = LLM_CONFIG_FILE.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {}

    found: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = str(raw_line or "").strip()
        if not line:
            continue
        match = re.match(r"^\s*([^:=：]+?)\s*[:=：]\s*(.+?)\s*$", line)
        if not match:
            continue
        key = re.sub(r"\s+", " ", match.group(1)).strip().lower()
        value = match.group(2).strip()
        if not value:
            continue
        if key in {"base url", "base_url", "url", "api url", "api base", "api endpoint"}:
            found["base_url"] = value
        elif key in {"model", "model name"}:
            found["model"] = value
        elif key in {"api key", "apikey", "api_key", "key"}:
            found["api_key"] = value
    return found


def _resolve_llm_config() -> tuple[str, str, str, int]:
    file_cfg = _load_file_backed_llm_config()
    key = (os.getenv("DASHSCOPE_API_KEY") or os.getenv("BAILIAN_API_KEY") or file_cfg.get("api_key") or "").strip()
    base_url = (
        os.getenv("BAILIAN_BASE_URL")
        or file_cfg.get("base_url")
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).strip().rstrip("/")
    model = (os.getenv("BAILIAN_MODEL") or file_cfg.get("model") or "qwen-plus").strip()
    timeout = int(os.getenv("BAILIAN_TIMEOUT_SECONDS", "20") or "20")
    return key, base_url, model, timeout


def llm_config_fingerprint() -> dict[str, Any]:
    file_cfg = _load_file_backed_llm_config()
    env_key = (os.getenv("DASHSCOPE_API_KEY") or os.getenv("BAILIAN_API_KEY") or "").strip()
    key, base_url, model, timeout = _resolve_llm_config()
    key_source = "none"
    if env_key:
        key_source = "env"
    elif str(file_cfg.get("api_key") or "").strip():
        key_source = "file"
    return {
        "key_present": bool(key),
        "key_source": key_source,
        "key_length": len(key),
        "model": model,
        "base_url": base_url,
        "timeout_seconds": timeout,
        "proxy_configured": bool((os.getenv("HTTPS_PROXY") or "").strip() or (os.getenv("HTTP_PROXY") or "").strip()),
        "config_file_present": LLM_CONFIG_FILE.exists(),
        "config_file_path": str(LLM_CONFIG_FILE),
    }


def is_llm_configured() -> bool:
    return bool(llm_config_fingerprint()["key_present"])


def _safe_insert_audit_log(**kwargs: Any) -> None:
    try:
        insert_audit_log(**kwargs)
    except Exception:
        return


def suggest_variants(word: str, k: int = 20, actor_user_id: int | None = None) -> dict[str, Any]:
    key, base_url, model, timeout = _resolve_llm_config()

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
        _safe_insert_audit_log(
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
        _safe_insert_audit_log(
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


def suggest_origin_year(
    word: str,
    basis_year: int | None = None,
    correct_first_year: int | None = None,
    actor_user_id: int | None = None,
) -> dict[str, Any]:
    key, base_url, model, timeout = _resolve_llm_config()
    fallback_year = basis_year or correct_first_year

    if not key:
        return {
            "suggested_year": fallback_year,
            "source": "heuristic",
            "reasoning": "No LLM credential was found, so the suggestion fell back to local corpus evidence.",
            "warnings": ["llm_key_missing"],
            "llm_error": None,
        }

    url = f"{base_url}/chat/completions"
    prompt = (
        "Return JSON only: "
        "{\"suggested_year\": <int|null>, \"reasoning\": \"short explanation\"}. "
        f"Canonical word: {word}. "
        f"Local corpus anchor year: {basis_year}. "
        f"Earliest correct-spelling year in local corpus: {correct_first_year}. "
        "Task: identify when the most common mainstream sense of this word began to be used by the public. "
        "Focus on the dominant everyday meaning, not a rare technical precursor. "
        "Return a single historically reasonable year and a concise reason. "
        "Do not clamp the answer to the local corpus window."
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
                "temperature": 0.2,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        parsed = _parse_origin_year_content(content, fallback_year=fallback_year)
        source = "llm" if parsed.get("suggested_year") is not None else "heuristic"
        warnings: list[str] = [] if source == "llm" else ["llm_empty_response"]
        _safe_insert_audit_log(
            action="LLM_ORIGIN_YEAR",
            actor_user_id=actor_user_id,
            target_type="llm",
            target_id=model,
            meta={
                "ok": True,
                "provider": "dashscope-compatible",
                "model": model,
                "latency_ms": int((time.time() - started) * 1000),
                "word": word,
                "basis_year": basis_year,
                "correct_first_year": correct_first_year,
                "suggested_year": parsed.get("suggested_year"),
                "source": source,
            },
        )
        return {
            "suggested_year": parsed.get("suggested_year"),
            "source": source,
            "reasoning": parsed.get("reasoning") or "",
            "warnings": warnings,
            "llm_error": None,
        }
    except Exception as exc:
        err = str(exc)
        _safe_insert_audit_log(
            action="LLM_ORIGIN_YEAR",
            actor_user_id=actor_user_id,
            target_type="llm",
            target_id=model,
            meta={
                "ok": False,
                "provider": "dashscope-compatible",
                "model": model,
                "latency_ms": int((time.time() - started) * 1000),
                "word": word,
                "basis_year": basis_year,
                "correct_first_year": correct_first_year,
                "error": err,
            },
        )
        return {
            "suggested_year": fallback_year,
            "source": "heuristic",
            "reasoning": "The LLM request failed, so the suggestion fell back to local corpus evidence.",
            "warnings": ["llm_failed"],
            "llm_error": err[:200],
        }
