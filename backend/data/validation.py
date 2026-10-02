import math
from typing import Any

from backend.timeframes.definitions import TIMEFRAMES


def validate_candles(candles: list[dict[str, Any]], timeframe: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if timeframe not in TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    if not candles:
        raise ValueError("Market data provider returned no candles")

    interval = TIMEFRAMES[timeframe]
    seen: dict[int, dict[str, Any]] = {}
    duplicates = 0
    invalid = 0
    unclosed = 0
    out_of_order = 0
    previous_input_time: int | None = None
    issues: list[str] = []

    for source_candle in candles:
        try:
            candle = {
                "time": int(source_candle["time"]),
                "open": float(source_candle["open"]),
                "high": float(source_candle["high"]),
                "low": float(source_candle["low"]),
                "close": float(source_candle["close"]),
                "volume": int(source_candle.get("volume", source_candle.get("tick_volume", 0))),
                "tick_volume": int(source_candle.get("tick_volume", source_candle.get("volume", 0))),
                "closed": bool(source_candle.get("closed", False)),
            }
        except (KeyError, TypeError, ValueError, OverflowError):
            invalid += 1
            continue

        if source_candle.get("closed") is not True:
            unclosed += 1
            continue

        prices = (candle["open"], candle["high"], candle["low"], candle["close"])
        if (
            not all(math.isfinite(price) and price > 0 for price in prices)
            or candle["time"] < 0
            or candle["time"] % interval != 0
            or candle["high"] < max(candle["open"], candle["close"])
            or candle["low"] > min(candle["open"], candle["close"])
            or candle["high"] < candle["low"]
            or candle["volume"] < 0
            or candle["tick_volume"] < 0
        ):
            invalid += 1
            continue

        if previous_input_time is not None and candle["time"] < previous_input_time:
            out_of_order += 1
        previous_input_time = candle["time"]
        if candle["time"] in seen:
            duplicates += 1
        seen[candle["time"]] = candle

    normalized = [seen[timestamp] for timestamp in sorted(seen)]
    missing = 0
    for previous, current in zip(normalized, normalized[1:]):
        gap = current["time"] - previous["time"]
        if gap > interval:
            missing += max(1, gap // interval - 1)

    if duplicates:
        issues.append(f"Removed {duplicates} duplicate candle timestamp(s)")
    if out_of_order:
        issues.append(f"Sorted {out_of_order} out-of-order candle(s)")
    if invalid:
        issues.append(f"Dropped {invalid} candle(s) with invalid OHLCV values")
    if unclosed:
        issues.append(f"Dropped {unclosed} candle(s) that were not explicitly closed")
    if missing:
        issues.append(f"Found {missing} missing candle interval(s); gaps were not synthesized")
    if not normalized:
        raise ValueError("Market data provider returned no valid OHLC candles")

    return normalized, {
        "status": "WARNING" if issues else "VALID",
        "candle_count": len(normalized),
        "duplicate_count": duplicates,
        "out_of_order_count": out_of_order,
        "invalid_count": invalid,
        "unclosed_count": unclosed,
        "missing_intervals": missing,
        "issues": issues,
        "first_timestamp": normalized[0]["time"],
        "last_timestamp": normalized[-1]["time"],
    }