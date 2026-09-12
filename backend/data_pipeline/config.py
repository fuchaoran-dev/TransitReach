from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass(frozen=True)
class CleaningConfig:
    """Explicit limits prevent an accidental full-dataset scan on a laptop."""

    start_date: date
    end_date: date
    route_ids: tuple[str, ...]
    sample_seconds: int = 30
    geofence_metres: float = 60.0
    minimum_geofence_observations: int = 2
    maximum_observation_gap_seconds: int = 90

    def validate(self) -> None:
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        if not self.route_ids:
            raise ValueError("at least one route_id is required")
        if self.sample_seconds < 1:
            raise ValueError("sample_seconds must be positive")
        if self.minimum_geofence_observations < 2:
            raise ValueError("arrival detection requires at least two observations")


@dataclass(frozen=True)
class PipelinePaths:
    raw_glob: str
    selected_observations: Path
    stop_arrivals: Path
    feature_table: Path

