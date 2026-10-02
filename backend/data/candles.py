import math
from collections import deque
from dataclasses import dataclass
from typing import Any

from backend.timeframes.definitions import TIMEFRAMES


@dataclass(frozen=True)
class Tick:
    timestamp: float
    price: float
    volume: float = 1.0


class TickCandleBuilder:
    def __init__(self, timeframe: str):
        if timeframe not in TIMEFRAMES:
            raise ValueError(f"Unsupported timeframe: {timeframe}")
        self.timeframe = timeframe
        self.interval = TIMEFRAMES[timeframe]
        self.current: dict[str, Any] | None = None
        self.last_timestamp: float | None = None
        self._recent_ticks: deque[tuple[float, float, float]] = deque(maxlen=4096)
        self._seen_ticks: set[tuple[float, float, float]] = set()
        self.duplicate_count = 0
        self.out_of_order_count = 0
        self.invalid_count = 0

    def add_tick(self, tick: Tick) -> dict[str, Any] | None:
        if (
            not math.isfinite(tick.timestamp)
            or tick.timestamp < 0
            or not math.isfinite(tick.price)
            or tick.price <= 0
            or not math.isfinite(tick.volume)
            or tick.volume < 0
        ):
            self.invalid_count += 1
            return None

        tick_key = (tick.timestamp, tick.price, tick.volume)
        if tick_key in self._seen_ticks:
            self.duplicate_count += 1
            return None
        if self.last_timestamp is not None and tick.timestamp < self.last_timestamp:
            self.out_of_order_count += 1
            return None

        if len(self._recent_ticks) == self._recent_ticks.maxlen:
            self._seen_ticks.discard(self._recent_ticks[0])
        self._recent_ticks.append(tick_key)
        self._seen_ticks.add(tick_key)
        self.last_timestamp = tick.timestamp
        bucket = int(tick.timestamp) // self.interval * self.interval
        if self.current is None:
            self.current = self._new_candle(bucket, tick)
            return None

        if bucket == self.current["time"]:
            self._update_candle(self.current, tick)
            return None

        if bucket < self.current["time"]:
            self.out_of_order_count += 1
            return None

        closed = {**self.current, "closed": True}
        self.current = self._new_candle(bucket, tick)
        return closed

    @staticmethod
    def _new_candle(bucket: int, tick: Tick) -> dict[str, Any]:
        return {
            "time": bucket,
            "open": tick.price,
            "high": tick.price,
            "low": tick.price,
            "close": tick.price,
            "volume": int(tick.volume),
            "tick_volume": 1,
            "closed": False,
        }

    @staticmethod
    def _update_candle(candle: dict[str, Any], tick: Tick) -> None:
        candle["high"] = max(candle["high"], tick.price)
        candle["low"] = min(candle["low"], tick.price)
        candle["close"] = tick.price
        candle["volume"] += int(tick.volume)
        candle["tick_volume"] += 1


class MultiTimeframeCandleBuilder:
    def __init__(self, timeframes: dict[str, int] | None = None):
        selected_timeframes = timeframes or TIMEFRAMES
        self.builders = {name: TickCandleBuilder(name) for name in selected_timeframes}

    def add_tick(self, tick: Tick) -> dict[str, list[dict[str, Any]]]:
        closed: dict[str, list[dict[str, Any]]] = {}
        for timeframe, builder in self.builders.items():
            candle = builder.add_tick(tick)
            if candle is not None:
                closed.setdefault(timeframe, []).append(candle)
        return closed