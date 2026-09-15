from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class TransitMode(str, Enum):
    BUS = "BUS"
    MRT = "MRT"
    LRT = "LRT"
    BRT = "BRT"


class RiskLevel(str, Enum):
    low = "low"
    moderate = "moderate"
    high = "high"
    very_high = "very_high"


class ServiceCapability(BaseModel):
    mode: TransitMode
    line_id: str
    name: str
    static_available: bool = True
    historical_operational_data_available: bool = False
    realtime_available: bool = False
    model_available: bool = False
    prediction_available: bool = False
    reason: str | None = "insufficient_historical_operational_data"
    stops: list[dict[str, str | int]] = Field(default_factory=list)


class UnsupportedPrediction(BaseModel):
    supported: bool = False
    reason: str = "insufficient_historical_operational_data"


class ReliabilityPrediction(BaseModel):
    supported: bool = True
    prediction_type: str
    prediction_level: str
    confidence: str
    sample_count: int
    is_fallback: bool
    expected_delay_min: float
    risk_level: RiskLevel
    historical_percentile: float = Field(ge=0, le=100)
    prediction_lower_min: float | None = None
    prediction_upper_min: float | None = None
    scheduled_headway_min: float | None = None
    observed_headway_min: float | None = None
    realtime_used: bool
    realtime_timestamp: datetime | None = None
    model_version: str
    model_type: str
    data_sources: list[str]
    training_period: str
    evaluation: dict[str, float]
    explanations: list[str]
    disclaimer: str = "AI estimate with uncertainty; it is not a guaranteed arrival time."
