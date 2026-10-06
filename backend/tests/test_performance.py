"""Offline regression tests: no cloud writes or dependency on live data."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from threading import Event
from unittest.mock import MagicMock, patch
from psycopg_pool import PoolTimeout

from fastapi.testclient import TestClient

from backend.app.cache import TTLCache
from backend.app import database
from backend.app.main import app
from backend.app.services import model_registry, reference_data_service


class CacheTests(unittest.TestCase):
    def test_expiration_and_none(self):
        now = [0]
        cache = TTLCache(10, clock=lambda: now[0])
        load = MagicMock(return_value=None)
        self.assertIsNone(cache.get("a", load))
        self.assertIsNone(cache.get("a", load))
        self.assertEqual(load.call_count, 1)
        now[0] = 10
        cache.get("a", load)
        self.assertEqual(load.call_count, 2)

    def test_lru_bound(self):
        cache = TTLCache(60, 2)
        cache.get("a", lambda: 1)
        cache.get("b", lambda: 2)
        cache.get("a", lambda: 99)
        cache.get("c", lambda: 3)
        self.assertEqual(cache.get("b", lambda: 4), 4)

    def test_error_is_not_cached(self):
        cache = TTLCache(60)
        with self.assertRaises(ValueError):
            cache.get("a", MagicMock(side_effect=ValueError))
        self.assertEqual(cache.get("a", lambda: 7), 7)

    def test_concurrent_miss_only_loads_once(self):
        cache = TTLCache(60)
        started, release = Event(), Event()
        def load():
            started.set()
            self.assertTrue(release.wait(2))
            return 7
        loader = MagicMock(side_effect=load)
        with ThreadPoolExecutor(max_workers=4) as executor:
            first = executor.submit(cache.get, "a", loader)
            self.assertTrue(started.wait(2))
            others = [executor.submit(cache.get, "a", loader) for _ in range(3)]
            release.set()
            self.assertEqual([first.result(), *(item.result() for item in others)], [7] * 4)
        self.assertEqual(loader.call_count, 1)

    def test_unrelated_key_does_not_wait_for_slow_load(self):
        cache = TTLCache(60, 2)
        started, release = Event(), Event()
        def slow():
            started.set()
            self.assertTrue(release.wait(2))
            return 7
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = executor.submit(cache.get, "slow", slow)
            self.assertTrue(started.wait(2))
            try:
                self.assertEqual(executor.submit(cache.get, "fast", lambda: 9).result(timeout=1), 9)
            finally:
                release.set()
            self.assertEqual(pending.result(), 7)

    def test_clearing_during_fill_does_not_restore_old_value(self):
        cache = TTLCache(60)
        started, release = Event(), Event()
        def slow():
            started.set()
            self.assertTrue(release.wait(2))
            return "old"
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(cache.get, "a", slow)
            self.assertTrue(started.wait(2))
            cache.clear()
            self.assertEqual(cache.get("a", lambda: "new"), "new")
            release.set()
            self.assertEqual(pending.result(), "old")
            self.assertEqual(cache.get("a", lambda: "wrong"), "new")


class PoolTests(unittest.TestCase):
    def test_connections_reuse_one_bounded_pool(self):
        fake = MagicMock()
        with patch.object(database, "_pool", None), patch.object(database, "database_url", return_value="postgresql://example/db"), patch.object(database, "ConnectionPool", return_value=fake) as constructor:
            with patch.dict(database.os.environ, {"DB_POOL_MIN_SIZE": "1", "DB_POOL_MAX_SIZE": "4"}):
                with database.connection():
                    pass
                with database.connection():
                    pass
                self.assertEqual(constructor.call_count, 1)
                self.assertEqual(fake.connection.call_count, 2)
                self.assertEqual(constructor.call_args.kwargs["max_size"], 4)
                self.assertEqual(constructor.call_args.kwargs["kwargs"]["prepare_threshold"], None)
                database.close_pool()
                fake.close.assert_called_once()
                self.assertIsNone(database._pool)

    def test_lifespan_closes_pool_on_exit(self):
        with patch("backend.app.main.get_pool") as opened, patch("backend.app.main.close_pool") as closed:
            with TestClient(app) as client:
                response = client.get("/health")
                self.assertEqual(response.status_code, 200)
                self.assertIn("app;dur=", response.headers["server-timing"])
            opened.assert_called_once()
            closed.assert_called_once()


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        reference_data_service._bootstrap_cache.clear()
        self.addCleanup(reference_data_service._bootstrap_cache.clear)
        self.client = TestClient(app)

    def test_public_payload_is_compressed_and_etag_revalidated(self):
        fixture = {"railStops": ["public reference record"] * 500}
        with patch.object(reference_data_service, "application_data", return_value=fixture) as load:
            first = self.client.get("/api/data/bootstrap")
            self.assertEqual(first.json(), fixture)
            self.assertEqual(first.headers["content-encoding"], "gzip")
            second = self.client.get("/api/data/bootstrap", headers={"If-None-Match": first.headers["etag"]})
            self.assertEqual(second.status_code, 304)
            self.assertEqual(second.content, b"")
            self.assertEqual(load.call_count, 1)
            self.assertIn("no-cache", second.headers["cache-control"])
            self.assertEqual(self.client.get("/api/data/bootstrap", headers={"If-None-Match": '"different"'}).status_code, 200)

    def test_expired_payload_changes_etag(self):
        with patch.object(reference_data_service, "application_data", side_effect=[{"railStops": [1]}, {"railStops": [2]}]):
            first = self.client.get("/api/data/bootstrap")
            reference_data_service._bootstrap_cache.clear()
            second = self.client.get("/api/data/bootstrap", headers={"If-None-Match": first.headers["etag"]})
            self.assertEqual(second.status_code, 200)
            self.assertNotEqual(first.headers["etag"], second.headers["etag"])

    def test_database_failure_can_be_retried(self):
        with patch.object(reference_data_service, "application_data", side_effect=[RuntimeError("offline"), {"railStops": []}]) as load:
            with self.assertRaises(RuntimeError):
                self.client.get("/api/data/bootstrap")
            self.assertEqual(self.client.get("/api/data/bootstrap").status_code, 200)
            self.assertEqual(load.call_count, 2)

    def test_pool_timeout_returns_retryable_503_without_caching(self):
        with patch.object(reference_data_service, "application_data", side_effect=PoolTimeout("private diagnostic")):
            response = self.client.get("/api/data/bootstrap")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers["retry-after"], "5")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("private diagnostic", response.text)


class PredictionCacheTests(unittest.TestCase):
    def setUp(self):
        for cache in (model_registry._metadata_cache, model_registry._prediction_cache, model_registry._catalog_cache):
            cache.clear()
            self.addCleanup(cache.clear)

    def test_same_features_reuse_inference_and_shap(self):
        metadata = {"model_version": "fixture-v1", "model_type": "CatBoostRegressor", "training_start": "2025-01-01", "training_end": "2025-06-30", "model_mae": 1., "model_rmse": 2., "baseline_mae": 3., "baseline_rmse": 4., "data_sources": ["fixture"]}
        profile = {"sample_count": 100, "stop_sequence": 2, "p25": 0, "p50": 2, "p75": 4, "historical_median_delay": 2., "historical_mean_delay": 2., "residual_scale": 1.}
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = profile
        @contextmanager
        def connect():
            yield db
        model = MagicMock()
        model.predict.return_value = [2.]
        model.get_feature_importance.return_value = [[1.] * 10]
        at = datetime.fromisoformat("2026-10-06T09:00:00+08:00")
        with patch.object(model_registry, "_active_metadata", return_value=metadata) as load_metadata, patch.object(model_registry, "connection", connect), patch.object(model_registry, "_model", return_value=model):
            first = model_registry.predict_historical("route", "stop", at)
            second = model_registry.predict_historical("route", "stop", at.replace(minute=30))
            self.assertEqual(first, second)
            self.assertEqual(model.predict.call_count, 1)
            self.assertEqual(model.get_feature_importance.call_count, 1)
            self.assertEqual(db.execute.call_count, 1)
            self.assertEqual(load_metadata.call_count, 1)
            second.explanations.clear()
            self.assertTrue(first.explanations)
            for changed in (at.replace(hour=10), at.replace(day=7)):
                model_registry.predict_historical("route", "stop", changed)
            self.assertEqual(model.predict.call_count, 3)
            model_registry._metadata_cache.clear()
            metadata = {**metadata, "model_version": "fixture-v2"}
            load_metadata.return_value = metadata
            self.assertEqual(model_registry.predict_historical("route", "stop", at).model_version, "fixture-v2")
            self.assertEqual(model.predict.call_count, 4)

    def test_catalog_is_not_cached_forever(self):
        with patch.object(model_registry, "_load_service_catalog", side_effect=[[{"line_id": "a"}], [{"line_id": "b"}]]) as load:
            self.assertEqual(model_registry.service_catalog(), [{"line_id": "a"}])
            model_registry.service_catalog()
            self.assertEqual(load.call_count, 1)
            model_registry._catalog_cache.clear()
            self.assertEqual(model_registry.service_catalog(), [{"line_id": "b"}])


if __name__ == "__main__":
    unittest.main()
