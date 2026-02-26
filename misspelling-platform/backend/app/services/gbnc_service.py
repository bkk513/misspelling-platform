import hashlib
import json
from datetime import date

from ..db.data_sources_repo import ensure_data_source_configured
from ..db.time_series_repo import (
    create_series,
    ensure_term,
    ensure_variant,
    find_series_by_cache_key,
    get_series_with_points,
    insert_series_points,
)
from ..integrations.gbnc import fetch_gbnc_series
from .audit_log_service import record_audit, record_audit_error


def _norm(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _dedupe_terms(term: str, variants: list[str]) -> list[str]:
    out: list[str] = []
    seen = set()
    for raw in [term] + list(variants or []):
        clean = _norm(str(raw))
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def _gbnc_cache_key(term: str, variant: str, start_year: int, end_year: int, corpus: str, smoothing: int) -> str:
    raw = json.dumps(
        {
            "source": "gbnc",
            "term": _norm(term),
            "variant": _norm(variant),
            "start_year": int(start_year),
            "end_year": int(end_year),
            "corpus": str(corpus),
            "smoothing": int(smoothing),
        },
        sort_keys=True,
        ensure_ascii=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def pull_gbnc_series_to_db(
    *,
    term: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str = "eng_2019",
    smoothing: int = 3,
    actor: str = "user",
):
    names = _dedupe_terms(term, variants)
    if not names:
        raise ValueError("term is required")
    y0, y1, sm = int(start_year), int(end_year), int(smoothing)
    cache_keys = {name: _gbnc_cache_key(names[0], name, y0, y1, corpus, sm) for name in names}
    cached_rows = {name: find_series_by_cache_key(cache_keys[name]) for name in names}
    if all(rows and int(rows[0].get("point_count") or 0) > 0 for rows in cached_rows.values()):
        record_audit("GBNC_CACHE_HIT", "gbnc", names[0], {"term": names[0], "variants": names, "corpus": corpus, "start_year": y0, "end_year": y1})
        return {
            "source": "gbnc",
            "cached": True,
            "term": names[0],
            "variants": names,
            "items": [{"series_id": int(rows[0]["series_id"]), "variant": name, "point_count": int(rows[0]["point_count"])} for name, rows in cached_rows.items()],
        }

    try:
        fetched = fetch_gbnc_series(names[0], names[1:], y0, y1, corpus, sm)
    except Exception as exc:
        record_audit_error("gbnc_pull", "gbnc fetch failed", {"term": names[0], "corpus": corpus, "error": str(exc)[:300]})
        raise

    source_id = ensure_data_source_configured("gbnc", "year", {"provider": "google-ngram-viewer"})
    term_id = ensure_term(names[0], category="custom", language="en")
    inserted_items = []
    for series in fetched.get("series", []):
        variant = _norm(str(series.get("variant") or ""))
        if not variant:
            continue
        points_in = series.get("points") or []
        if not isinstance(points_in, list) or not points_in:
            continue
        variant_id = None if variant == names[0] else ensure_variant(term_id, variant, variant_type="external")
        cache_key = cache_keys.get(variant) or _gbnc_cache_key(names[0], variant, y0, y1, corpus, sm)
        ts_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="year",
            window_start=date(y0, 1, 1),
            window_end=date(y1, 12, 31),
            units=str(fetched.get("unit") or "relative_frequency"),
            meta={
                "source_kind": "external",
                "provider": "google-ngram-viewer",
                "gbnc": True,
                "gbnc_cache_key": cache_key,
                "term": names[0],
                "variant": variant,
                "corpus": corpus,
                "smoothing": sm,
                "query": fetched.get("query"),
                "request_url": fetched.get("request_url"),
            },
        )
        points = [{"t": date(int(p["year"]), 1, 1), "value": float(p["value"])} for p in points_in if "year" in p and "value" in p]
        insert_series_points(ts_id, points)
        inserted_items.append({"series_id": ts_id, "variant": variant, "point_count": len(points)})

    record_audit(
        "GBNC_PULL_SUCCESS",
        "gbnc",
        names[0],
        {"term": names[0], "variants": [i["variant"] for i in inserted_items], "count": len(inserted_items), "corpus": corpus, "start_year": y0, "end_year": y1, "actor": actor},
    )
    return {"source": "gbnc", "cached": False, "term": names[0], "variants": names, "items": inserted_items, "meta": fetched}


def get_gbnc_series_payload(series_id: int):
    meta, points = get_series_with_points(int(series_id))
    if not meta:
        return None
    meta_json = meta.get("meta_json")
    if isinstance(meta_json, str):
        try:
            meta_json = json.loads(meta_json)
        except Exception:
            meta_json = {"raw": meta_json}
    return {
        "series_id": int(meta["series_id"]),
        "source": meta["source_name"],
        "word": meta["canonical"],
        "variant": meta["variant"],
        "granularity": meta["granularity"],
        "units": meta["units"],
        "window_start": meta["window_start"],
        "window_end": meta["window_end"],
        "updated_at": meta.get("updated_at"),
        "point_count": len(points),
        "meta": meta_json,
    }


def get_gbnc_series_points_payload(series_id: int):
    _, points = get_series_with_points(int(series_id))
    return {"series_id": int(series_id), "items": [{"time": str(r["t"]), "value": float(r["value"])} for r in points]}
