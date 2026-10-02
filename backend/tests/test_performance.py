import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.data import database
from backend.performance.engine import summarize_performance


class PerformanceTests(unittest.TestCase):
    def test_metrics_and_breakdowns_use_only_resolved_trades(self):
        rows = [
            {"pair": "EURUSD", "timeframe": "1m", "session": "London", "confidence": 78, "expiry_seconds": 60, "decision": "CALL", "result": "WIN", "profit_units": 0.8, "status": "RESOLVED"},
            {"pair": "EURUSD", "timeframe": "5m", "session": "Overlap", "confidence": 82, "expiry_seconds": 180, "decision": "PUT", "result": "LOSS", "profit_units": -1.0, "status": "RESOLVED"},
            {"pair": "GBPUSD", "timeframe": "1m", "session": "Tokyo", "confidence": 88, "expiry_seconds": 300, "decision": "PUT", "result": "LOSS", "profit_units": -1.0, "status": "RESOLVED"},
            {"pair": "GBPUSD", "timeframe": "1m", "session": "Tokyo", "confidence": 0, "expiry_seconds": None, "decision": "NO_TRADE", "result": "SKIPPED", "profit_units": 0, "status": "NO_TRADE"},
            {"pair": "EURUSD", "timeframe": "1m", "session": "London", "confidence": 80, "expiry_seconds": 60, "decision": "CALL", "result": "PENDING", "profit_units": 0, "status": "PENDING"},
        ]

        report = summarize_performance(rows, source="mock-demo")

        self.assertEqual(report["overall"]["total_trades"], 3)
        self.assertEqual(report["overall"]["no_trade_signals"], 1)
        self.assertEqual(report["overall"]["wins"], 1)
        self.assertEqual(report["overall"]["losses"], 2)
        self.assertEqual(report["overall"]["win_rate"], 33.33)
        self.assertEqual(report["overall"]["profit_factor"], 0.4)
        self.assertEqual(report["overall"]["expectancy_units"], -0.4)
        self.assertEqual(report["overall"]["max_drawdown_units"], 2.0)
        self.assertEqual(report["overall"]["max_consecutive_losses"], 2)
        self.assertEqual(report["pair_performance"]["EURUSD"]["total_trades"], 2)
        self.assertEqual(report["timeframe_performance"]["5m"]["total_trades"], 1)
        self.assertEqual(report["session_performance"]["Overlap"]["total_trades"], 1)
        self.assertEqual(report["confidence_performance"]["75-80%"]["total_trades"], 1)
        self.assertEqual(report["confidence_performance"]["80-85%"]["total_trades"], 1)
        self.assertEqual(report["confidence_performance"]["85%+"]["total_trades"], 1)
        self.assertEqual(report["expiry_performance"]["1m"]["total_trades"], 1)
        self.assertEqual(report["source"], "mock-demo")

    def test_empty_history_reports_unavailable_rates_not_zero_success(self):
        report = summarize_performance([], source="mock-demo")
        self.assertEqual(report["overall"]["total_trades"], 0)
        self.assertIsNone(report["overall"]["win_rate"])
        self.assertIsNone(report["overall"]["profit_factor"])
        self.assertIsNone(report["overall"]["expectancy_units"])
        self.assertFalse(report["has_resolved_results"])

    def test_journal_is_idempotent_and_waits_for_expiry_candle(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(database, "DATA_DIR", Path(directory)), patch.object(database, "DATABASE_PATH", Path(directory) / "test.sqlite3"):
                database.initialize()
                base_candle = {"time": 1000, "open": 1.0, "high": 1.01, "low": 0.99, "close": 1.0, "volume": 5, "closed": True}
                database.save_candles("EURUSD", "1m", [base_candle], source="mock-demo")
                entry = {"pair": "EURUSD", "timeframe": "1m", "timestamp": 1000, "decision": "CALL", "confidence": 78, "expiry_seconds": 60, "entry_price": 1.0, "payout": 0.82, "session": "London", "regime": "TRENDING_UP", "reasons": ["EMA and structure aligned"], "source": "mock-demo"}

                first_id = database.record_journal_signal(entry)
                second_id = database.record_journal_signal(entry)
                self.assertEqual(first_id, second_id)
                self.assertEqual(database.resolve_pending_journal("EURUSD", "1m"), 0)
                self.assertEqual(database.get_signal_journal()[0]["status"], "PENDING")

                later_candle = {"time": 1060, "open": 1.0, "high": 1.02, "low": 1.0, "close": 1.01, "volume": 7, "closed": True}
                database.save_candles("EURUSD", "1m", [later_candle], source="mock-demo")
                self.assertEqual(database.resolve_pending_journal("EURUSD", "1m"), 1)
                resolved = database.get_signal_journal()[0]
                self.assertEqual(resolved["result"], "WIN")
                self.assertEqual(resolved["status"], "RESOLVED")
                self.assertEqual(resolved["profit_units"], 0.82)


if __name__ == "__main__":
    unittest.main()
