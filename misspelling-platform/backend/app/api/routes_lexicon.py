from fastapi import APIRouter

from ..services.lexicon_service import get_or_suggest_variants, list_term_variants_payload, list_terms_payload

router = APIRouter()


@router.post("/api/lexicon/variants/suggest")
def suggest_lexicon_variants(word: str, k: int = 20):
    return get_or_suggest_variants(word, k)


@router.get("/api/lexicon/terms")
def list_lexicon_terms(limit: int = 20):
    return list_terms_payload(limit)


@router.get("/api/lexicon/{term_id}/variants")
def get_lexicon_variants(term_id: int):
    return list_term_variants_payload(term_id)
