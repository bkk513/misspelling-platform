from fastapi import APIRouter, HTTPException

from ..services.gbnc_service import (
    get_gbnc_series_payload,
    get_gbnc_series_points_payload,
    pull_gbnc_series_to_db,
)
from ..services.lexicon_service import get_or_suggest_variants

router = APIRouter()


@router.post("/api/data/gbnc/pull")
def pull_gbnc(
    word: str,
    start_year: int = 1800,
    end_year: int = 2019,
    corpus: str = "eng_2019",
    smoothing: int = 3,
):
    try:
        variants_payload = get_or_suggest_variants(word, 8)
        result = pull_gbnc_series_to_db(
            term=word,
            variants=list(variants_payload.get("variants") or []),
            start_year=start_year,
            end_year=end_year,
            corpus=corpus,
            smoothing=smoothing,
            actor="api",
        )
        result["variant_source"] = variants_payload.get("source")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"gbnc pull failed: {exc}")


@router.get("/api/data/gbnc/series/{series_id}")
def get_gbnc_series(series_id: int):
    payload = get_gbnc_series_payload(series_id)
    if not payload:
        raise HTTPException(status_code=404, detail="series not found")
    return payload


@router.get("/api/data/gbnc/series/{series_id}/points")
def get_gbnc_series_points(series_id: int, variant: str | None = None):
    payload = get_gbnc_series_points_payload(series_id)
    if variant and str(variant).strip().lower() != str((get_gbnc_series_payload(series_id) or {}).get("variant", "")).lower():
        raise HTTPException(status_code=404, detail="variant not found for series")
    return payload

