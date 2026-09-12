import unittest

from backend.data_pipeline.shape_matcher import ShapePoint, monotonic_progress_ratio, project_to_shape


class ShapeMatcherTests(unittest.TestCase):
    def test_projection_returns_progress_and_distance(self) -> None:
        shape = [ShapePoint(3.0, 101.0, 1), ShapePoint(3.0, 101.01, 2)]
        projection = project_to_shape(3.0001, 101.005, shape)
        assert projection is not None
        self.assertGreater(projection.progress_metres, 500)
        self.assertLess(projection.distance_metres, 20)

    def test_progress_quality_rejects_reversed_trace(self) -> None:
        self.assertEqual(monotonic_progress_ratio([300, 200, 100], 0), 0)
        self.assertEqual(monotonic_progress_ratio([100, 200, 300], 0), 1)
