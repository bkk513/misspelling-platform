from __future__ import annotations

import urllib.parse
import urllib.request

from .parser import parse_graph_response
from .types import GBNCFetchResult

CORPORA = {
    "eng_2019": 26,
    "eng_us_2019": 28,
    "eng_gb_2019": 29,
    "eng_fiction_2019": 27,
    "eng_2012": 15,
    "eng_2009": 0,
}


def _normalize_term(v: str) -> str:
    return " ".join((v or "").strip().split())


def _dedupe_terms(term: str, variants: list[str]) -> list[str]:
    out: list[str] = []
    seen = set()
    for raw in [term] + list(variants or []):
        clean = _normalize_term(str(raw))
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def fetch_gbnc_series(
    term: str,
    variants: list[str],
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
) -> GBNCFetchResult:
    names = _dedupe_terms(term, variants)
    if not names:
        raise ValueError("term is required")
    if corpus not in CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    y0 = int(start_year)
    y1 = int(end_year)
    if y1 < y0:
        raise ValueError("end_year must be >= start_year")
    sm = max(0, int(smoothing))
    query = ",".join(names)
    encoded_query = urllib.parse.quote_plus(query, safe='"')
    url = (
        "https://books.google.com/ngrams/json?"
        f"content={encoded_query}"
        f"&year_start={y0}&year_end={y1}&corpus={CORPORA[corpus]}&smoothing={sm}"
    )
    payload = urllib.request.urlopen(url, timeout=15).read()
    raw = parse_graph_response(payload)
    series = []
    for label in names:
        values = raw.get(label, [])
        points = [{"year": y0 + i, "value": float(v)} for i, v in enumerate(values[: (y1 - y0 + 1)])]
        series.append({"variant": label, "points": points})
    return {
        "source": "gbnc",
        "provider": "google-ngram-viewer",
        "unit": "relative_frequency",
        "term": _normalize_term(term),
        "variants": names,
        "corpus": corpus,
        "smoothing": sm,
        "start_year": y0,
        "end_year": y1,
        "request_url": url,
        "query": query,
        "series": series,
    }
