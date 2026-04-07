from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import requests
from fastapi import HTTPException

from ..db.audit_logs_repo import insert_audit_log
from ..services.variant_review_service import review_misspelling_variants

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_MIN_YEAR = 2015
GDELT_MAX_QUERY_SPAN_YEARS = 11
GDELT_MAX_VARIANTS = 4
GDELT_MIN_REQUEST_INTERVAL_SECONDS = 5.5
GDELT_MAX_RETRIES = 4
GDELT_RETRY_BACKOFF_BASE_SECONDS = 2.0
GDELT_CHUNK_FALLBACK_SPAN_YEARS = 4
GDELT_MAX_RETRIES_CANONICAL = 3
GDELT_MAX_RETRIES_VARIANT = 2
GDELT_TIMEOUT_SECONDS_CANONICAL = 12
GDELT_TIMEOUT_SECONDS_VARIANT = 8
GDELT_MAX_CHUNK_REQUESTS = 3
GDELT_TOTAL_PULL_BUDGET_SECONDS = 55.0

_CACHE_ROOT = Path(
    str(os.getenv("GDELT_CACHE_DIR") or (Path(__file__).resolve().parents[3] / "runtime" / "gdelt_cache"))
).expanduser()
_REQUEST_LOCK = Lock()
_LAST_REQUEST_AT = 0.0
_SAFE_NAME_RE = re.compile(r"[^a-z0-9]+")


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_word(value: str | None) -> str:
    return str(value or "").strip().lower()


def _clip_window(start_year: int, end_year: int) -> tuple[int, int, list[str]]:
    safe_start = int(start_year)
    safe_end = int(end_year)
    warnings: list[str] = []
    current_year = datetime.now(timezone.utc).year
    min_year = GDELT_MIN_YEAR
    max_year = max(GDELT_MIN_YEAR, current_year)

    if safe_start < min_year:
        warnings.append(f"gdelt_start_year_clipped:{safe_start}->{min_year}")
        safe_start = min_year
    if safe_end > max_year:
        warnings.append(f"gdelt_end_year_clipped:{safe_end}->{max_year}")
        safe_end = max_year
    if safe_start > safe_end:
        safe_start = safe_end
    if safe_end - safe_start + 1 > GDELT_MAX_QUERY_SPAN_YEARS:
        clipped_start = safe_end - GDELT_MAX_QUERY_SPAN_YEARS + 1
        warnings.append(f"gdelt_window_clipped:{safe_start}->{clipped_start}")
        safe_start = clipped_start
    return safe_start, safe_end, warnings


def _to_dt(year: int, is_end: bool = False) -> str:
    if is_end:
        return f"{int(year):04d}1231235959"
    return f"{int(year):04d}0101000000"


def _parse_date(raw: Any) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[0]
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if len(text) >= 10:
        return text[:10]
    return None


def _timeline_points(payload: dict[str, Any]) -> list[dict[str, Any]]:
    timeline = payload.get("timeline") or []
    rows = timeline[0].get("data") if timeline and isinstance(timeline[0], dict) else []
    points: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        dt = _parse_date(row.get("date"))
        if not dt:
            continue
        try:
            value = float(row.get("value") or 0.0)
            norm = float(row.get("norm") or 0.0)
        except Exception:
            continue
        normalized = float(value / norm) if norm > 0 else float(value)
        points.append({"date": dt, "value": normalized, "raw_value": value, "raw_norm": norm})
    return points


def _merge_timeline_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    by_date: dict[str, dict[str, float]] = {}
    for payload in payloads:
        for point in _timeline_points(payload):
            dt = str(point.get("date") or "")
            if not dt:
                continue
            bucket = by_date.setdefault(
                dt,
                {
                    "raw_value_sum": 0.0,
                    "raw_norm_sum": 0.0,
                    "normalized_sum": 0.0,
                    "count": 0.0,
                },
            )
            bucket["raw_value_sum"] += float(point.get("raw_value") or 0.0)
            bucket["raw_norm_sum"] += float(point.get("raw_norm") or 0.0)
            bucket["normalized_sum"] += float(point.get("value") or 0.0)
            bucket["count"] += 1.0

    rows: list[dict[str, Any]] = []
    for dt in sorted(by_date.keys()):
        bucket = by_date[dt]
        raw_value_sum = float(bucket["raw_value_sum"])
        raw_norm_sum = float(bucket["raw_norm_sum"])
        if raw_norm_sum > 0:
            rows.append({"date": dt, "value": raw_value_sum, "norm": raw_norm_sum})
            continue
        count = max(1.0, float(bucket["count"]))
        rows.append({"date": dt, "value": float(bucket["normalized_sum"]) / count, "norm": 0.0})
    return {"timeline": [{"data": rows}]}


def _safe_cache_name(variant: str) -> str:
    safe = _SAFE_NAME_RE.sub("_", str(variant or "").strip().lower()).strip("_")
    return safe[:48] or "term"


def _cache_file(variant: str, start_year: int, end_year: int) -> Path:
    digest = hashlib.sha1(f"{variant}|{start_year}|{end_year}".encode("utf-8")).hexdigest()[:12]
    return _CACHE_ROOT / f"{_safe_cache_name(variant)}-{start_year}-{end_year}-{digest}.json"


def _load_cached_timeline(variant: str, start_year: int, end_year: int) -> dict[str, Any] | None:
    path = _cache_file(variant, start_year, end_year)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _save_cached_timeline(variant: str, start_year: int, end_year: int, payload: dict[str, Any]) -> None:
    try:
        _CACHE_ROOT.mkdir(parents=True, exist_ok=True)
        path = _cache_file(variant, start_year, end_year)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        return


def _throttle() -> None:
    global _LAST_REQUEST_AT
    with _REQUEST_LOCK:
        now = time.monotonic()
        wait_seconds = max(0.0, GDELT_MIN_REQUEST_INTERVAL_SECONDS - (now - _LAST_REQUEST_AT))
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        _LAST_REQUEST_AT = time.monotonic()


def _retry_after_seconds(raw: Any) -> float:
    try:
        value = float(str(raw or "").strip())
    except Exception:
        return 0.0
    return max(0.0, value)


def _fetch_variant_timeline_request(
    variant: str,
    start_year: int,
    end_year: int,
    *,
    mode: str,
    timeout_seconds: int,
    max_retries: int,
) -> dict[str, Any]:
    last_error: Exception | None = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "misspelling-platform/1.0",
    }
    for attempt in range(max(1, int(max_retries))):
        try:
            _throttle()
            response = requests.get(
                GDELT_DOC_API,
                params={
                    "query": variant,
                    "mode": mode,
                    "format": "json",
                    "TIMELINESMOOTH": 0,
                    "startdatetime": _to_dt(start_year, is_end=False),
                    "enddatetime": _to_dt(end_year, is_end=True),
                },
                headers=headers,
                timeout=timeout_seconds,
            )
        except Exception as exc:
            last_error = exc
            if attempt < max_retries - 1:
                time.sleep(GDELT_MIN_REQUEST_INTERVAL_SECONDS + (attempt * GDELT_RETRY_BACKOFF_BASE_SECONDS))
                continue
            break

        if response.status_code == 429:
            last_error = RuntimeError(f"gdelt_rate_limited:{variant}")
            if attempt < max_retries - 1:
                retry_after = _retry_after_seconds(response.headers.get("Retry-After"))
                wait_seconds = max(
                    GDELT_MIN_REQUEST_INTERVAL_SECONDS,
                    retry_after,
                ) + (attempt * GDELT_RETRY_BACKOFF_BASE_SECONDS)
                time.sleep(wait_seconds)
                continue
            break

        try:
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and payload.get("error"):
                raise RuntimeError(str(payload.get("error")))
            if not isinstance(payload, dict):
                raise RuntimeError("gdelt_invalid_payload")
            if "_meta" not in payload or not isinstance(payload.get("_meta"), dict):
                payload["_meta"] = {}
            payload["_meta"]["timeline_mode"] = mode
            return payload
        except Exception as exc:
            last_error = exc
            if attempt < max_retries - 1:
                time.sleep(GDELT_MIN_REQUEST_INTERVAL_SECONDS + (attempt * GDELT_RETRY_BACKOFF_BASE_SECONDS))
                continue
            break

    if last_error is not None:
        raise RuntimeError(f"gdelt_fetch_failed:{variant}:{mode}:{last_error}") from last_error
    raise RuntimeError(f"gdelt_fetch_failed:{variant}:{mode}")


def _fetch_variant_timeline_live(
    variant: str,
    start_year: int,
    end_year: int,
    *,
    timeout_seconds: int,
    max_retries: int,
    allow_chunk_fallback: bool,
    max_chunk_requests: int,
) -> dict[str, Any]:
    last_error: Exception | None = None

    for mode in ("TimelineVolRaw", "TimelineVol"):
        retries = max_retries if mode == "TimelineVolRaw" else max(1, max_retries - 1)
        try:
            return _fetch_variant_timeline_request(
                variant=variant,
                start_year=start_year,
                end_year=end_year,
                mode=mode,
                timeout_seconds=timeout_seconds,
                max_retries=retries,
            )
        except Exception as exc:
            last_error = exc

    if not allow_chunk_fallback:
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"gdelt_fetch_failed:{variant}")

    chunk_payloads: list[dict[str, Any]] = []
    chunk_errors: list[str] = []
    cursor = int(start_year)
    chunk_requests = 0
    while cursor <= int(end_year):
        if chunk_requests >= max(1, int(max_chunk_requests)):
            chunk_errors.append("chunk_budget_exhausted")
            break
        chunk_end = min(int(end_year), cursor + GDELT_CHUNK_FALLBACK_SPAN_YEARS - 1)
        chunk_payload: dict[str, Any] | None = None
        for mode in ("TimelineVolRaw", "TimelineVol"):
            retries = max(1, max_retries - 1)
            try:
                chunk_payload = _fetch_variant_timeline_request(
                    variant=variant,
                    start_year=cursor,
                    end_year=chunk_end,
                    mode=mode,
                    timeout_seconds=timeout_seconds,
                    max_retries=retries,
                )
                break
            except Exception as exc:
                last_error = exc
                if mode == "TimelineVol":
                    chunk_errors.append(f"{cursor}-{chunk_end}:{exc}")
        chunk_requests += 1
        if isinstance(chunk_payload, dict):
            chunk_payloads.append(chunk_payload)
        cursor = chunk_end + 1

    if chunk_payloads:
        merged = _merge_timeline_payloads(chunk_payloads)
        merged["_meta"] = {
            "timeline_mode": "chunked",
            "chunk_count": len(chunk_payloads),
            "chunk_failures": chunk_errors,
        }
        if last_error is not None:
            merged["_meta"]["direct_error"] = str(last_error)
        return merged

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"gdelt_fetch_failed:{variant}")


def _fetch_variant_timeline(
    variant: str,
    start_year: int,
    end_year: int,
    *,
    is_canonical: bool,
) -> tuple[dict[str, Any], str]:
    cached = _load_cached_timeline(variant, start_year, end_year)
    if isinstance(cached, dict):
        return cached, "cache"
    payload = _fetch_variant_timeline_live(
        variant,
        start_year,
        end_year,
        timeout_seconds=GDELT_TIMEOUT_SECONDS_CANONICAL if is_canonical else GDELT_TIMEOUT_SECONDS_VARIANT,
        max_retries=GDELT_MAX_RETRIES_CANONICAL if is_canonical else GDELT_MAX_RETRIES_VARIANT,
        allow_chunk_fallback=bool(is_canonical),
        max_chunk_requests=GDELT_MAX_CHUNK_REQUESTS,
    )
    _save_cached_timeline(variant, start_year, end_year, payload)
    meta = payload.get("_meta") if isinstance(payload, dict) else {}
    mode = str((meta or {}).get("timeline_mode") or "").strip()
    if mode == "chunked":
        return payload, "live_chunked"
    if mode == "TimelineVol":
        return payload, "live_timelinevol"
    return payload, "live"


def pull_gdelt_series_payload(
    word: str,
    variants: list[str] | None,
    start_year: int,
    end_year: int,
    current_user: dict | None = None,
):
    canonical = _normalize_word(word)
    if not canonical:
        raise HTTPException(status_code=400, detail="word is required")
    if int(start_year) > int(end_year):
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")

    review = review_misspelling_variants(canonical, variants or [])
    selected_variants = [str(v) for v in (review.get("accepted_variants") or [])]
    warnings = [str(item) for item in (review.get("warnings") or [])]
    if len(selected_variants) > GDELT_MAX_VARIANTS:
        warnings.append(f"gdelt_variant_count_clipped:{len(selected_variants)}->{GDELT_MAX_VARIANTS}")
        selected_variants = selected_variants[:GDELT_MAX_VARIANTS]

    owner_user_id = _owner_id(current_user)
    clipped_start, clipped_end, clip_warnings = _clip_window(int(start_year), int(end_year))
    warnings.extend(clip_warnings)
    all_terms = [canonical, *[value for value in selected_variants if value != canonical]]
    started = datetime.now(timezone.utc)
    started_mono = time.monotonic()

    series: list[dict[str, Any]] = []
    total_points = 0
    error_reason: str | None = None
    failed_variants: list[dict[str, str]] = []
    fetch_modes: list[str] = []
    canonical_points: list[dict[str, Any]] | None = None

    for index, variant in enumerate(all_terms):
        if index > 0 and (time.monotonic() - started_mono) >= GDELT_TOTAL_PULL_BUDGET_SECONDS:
            warnings.append(f"gdelt_variant_skipped_budget:{variant}")
            series.append({"variant": variant, "points": []})
            continue
        try:
            payload, fetch_mode = _fetch_variant_timeline(
                variant,
                clipped_start,
                clipped_end,
                is_canonical=(index == 0),
            )
            fetch_modes.append(fetch_mode)
            if fetch_mode == "live_timelinevol":
                warnings.append(f"gdelt_mode_fallback_timelinevol:{variant}")
            if fetch_mode == "live_chunked":
                warnings.append(f"gdelt_chunked_fallback:{variant}")
            payload_meta = payload.get("_meta") if isinstance(payload, dict) else {}
            chunk_failures = payload_meta.get("chunk_failures") if isinstance(payload_meta, dict) else None
            if isinstance(chunk_failures, list) and chunk_failures:
                warnings.append(f"gdelt_chunked_partial:{variant}:{len(chunk_failures)}")
            points = _timeline_points(payload)
            if not points:
                warnings.append(f"gdelt_variant_no_points:{variant}")
            if index == 0:
                canonical_points = points
            series.append({"variant": variant, "points": points})
            total_points += len(points)
        except Exception as exc:
            if error_reason is None:
                error_reason = str(exc)
            failed_variants.append({"variant": variant, "error": str(exc)})
            warnings.append(f"gdelt_variant_pull_failed:{variant}")
            series.append({"variant": variant, "points": []})
            if index == 0:
                canonical_points = []

    if not canonical_points:
        warnings.append("gdelt_missing_canonical_signal")
        series = [{"variant": variant, "points": []} for variant in all_terms] or [{"variant": canonical, "points": []}]
        total_points = 0

    if total_points == 0:
        warnings.append("gdelt_pull_failed")
    elif failed_variants:
        warnings.append("gdelt_partial_pull_failed")
    if total_points == 0 and not failed_variants:
        warnings.append("gdelt_no_points_returned")

    cache_hit = bool(fetch_modes) and all(mode == "cache" for mode in fetch_modes)

    insert_audit_log(
        action="DATA_PULL_GDELT",
        actor_user_id=owner_user_id,
        target_type="gdelt",
        target_id=canonical,
        meta={
            "ok": total_points > 0,
            "cache_hit": cache_hit,
            "fetch_modes": fetch_modes,
            "variants": len(all_terms),
            "series": len(series),
            "points": total_points,
            "failed_variants": failed_variants,
            "start_year": clipped_start,
            "end_year": clipped_end,
            "latency_ms": int((datetime.now(timezone.utc) - started).total_seconds() * 1000),
            "warnings": warnings,
            "error": error_reason,
        },
    )

    unique_warnings: list[str] = []
    for item in warnings:
        msg = str(item or "").strip()
        if msg and msg not in unique_warnings:
            unique_warnings.append(msg)

    return {
        "word": canonical,
        "source": "GDELT",
        "cache_hit": cache_hit,
        "granularity": "day",
        "unit": "normalized_news_volume",
        "series": series,
        "point_count": total_points,
        "series_ids": [],
        "series_id": None,
        "warnings": unique_warnings,
        "error_reason": error_reason,
        "failed_variants": failed_variants,
        "rejected_variants": review.get("rejected_variants") or [],
        "filter_policy": review.get("filter_policy"),
        "start_year": clipped_start,
        "end_year": clipped_end,
    }
