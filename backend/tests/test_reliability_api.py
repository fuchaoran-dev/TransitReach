import unittest

from fastapi.testclient import TestClient

from backend.app.main import app


class ReliabilityApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_supported_bus_service_returns_ai_prediction(self) -> None:
        services = self.client.get("/api/reliability/services").json()
        bus_services = [item for item in services if item["mode"] == "BUS"]
        self.assertGreaterEqual(len(bus_services), 100)
        service = next(item for item in services if item["line_id"] == "U1510")
        response = self.client.get("/api/reliability/predict", params={
            "mode": "BUS", "line_id": "U1510", "stop_id": service["stops"][0]["stop_id"],
            "datetime": "2026-09-14T08:00:00+08:00",
        })
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["supported"])
        self.assertEqual(body["model_type"], "CatBoostRegressor")
        self.assertFalse(body["realtime_used"])
        self.assertGreater(len(body["explanations"]), 0)

    def test_unvalidated_rail_service_remains_unsupported(self) -> None:
        response = self.client.get("/api/reliability/predict", params={
            "mode": "MRT", "line_id": "KGL", "stop_id": "KGL01",
            "datetime": "2026-09-14T08:00:00+08:00",
        })
        self.assertEqual(response.json(), {
            "supported": False, "reason": "insufficient_historical_operational_data"
        })
