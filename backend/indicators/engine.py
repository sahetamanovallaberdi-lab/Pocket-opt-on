from typing import Any


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (max(1, period) + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def sma(values: list[float], period: int) -> list[float]:
    return [sum(window) / len(window) for i in range(len(values)) if (window := values[max(0, i - period + 1):i + 1])]


def rsi(values: list[float], period: int = 14) -> float:
    if len(values) < 2:
        return 50.0
    changes = [values[i] - values[i - 1] for i in range(1, len(values))][-period:]
    gain = sum(max(change, 0) for change in changes) / max(1, len(changes))
    loss = sum(max(-change, 0) for change in changes) / max(1, len(changes))
    return round(100 if loss == 0 else 100 - 100 / (1 + gain / loss), 2)


def analyze_indicators(candles: list[dict[str, Any]], settings: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = settings or {}
    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    volumes = [int(c.get("tick_volume", c.get("volume", 0))) for c in candles]
    periods = settings.get("ema", [9, 21, 50, 200])
    ema_values = {str(p): round(ema(closes, int(p))[-1], 6) for p in periods if closes}
    tr, plus_dm, minus_dm = [], [], []
    for index in range(len(candles)):
        previous_close = closes[index - 1] if index else closes[index]
        previous_high = highs[index - 1] if index else highs[index]
        previous_low = lows[index - 1] if index else lows[index]
        tr.append(max(highs[index] - lows[index], abs(highs[index] - previous_close), abs(lows[index] - previous_close)))
        up, down = highs[index] - previous_high, previous_low - lows[index]
        plus_dm.append(up if up > down and up > 0 else 0)
        minus_dm.append(down if down > up and down > 0 else 0)
    atr_period = int(settings.get("atr_period", 14))
    atr_series = sma(tr, atr_period)
    atr_value = atr_series[-1] if atr_series else 0
    atr_average = sum(atr_series[-50:]) / len(atr_series[-50:]) if atr_series else 0
    adx_period = int(settings.get("adx_period", 14))
    plus_dm_smooth = sma(plus_dm, adx_period)
    minus_dm_smooth = sma(minus_dm, adx_period)
    plus_di_series = [100 * plus_dm_smooth[index] / tr_value if tr_value else 0 for index, tr_value in enumerate(atr_series)]
    minus_di_series = [100 * minus_dm_smooth[index] / tr_value if tr_value else 0 for index, tr_value in enumerate(atr_series)]
    dx_series = [100 * abs(plus - minus) / (plus + minus) if plus + minus else 0 for plus, minus in zip(plus_di_series, minus_di_series)]
    adx_series = sma(dx_series, adx_period)
    adx_value = adx_series[-1] if adx_series else 0
    macd_fast, macd_slow, macd_signal_period = settings.get("macd", [12, 26, 9])
    macd_line = [a - b for a, b in zip(ema(closes, int(macd_fast)), ema(closes, int(macd_slow)))]
    macd_signal_values = ema(macd_line, int(macd_signal_period))
    bb_period, bb_deviations = settings.get("bollinger", [20, 2])
    bb_window = closes[-int(bb_period):]
    bb_mid = sum(bb_window) / len(bb_window) if bb_window else 0
    bb_std = (sum((value - bb_mid) ** 2 for value in bb_window) / len(bb_window)) ** 0.5 if bb_window else 0
    stoch_period = int(settings.get("stochastic", [14, 3, 3])[0])
    stochastic_window = candles[-stoch_period:]
    stoch_low = min((c["low"] for c in stochastic_window), default=0)
    stoch_high = max((c["high"] for c in stochastic_window), default=0)
    stochastic = 100 * (closes[-1] - stoch_low) / (stoch_high - stoch_low) if stoch_high != stoch_low else 50
    momentum_period = int(settings.get("momentum_period", 10))
    momentum = closes[-1] - closes[-momentum_period - 1] if len(closes) > momentum_period else 0
    return {"ema": ema_values, "rsi": rsi(closes, int(settings.get("rsi_period", 14))), "macd": round(macd_line[-1], 8) if macd_line else 0, "macd_signal": round(macd_signal_values[-1], 8) if macd_signal_values else 0, "macd_histogram": round(macd_line[-1] - macd_signal_values[-1], 8) if macd_line and macd_signal_values else 0, "bollinger": {"upper": round(bb_mid + float(bb_deviations) * bb_std, 6), "middle": round(bb_mid, 6), "lower": round(bb_mid - float(bb_deviations) * bb_std, 6)}, "stochastic": round(stochastic, 2), "adx": round(adx_value, 2), "atr": round(atr_value, 8), "atr_average": round(atr_average, 8), "tick_volume": volumes[-1] if volumes else 0, "volume_average": round(sum(volumes[-20:]) / max(1, len(volumes[-20:])), 2), "momentum": round(momentum, 8)}
