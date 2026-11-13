import unittest

from perf_ui import compare, distribution, sample_map, validate_baseline


class PerformanceMetricsTest(unittest.TestCase):
    def test_sample_map_has_unique_keys_and_exact_count(self):
        document = sample_map(1000)
        pending, seen = [document["tree"]], set()
        while pending:
            node = pending.pop()
            self.assertNotIn(node["key"], seen)
            seen.add(node["key"])
            pending.extend(node["children"])
        self.assertEqual(len(seen), 1000)

    def test_distribution_and_empty_input(self):
        self.assertEqual(distribution([10, 20, 30, 40, 50]),
                         {"samples": 5, "median_ms": 30, "p95_ms": 50, "max_ms": 50})
        with self.assertRaises(ValueError):
            distribution([])

    def test_baseline_rejects_invalid_data(self):
        report = {"schema": 1, "engine": "test", "viewport": [1, 2], "os": "Linux", "browser_version": "1"}
        with self.assertRaises(ValueError):
            validate_baseline({**report, "scenarios": [{"nodes": 100}]}, report, [100])
        with self.assertRaises(ValueError):
            validate_baseline({**report, "os": "Windows", "scenarios": []}, report, [100])

    def test_comparison_uses_matching_node_counts(self):
        def scenario(count, value):
            return {"nodes": count, **{name: {"p95_ms": value} for name in
                    ("idle_frames", "pan_frames", "zoom_frames", "drag_frames", "input_to_frame")}}
        result = compare([scenario(100, 20)], {"scenarios": [scenario(500, 10), scenario(100, 10)]})
        self.assertEqual(result[0]["nodes"], 100)
        self.assertEqual(result[0]["drag_frames_p95_ratio"], 2)


if __name__ == "__main__":
    unittest.main()
