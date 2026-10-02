import unittest

from backend.scoring.engine import score_market


class StrategyEngineTests(unittest.TestCase):
    def setUp(self):
        self.candles = [
            {
                "time": 1_700_000_000 + index * 60,
                "open": 1.1 + index * 0.0004,
                "high": 1.101 + index * 0.0004,
                "low": 1.099 + index * 0.0004,
                "close": 1.1005 + index * 0.0004,
                "volume": 1000 + index,
                "closed": True,
            }
            for index in range(80)
        ]
        self.indicators = {
            "ema": {"9": 1.132, "21": 1.128, "50": 1.12, "200": 1.1},
            "rsi": 61,
            "macd_histogram": 0.001,
            "bollinger": {"upper": 1.14, "middle": 1.13, "lower": 1.12},
            "stochastic": 72,
            "adx": 34,
            "atr": 0.002,
            "atr_average": 0.002,
            "tick_volume": 1200,
            "volume_average": 1000,
            "momentum": 0.005,
        }
        self.structure = [
            {"name": "Higher High / Higher Low", "detected": True, "direction": "bullish", "strength": 70, "priceLevel": 1.13},
            {"name": "BOS", "detected": True, "direction": "bullish", "strength": 82, "priceLevel": 1.132},
            {"name": "Support / Resistance", "detected": True, "direction": "bullish", "strength": 58, "priceLevel": 1.125},
        ]

    def test_trending_regime_and_independent_strategy_outputs(self):
        result = score_market(self.indicators, self.structure, self.candles)

        self.assertEqual(result["regime"], "TRENDING_UP")
        strategies = result["strategies"]
        self.assertEqual(
            {strategy["name"] for strategy in strategies},
            {"Trend Following", "Pullback", "Breakout", "Reversal", "Liquidity Sweep"},
        )
        self.assertTrue(all("confidence" in strategy and "reasons" in strategy for strategy in strategies))
        self.assertTrue(all("market_conditions" in strategy and "strategy_status" in strategy for strategy in strategies))
        self.assertIn("agreement", result)
        self.assertIsNone(result["final_signal"])

    def test_high_volatility_is_reported_without_forcing_final_signal(self):
        indicators = {**self.indicators, "atr": 0.01, "atr_average": 0.002}
        result = score_market(indicators, self.structure, self.candles)

        self.assertEqual(result["regime"], "HIGH_VOLATILITY")
        self.assertIsNone(result["final_signal"])

    def test_mtf_api_returns_six_independent_timeframe_directions(self):
        from fastapi.testclient import TestClient
        from backend.api.main import app

        with TestClient(app) as client:
            response = client.get("/api/analysis/EURUSD")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload["timeframes"]), {"30s", "1m", "5m", "15m", "30m", "1h"})
        self.assertIn("agreement", payload)
        self.assertTrue(all("direction" in item and "confidence" in item for item in payload["timeframes"].values()))

    def test_open_candle_does_not_change_analysis(self):
        from backend.signals.engine import analyze

        baseline = analyze(self.candles)
        still_forming = {
            "time": self.candles[-1]["time"] + 60,
            "open": 1.2,
            "high": 9.0,
            "low": 0.1,
            "close": 8.0,
            "volume": 999999,
            "closed": False,
        }
        with_forming = analyze(self.candles + [still_forming])

        self.assertEqual(with_forming["last_closed_at"], baseline["last_closed_at"])
        self.assertEqual(with_forming["signal_decision"], baseline["signal_decision"])
        self.assertEqual(with_forming["indicators"], baseline["indicators"])

    def test_backtest_and_walk_forward_use_shared_analysis_engine(self):
        from backend.backtest.engine import run_backtest, run_walk_forward

        result = run_backtest(self.candles, 9, 21, 2, 0.8)
        walk_forward = run_walk_forward(self.candles, 9, 21, 2, 0.8)

        self.assertEqual(result["engine"], "shared-deterministic-closed-candle")
        self.assertEqual(walk_forward["method"], "chronological-no-shuffle")
        self.assertEqual(walk_forward["validation"]["engine"], "shared-deterministic-closed-candle")


if __name__ == "__main__":
    unittest.main()
