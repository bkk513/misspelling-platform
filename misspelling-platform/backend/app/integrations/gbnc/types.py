from dataclasses import dataclass


@dataclass
class SeriesPoint:
    year: int
    value: float


@dataclass
class VariantSeries:
    variant: str
    points: list[SeriesPoint]


@dataclass
class GbncFetchResult:
    source: str
    corpus: str
    smoothing: int
    unit: str
    series: list[VariantSeries]
    warnings: list[str]
