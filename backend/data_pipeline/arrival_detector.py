from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from typing import Iterable


@dataclass(frozen=True)
class VehicleObservation:
    timestamp: datetime
    latitude: float
    longitude: float


@dataclass(frozen=True)
class ArrivalDetection:
    actual_arrival: datetime | None
    quality: str
    observations_in_geofence: int
    reason: str | None = None
    confidence: float = 0.0
    confirmation_span_seconds: float | None = None


def _distance_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius = 6_371_000.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * earth_radius * asin(sqrt(a))


def detect_stop_arrival(
    observations: Iterable[VehicleObservation],
    stop_latitude: float,
    stop_longitude: float,
    *,
    geofence_metres: float = 60,
    minimum_observations: int = 2,
    maximum_gap_seconds: int = 90,
) -> ArrivalDetection:
    """Return the first confirmed geofence entry; reject isolated/noisy GPS points."""
    inside = sorted(
        (item for item in observations if _distance_metres(
            item.latitude, item.longitude, stop_latitude, stop_longitude
        ) <= geofence_metres),
        key=lambda item: item.timestamp,
    )
    if len(inside) < minimum_observations:
        return ArrivalDetection(None, "LOW", len(inside), "insufficient_geofence_observations")

    for index in range(len(inside) - minimum_observations + 1):
        window = inside[index : index + minimum_observations]
        span = (window[-1].timestamp - window[0].timestamp).total_seconds()
        if 0 <= span <= maximum_gap_seconds:
            extra_observations = min(2, len(window) - minimum_observations)
            confidence = min(1.0, .6 + .15 * extra_observations + .1 * (1 - span / maximum_gap_seconds))
            return ArrivalDetection(
                window[0].timestamp, "HIGH", len(inside), confidence=round(confidence, 3),
                confirmation_span_seconds=span,
            )
    return ArrivalDetection(None, "LOW", len(inside), "observations_not_consecutive")


def delay_seconds(scheduled_arrival: datetime, detection: ArrivalDetection) -> int | None:
    if detection.actual_arrival is None or detection.quality != "HIGH":
        return None
    return round((detection.actual_arrival - scheduled_arrival).total_seconds())
