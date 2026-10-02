from typing import Any

from backend.indicators.engine import analyze_indicators
from backend.market_structure.engine import analyze_structure
from backend.scoring.engine import score_market
from backend.signals.features import analyze_features


def analyze(candles: list[dict[str, Any]], settings: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = settings or {}
    closed = [candle for candle in candles if candle.get("closed") is True]
    if len(closed) < 30:
        raise ValueError("At least 30 closed candles are required for analysis")
    indicators = analyze_indicators(closed, settings)
    indicators["confidence_threshold"] = int(settings.get("confidence_threshold", 75))
    structure = analyze_structure(closed)
    market = score_market(indicators, structure, closed)
    features = analyze_features(closed)
    structure.extend(features["divergence_events"])
    confirmed = [item for item in market["strategies"] if item["strategy_status"] == "CONFIRMED"]
    calls = sum(item["signal"] == "CALL" for item in confirmed)
    puts = sum(item["signal"] == "PUT" for item in confirmed)
    agreement = market["agreement"]
    conflicts = calls > 0 and puts > 0
    regime = market["regime"]
    filter_reasons = []
    if regime in ("RANGING", "HIGH_VOLATILITY"):
        filter_reasons.append(f"{regime.replace('_', ' ').title()} regime blocks directional entries")
    if conflicts:
        filter_reasons.append("Confirmed strategies disagree on direction")
    if agreement["count"] < 2:
        filter_reasons.append("Fewer than two strategies confirm the same direction")
    filter_passed = not filter_reasons and bool(confirmed)
    decision = "CALL" if filter_passed and calls > puts else "PUT" if filter_passed and puts > calls else "NO_TRADE"
    if decision == "NO_TRADE" and not filter_reasons:
        filter_reasons.append("No setup met the configured confidence threshold")
    direction = "bullish" if decision == "CALL" else "bearish" if decision == "PUT" else "neutral"
    market["signal"] = {
        "direction": direction,
        "score": max((item["confidence"] for item in confirmed), default=0) if decision != "NO_TRADE" else 0,
        "allowed": decision != "NO_TRADE",
        "reason": "; ".join(filter_reasons) if filter_reasons else "Multiple independent strategies agree above the confidence threshold",
    }
    market["signal_decision"] = decision
    market["false_signal_filter"] = {"passed": filter_passed, "reasons": filter_reasons, "confidence_threshold": int((settings or {}).get("confidence_threshold", 75))}
    market["signal_lifecycle"] = "INVALIDATED" if regime in ("RANGING", "HIGH_VOLATILITY") else "CONFIRMED" if decision != "NO_TRADE" else "SETUP" if any(item["strategy_status"] == "SETUP" for item in market["strategies"]) else "WATCHING"
    market["recommended_expiry"] = {
        "candle_count": 3 if regime in ("TRENDING_UP", "TRENDING_DOWN") else 1 if regime in ("BREAKOUT", "REVERSAL") else None,
        "seconds": ({"30s": 30, "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600}.get(str(settings.get("timeframe", "1m")), 60)) * (3 if regime in ("TRENDING_UP", "TRENDING_DOWN") else 1) if regime not in ("RANGING", "HIGH_VOLATILITY") else None,
    }
    return {"indicators": indicators, "structure": structure, "features": features, **market, "candle_count": len(closed), "last_closed_at": closed[-1]["time"]}
