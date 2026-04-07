"""文件说明：词库接口路由模块，负责接收 HTTP 请求并调用对应服务层。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth_deps import get_current_user, get_optional_user
from ..services.lexicon_service import (
    delete_variant_cache_payload,
    enrich_term_payload,
    get_term_payload,
    list_variant_cache_payload,
    list_terms_payload,
    save_variant_cache_payload,
    suggest_origin_year_payload,
    suggest_and_cache_variants,
)

router = APIRouter()


class DeleteVariantCacheBody(BaseModel):
    ids: list[int] = []
    word: str | None = None
    variants: list[str] = []


class SaveVariantCacheBody(BaseModel):
    word: str
    variants: list[str]
    source: str = "manual"


@router.post("/api/lexicon/variants/suggest")
def suggest_variants(
    word: str,
    k: int = 12,
    persist: bool = True,
    prefer_cache: bool = True,
    current_user=Depends(get_optional_user),
):
    return suggest_and_cache_variants(
        word=word,
        k=max(1, min(int(k), 50)),
        current_user=current_user,
        persist=bool(persist),
        prefer_cache=bool(prefer_cache),
    )


@router.post("/api/lexicon/term/enrich")
def enrich_term(word: str, current_user=Depends(get_optional_user)):
    return enrich_term_payload(word=word, current_user=current_user)


@router.get("/api/lexicon/origin-year/suggest")
@router.get("/api/lexicon/origin_year/suggest")
@router.post("/api/lexicon/origin-year/suggest")
@router.post("/api/lexicon/origin_year/suggest")
def suggest_origin_year(
    word: str,
    variants: str | None = None,
    start_year: int = 1500,
    end_year: int = 2019,
    corpus: str = "eng_2019",
    smoothing: int = 0,
    current_user=Depends(get_optional_user),
):
    selected_variants = [v.strip().lower() for v in str(variants or "").split(",") if v.strip()]
    return suggest_origin_year_payload(
        word=word,
        variants=selected_variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
    )


@router.get("/api/lexicon/terms")
def list_terms(limit: int = 50, q: str = "", current_user=Depends(get_optional_user)):
    return list_terms_payload(limit=limit, q=q, current_user=current_user)


@router.get("/api/lexicon/variant-cache")
def list_variant_cache(word: str = "", limit: int = 200, current_user=Depends(get_current_user)):
    return list_variant_cache_payload(current_user=current_user, word=word, limit=limit)


@router.delete("/api/lexicon/variant-cache")
def delete_variant_cache(body: DeleteVariantCacheBody, current_user=Depends(get_current_user)):
    return delete_variant_cache_payload(
        current_user=current_user,
        ids=body.ids or [],
        word=body.word,
        variants=body.variants or [],
    )


@router.post("/api/lexicon/variant-cache")
def save_variant_cache(body: SaveVariantCacheBody, current_user=Depends(get_current_user)):
    return save_variant_cache_payload(
        current_user=current_user,
        word=body.word,
        variants=body.variants or [],
        source=body.source,
    )


@router.get("/api/lexicon/{term_id}")
def get_term(term_id: int, current_user=Depends(get_optional_user)):
    return get_term_payload(term_id=term_id, current_user=current_user)
