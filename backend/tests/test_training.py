import unittest

from backend.models.train_historical import chronological_boundaries, metrics


class TrainingEvaluationTests(unittest.TestCase):
    def test_split_is_chronological_70_15_15(self) -> None:
        self.assertEqual(chronological_boundaries(100), (70, 85))

    def test_mae_and_rmse(self) -> None:
        result = metrics([1, 2, 3], [2, 2, 2])
        self.assertAlmostEqual(result["mae"], 2 / 3)
        self.assertAlmostEqual(result["rmse"], (2 / 3) ** .5)
