import hashlib
import math
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ..db.data_sources_repo import ensure_data_source
from ..db.tasks_repo import get_task_owner
from ..db.time_series_repo import (
    create_series,
    delete_series_by_ids,
    ensure_term,
    ensure_variant,
    get_series_points_for_task,
    insert_series_points,
    list_series,
    list_series_by_task,
    list_series_owners,
)


def _seed(task_id: str, label: str) -> int:
    return int.from_bytes(hashlib.sha256(f"{task_id}:{label}".encode("utf-8")).digest()[:8], "big")


def _build_points(task_id: str, label: str, count: int, scale: float):
    rng = random.Random(_seed(task_id, label))
    start = date(2020, 1, 1)
    points = []
    for i in range(count):
        trend = 6.0 + (i * 0.12 if i < count * 0.55 else count * 0.12 * 0.55 + (i - count * 0.55) * 0.02)
        wobble = math.sin(i / 4.5 + (rng.random() * 0.7)) * 1.8 + math.cos(i / 11.0) * 0.8
        noise = rng.uniform(-0.45, 0.45)
        value = max(0.01, (trend + wobble + noise) * scale)
        points.append({"t": start + timedelta(days=i), "value": round(value, 6)})
    return points


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_guest_key(guest_key: str | None) -> str:
    return str(guest_key or "").strip()[:64]


def _is_today_utc(value: Any) -> bool:
    today = datetime.now(timezone.utc).date()
    if value is None:
        return False
    if hasattr(value, "date"):
        try:
            return value.date() == today
        except Exception:
            pass
    text_value = str(value)
    if len(text_value) >= 10:
        try:
            return datetime.strptime(text_value[:10], "%Y-%m-%d").date() == today
        except Exception:
            return False
    return False


def _persist_stub_bundle(task_id: str, task_type: str, canonical: str, point_count: int):
    owner_user_id = get_task_owner(task_id)
    source_id = ensure_data_source()
    term_id = ensure_term(canonical=canonical, category="custom", language="en", owner_user_id=owner_user_id)
    variants = [
        ("correct", None, 1.00),
        ("misspelling_1", ensure_variant(term_id, f"{canonical}e", owner_user_id=owner_user_id), 0.68),
        (
            "misspelling_2",
            ensure_variant(term_id, f"{canonical}{canonical[-1:] or 'x'}", owner_user_id=owner_user_id),
            0.52,
        ),
    ]
    for variant_label, variant_id, scale in variants:
        points = _build_points(task_id, variant_label, point_count, scale)
        series_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="day",
            window_start=points[0]["t"],
            window_end=points[-1]["t"],
            units="relative_freq",
            meta={
                "stub": True,
                "task_id": task_id,
                "task_type": task_type,
                "canonical": canonical,
                "variant": variant_label,
            },
            owner_user_id=owner_user_id,
        )
        insert_series_points(series_id, points)


def persist_word_analysis_stub_timeseries(task_id: str, word: str):
    _persist_stub_bundle(task_id, "word-analysis", (word or "word").lower(), 60)


def persist_simulation_stub_timeseries(task_id: str, n: int, steps: int):
    count = max(30, min(90, int(steps or 0) if steps is not None else 60))
    canonical = f"sim-{str(task_id)[:8]}"
    _persist_stub_bundle(task_id, "simulation-run", canonical, count)


def get_task_timeseries_summary(task_id: str, current_user: dict | None = None, guest_key: str | None = None):
    rows = list_series_by_task(
        task_id,
        owner_user_id=_owner_id(current_user),
        include_all=_is_admin(current_user),
        guest_key=guest_key,
    )
    if not rows:
        return {"task_id": task_id, "items": [], "variants": [], "point_count": 0}
    items = [dict(r) for r in rows]
    return {
        "task_id": task_id,
        "source": items[0]["source_name"],
        "word": items[0]["canonical"],
        "granularity": items[0]["granularity"],
        "variants": [r["variant"] for r in items],
        "point_count": int(sum(int(r["point_count"]) for r in items)),
        "items": items,
    }


def get_task_timeseries_points(
    task_id: str,
    variant: str = "correct",
    current_user: dict | None = None,
    guest_key: str | None = None,
):
    series_id, rows = get_series_points_for_task(
        task_id,
        variant or "correct",
        owner_user_id=_owner_id(current_user),
        include_all=_is_admin(current_user),
        guest_key=guest_key,
    )
    return {
        "task_id": task_id,
        "variant": variant or "correct",
        "series_id": series_id,
        "items": [{"time": str(r["t"]), "value": float(r["value"])} for r in rows],
    }


def list_series_catalog_payload(
    limit: int = 100,
    current_user: dict | None = None,
    scope: str | None = None,
    guest_key: str | None = None,
):
    safe_limit = max(1, min(int(limit), 500))
    include_all = _is_admin(current_user) and scope == "all"
    owner_user_id = _owner_id(current_user)
    if _is_admin(current_user) and scope == "guest":
        owner_user_id = None
        include_all = False
    rows = list_series(limit=safe_limit, owner_user_id=owner_user_id, include_all=include_all, guest_key=guest_key)
    return {"items": [dict(r) for r in rows]}


def bulk_delete_series_payload(series_ids: list[int], current_user: dict | None = None, guest_key: str | None = None):
    safe_ids = []
    for value in series_ids:
        try:
            sid = int(value)
        except Exception:
            continue
        if sid > 0:
            safe_ids.append(sid)

    if not safe_ids:
        return {"requested": 0, "deleted": [], "skipped": []}

    owner_user_id = _owner_id(current_user)
    allow_all = _is_admin(current_user)
    owners = list_series_owners(safe_ids)
    allowed: list[int] = []
    skipped: list[dict[str, str]] = []

    for row in owners:
        sid = int(row["id"])
        owner = row["owner_user_id"]
        if allow_all:
            allowed.append(sid)
            continue
        if owner_user_id is None:
            row_guest_key = _normalize_guest_key(row.get("guest_key"))
            row_status = str(row.get("task_status") or "").upper()
            if (
                owner is None
                and row_guest_key
                and row_guest_key == _normalize_guest_key(guest_key)
                and _is_today_utc(row.get("task_created_at"))
                and row_status != "DELETED"
            ):
                allowed.append(sid)
            else:
                skipped.append({"series_id": str(sid), "reason": "FORBIDDEN"})
            continue
        if owner == owner_user_id:
            allowed.append(sid)
        else:
            skipped.append({"series_id": str(sid), "reason": "FORBIDDEN"})

    if allowed:
        delete_series_by_ids(allowed)
    existing_ids = {int(r["id"]) for r in owners}
    for sid in safe_ids:
        if sid not in existing_ids:
            skipped.append({"series_id": str(sid), "reason": "NOT_FOUND"})

    return {"requested": len(safe_ids), "deleted": allowed, "skipped": skipped}


def persist_word_analysis_external_series(
    task_id: str,
    word: str,
    payload: dict[str, Any],
):
    owner_user_id = get_task_owner(task_id)
    source_name = "GBNC" if str(payload.get("source", "")).upper() == "GBNC" else "stub_local"
    source_id = ensure_data_source(name=source_name, granularity="year")
    canonical = (word or "word").strip().lower()
    term_id = ensure_term(canonical=canonical, category="custom", language="en", owner_user_id=owner_user_id)

    series_rows = payload.get("series") or []
    if not series_rows:
        series_rows = [{"variant": canonical, "points": []}]

    total_points = 0
    variants: list[str] = []
    for item in series_rows:
        variant = str(item.get("variant") or canonical).strip().lower() or canonical
        points_raw = item.get("points") or []
        variants.append(variant)
        variant_id = None if variant == canonical else ensure_variant(term_id, variant, owner_user_id=owner_user_id)

        if points_raw:
            years = [int(p.get("year")) for p in points_raw if p.get("year") is not None]
            window_start = date(min(years), 1, 1)
            window_end = date(max(years), 1, 1)
        else:
            now_year = date.today().year
            window_start = date(now_year, 1, 1)
            window_end = date(now_year, 1, 1)

        series_id = create_series(
            term_id=term_id,
            variant_id=variant_id,
            source_id=source_id,
            granularity="year",
            window_start=window_start,
            window_end=window_end,
            units=str(payload.get("unit") or "relative_frequency"),
            meta={
                "task_id": task_id,
                "task_type": "word-analysis",
                "canonical": canonical,
                "variant": variant,
                "source": payload.get("source"),
                "warnings": payload.get("warnings") or [],
                "error_reason": payload.get("error_reason"),
            },
            owner_user_id=owner_user_id,
        )
        points = []
        for point in points_raw:
            year = point.get("year")
            if year is None:
                continue
            value = float(point.get("value") or 0.0)
            points.append({"t": date(int(year), 1, 1), "value": value})
        total_points += len(points)
        if points:
            insert_series_points(series_id, points)

    return {
        "source": payload.get("source"),
        "series_count": len(series_rows),
        "point_count": total_points,
        "variants": variants,
    }
