from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

from .arrival_detector import VehicleObservation, delay_seconds, detect_stop_arrival
from .gtfs_static_loader import StaticSchedule, load_gtfs_static, parse_gtfs_time
from .shape_matcher import monotonic_progress_ratio, project_to_shape


KUALA_LUMPUR = ZoneInfo("Asia/Kuala_Lumpur")


@dataclass(frozen=True)
class TripObservation:
    service_date: date
    trip_id: str
    route_id: str
    vehicle_id: str
    start_time: str
    timestamp: datetime
    latitude: float
    longitude: float


@dataclass(frozen=True)
class StopArrivalEvent:
    service_date: date
    route_id: str
    trip_id: str
    vehicle_id: str
    start_time: str
    stop_id: str
    stop_sequence: int
    scheduled_arrival: datetime
    actual_arrival: datetime | None
    delay_seconds: int | None
    arrival_match_quality: str
    quality_reason: str | None
    match_confidence: float

    @property
    def training_eligible(self) -> bool:
        return (
            self.arrival_match_quality == "HIGH"
            and self.delay_seconds is not None
            and self.match_confidence >= .65
        )


def _scheduled_datetime(service_date: date, seconds: int) -> datetime:
    return datetime.combine(service_date, time(), KUALA_LUMPUR) + timedelta(seconds=seconds)


def _local_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(KUALA_LUMPUR)


def build_stop_arrivals(
    observations: Iterable[TripObservation],
    schedule: StaticSchedule,
    *,
    geofence_metres: float = 60,
    minimum_observations: int = 2,
    maximum_gap_seconds: int = 90,
    maximum_early_seconds: int = 600,
    maximum_late_seconds: int = 3600,
    maximum_shape_distance_metres: float = 120,
    maximum_stop_progress_delta_metres: float = 250,
) -> list[StopArrivalEvent]:
    """Match complete vehicle trips to scheduled stops without inventing arrivals."""
    grouped: dict[tuple[date, str, str, str], list[TripObservation]] = {}
    for item in observations:
        normalized = TripObservation(
            item.service_date, item.trip_id, item.route_id, item.vehicle_id, item.start_time,
            _local_timestamp(item.timestamp), item.latitude, item.longitude,
        )
        grouped.setdefault((item.service_date, item.trip_id, item.vehicle_id, item.start_time), []).append(normalized)

    events: list[StopArrivalEvent] = []
    for (service_date, trip_id, vehicle_id, start_time), trip_observations in grouped.items():
        scheduled_stops = schedule.stop_times_by_trip.get(trip_id)
        expected_route = schedule.trips.get(trip_id)
        route_ids = {item.route_id for item in trip_observations}
        if scheduled_stops is None or expected_route is None or route_ids != {expected_route}:
            continue

        remaining = sorted(trip_observations, key=lambda item: item.timestamp)
        shape_id = schedule.trip_shapes.get(trip_id)
        shape = schedule.shapes.get(shape_id or "")
        projections = {
            item: project_to_shape(item.latitude, item.longitude, shape)
            for item in remaining
        } if shape else {}
        on_shape_progress = [
            projection.progress_metres for item in remaining
            if (projection := projections.get(item)) is not None
            and projection.distance_metres <= maximum_shape_distance_metres
        ]
        shape_is_reliable = bool(shape) and monotonic_progress_ratio(on_shape_progress) >= .8
        last_arrival: datetime | None = None
        instance_start = parse_gtfs_time(start_time)
        template_start = scheduled_stops[0].arrival_seconds
        for scheduled in scheduled_stops:
            stop = schedule.stops[scheduled.stop_id]
            scheduled_at = _scheduled_datetime(
                service_date, instance_start + scheduled.arrival_seconds - template_start
            )
            window_start = scheduled_at - timedelta(seconds=maximum_early_seconds)
            window_end = scheduled_at + timedelta(seconds=maximum_late_seconds)
            candidates = [
                item for item in remaining
                if (last_arrival is None or item.timestamp > last_arrival)
                and window_start <= item.timestamp <= window_end
            ]
            stop_projection = project_to_shape(stop.latitude, stop.longitude, shape) if shape_is_reliable and shape else None
            if stop_projection is not None:
                candidates = [
                    item for item in candidates
                    if (projection := projections.get(item)) is not None
                    and projection.distance_metres <= maximum_shape_distance_metres
                    and abs(projection.progress_metres - stop_projection.progress_metres)
                    <= maximum_stop_progress_delta_metres
                ]
            detection = detect_stop_arrival(
                (VehicleObservation(item.timestamp, item.latitude, item.longitude) for item in candidates),
                stop.latitude, stop.longitude,
                geofence_metres=geofence_metres,
                minimum_observations=minimum_observations,
                maximum_gap_seconds=maximum_gap_seconds,
            )
            actual_at = detection.actual_arrival
            events.append(StopArrivalEvent(
                service_date, expected_route, trip_id, vehicle_id, start_time, scheduled.stop_id,
                scheduled.stop_sequence, scheduled_at, actual_at,
                delay_seconds(scheduled_at, detection), detection.quality, detection.reason,
                detection.confidence,
            ))
            if actual_at is not None:
                last_arrival = actual_at
                remaining = [item for item in remaining if item.timestamp >= actual_at]
    return events


def build_parquet(selected_observations: Path, gtfs_directory: Path, output: Path) -> dict[str, int]:
    """Build a small proof-of-pipeline slice; large runs should partition by route/date."""
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("Install backend/requirements.txt before running the pipeline") from exc

    table = pq.read_table(selected_observations)
    observations = [TripObservation(
        service_date=row["service_date"], trip_id=row["trip_id"], route_id=row["route_id"],
        vehicle_id=row["vehicle_id"], start_time=row["start_time"], timestamp=row["timestamp"],
        latitude=row["latitude"], longitude=row["longitude"],
    ) for row in table.to_pylist()]
    events = build_stop_arrivals(observations, load_gtfs_static(gtfs_directory))
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(event) | {"training_eligible": event.training_eligible} for event in events]
    if not rows:
        raise RuntimeError("No matching GTFS trips were found; refusing to create an empty artifact")
    pq.write_table(pa.Table.from_pylist(rows), output, compression="zstd")
    eligible = sum(event.training_eligible for event in events)
    return {"events": len(events), "training_eligible": eligible, "rejected": len(events) - eligible}


def main() -> None:
    parser = argparse.ArgumentParser(description="Derive confirmed stop arrivals from a cleaned slice")
    parser.add_argument("--observations", required=True, type=Path)
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(build_parquet(args.observations, args.gtfs, args.output))


if __name__ == "__main__":
    main()
