import hashlib
import math
import time
from typing import Any

from backend.brokers.base import MarketDataAdapter
from backend.timeframes.definitions import TIMEFRAMES

PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD", "EURGBP", "EURJPY", "GBPJPY", "XAUUSD", "BTCUSD", "EURUSD-OTC", "GBPUSD-OTC"]
BASE_PRICES = {"EURUSD": 1.0842, "GBPUSD": 1.2718, "USDJPY": 149.62, "USDCHF": 0.8842, "AUDUSD": 0.6581, "NZDUSD": 0.6112, "USDCAD": 1.3577, "EURGBP": 0.8528, "EURJPY": 162.21, "GBPJPY": 190.34, "XAUUSD": 2324.5, "BTCUSD": 64280.0, "EURUSD-OTC": 1.0842, "GBPUSD-OTC": 1.2718}


class DemoProvider(MarketDataAdapter):
    name = "demo"

    def list_pairs(self) -> list[str]:
        return PAIRS.copy()

    def candles(self, pair: str, timeframe: str, limit: int = 240) -> list[dict[str, Any]]:
        pair = pair.upper()
        if pair not in BASE_PRICES:
            raise ValueError(f"Unknown pair: {pair}")
        if timeframe not in TIMEFRAMES:
            raise ValueError(f"Unsupported timeframe: {timeframe}")
        count = max(30, min(limit, 500))
        interval = TIMEFRAMES[timeframe]
        end = int(time.time()) // interval * interval - interval
        seed = int(hashlib.sha256(pair.encode()).hexdigest()[:8], 16)
        base = BASE_PRICES[pair]
        scale = 0.00065 if base < 10 else base * 0.00065
        candles = []
        for index in range(count):
            phase = index - count + 1 + seed % 97
            close = base + scale * (0.85 * math.sin(phase / 8.1) + 0.35 * math.sin(phase / 2.7))
            previous = base + scale * (0.85 * math.sin((phase - 1) / 8.1) + 0.35 * math.sin((phase - 1) / 2.7))
            wick = scale * (0.16 + abs(math.sin(phase * 1.37)) * 0.48)
            volume = 700 + (seed + index * 137) % 1800
            candles.append({"time": end - (count - index - 1) * interval, "open": round(previous, 6), "high": round(max(previous, close) + wick, 6), "low": round(min(previous, close) - wick * 0.82, 6), "close": round(close, 6), "volume": volume, "tick_volume": volume, "closed": True})
        return candles


MockDemoProvider = DemoProvider
