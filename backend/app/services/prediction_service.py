from __future__ import annotations

from bisect import bisect_right
from datetime import datetime, timedelta, timezone

from backend.app.schemas.reliability import RiskLevel


REALTIME_FRESHNESS = timedelta(minutes=2)


def risk_from_distribution(predicted_delay: float, comparable_delays: list[float]) -> tuple[RiskLevel, float]:
    if len(comparable_delays) < 4:
        raise ValueError("insufficient comparable historical distribution")
    ordered = sorted(comparable_delays)
    percentile = 100 * bisect_right(ordered, predicted_delay) / len(ordered)
    if percentile <= 25:
        risk = RiskLevel.low
    elif percentile <= 50:
        risk = RiskLevel.moderate
    elif percentile <= 75:
        risk = RiskLevel.high
    else:
        risk = RiskLevel.very_high
    return risk, round(percentile, 1)


def realtime_is_fresh(observed_at: datetime | None, now: datetime | None = None) -> bool:
    if observed_at is None:
        return False
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    return timedelta(0) <= reference - observed_at <= REALTIME_FRESHNESS

