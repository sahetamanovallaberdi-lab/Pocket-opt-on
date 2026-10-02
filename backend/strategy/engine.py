from typing import Any


STRATEGY_NAMES = (
    "Trend Following",
    "Pullback",
    "Breakout",
    "Reversal",
    "Liquidity Sweep",
)


def _event(structure: list[dict[str, Any]], *names: str) -> dict[str, Any] | None:
    return next((item for item in structure if item.get("detected") and item.get("name") in names), None)


def _strategy(name: str, signal: str, confidence: int, reasons: list[str], conditions: dict[str, Any], eligible: bool, threshold: int) -> dict[str, Any]:
    confidence = max(0, min(100, int(confidence)))
    invalidated = conditions.get("regime") == "HIGH_VOLATILITY" and name in ("Trend Following", "Pullback", "Breakout")
    active = eligible and signal in ("CALL", "PUT") and confidence >= threshold
    if invalidated:
        status = "INVALIDATED"
    elif active:
        status = "CONFIRMED"
    elif eligible and confidence >= max(0, threshold - 15):
        status = "SETUP"
    else:
        status = "WATCHING"
    return {
        "name": name,
        "signal": signal if active else "NO_TRADE",
        "confidence": confidence,
        "reasons": reasons or ["Required market conditions are not present"],
        "market_conditions": conditions,
        "strategy_status": status,
        "lifecycle": status,
    }


def analyze_strategies(regime: dict[str, Any], indicators: dict[str, Any], structure: list[dict[str, Any]], candles: list[dict[str, Any]], confidence_threshold: int = 75) -> list[dict[str, Any]]:
    """Score independent technical setups without collapsing them into a trade instruction."""
    ema = indicators.get("ema", {})
    ema_values = [float(ema.get(str(period), 0)) for period in (9, 21, 50, 200)]
    close = float(candles[-1]["close"]) if candles else 0.0
    atr = max(float(indicators.get("atr", 0)), 1e-12)
    adx = float(indicators.get("adx", 0))
    rsi = float(indicators.get("rsi", 50))
    macd = float(indicators.get("macd_histogram", 0))
    volume = float(indicators.get("tick_volume", 0))
    average_volume = max(float(indicators.get("volume_average", 0)), 1.0)
    regime_code = str(regime.get("code", "RANGING"))
    trend_direction = str(regime.get("direction", "NEUTRAL"))
    conditions = {"regime": regime_code, "direction": trend_direction, "adx": round(adx, 2), "volatility": regime.get("volatility", "NORMAL")}
    ema_bull = all(left > right for left, right in zip(ema_values, ema_values[1:]))
    ema_bear = all(left < right for left, right in zip(ema_values, ema_values[1:]))
    trend = trend_direction if trend_direction in ("BULLISH", "BEARISH") else "NEUTRAL"
    trend_signal = "CALL" if trend == "BULLISH" else "PUT" if trend == "BEARISH" else "NO_TRADE"
    trend_strength = 42 + min(25, max(0, adx - 18)) + (14 if ema_bull or ema_bear else 0) + (9 if abs(macd) > 0 else 0)
    trend_reasons = []
    if trend != "NEUTRAL":
        trend_reasons.append(f"{trend.title()} regime from EMA structure and price action")
    if adx >= 20:
        trend_reasons.append(f"ADX {adx:.1f} confirms directional strength")
    strategies = [_strategy("Trend Following", trend_signal, trend_strength, trend_reasons, conditions, regime_code in ("TRENDING_UP", "TRENDING_DOWN") and (ema_bull or ema_bear), confidence_threshold)]

    pullback = _event(structure, "Pullback")
    near_fast_ema = abs(close - float(ema.get("21", close))) <= atr * 1.1
    pullback_signal = "CALL" if trend == "BULLISH" else "PUT" if trend == "BEARISH" else "NO_TRADE"
    pullback_strength = 45 + (18 if near_fast_ema else 0) + (16 if pullback else 0) + (10 if macd and (macd > 0) == (trend == "BULLISH") else 0)
    pullback_reasons = [reason for condition, reason in ((near_fast_ema, "Price is near the 21 EMA zone"), (bool(pullback), "Recent candles show a pullback structure"), (trend != "NEUTRAL", f"Pullback direction follows {trend.lower()} trend structure")) if condition]
    strategies.append(_strategy("Pullback", pullback_signal, pullback_strength, pullback_reasons, conditions, trend != "NEUTRAL" and regime_code not in ("RANGING", "HIGH_VOLATILITY") and near_fast_ema and bool(pullback), confidence_threshold))

    breakout = _event(structure, "Breakout", "BOS")
    breakout_direction = str(breakout.get("direction", "neutral")).upper() if breakout else "NEUTRAL"
    breakout_signal = "CALL" if breakout_direction == "BULLISH" else "PUT" if breakout_direction == "BEARISH" else "NO_TRADE"
    breakout_strength = 48 + (18 if breakout else 0) + min(15, max(0, adx - 20)) + (8 if volume > average_volume else 0)
    breakout_reasons = [reason for condition, reason in ((bool(breakout), "Closed candle broke a recent structure level"), (adx >= 20, f"ADX {adx:.1f} supports expansion"), (volume > average_volume, "Tick volume is above its recent average")) if condition]
    strategies.append(_strategy("Breakout", breakout_signal, breakout_strength, breakout_reasons, conditions, bool(breakout) and regime_code in ("BREAKOUT", "TRENDING_UP", "TRENDING_DOWN"), confidence_threshold))

    reversal = _event(structure, "CHoCH", "Liquidity Sweep", "False Breakout", "Bullish Engulfing", "Bearish Engulfing")
    reversal_direction = str(reversal.get("direction", "neutral")).upper() if reversal else "NEUTRAL"
    reversal_signal = "CALL" if reversal_direction == "BULLISH" else "PUT" if reversal_direction == "BEARISH" else "NO_TRADE"
    reversal_strength = 44 + (22 if reversal else 0) + (10 if rsi < 35 or rsi > 65 else 0) + (8 if trend != "NEUTRAL" and reversal_direction != trend else 0)
    reversal_reasons = [reason for condition, reason in ((bool(reversal), f"{reversal.get('name')} reversal evidence detected" if reversal else ""), (rsi < 35 or rsi > 65, f"RSI {rsi:.1f} is at an extreme"), (trend != "NEUTRAL" and reversal_direction != trend, "Structure is turning against the prior trend")) if condition]
    strategies.append(_strategy("Reversal", reversal_signal, reversal_strength, reversal_reasons, conditions, bool(reversal) and (regime_code == "REVERSAL" or rsi < 35 or rsi > 65), confidence_threshold))

    sweep = _event(structure, "Liquidity Sweep", "False Breakout")
    sweep_direction = str(sweep.get("direction", "neutral")).upper() if sweep else "NEUTRAL"
    sweep_signal = "CALL" if sweep_direction == "BULLISH" else "PUT" if sweep_direction == "BEARISH" else "NO_TRADE"
    sweep_strength = 46 + (26 if sweep else 0) + (10 if volume > average_volume else 0)
    sweep_reasons = [reason for condition, reason in ((bool(sweep), "Price swept a swing level and closed back inside"), (volume > average_volume, "Tick volume confirms participation")) if condition]
    strategies.append(_strategy("Liquidity Sweep", sweep_signal, sweep_strength, sweep_reasons, conditions, bool(sweep) and regime_code != "HIGH_VOLATILITY", confidence_threshold))
    return strategies


def strategy_agreement(strategies: list[dict[str, Any]]) -> dict[str, Any]:
    votes = {"CALL": 0, "PUT": 0}
    for item in strategies:
        if item["strategy_status"] == "CONFIRMED" and item["signal"] in votes:
            votes[item["signal"]] += 1
    direction = "CALL" if votes["CALL"] > votes["PUT"] else "PUT" if votes["PUT"] > votes["CALL"] else "MIXED"
    return {"count": max(votes.values(), default=0), "total": len(strategies), "direction": direction, "votes": votes}
