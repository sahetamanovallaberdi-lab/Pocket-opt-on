from typing import Any

from backend.strategy.engine import analyze_strategies, strategy_agreement


def classify_regime(indicators: dict[str, Any], structure: list[dict[str, Any]], candles: list[dict[str, Any]]) -> dict[str, Any]:
    ema = indicators.get("ema", {})
    periods = [float(ema.get(str(period), 0)) for period in (9, 21, 50, 200)]
    ema_up = all(left > right for left, right in zip(periods, periods[1:]))
    ema_down = all(left < right for left, right in zip(periods, periods[1:]))
    adx = float(indicators.get("adx", 0))
    atr = float(indicators.get("atr", 0))
    atr_average = float(indicators.get("atr_average", atr))
    last_close = float(candles[-1]["close"]) if candles else 0
    atr_ratio = atr / atr_average if atr_average > 0 else 1.0
    normalized_atr = atr / abs(last_close) if last_close else 0
    active = {event.get("name"): event for event in structure if event.get("detected")}
    bullish_structure = any(name in active for name in ("Higher High / Higher Low", "BOS")) and any(event.get("direction") == "bullish" for event in active.values())
    bearish_structure = any(name in active for name in ("Lower High / Lower Low", "BOS")) and any(event.get("direction") == "bearish" for event in active.values())
    breakout_event = active.get("Breakout")
    reversal_event = active.get("CHoCH") or active.get("Liquidity Sweep") or active.get("False Breakout")

    direction = "BULLISH" if ema_up else "BEARISH" if ema_down else "NEUTRAL"
    if atr_ratio >= 1.8 or normalized_atr >= 0.006:
        code = "HIGH_VOLATILITY"
    elif breakout_event and adx >= 18:
        code = "BREAKOUT"
        direction = str(breakout_event.get("direction", "neutral")).upper()
    elif reversal_event and (adx >= 18 or indicators.get("rsi", 50) < 35 or indicators.get("rsi", 50) > 65):
        code = "REVERSAL"
        direction = str(reversal_event.get("direction", "neutral")).upper()
    elif atr_ratio <= 0.55 and normalized_atr <= 0.002:
        code = "LOW_VOLATILITY"
    elif adx >= 20 and ema_up and bullish_structure and not bearish_structure:
        code, direction = "TRENDING_UP", "BULLISH"
    elif adx >= 20 and ema_down and bearish_structure and not bullish_structure:
        code, direction = "TRENDING_DOWN", "BEARISH"
    else:
        code, direction = "RANGING", "NEUTRAL"

    volatility = "HIGH" if atr_ratio >= 1.8 or normalized_atr >= 0.006 else "LOW" if atr_ratio <= 0.55 and normalized_atr <= 0.002 else "NORMAL"
    category = "TREND" if code in ("TRENDING_UP", "TRENDING_DOWN") else "RANGE" if code == "RANGING" else code
    return {
        "code": code,
        "category": category,
        "tags": [tag for condition, tag in ((ema_up and bullish_structure, "TRENDING_UP"), (ema_down and bearish_structure, "TRENDING_DOWN"), (bool(breakout_event), "BREAKOUT"), (bool(reversal_event), "REVERSAL"), (volatility == "HIGH", "HIGH_VOLATILITY"), (volatility == "LOW", "LOW_VOLATILITY")) if condition],
        "direction": direction,
        "volatility": volatility,
        "adx": round(adx, 2),
        "atr_ratio": round(atr_ratio, 3),
        "ema_structure": "BULLISH" if ema_up else "BEARISH" if ema_down else "MIXED",
        "structure_direction": "BULLISH" if bullish_structure and not bearish_structure else "BEARISH" if bearish_structure and not bullish_structure else "MIXED",
        "support": next((event.get("priceLevel") for event in structure if event.get("name") == "Support / Resistance" and event.get("detected") and event.get("direction") == "bullish"), None),
        "resistance": next((event.get("priceLevel") for event in structure if event.get("name") == "Support / Resistance" and event.get("detected") and event.get("direction") == "bearish"), None),
    }


def score_market(indicators: dict[str, Any], structure: list[dict[str, Any]], candles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    candles = candles or []
    regime = classify_regime(indicators, structure, candles)
    strategies = analyze_strategies(regime, indicators, structure, candles, int(indicators.get("confidence_threshold", 75)))
    agreement = strategy_agreement(strategies)
    trend_strategy = strategies[0]
    legacy_allowed = trend_strategy["strategy_status"] == "CONFIRMED"
    legacy_direction = "bullish" if trend_strategy["signal"] == "CALL" else "bearish" if trend_strategy["signal"] == "PUT" else "neutral"
    legacy_score = trend_strategy["confidence"] if legacy_allowed else 0
    legacy_reason = "; ".join(trend_strategy["reasons"])
    return {
        "regime": regime["code"],
        "regime_category": regime["category"],
        "regime_details": regime,
        "volatility": regime["volatility"].lower(),
        "trend_direction": regime["direction"],
        "strategies": strategies,
        "agreement": agreement,
        "final_signal": None,
        "signal": {
            "direction": legacy_direction,
            "score": legacy_score,
            "allowed": legacy_allowed,
            "reason": legacy_reason or "No individual strategy currently meets its conditions",
        },
    }
