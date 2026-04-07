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
    granularity: str = "year"
    time_labels: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    fallback_reason: str | None = None

    @property
    def matrix(self) -> list[list[float]]:
        return [row.values for row in self.series]

    @property
    def labels(self) -> list[str]:
        if len(self.time_labels) == len(self.years):
            return [str(item) for item in self.time_labels]
        return [str(int(year)) for year in self.years]

    @property
    def mode(self) -> str:
        return "stub" if str(self.source).strip().upper() in {"STUB", "STUB_LOCAL"} else "real"
