from fastapi import APIRouter, Depends

from .auth_deps import get_optional_user
from ..services.gbnc_data_service import (
    get_gbnc_series_payload,
    get_gbnc_series_points_payload,
    pull_gbnc_series_payload,
)

router = APIRouter()


@router.post("/api/data/gbnc/pull")
def pull_gbnc(
    word: str,
    start_year: int = 1900,
    end_year: int = 2019,
    corpus: str = "eng_2019",
    smoothing: int = 3,
    variants: str | None = None,
    current_user=Depends(get_optional_user),
):
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    return pull_gbnc_series_payload(
        word=word,
        variants=selected_variants,
        start_year=int(start_year),
        end_year=int(end_year),
        corpus=corpus,
        smoothing=int(smoothing),
        current_user=current_user,
    )


@router.get("/api/data/gbnc/series/{series_id}")
def gbnc_series(series_id: int, current_user=Depends(get_optional_user)):
    return get_gbnc_series_payload(series_id=series_id, current_user=current_user)


@router.get("/api/data/gbnc/series/{series_id}/points")
def gbnc_series_points(series_id: int, variant: str | None = None, current_user=Depends(get_optional_user)):
    return get_gbnc_series_points_payload(series_id=series_id, variant=variant, current_user=current_user)
