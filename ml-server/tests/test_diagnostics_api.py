import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app import species_detector


class DiagnosticsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_private_diagnostics_route_requires_the_server_api_key(self):
        with patch.dict(os.environ, {"SPECIES_API_KEY": "diagnostics-test-secret"}):
            denied = self.client.get("/api/v1/detect/diagnostics")
            allowed = self.client.get(
                "/api/v1/detect/diagnostics",
                headers={"X-API-Key": "diagnostics-test-secret"},
            )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        self.assertIn("diagnostics", allowed.json())
        self.assertIn("successful_inferences_total", allowed.json()["diagnostics"])

    def test_regular_health_does_not_include_aggregate_detector_metrics(self):
        with patch.object(species_detector, "_model", object()):
            response = self.client.get("/api/v1/detect/health")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("diagnostics", response.json())


if __name__ == "__main__":
    unittest.main()
