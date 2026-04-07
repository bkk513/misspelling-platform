"""文件说明：GBNC 集成类型定义模块，负责描述数据拉取与解析所需的结构。"""

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
