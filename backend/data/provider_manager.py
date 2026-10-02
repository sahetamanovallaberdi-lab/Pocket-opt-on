from datetime import datetime, timezone
from time import perf_counter
from typing import Any

from backend.brokers.base import MarketDataAdapter
from backend.brokers.pocket_option import PocketOptionProvider
from backend.data.candles import MultiTimeframeCandleBuilder, Tick
from backend.data.demo_provider import DemoProvider
from backend.data.mtf_store import MTFDataStore
from backend.data.validation import validate_candles


class MarketDataProvider:
    """Select an authorized source when available; otherwise fail over to local demo data."""

    def __init__(self, official: MarketDataAdapter | None = None, demo: MarketDataAdapter | None = None):
        self.official = official or PocketOptionProvider()
        self.demo = demo or DemoProvider()
        self.active = self.official if self.official.is_authorized else self.demo
        self.store = MTFDataStore()
        self._last_update: str | None = None
        self._last_error: str | None = None
        self._last_validation: dict[str, Any] | None = None
        self._last_latency_ms: float | None = None
        self._tick_builders: dict[str, MultiTimeframeCandleBuilder] = {}
        self._tick_pairs: set[str] = set()
        self._healthy = self.active is self.demo
        if self.active is self.demo:
            self._last_error = "No officially authorized Pocket Option market-data integration is configured; deterministic demo data is active."

    @property
    def name(self) -> str:
        return self.active.name

    @property
    def last_validation(self) -> dict[str, Any] | None:
        return self._last_validation

    def status(self) -> dict[str, Any]:
        is_demo = self.active is self.demo
        status = "DEMO" if is_demo and self._healthy else "CONNECTED" if self._healthy else "UNAVAILABLE" if is_demo else "DISCONNECTED"
        return {
            "status": status,
            "last_update": self._last_update,
            "source": self.active.name,
            "connected": self._healthy,
            "latency_ms": self._last_latency_ms,
            "error": self._last_error,
        }

    def list_pairs(self) -> list[str]:
        source = self.active
        try:
            pairs = source.list_pairs()
        except Exception as error:
            if source is not self.official:
                self._healthy = False
                self._last_error = f"{source.name} provider failed: {error}"
                raise
            return self._demo_pairs(f"Official provider failed: {error}. Demo fallback is active.")

        if pairs:
            return pairs
        if source is self.official:
            return self._demo_pairs("Official provider returned no available pairs; demo fallback is active.")

        self._healthy = False
        self._last_error = "No market pairs are available from the active provider."
        return []

    def _demo_pairs(self, reason: str) -> list[str]:
        self._activate_demo(reason)
        try:
            pairs = self.demo.list_pairs()
        except Exception as error:
            self._healthy = False
            self._last_error = f"Demo provider failed: {error}"
            raise
        if not pairs:
            self._healthy = False
            self._last_error = "No market pairs are available from the active provider."
        return pairs

    def ingest_tick(self, pair: str, tick: Tick) -> dict[str, list[dict[str, Any]]]:
        started = perf_counter()
        normalized_pair = pair.upper()
        builder = self._tick_builders.setdefault(normalized_pair, MultiTimeframeCandleBuilder())
        closed_by_timeframe = builder.add_tick(tick)
        validated_by_timeframe: dict[str, list[dict[str, Any]]] = {}
        for timeframe, closed_candles in closed_by_timeframe.items():
            candles, validation = validate_candles(closed_candles, timeframe)
            self.store.put(normalized_pair, timeframe, candles)
            validated_by_timeframe[timeframe] = candles
            self._last_validation = validation

        self._tick_pairs.add(normalized_pair)
        self._last_latency_ms = round((perf_counter() - started) * 1000, 3)
        if closed_by_timeframe:
            self._last_update = datetime.now(timezone.utc).isoformat()
            if self.active is self.official:
                self._healthy = True
                self._last_error = None
        return validated_by_timeframe

    def candles(self, pair: str, timeframe: str, limit: int = 240) -> list[dict[str, Any]]:
        started = perf_counter()
        normalized_pair = pair.upper()
        from_tick_stream = normalized_pair in self._tick_pairs
        try:
            raw = self.store.get(normalized_pair, timeframe, limit) if from_tick_stream else self.active.candles(pair, timeframe, limit)
            candles, validation = validate_candles(raw, timeframe)
        except Exception as error:
            if self.active is self.official and not from_tick_stream:
                self._activate_demo(f"Official provider failed: {error}. Demo fallback is active.")
                try:
                    raw = self.demo.candles(pair, timeframe, limit)
                    candles, validation = validate_candles(raw, timeframe)
                except Exception as demo_error:
                    self._healthy = False
                    self._last_error = f"Demo fallback unavailable or invalid: {demo_error}"
                    self._last_latency_ms = round((perf_counter() - started) * 1000, 3)
                    raise
            else:
                self._healthy = False
                self._last_error = f"{self.active.name} data unavailable or invalid: {error}"
                self._last_latency_ms = round((perf_counter() - started) * 1000, 3)
                raise

        self._last_latency_ms = round((perf_counter() - started) * 1000, 3)
        self._healthy = True
        self._last_update = datetime.now(timezone.utc).isoformat()
        self._last_validation = validation
        candles = self.store.put(pair, timeframe, candles)[-limit:]
        if validation["status"] == "WARNING":
            self._last_error = "; ".join(validation["issues"])
        elif self.active is self.demo:
            if not self.official.is_authorized:
                self._last_error = "No officially authorized Pocket Option market-data integration is configured; deterministic demo data is active."
        else:
            self._last_error = None
        return candles

    def _activate_demo(self, reason: str) -> None:
        if self.active is not self.demo:
            self.store.clear()
            self._tick_builders.clear()
            self._tick_pairs.clear()
        self.active = self.demo
        self._healthy = True
        self._last_error = reason