import unittest

from backend.brokers.base import MarketDataAdapter
from backend.data.candles import MultiTimeframeCandleBuilder, Tick, TickCandleBuilder
from backend.data.demo_provider import DemoProvider, MockDemoProvider
from backend.data.mock_provider import MockProvider
from backend.data.mtf_store import MTFDataStore
from backend.data.provider_manager import MarketDataProvider
from backend.data.validation import validate_candles
from backend.timeframes.definitions import TIMEFRAMES


class FailingOfficialProvider(MarketDataAdapter):
    name = "official-test"
    is_authorized = True

    def list_pairs(self):
        return ["EURUSD"]

    def candles(self, pair, timeframe, limit=240):
        raise ConnectionError("official feed unavailable")


class FailingDemoProvider(DemoProvider):
    def candles(self, pair, timeframe, limit=240):
        raise ConnectionError("demo feed unavailable")


class TickFeedProvider(MarketDataAdapter):
    name = "authorized-tick-test"
    is_authorized = True

    def list_pairs(self):
        return ["EURUSD"]

    def candles(self, pair, timeframe, limit=240):
        raise AssertionError("Tick-built candles should be read from the MTF store")


class EmptyOfficialProvider(FailingOfficialProvider):
    def list_pairs(self):
        return []


class MarketDataProviderTests(unittest.TestCase):
    def test_unauthorized_pocket_option_source_selects_demo_explicitly(self):
        provider = MarketDataProvider()
        status = provider.status()

        self.assertEqual(provider.name, "demo")
        self.assertEqual(status["status"], "DEMO")
        self.assertTrue(status["connected"])
        self.assertIsNone(status["last_update"])
        self.assertIn("authorized", status["error"])
        self.assertEqual(MockProvider.name, "mock")
        self.assertNotEqual(DemoProvider.name, MockProvider.name)

    def test_failed_authorized_source_falls_back_to_demo(self):
        provider = MarketDataProvider(official=FailingOfficialProvider(), demo=MockDemoProvider())
        candles = provider.candles("EURUSD", "1m", 40)

        self.assertEqual(provider.name, "demo")
        self.assertEqual(len(candles), 40)
        self.assertEqual(provider.status()["status"], "DEMO")
        self.assertIsNotNone(provider.status()["latency_ms"])
        self.assertIn("official feed unavailable", provider.status()["error"])

    def test_official_provider_with_no_pairs_uses_dynamic_demo_pair_list(self):
        provider = MarketDataProvider(official=EmptyOfficialProvider(), demo=DemoProvider())

        pairs = provider.list_pairs()

        self.assertEqual(pairs, DemoProvider().list_pairs())
        self.assertEqual(provider.status()["status"], "DEMO")

    def test_unavailable_demo_fallback_is_reported_without_claiming_connection(self):
        provider = MarketDataProvider(official=FailingOfficialProvider(), demo=FailingDemoProvider())

        with self.assertRaises(ConnectionError):
            provider.candles("EURUSD", "1m", 40)

        self.assertEqual(provider.status()["status"], "UNAVAILABLE")
        self.assertFalse(provider.status()["connected"])
        self.assertIn("demo feed unavailable", provider.status()["error"])

    def test_mock_source_returns_valid_closed_ohlc_for_all_timeframes(self):
        provider = MarketDataProvider()

        for timeframe in TIMEFRAMES:
            with self.subTest(timeframe=timeframe):
                candles = provider.candles("EURUSD", timeframe, 40)
                normalized, report = validate_candles(candles, timeframe)
                self.assertEqual(len(normalized), 40)
                self.assertTrue(all(candle["closed"] for candle in normalized))
                self.assertEqual(report["status"], "VALID")
                self.assertEqual(report["missing_intervals"], 0)

    def test_validation_reports_duplicates_order_gaps_and_drops_bad_ohlc(self):
        candles = [
            {"time": 120, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "closed": True},
            {"time": 60, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "closed": True},
            {"time": 120, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.16, "closed": True},
            {"time": 240, "open": 1.1, "high": 1.0, "low": 1.2, "close": 1.15, "closed": True},
            {"time": 300, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "closed": True},
            {"time": 360, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "closed": False},
        ]

        normalized, report = validate_candles(candles, "1m")

        self.assertEqual([candle["time"] for candle in normalized], [60, 120, 300])
        self.assertEqual(normalized[1]["close"], 1.16)
        self.assertEqual(report["duplicate_count"], 1)
        self.assertEqual(report["out_of_order_count"], 1)
        self.assertEqual(report["invalid_count"], 1)
        self.assertEqual(report["missing_intervals"], 2)
        self.assertEqual(report["unclosed_count"], 1)
        self.assertEqual(report["status"], "WARNING")

    def test_tick_builder_forms_ohlc_and_emits_only_closed_candles(self):
        builder = TickCandleBuilder("1m")

        self.assertIsNone(builder.add_tick(Tick(60, 1.1)))
        self.assertIsNone(builder.add_tick(Tick(75, 1.3, 2)))
        candle = builder.add_tick(Tick(120, 1.2))

        self.assertEqual(candle, {
            "time": 60, "open": 1.1, "high": 1.3, "low": 1.1,
            "close": 1.3, "volume": 3, "tick_volume": 2, "closed": True,
        })
        self.assertFalse(builder.current["closed"])

    def test_tick_builder_ignores_duplicate_invalid_and_out_of_order_ticks(self):
        builder = TickCandleBuilder("30s")
        first = Tick(30, 1.2)
        builder.add_tick(first)
        builder.add_tick(Tick(31, 1.25))
        builder.add_tick(first)
        builder.add_tick(Tick(29, 1.1))
        builder.add_tick(Tick(31, float("nan")))

        self.assertEqual(builder.duplicate_count, 1)
        self.assertEqual(builder.out_of_order_count, 1)
        self.assertEqual(builder.invalid_count, 1)
        self.assertEqual(builder.current["close"], 1.25)

    def test_mtf_builder_uses_one_tick_stream_and_does_not_fill_gaps(self):
        builder = MultiTimeframeCandleBuilder({"30s": 30, "1m": 60, "5m": 300})
        closed = {}
        for timestamp, price in ((0, 1.0), (30, 1.1), (60, 1.2), (300, 1.3)):
            for timeframe, candles in builder.add_tick(Tick(timestamp, price)).items():
                closed.setdefault(timeframe, []).extend(candles)

        self.assertEqual([candle["time"] for candle in closed["30s"]], [0, 30, 60])
        self.assertEqual([candle["time"] for candle in closed["1m"]], [0, 60])
        self.assertEqual([candle["time"] for candle in closed["5m"]], [0])
        self.assertTrue(all(candle["closed"] for candles in closed.values() for candle in candles))

    def test_mtf_store_keeps_only_closed_sorted_deduplicated_candles(self):
        store = MTFDataStore()
        candles = [
            {"time": 60, "close": 1.1, "closed": True},
            {"time": 0, "close": 1.0, "closed": True},
            {"time": 120, "close": 1.2, "closed": False},
            {"time": 60, "close": 1.15, "closed": True},
        ]

        stored = store.put("EURUSD", "1m", candles)

        self.assertEqual([item["time"] for item in stored], [0, 60])
        self.assertEqual(stored[-1]["close"], 1.15)

    def test_tick_pipeline_stores_validated_candles_for_strategy_consumers(self):
        provider = MarketDataProvider(official=TickFeedProvider(), demo=DemoProvider())
        for timestamp in range(0, 1861, 60):
            provider.ingest_tick("EURUSD", Tick(timestamp, 1 + timestamp / 10000))

        candles = provider.candles("eurusd", "1m", 30)

        self.assertEqual(len(candles), 30)
        self.assertTrue(all(candle["closed"] for candle in candles))
        self.assertEqual(provider.status()["status"], "CONNECTED")
        self.assertEqual(provider.last_validation["status"], "VALID")


if __name__ == "__main__":
    unittest.main()