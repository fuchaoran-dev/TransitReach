from __future__ import annotations

from dataclasses import dataclass
from math import cos, hypot, radians
from typing import Sequence


METRES_PER_DEGREE = 111_320.0


@dataclass(frozen=True)
class ShapePoint:
    latitude: float
    longitude: float
    sequence: int


@dataclass(frozen=True)
class ShapeProjection:
    progress_metres: float
    distance_metres: float
    segment_index: int


def project_to_shape(latitude: float, longitude: float, shape: Sequence[ShapePoint]) -> ShapeProjection | None:
    """Project a WGS84 point onto a polyline using a local metric approximation."""
    if len(shape) < 2:
        return None
    reference_latitude = radians(latitude)
    x_scale = METRES_PER_DEGREE * cos(reference_latitude)
    y_scale = METRES_PER_DEGREE
    cumulative = 0.0
    best: ShapeProjection | None = None
    for index, (start, end) in enumerate(zip(shape, shape[1:])):
        ax, ay = (start.longitude - longitude) * x_scale, (start.latitude - latitude) * y_scale
        bx, by = (end.longitude - longitude) * x_scale, (end.latitude - latitude) * y_scale
        dx, dy = bx - ax, by - ay
        length_squared = dx * dx + dy * dy
        fraction = 0.0 if length_squared == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length_squared))
        px, py = ax + fraction * dx, ay + fraction * dy
        segment_length = hypot(dx, dy)
        candidate = ShapeProjection(cumulative + fraction * segment_length, hypot(px, py), index)
        if best is None or candidate.distance_metres < best.distance_metres:
            best = candidate
        cumulative += segment_length
    return best


def monotonic_progress_ratio(progress_values: Sequence[float], tolerance_metres: float = 100) -> float:
    if len(progress_values) < 2:
        return 0.0
    forward = sum(
        current + tolerance_metres >= previous
        for previous, current in zip(progress_values, progress_values[1:])
    )
    return forward / (len(progress_values) - 1)
