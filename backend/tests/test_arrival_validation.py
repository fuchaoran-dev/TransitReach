import unittest

from backend.data_pipeline.evaluate_arrival_validation import validation_metrics


class ArrivalValidationTests(unittest.TestCase):
    def test_validation_metrics(self) -> None:
        result = validation_metrics([30, -60, 90], false_matches=1, reviewed=100)
        self.assertEqual(result["mae_seconds"], 60)
        self.assertEqual(result["within_120_seconds"], 1)
        self.assertEqual(result["false_match_rate"], .01)
