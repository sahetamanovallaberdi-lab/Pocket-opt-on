from datetime import datetime, timezone
from typing import Any

from backend.indicators.engine import ema, rsi


def _pivots(values: list[float], mode: str) -> list[int]:
    indices = []
    for index in range(2, len(values) - 2):
        window = values[index - 2:index + 3]
        if mode == "low" and values[index] == min(window):
            indices.append(index)
        elif mode == "high" and values[index] == max(window):
            indices.append(index)
    return indices


def _divergence_event(name: str, detected: bool, direction: str, timestamp: int, price: float, strength: int) -> dict[str, Any]:
    return {"name": name, "detected": detected, "direction": direction if detected else "neutral", "strength": strength if detected else 0, "timestamp": timestamp, "priceLevel": round(float(price), 6)}


def detect_divergences(candles: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [float(candle["close"]) for candle in candles]
    highs = [float(candle["high"]) for candle in candles]
    lows = [float(candle["low"]) for candle in candles]
    if len(closes) < 20:
        return {"rsi": [], "macd": []}
    rsi_values = []
    for index in range(len(closes)):
        rsi_values.append(rsi(closes[:index + 1], 14))
    macd_values = [fast - slow for fast, slow in zip(ema(closes, 12), ema(closes, 26))]
    output: dict[str, list[dict[str, Any]]] = {"rsi": [], "macd": []}
    for oscillator_name, oscillator in (("RSI", rsi_values), ("MACD", macd_values)):
        for mode in ("low", "high"):
            prices = lows if mode == "low" else highs
            points = _pivots(prices, mode)[-2:]
            if len(points) < 2:
                continue
            previous, current = points
            bullish = prices[current] < prices[previous] and oscillator[current] > oscillator[previous]
            bearish = prices[current] > prices[previous] and oscillator[current] < oscillator[previous]
            detected = bullish or bearish
            direction = "bullish" if bullish else "bearish" if bearish else "neutral"
            output[oscillator_name.lower()].append(
                _divergence_event(f"{oscillator_name} {mode.title()} Divergence", detected, direction, int(candles[current]["time"]), prices[current], 72)
            )
    return output


def fibonacci_levels(candles: list[dict[str, Any]], lookback: int = 60) -> dict[str, Any]:
    sample = candles[-lookback:]
    if not sample:
        return {"high": None, "low": None, "levels": {}}
    high = max(float(candle["high"]) for candle in sample)
    low = min(float(candle["low"]) for candle in sample)
    span = high - low
    ratios = (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1)
    levels = {f"{ratio:.3f}": round(high - span * ratio, 6) for ratio in ratios}
    return {"high": round(high, 6), "low": round(low, 6), "levels": levels, "lookback": len(sample)}


def session_analysis(timestamp: int) -> dict[str, Any]:
    hour = datetime.fromtimestamp(timestamp, tz=timezone.utc).hour
    windows = {"Tokyo": (0, 9), "London": (7, 16), "New York": (12, 21)}
    active = [name for name, (start, end) in windows.items() if start <= hour < end]
    return {
        "timezone": "UTC",
        "active_sessions": active,
        "primary_session": active[-1] if active else "Off-session",
        "overlap": len(active) > 1,
        "utc_hour": hour,
        "note": "Session windows are UTC approximations; daylight-saving changes are not modeled.",
    }


def analyze_features(candles: list[dict[str, Any]]) -> dict[str, Any]:
    last_time = int(candles[-1]["time"]) if candles else 0
    divergence = detect_divergences(candles)
    detected_divergences = [event for events in divergence.values() for event in events if event["detected"]]
    return {
        "divergence": divergence,
        "fibonacci": fibonacci_levels(candles),
        "sessions": session_analysis(last_time),
        "divergence_events": detected_divergences,
    }
