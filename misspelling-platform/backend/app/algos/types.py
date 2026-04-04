from dataclasses import dataclass, field


@dataclass
class AlgorithmSeries:
    variant: str
    values: list[float]


@dataclass
class AlgorithmDataset:
    task_id: str
    word: str
    variants: list[str]
    years: list[int]
    series: list[AlgorithmSeries]
    source: str
    warnings: list[str] = field(default_factory=list)
    fallback_reason: str | None = None

    @property
    def matrix(self) -> list[list[float]]:
        return [row.values for row in self.series]

    @property
    def mode(self) -> str:
        return "stub" if str(self.source).strip().upper() in {"STUB", "STUB_LOCAL"} else "real"
