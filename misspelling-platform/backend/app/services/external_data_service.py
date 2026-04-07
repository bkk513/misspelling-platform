from __future__ import annotations

from typing import Any

from .gbnc_data_service import pull_gbnc_series_payload, pull_gbnc_snapshot_payload
from .gdelt_data_service import pull_gdelt_series_payload

SUPPORTED_DATA_SOURCES = {"gbnc", "gdelt"}


def normalize_data_source(value: Any) -> str:
    source = str(value or "gbnc").strip().lower()
    return source if source in SUPPORTED_DATA_SOURCES else "gbnc"


def data_source_label(value: Any) -> str:
    source = normalize_data_source(value)
    return "GDELT" if source == "gdelt" else "GBNC"


def data_source_uses_corpus(value: Any) -> bool:
    return normalize_data_source(value) == "gbnc"


def pull_external_series_payload(
    *,
    word: str,
    variants: list[str] | None,
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    current_user: dict | None = None,
    data_source: str = "gbnc",
):
    source = normalize_data_source(data_source)
    if source == "gdelt":
        return pull_gdelt_series_payload(
            word=word,
            variants=variants,
            start_year=start_year,
            end_year=end_year,
            current_user=current_user,
        )
    return pull_gbnc_series_payload(
        word=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
    )


def pull_external_snapshot_payload(
    *,
    word: str,
    variants: list[str] | None,
    start_year: int,
    end_year: int,
    corpus: str,
    smoothing: int,
    current_user: dict | None = None,
    data_source: str = "gbnc",
):
    source = normalize_data_source(data_source)
    if source == "gdelt":
        return pull_gdelt_series_payload(
            word=word,
            variants=variants,
            start_year=start_year,
            end_year=end_year,
            current_user=current_user,
        )
    return pull_gbnc_snapshot_payload(
        word=word,
        variants=variants,
        start_year=start_year,
        end_year=end_year,
        corpus=corpus,
        smoothing=smoothing,
        current_user=current_user,
    )
