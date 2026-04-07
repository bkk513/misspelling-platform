"""文件说明：GBNC 领域服务模块，负责面向业务层封装 GBNC 数据拉取与响应结构。"""

import hashlib
import random
from typing import Any

from ..db.audit_logs_repo import insert_audit_log
from ..integrations.gbnc import fetch_gbnc_series


def _seed(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")


def _stub_series(term: str, variants: list[str], start_year: int, end_year: int):
    all_terms: list[str] = []
    for raw in [term, *(variants or [])]:
        v = str(raw or "").strip().lower()
        if v and v not in all_terms:
            all_terms.append(v)
    years = list(range(int(start_year), int(end_year) + 1))
    out = []
    for idx, variant in enumerate(all_terms):
        rng = random.Random(_seed(f"{variant}:{start_year}:{end_year}"))
        points = []
        base = max(0.0000001, 0.00001 * (1.0 - (idx * 0.08)))
        for y in years:
            drift = (y - years[0]) / max(1, len(years) - 1)
            noise = (rng.random() - 0.5) * base * 0.25
            value = max(0.0, base * (0.8 + drift * 0.4) + noise)
            points.append({"year": y, "value": float(value)})
        out.append({"variant": variant, "points": points})
    return out


def pull_gbnc_with_fallback(
    term: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    actor_user_id: int | None = None,
):
    try:
        payload = fetch_gbnc_series(term, variants, start_year, end_year, corpus, smoothing)
        points = sum(len(item.get("points") or []) for item in payload.get("series") or [])
        insert_audit_log(
            action="DATA_PULL_GBNC",
            actor_user_id=actor_user_id,
            target_type="gbnc",
            target_id=str(term),
            meta={
                "ok": True,
                "corpus": corpus,
                "smoothing": smoothing,
                "start_year": start_year,
                "end_year": end_year,
                "variants": len(variants or []),
                "series": len(payload.get("series") or []),
                "points": points,
                "latency_ms": payload.get("latency_ms"),
                "warnings": payload.get("warnings") or [],
            },
        )
        return {
            "source": "GBNC",
            "corpus": corpus,
            "smoothing": int(smoothing),
            "unit": payload.get("unit") or "relative_frequency",
            "series": payload.get("series") or [],
            "warnings": payload.get("warnings") or [],
            "error_reason": None,
            "latency_ms": payload.get("latency_ms"),
        }
    except Exception as exc:
        error_reason = str(exc)
        insert_audit_log(
            action="DATA_PULL_GBNC",
            actor_user_id=actor_user_id,
            target_type="gbnc",
            target_id=str(term),
            meta={
                "ok": False,
                "error": error_reason,
                "corpus": corpus,
                "smoothing": smoothing,
                "start_year": start_year,
                "end_year": end_year,
            },
        )
        return {
            "source": "STUB",
            "corpus": corpus,
            "smoothing": int(smoothing),
            "unit": "relative_frequency",
            "series": _stub_series(term, variants, start_year, end_year),
            "warnings": ["gbnc_fallback_stub"],
            "error_reason": error_reason,
            "latency_ms": None,
        }


def build_provenance(task_id: str, gbnc_payload: dict[str, Any], params: dict[str, Any]):
    series = gbnc_payload.get("series") or []
    points_count = sum(len(item.get("points") or []) for item in series)
    return {
        "task_id": task_id,
        "source": gbnc_payload.get("source"),
        "corpus": gbnc_payload.get("corpus"),
        "smoothing": gbnc_payload.get("smoothing"),
        "params": params,
        "series_count": len(series),
        "points_count": points_count,
        "warnings": gbnc_payload.get("warnings") or [],
        "error_reason": gbnc_payload.get("error_reason"),
        "latency_ms": gbnc_payload.get("latency_ms"),
    }
