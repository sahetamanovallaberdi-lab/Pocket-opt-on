import unittest

from fastapi.testclient import TestClient

from backend.api.main import app


class MarketApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)

    def test_demo_market_is_available_without_external_credentials(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["mode"], "SIGNAL_ONLY")
        status = self.client.get("/api/provider/status").json()
        self.assertEqual(status["status"], "DEMO")
        self.assertEqual(status["source"], "demo")

        pairs = self.client.get("/api/pairs")
        self.assertEqual(pairs.status_code, 200)
        self.assertIn("EURUSD", pairs.json()["pairs"])

        market = self.client.get("/api/market/EURUSD", params={"timeframe": "1m"})
        self.assertEqual(market.status_code, 200)
        payload = market.json()
        self.assertEqual(payload["provider"], "demo")
        self.assertEqual(payload["data_status"]["status"], "DEMO")
        self.assertEqual(payload["data_validation"]["status"], "VALID")
        self.assertTrue(payload["candles"])
        self.assertTrue(payload["candles"][-1]["closed"])
        self.assertIsNotNone(payload["analysis"]["indicators"]["rsi"])
        self.assertTrue(payload["analysis"]["structure"])
        self.assertEqual(len(payload["analysis"]["strategies"]), 5)
        self.assertIn("features", payload["analysis"])
        self.assertEqual(payload["analysis"]["false_signal_filter"]["confidence_threshold"], 75)

    def test_provider_status_exposes_dashboard_monitoring_fields(self):
        self.client.get("/api/market/EURUSD", params={"timeframe": "1m"})
        status = self.client.get("/api/provider/status").json()

        self.assertEqual(status["status"], "DEMO")
        self.assertEqual(status["source"], "demo")
        self.assertIsNotNone(status["last_update"])
        self.assertIsInstance(status["latency_ms"], (int, float))
        self.assertIn("error", status)

    def test_replay_stops_at_the_requested_closed_candle_prefix(self):
        response = self.client.get("/api/replay/EURUSD", params={"timeframe": "1m", "bars": 45})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["replay_bars"], 45)
        self.assertEqual(payload["analysis"]["candle_count"], 45)
        self.assertEqual(payload["analysis"]["last_closed_at"], payload["candles"][-1]["time"])

    def test_paper_trades_are_recorded_without_broker_execution(self):
        response = self.client.post("/api/paper/trades", json={
            "pair": "EURUSD", "timeframe": "1m", "direction": "CALL",
            "entry_price": 1.08, "stake": 10, "expiry_seconds": 60,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "PAPER_ONLY")
        self.assertEqual(self.client.get("/api/paper/trades").status_code, 200)

    def test_risk_endpoint_only_calculates_position_size(self):
        response = self.client.post("/api/risk/position-size", json={
            "balance": 1000, "risk_percent": 1, "stop_distance": 0.01,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["risk_amount"], 10)
        self.assertEqual(response.json()["position_size"], 1000)

    def test_unsupported_timeframe_is_rejected(self):
        response = self.client.get("/api/market/EURUSD", params={"timeframe": "2m"})
        self.assertEqual(response.status_code, 422)

    def test_websocket_stream_includes_demo_status_and_validated_candles(self):
        with self.client.websocket_connect("/ws/market/EURUSD?timeframe=30s") as websocket:
            payload = websocket.receive_json()

        self.assertEqual(payload["data_status"]["status"], "DEMO")
        self.assertEqual(payload["data_status"]["source"], "demo")
        self.assertEqual(payload["data_validation"]["status"], "VALID")
        self.assertTrue(all(candle["closed"] for candle in payload["candles"]))

    def test_websocket_heartbeat_is_answered_and_connection_can_reconnect(self):
        for _ in range(2):
            with self.client.websocket_connect("/ws/market/EURUSD?timeframe=30s") as websocket:
                websocket.receive_json()
                websocket.send_json({"type": "ping", "timestamp": 123})
                self.assertEqual(websocket.receive_json(), {"type": "pong", "timestamp": 123})

    def test_market_decisions_are_saved_to_the_full_signal_journal(self):
        self.client.get("/api/market/GBPUSD", params={"timeframe": "5m"})
        response = self.client.get("/api/journal", params={"pair": "GBPUSD", "limit": 1})
        self.assertEqual(response.status_code, 200)
        signal = response.json()["signals"][0]
        self.assertEqual(signal["pair"], "GBPUSD")
        self.assertEqual(signal["timeframe"], "5m")
        self.assertIn(signal["decision"], ("CALL", "PUT", "NO_TRADE"))
        self.assertIn("confidence", signal)
        self.assertIn("expiry_seconds", signal)
        self.assertTrue(signal["reasons"])
        self.assertEqual(signal["source"], "demo")

    def test_performance_endpoint_does_not_count_pending_signals_as_trades(self):
        response = self.client.get("/api/performance", params={"pair": "NO-SUCH-JOURNAL-PAIR"})
        self.assertEqual(response.status_code, 200)
        report = response.json()
        self.assertEqual(report["overall"]["total_trades"], 0)
        self.assertIsNone(report["overall"]["win_rate"])
        self.assertFalse(report["has_resolved_results"])


if __name__ == "__main__":
    unittest.main()
