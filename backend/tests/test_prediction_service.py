from datetime import datetime, timedelta, timezone
import unittest

from backend.app.schemas.reliability import RiskLevel
from backend.app.services.prediction_service import realtime_is_fresh, risk_from_distribution


class RiskBandTests(unittest.TestCase):
    def test_configured_quartile_interpretation(self) -> None:
        values = list(range(1, 101))
        self.assertEqual(risk_from_distribution(10, values)[0], RiskLevel.low)
        self.assertEqual(risk_from_distribution(40, values)[0], RiskLevel.moderate)
        self.assertEqual(risk_from_distribution(70, values)[0], RiskLevel.high)
        self.assertEqual(risk_from_distribution(90, values)[0], RiskLevel.very_high)

    def test_stale_realtime_falls_back(self) -> None:
        now = datetime(2026, 4, 1, 8, tzinfo=timezone.utc)
        self.assertFalse(realtime_is_fresh(now - timedelta(minutes=3), now))

    def test_fresh_realtime_is_usable(self) -> None:
        now = datetime(2026, 4, 1, 8, tzinfo=timezone.utc)
        self.assertTrue(realtime_is_fresh(now - timedelta(seconds=30), now))
