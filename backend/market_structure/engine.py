from typing import Any


def _event(name: str, detected: bool, direction: str, strength: int, timestamp: int, price: float) -> dict[str, Any]:
    return {"name": name, "detected": detected, "direction": direction, "strength": strength if detected else 0, "timestamp": timestamp, "priceLevel": round(float(price), 6)}


def analyze_structure(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    current, previous, before = candles[-1], candles[-2], candles[-3]
    recent = candles[-30:]
    swing_high = max(c["high"] for c in recent[:-1])
    swing_low = min(c["low"] for c in recent[:-1])
    timestamp = current["time"]
    width = max(swing_high - swing_low, 1e-12)
    body = abs(current["close"] - current["open"])
    upper_wick = current["high"] - max(current["open"], current["close"])
    lower_wick = min(current["open"], current["close"]) - current["low"]
    bull_sweep = current["low"] < swing_low and current["close"] > swing_low
    bear_sweep = current["high"] > swing_high and current["close"] < swing_high
    bull_engulf = current["close"] > current["open"] and previous["close"] < previous["open"] and current["close"] >= previous["open"] and current["open"] <= previous["close"]
    bear_engulf = current["close"] < current["open"] and previous["close"] > previous["open"] and current["close"] <= previous["open"] and current["open"] >= previous["close"]
    inside = current["high"] <= previous["high"] and current["low"] >= previous["low"]
    support_touches = sum(abs(c["low"] - swing_low) <= width * 0.04 for c in recent)
    resistance_touches = sum(abs(c["high"] - swing_high) <= width * 0.04 for c in recent)
    return [
        _event("Swing High", current["high"] > previous["high"] and current["high"] >= before["high"], "bearish", 48, timestamp, current["high"]),
        _event("Swing Low", current["low"] < previous["low"] and current["low"] <= before["low"], "bullish", 48, timestamp, current["low"]),
        _event("Higher High / Higher Low", current["high"] > previous["high"] and current["low"] > previous["low"], "bullish", 64, timestamp, current["high"]),
        _event("Lower High / Lower Low", current["high"] < previous["high"] and current["low"] < previous["low"], "bearish", 64, timestamp, current["low"]),
        _event("BOS", current["close"] > swing_high or current["close"] < swing_low, "bullish" if current["close"] > swing_high else "bearish", 82, timestamp, current["close"]),
        _event("CHoCH", (current["close"] > previous["high"] and previous["close"] < before["close"]) or (current["close"] < previous["low"] and previous["close"] > before["close"]), "bullish" if current["close"] > previous["high"] else "bearish", 78, timestamp, current["close"]),
        _event("Support / Resistance", support_touches >= 2 or resistance_touches >= 2, "bullish" if support_touches >= resistance_touches else "bearish", 56, timestamp, swing_low if support_touches >= resistance_touches else swing_high),
        _event("Equal High / Low", abs(current["high"] - previous["high"]) < width * 0.025 or abs(current["low"] - previous["low"]) < width * 0.025, "neutral", 54, timestamp, current["close"]),
        _event("Liquidity Sweep", bull_sweep or bear_sweep, "bearish" if bear_sweep else "bullish", 77, timestamp, current["high"] if bear_sweep else current["low"]),
        _event("Breakout", current["close"] > swing_high or current["close"] < swing_low, "bullish" if current["close"] > swing_high else "bearish", 73, timestamp, current["close"]),
        _event("False Breakout", bull_sweep or bear_sweep, "bearish" if bear_sweep else "bullish", 76, timestamp, current["close"]),
        _event("Pullback", abs(current["close"] - previous["close"]) < abs(previous["close"] - before["close"]) * 0.5 and body > 0, "bullish" if current["close"] >= current["open"] else "bearish", 42, timestamp, current["close"]),
        _event("Order Block", (previous["close"] < previous["open"] and current["close"] > previous["high"]) or (previous["close"] > previous["open"] and current["close"] < previous["low"]), "bullish" if current["close"] > previous["high"] else "bearish", 66, previous["time"], previous["open"]),
        _event("Fair Value Gap", current["low"] > before["high"] or current["high"] < before["low"], "bullish" if current["low"] > before["high"] else "bearish", 61, timestamp, before["high"] if current["low"] > before["high"] else before["low"]),
        _event("Doji", body <= (current["high"] - current["low"]) * 0.1, "neutral", 38, timestamp, current["close"]),
        _event("Hammer", lower_wick > body * 2 and upper_wick < body and current["close"] >= current["open"], "bullish", 62, timestamp, current["low"]),
        _event("Shooting Star", upper_wick > body * 2 and lower_wick < body and current["close"] <= current["open"], "bearish", 62, timestamp, current["high"]),
        _event("Bullish Engulfing", bull_engulf, "bullish", 72, timestamp, current["close"]),
        _event("Bearish Engulfing", bear_engulf, "bearish", 72, timestamp, current["close"]),
        _event("Morning Star", before["close"] < before["open"] and abs(previous["close"] - previous["open"]) < abs(before["close"] - before["open"]) * 0.4 and current["close"] > (current["high"] + current["low"]) / 2, "bullish", 69, timestamp, current["close"]),
        _event("Evening Star", before["close"] > before["open"] and abs(previous["close"] - previous["open"]) < abs(before["close"] - before["open"]) * 0.4 and current["close"] < (current["high"] + current["low"]) / 2, "bearish", 69, timestamp, current["close"]),
        _event("Inside Bar", inside, "neutral", 37, timestamp, current["close"]),
    ]
