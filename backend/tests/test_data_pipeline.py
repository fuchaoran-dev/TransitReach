from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.data_pipeline.arrival_detector import ArrivalDetection, VehicleObservation, delay_seconds, detect_stop_arrival
from backend.data_pipeline.build_stop_arrivals import TripObservation, build_stop_arrivals
from backend.data_pipeline.gtfs_static_loader import load_gtfs_static, parse_gtfs_time
from backend.data_pipeline.source_resolver import NoOperationalDataError, resolve_training_source


class ArrivalDetectorTests(unittest.TestCase):
    def test_requires_multiple_nearby_observations(self) -> None:
        now = datetime(2026, 6, 1, 8, tzinfo=timezone.utc)
        detection = detect_stop_arrival([VehicleObservation(now, 3.139, 101.687)], 3.139, 101.687)
        self.assertIsNone(detection.actual_arrival)
        self.assertEqual(detection.quality, "LOW")

    def test_confirmed_arrival_and_delay(self) -> None:
        now = datetime(2026, 6, 1, 8, 5, tzinfo=timezone.utc)
        observations = [VehicleObservation(now, 3.139, 101.687), VehicleObservation(
            now + timedelta(seconds=30), 3.1391, 101.6871)]
        detection = detect_stop_arrival(observations, 3.139, 101.687)
        self.assertEqual(detection.actual_arrival, now)
        self.assertGreaterEqual(detection.confidence, .65)
        self.assertEqual(delay_seconds(now - timedelta(minutes=2), detection), 120)

    def test_invalid_ground_truth_has_no_delay_label(self) -> None:
        detection = ArrivalDetection(None, "LOW", 1, "gps_noise")
        self.assertIsNone(delay_seconds(datetime.now(timezone.utc), detection))


class SourceResolverTests(unittest.TestCase):
    def test_server_failure_uses_existing_data(self) -> None:
        with TemporaryDirectory() as directory:
            cached = Path(directory) / "features.parquet"
            cached.write_bytes(b"real-existing-data")
            resolved = resolve_training_source(cached, lambda: (_ for _ in ()).throw(OSError("offline")))
            self.assertEqual(resolved.origin, "cache")
            self.assertIn("offline", resolved.warning or "")

    def test_no_server_and_no_cache_stops_training(self) -> None:
        with TemporaryDirectory() as directory:
            with self.assertRaises(NoOperationalDataError):
                resolve_training_source(Path(directory) / "missing.parquet", lambda: (_ for _ in ()).throw(OSError()))


class EndToEndFixtureTests(unittest.TestCase):
    """Tiny synthetic geometry is test-only and is never persisted as model data."""

    def test_static_schedule_and_real_observations_produce_label(self) -> None:
        with TemporaryDirectory() as directory:
            gtfs = Path(directory)
            (gtfs / "stops.txt").write_text(
                "stop_id,stop_name,stop_lat,stop_lon\nS1,Fixture Stop,3.139,101.687\n",
                encoding="utf-8",
            )
            (gtfs / "trips.txt").write_text(
                "route_id,service_id,trip_id\nT801,WKD,trip-1\n", encoding="utf-8"
            )
            (gtfs / "stop_times.txt").write_text(
                "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                "trip-1,08:00:00,08:00:00,S1,1\n", encoding="utf-8"
            )
            schedule = load_gtfs_static(gtfs)
            local_tz = timezone(timedelta(hours=8))
            observed_at = datetime(2026, 6, 1, 8, 2, tzinfo=local_tz)
            observations = [
                TripObservation(date(2026, 6, 1), "trip-1", "T801", "bus-1", "08:00:00", observed_at, 3.139, 101.687),
                TripObservation(date(2026, 6, 1), "trip-1", "T801", "bus-1", "08:00:00", observed_at + timedelta(seconds=30), 3.1391, 101.6871),
            ]
            event = build_stop_arrivals(observations, schedule)[0]
            self.assertTrue(event.training_eligible)
            self.assertEqual(event.delay_seconds, 120)

    def test_gtfs_time_after_midnight(self) -> None:
        self.assertEqual(parse_gtfs_time("25:05:30"), 90330)


if __name__ == "__main__":
    unittest.main()
