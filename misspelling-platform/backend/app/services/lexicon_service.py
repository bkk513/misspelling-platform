from pathlib import Path
from datetime import date
from typing import Any

from ..db.audit_logs_repo import insert_audit_log
from ..db.lexicon_repo import (
    find_term_by_word,
    get_or_create_term,
    get_term,
    list_terms,
    list_variants as list_term_variants,
    upsert_variants as upsert_term_variants,
)
from ..db.variant_cache_repo import (
    admin_delete_variant as admin_delete_cached_variant,
    admin_list_variants as admin_list_cached_variants,
    delete_variants as delete_cached_variants,
    list_variants as list_cached_variants,
    upsert_variants as upsert_cached_variants,
)
from ..providers.llm_bailian import suggest_origin_year as llm_suggest_origin_year, suggest_variants
from .external_data_service import pull_external_series_payload
from .dictionary_service import enrich_term, search_terms
from .variant_dictionary_service import suggest_from_dictionary
from .variant_review_service import review_misspelling_variants

ORIGIN_YEAR_SEED_PATH = Path(__file__).resolve().parent.parent / "assets" / "origin_year_seed.txt"
_ORIGIN_YEAR_SEEDS: dict[str, int] | None = None


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _normalize_word(word: str) -> str:
    return str(word or "").strip().lower()


def _merge_variant_warnings(*parts: Any) -> list[str]:
    warnings: list[str] = []
    for part in parts:
        if not part:
            continue
        for raw in part if isinstance(part, list) else [part]:
            msg = str(raw or "").strip()
            if msg and msg not in warnings:
                warnings.append(msg)
    return warnings


def _review_variant_rows(
    rows: list[dict[str, Any]],
    *,
    word_key: str,
    variant_key: str,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]], str | None]:
    grouped: dict[str, list[str]] = {}
    for row in rows:
        word = _normalize_word(str(row.get(word_key) or ""))
        variant = _normalize_word(str(row.get(variant_key) or ""))
        if not word or not variant:
            continue
        grouped.setdefault(word, []).append(variant)

    accepted_by_word: dict[str, set[str]] = {}
    warnings: list[str] = []
    rejected: list[dict[str, Any]] = []
    filter_policy: str | None = None

    for word, variants in grouped.items():
        review = review_misspelling_variants(word, variants)
        accepted_by_word[word] = set(str(v) for v in (review.get("accepted_variants") or []))
        filter_policy = str(review.get("filter_policy") or filter_policy or "") or filter_policy
        warnings = _merge_variant_warnings(warnings, review.get("warnings"))
        for item in review.get("rejected_variants") or []:
            row = dict(item)
            row["word"] = word
            rejected.append(row)

    filtered_rows: list[dict[str, Any]] = []
    for row in rows:
        word = _normalize_word(str(row.get(word_key) or ""))
        variant = _normalize_word(str(row.get(variant_key) or ""))
        accepted = accepted_by_word.get(word)
        if accepted is None or variant in accepted:
            filtered_rows.append(row)

    return filtered_rows, warnings, rejected, filter_policy


def _load_origin_year_seeds() -> dict[str, int]:
    global _ORIGIN_YEAR_SEEDS
    if _ORIGIN_YEAR_SEEDS is not None:
        return _ORIGIN_YEAR_SEEDS
    seeds: dict[str, int] = {}
    try:
        for raw in ORIGIN_YEAR_SEED_PATH.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            word = _normalize_word(parts[0])
            try:
                year = int(parts[1])
            except Exception:
                continue
            if word:
                seeds[word] = year
    except Exception:
        seeds = {}
    _ORIGIN_YEAR_SEEDS = seeds
    return seeds


def _infer_observed_origin_years(series_rows: list[dict[str, Any]]) -> tuple[int | None, int | None]:
    aggregate: dict[int, float] = {}
    correct_first_year: int | None = None
    for index, row in enumerate(series_rows):
        points = row.get("points") or []
        for point in points:
            try:
                raw_year = point.get("year")
                raw_date = str(point.get("date") or "").strip()
                if raw_year is not None:
                    year = int(raw_year)
                elif raw_date:
                    year = int(date.fromisoformat(raw_date[:10]).year)
                else:
                    continue
                value = float(point.get("value") or 0.0)
            except Exception:
                continue
            if value <= 0:
                continue
            aggregate[year] = aggregate.get(year, 0.0) + value
            if index == 0 and correct_first_year is None:
                correct_first_year = year
    basis_year = None
    for year in sorted(aggregate):
        if aggregate[year] > 0:
            basis_year = year
            break
    return basis_year, correct_first_year


def suggest_and_cache_variants(
    word: str,
    k: int = 12,
    current_user: dict | None = None,
    persist: bool = True,
    prefer_cache: bool = True,
):
    normalized_word = _normalize_word(word)
    term = find_term_by_word(normalized_word)
    owner_user_id = _owner_id(current_user)

    dictionary_hit = suggest_from_dictionary(word=normalized_word, k=k)
    if dictionary_hit.get("found"):
        term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
        review = review_misspelling_variants(normalized_word, [str(v) for v in (dictionary_hit.get("variants") or [])])
        variants = [str(v) for v in (review.get("accepted_variants") or [])]
        warnings = _merge_variant_warnings(review.get("warnings"))
        if not variants:
            dictionary_hit = {"found": False}
        else:
            if persist and owner_user_id is not None:
                upsert_cached_variants(owner_user_id, normalized_word, variants, source="dictionary")
                upsert_term_variants(int(term_id), variants, source="dictionary", owner_user_id=owner_user_id)
            insert_audit_log(
                action="LEXICON_VARIANT_SUGGEST",
                actor_user_id=owner_user_id,
                target_type="term",
                target_id=str(term_id),
                meta={
                    "word": normalized_word,
                    "variants_count": len(variants),
                    "source": "dictionary",
                    "dictionary_path": dictionary_hit.get("dictionary_path"),
                    "warnings": warnings,
                    "rejected_variants": review.get("rejected_variants") or [],
                    "persist": bool(persist),
                    "prefer_cache": bool(prefer_cache),
                },
            )
            return {
                "word": normalized_word,
                "variants": variants,
                "accepted_variants": variants,
                "rejected_variants": review.get("rejected_variants") or [],
                "filter_policy": review.get("filter_policy"),
                "source": "dictionary",
                "warnings": warnings,
                "llm_error": None,
                "term_id": int(term_id),
            }

    if prefer_cache and owner_user_id is not None:
        cached = list_cached_variants(owner_user_id, word=normalized_word, limit=max(k, 200))
        review = review_misspelling_variants(normalized_word, [str(v["variant"]) for v in cached])
        cached_values = [str(v) for v in (review.get("accepted_variants") or [])]
        if cached_values:
            term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
            return {
                "word": normalized_word,
                "variants": cached_values[:k],
                "accepted_variants": cached_values[:k],
                "rejected_variants": review.get("rejected_variants") or [],
                "filter_policy": review.get("filter_policy"),
                "source": "cache",
                "warnings": _merge_variant_warnings(review.get("warnings")),
                "llm_error": None,
                "term_id": int(term_id),
            }

    suggested = suggest_variants(normalized_word, k=k, actor_user_id=owner_user_id)
    review = review_misspelling_variants(normalized_word, suggested["variants"])
    accepted_variants = [str(v) for v in (review.get("accepted_variants") or [])]
    merged_warnings = _merge_variant_warnings(suggested.get("warnings"), review.get("warnings"))
    term_id = term["id"] if term else get_or_create_term(normalized_word, owner_user_id=owner_user_id)
    if persist and owner_user_id is not None:
        upsert_cached_variants(owner_user_id, normalized_word, accepted_variants, source=str(suggested["source"]))
        upsert_term_variants(
            int(term_id),
            accepted_variants,
            source=str(suggested["source"]),
            owner_user_id=owner_user_id,
        )
    insert_audit_log(
        action="LEXICON_VARIANT_SUGGEST",
        actor_user_id=owner_user_id,
        target_type="term",
        target_id=str(term_id),
        meta={
            "word": normalized_word,
            "variants_count": len(accepted_variants),
            "source": suggested["source"],
            "warnings": merged_warnings,
            "rejected_variants": review.get("rejected_variants") or [],
            "persist": bool(persist),
            "prefer_cache": bool(prefer_cache),
        },
    )
    return {
        "word": normalized_word,
        "variants": accepted_variants,
        "accepted_variants": accepted_variants,
        "rejected_variants": review.get("rejected_variants") or [],
        "filter_policy": review.get("filter_policy"),
        "source": suggested["source"],
        "warnings": merged_warnings,
        "llm_error": suggested.get("llm_error"),
        "term_id": int(term_id),
    }


def suggest_origin_year_payload(
    word: str,
    variants: list[str] | None = None,
    start_year: int = 1500,
    end_year: int = 2019,
    corpus: str = "eng_2019",
    smoothing: int = 0,
    data_source: str = "gbnc",
    current_user: dict | None = None,
):
    normalized_word = _normalize_word(word)
    review = review_misspelling_variants(normalized_word, variants or [])
    cleaned_variants = [str(v) for v in (review.get("accepted_variants") or [])]
    seeds = _load_origin_year_seeds()
    seed_year = seeds.get(normalized_word)
    basis_year = seed_year
    correct_first_year: int | None = None
    dataset_source = None
    warnings: list[str] = _merge_variant_warnings(review.get("warnings"))

    if basis_year is None:
        pulled = pull_external_series_payload(
            word=normalized_word,
            variants=cleaned_variants,
            start_year=int(start_year),
            end_year=int(end_year),
            corpus=str(corpus or "eng_2019"),
            smoothing=max(0, int(smoothing)),
            data_source=data_source,
            current_user=current_user,
        )
        dataset_source = str(pulled.get("source") or "")
        warnings.extend(str(item) for item in (pulled.get("warnings") or []))
        if dataset_source.upper() not in {"STUB", ""}:
            basis_year, correct_first_year = _infer_observed_origin_years(pulled.get("series") or [])

    llm_result = llm_suggest_origin_year(
        normalized_word,
        basis_year=basis_year,
        correct_first_year=correct_first_year,
        actor_user_id=_owner_id(current_user),
    )
    warnings.extend(str(item) for item in (llm_result.get("warnings") or []))

    suggested_year = llm_result.get("suggested_year")
    if suggested_year is None:
        suggested_year = seed_year or basis_year or correct_first_year
    if suggested_year is not None:
        suggested_year = int(suggested_year)

    if llm_result.get("suggested_year") is not None:
        source = "llm"
        reasoning = str(llm_result.get("reasoning") or "Suggested by the language model.")
    elif seed_year is not None:
        source = "seed"
        reasoning = f"Anchored to the curated paper reference year {seed_year}."
    elif basis_year is not None:
        source = "heuristic"
        reasoning = f"Anchored to the earliest observed aggregate year {basis_year} in the local corpus series."
    elif correct_first_year is not None:
        source = "heuristic"
        reasoning = f"Anchored to the earliest observed correct-spelling year {correct_first_year} in the local corpus series."
    else:
        source = "unknown"
        reasoning = "No reliable origin year could be inferred from the local references."

    if llm_result.get("reasoning") and source != "llm":
        reasoning = f"{reasoning} LLM note: {str(llm_result.get('reasoning')).strip()}"

    unique_warnings: list[str] = []
    for item in warnings:
        msg = str(item or "").strip()
        if msg and msg not in unique_warnings:
            unique_warnings.append(msg)

    insert_audit_log(
        action="LEXICON_ORIGIN_YEAR_SUGGEST",
        actor_user_id=_owner_id(current_user),
        target_type="term",
        target_id=normalized_word,
        meta={
            "word": normalized_word,
            "variants_count": len(cleaned_variants),
            "seed_year": seed_year,
            "basis_year": basis_year,
            "correct_first_year": correct_first_year,
            "llm_year": llm_result.get("suggested_year"),
            "suggested_year": suggested_year,
            "source": source,
            "dataset_source": dataset_source,
            "warnings": unique_warnings,
        },
    )
    return {
        "word": normalized_word,
        "variants": cleaned_variants,
        "suggested_year": suggested_year,
        "basis_year": basis_year,
        "correct_first_year": correct_first_year,
        "source": source,
        "dataset_source": dataset_source,
        "reasoning": reasoning,
        "warnings": unique_warnings,
        "rejected_variants": review.get("rejected_variants") or [],
        "filter_policy": review.get("filter_policy"),
    }


def list_terms_payload(limit: int = 50, q: str = "", current_user: dict | None = None):
    rows = list_terms(
        limit=limit,
        q=q,
        owner_user_id=_owner_id(current_user),
        include_all=_is_admin(current_user),
    )
    seed_hits = []
    if q:
        seed_hits = search_terms(q=q, limit=min(limit, 30))
    return {
        "items": [dict(r) for r in rows],
        "seed_hits": seed_hits,
    }


def get_term_payload(term_id: int, current_user: dict | None = None):
    term = get_term(term_id, owner_user_id=_owner_id(current_user), include_all=_is_admin(current_user))
    if not term:
        return {"id": term_id, "found": False}
    variants = list_term_variants(term_id, owner_user_id=_owner_id(current_user), include_all=_is_admin(current_user))
    variant_rows = [{**dict(v), "canonical": str(term["canonical"])} for v in variants]
    reviewed_rows, warnings, rejected_variants, filter_policy = _review_variant_rows(
        variant_rows,
        word_key="canonical",
        variant_key="variant",
    ) if variant_rows else ([], [], [], None)
    attrs = enrich_term(str(term["canonical"]))
    return {
        "id": int(term["id"]),
        "canonical": term["canonical"],
        "category": term.get("category"),
        "language": term.get("language"),
        "owner_user_id": term.get("owner_user_id"),
        "attributes": attrs,
        "variants": reviewed_rows if variants else [],
        "warnings": warnings,
        "rejected_variants": rejected_variants,
        "filter_policy": filter_policy,
    }


def enrich_term_payload(word: str, current_user: dict | None = None):
    attrs = enrich_term(word)
    term_id = get_or_create_term(word, owner_user_id=_owner_id(current_user), category="custom")
    with_meta = {
        "term_id": term_id,
        "word": word,
        "attributes": attrs,
        "source": attrs.get("source") if isinstance(attrs, dict) else "derived",
    }
    insert_audit_log(
        action="TERM_ENRICH",
        actor_user_id=_owner_id(current_user),
        target_type="term",
        target_id=str(term_id),
        meta=with_meta,
    )
    return with_meta


def list_variant_cache_payload(current_user: dict, word: str = "", limit: int = 200):
    owner_user_id = _owner_id(current_user)
    rows = list_cached_variants(
        owner_user_id=owner_user_id or 0,
        word=_normalize_word(word) if word else None,
        limit=limit,
    )
    reviewed_rows, warnings, rejected_variants, filter_policy = _review_variant_rows(
        [dict(r) for r in rows],
        word_key="word",
        variant_key="variant",
    ) if rows else ([], [], [], None)
    return {
        "items": [
            {
                "id": int(r["id"]),
                "owner_user_id": int(r["owner_user_id"]),
                "word": str(r["word"]),
                "variant": str(r["variant"]),
                "source": str(r["source"] or ""),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            }
            for r in reviewed_rows
        ],
        "warnings": warnings,
        "rejected_variants": rejected_variants,
        "filter_policy": filter_policy,
    }


def delete_variant_cache_payload(
    current_user: dict,
    ids: list[int] | None = None,
    word: str | None = None,
    variants: list[str] | None = None,
):
    owner_user_id = _owner_id(current_user)
    deleted = delete_cached_variants(
        owner_user_id=owner_user_id or 0,
        ids=ids,
        word=_normalize_word(word or "") or None,
        variants=[_normalize_word(v) for v in (variants or []) if _normalize_word(v)],
    )
    insert_audit_log(
        action="LEXICON_VARIANT_CACHE_DELETE",
        actor_user_id=owner_user_id,
        target_type="variant_cache",
        meta={
            "deleted": deleted,
            "ids_count": len(ids or []),
            "word": _normalize_word(word or "") or None,
            "variants_count": len(variants or []),
        },
    )
    return {"deleted": deleted}


def save_variant_cache_payload(
    current_user: dict,
    word: str,
    variants: list[str],
    source: str = "manual",
):
    owner_user_id = _owner_id(current_user)
    normalized_word = _normalize_word(word)
    review = review_misspelling_variants(normalized_word, variants)
    cleaned = [str(v) for v in (review.get("accepted_variants") or [])]
    if not normalized_word or not cleaned:
        return {
            "saved": 0,
            "variants": [],
            "rejected_variants": review.get("rejected_variants") or [],
            "warnings": _merge_variant_warnings(review.get("warnings")),
            "filter_policy": review.get("filter_policy"),
        }
    saved = upsert_cached_variants(
        owner_user_id=owner_user_id or 0,
        word=normalized_word,
        variants=cleaned,
        source=source or "manual",
    )
    insert_audit_log(
        action="LEXICON_VARIANT_CACHE_SAVE",
        actor_user_id=owner_user_id,
        target_type="variant_cache",
        meta={
            "word": normalized_word,
            "saved": saved,
            "source": source or "manual",
            "rejected_variants": review.get("rejected_variants") or [],
            "warnings": _merge_variant_warnings(review.get("warnings")),
        },
    )
    return {
        "saved": saved,
        "variants": cleaned,
        "rejected_variants": review.get("rejected_variants") or [],
        "warnings": _merge_variant_warnings(review.get("warnings")),
        "filter_policy": review.get("filter_policy"),
    }


def admin_list_variant_cache_payload(limit: int = 300, user_id: int | None = None, word: str | None = None):
    rows = admin_list_cached_variants(
        owner_user_id=user_id if user_id and user_id > 0 else None,
        word=_normalize_word(word or "") or None,
        limit=limit,
    )
    reviewed_rows, warnings, rejected_variants, filter_policy = _review_variant_rows(
        [dict(r) for r in rows],
        word_key="word",
        variant_key="variant",
    ) if rows else ([], [], [], None)
    return {
        "items": [
            {
                "id": int(r["id"]),
                "owner_user_id": int(r["owner_user_id"]),
                "username": str(r["username"]),
                "word": str(r["word"]),
                "variant": str(r["variant"]),
                "source": str(r["source"] or ""),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
            }
            for r in reviewed_rows
        ],
        "warnings": warnings,
        "rejected_variants": rejected_variants,
        "filter_policy": filter_policy,
    }


def admin_delete_variant_cache_payload(entry_id: int, actor_user_id: int):
    deleted = admin_delete_cached_variant(entry_id)
    insert_audit_log(
        action="ADMIN_VARIANT_CACHE_DELETE",
        actor_user_id=actor_user_id,
        target_type="variant_cache",
        target_id=str(entry_id),
        meta={"deleted": deleted},
    )
    return {"deleted": deleted > 0}
