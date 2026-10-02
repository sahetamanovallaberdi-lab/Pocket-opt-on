from typing import Any

from backend.signals.engine import analyze
from backend.timeframes.definitions import TIMEFRAMES


def _direction(analysis: dict[str, Any]) -> str:
    if analysis.get("regime") in ("RANGING", "HIGH_VOLATILITY"):
        return "NEUTRAL"
    regime = analysis.get("regime_details", {})
    direction = regime.get("direction", "NEUTRAL")
    return direction if direction in ("BULLISH", "BEARISH") else "NEUTRAL"


def _confidence(analysis: dict[str, Any]) -> int:
    active = [item["confidence"] for item in analysis["strategies"] if item["strategy_status"] == "CONFIRMED"]
    return max(active, default=max((item["confidence"] for item in analysis["strategies"]), default=0))


def analyze_timeframes(pair: str, provider: Any, settings: dict[str, Any], candle_store: dict[str, list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    """Fetch and analyze each timeframe's own candles; never resample/mix series."""
    results: dict[str, dict[str, Any]] = {}
    directions: dict[str, int] = {"BULLISH": 0, "BEARISH": 0, "NEUTRAL": 0}
    for timeframe in TIMEFRAMES:
        candles = provider.candles(pair, timeframe, 240)
        if candle_store is not None:
            candle_store[timeframe] = candles
        result = analyze(candles, {**settings, "timeframe": timeframe})
        direction = _direction(result)
        results[timeframe] = {
            "direction": direction,
            "confidence": _confidence(result),
            "regime": result["regime"],
            "regime_category": result["regime_category"],
            "regime_details": result["regime_details"],
            "strategies": result["strategies"],
            "agreement": result["agreement"],
            "last_closed_at": result["last_closed_at"],
            "candle_count": result["candle_count"],
        }
        directions[direction] += 1

    higher_directions = [results[timeframe]["direction"] for timeframe in ("1h", "30m", "15m")]
    higher_bullish = higher_directions.count("BULLISH")
    higher_bearish = higher_directions.count("BEARISH")
    higher_direction = "BULLISH" if higher_bullish > higher_bearish else "BEARISH" if higher_bearish > higher_bullish else "NEUTRAL"
    dominant_direction = "BULLISH" if directions["BULLISH"] > directions["BEARISH"] else "BEARISH" if directions["BEARISH"] > directions["BULLISH"] else "NEUTRAL"
    agreement_count = directions[dominant_direction] if dominant_direction != "NEUTRAL" else directions["NEUTRAL"]
    return {
        "pair": pair,
        "timeframes": results,
        "higher_timeframe_direction": higher_direction,
        "agreement": {"count": agreement_count, "total": len(TIMEFRAMES), "direction": dominant_direction, "votes": directions},
        "final_signal": None,
        "entry_timeframes": ["5m", "1m", "30s"],
        "trend_timeframes": ["1h", "30m", "15m"],
    }
