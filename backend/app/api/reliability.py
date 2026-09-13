from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query

from backend.app.schemas.reliability import (
    ReliabilityPrediction, ServiceCapability, TransitMode, UnsupportedPrediction,
)
from backend.app.services.capability_service import get_capability, list_capabilities
from backend.app.services.model_registry import predict_historical


router = APIRouter(prefix="/api/reliability", tags=["reliability"])


@router.get("/services", response_model=list[ServiceCapability])
def services() -> list[ServiceCapability]:
    return list(list_capabilities())


@router.get("/predict", response_model=ReliabilityPrediction | UnsupportedPrediction)
def predict(
    mode: TransitMode,
    line_id: str = Query(min_length=1),
    stop_id: str = Query(min_length=1),
    datetime_: datetime = Query(alias="datetime"),
) -> ReliabilityPrediction | UnsupportedPrediction:
    capability = get_capability(mode, line_id)
    if capability is None:
        return UnsupportedPrediction(reason="unknown_service")
    if not capability.prediction_available:
        return UnsupportedPrediction(reason=capability.reason or "model_not_available")
    prediction = predict_historical(line_id, stop_id, datetime_)
    return prediction or UnsupportedPrediction(reason="insufficient_comparable_historical_data")
