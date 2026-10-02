from typing import Any


class MTFDataStore:
    def __init__(self, max_candles: int = 500):
        self.max_candles = max_candles
        self._candles: dict[tuple[str, str], dict[int, dict[str, Any]]] = {}

    def put(self, pair: str, timeframe: str, candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
        key = (pair.upper(), timeframe)
        stored = self._candles.setdefault(key, {})
        for candle in candles:
            if candle.get("closed") is True:
                stored[int(candle["time"])] = candle.copy()
        if len(stored) > self.max_candles:
            for timestamp in sorted(stored)[:-self.max_candles]:
                del stored[timestamp]
        return self.get(pair, timeframe, self.max_candles)

    def get(self, pair: str, timeframe: str, limit: int = 240) -> list[dict[str, Any]]:
        stored = self._candles.get((pair.upper(), timeframe), {})
        timestamps = sorted(stored)[-limit:]
        return [stored[timestamp].copy() for timestamp in timestamps]

    def clear(self) -> None:
        self._candles.clear()