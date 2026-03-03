from fastapi import APIRouter, Depends

from .auth_deps import get_optional_user
from ..services.lexicon_service import (
    enrich_term_payload,
    get_term_payload,
    list_terms_payload,
    suggest_and_cache_variants,
)

router = APIRouter()


@router.post("/api/lexicon/variants/suggest")
def suggest_variants(word: str, k: int = 12, current_user=Depends(get_optional_user)):
    return suggest_and_cache_variants(word=word, k=max(1, min(int(k), 50)), current_user=current_user)


@router.post("/api/lexicon/term/enrich")
def enrich_term(word: str, current_user=Depends(get_optional_user)):
    return enrich_term_payload(word=word, current_user=current_user)


@router.get("/api/lexicon/terms")
def list_terms(limit: int = 50, q: str = "", current_user=Depends(get_optional_user)):
    return list_terms_payload(limit=limit, q=q, current_user=current_user)


@router.get("/api/lexicon/{term_id}")
def get_term(term_id: int, current_user=Depends(get_optional_user)):
    return get_term_payload(term_id=term_id, current_user=current_user)
