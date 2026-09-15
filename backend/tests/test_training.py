import unittest
from datetime import date, datetime

from backend.models.train_historical import chronological_boundaries, chronological_partitions, metrics


class TrainingEvaluationTests(unittest.TestCase):
    def test_split_is_chronological_70_15_15(self) -> None:
        self.assertEqual(chronological_boundaries(100), (70, 85))

    def test_mae_and_rmse(self) -> None:
        result = metrics([1, 2, 3], [2, 2, 2])
        self.assertAlmostEqual(result["mae"], 2 / 3)
        self.assertAlmostEqual(result["rmse"], (2 / 3) ** .5)

    def test_six_month_split_uses_complete_holdout_months(self) -> None:
        rows = [
            {"service_date": date(2025, month, 1), "scheduled_arrival": datetime(2025, month, 1)}
            for month in range(1, 7)
        ]
        training, validation, test = chronological_partitions(rows)
        self.assertEqual([row["service_date"].month for row in training], [1, 2, 3, 4])
        self.assertEqual([row["service_date"].month for row in validation], [5])
        self.assertEqual([row["service_date"].month for row in test], [6])
