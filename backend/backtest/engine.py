from typing import Any

from backend.signals.engine import analyze


def _empty_metrics() -> dict[str, Any]:
    return {"trades": 0, "wins": 0, "losses": 0, "no_trade_bars": 0, "win_rate": 0, "net_return_units": 0, "max_drawdown_units": 0, "trade_log": []}


def run_backtest(
    candles: list[dict[str, Any]],
    fast_period: int = 9,
    slow_period: int = 21,
    expiry: int = 3,
    payout: float = 0.8,
    settings: dict[str, Any] | None = None,
    start_index: int = 30,
    end_index: int | None = None,
) -> dict[str, Any]:
    """Walk forward using the production signal engine and candles available at each decision."""
    closed = [candle for candle in candles if candle.get("closed") is True]
    stop = min(end_index or len(closed), len(closed))
    settings = dict(settings or {})
    configured_ema = list(settings.get("ema", [9, 21, 50, 200]))
    configured_ema[:2] = [fast_period, slow_period]
    settings["ema"] = configured_ema
    metrics = _empty_metrics()
    balance = peak = drawdown = 0.0

    for index in range(max(30, start_index), stop - expiry):
        available = closed[: index + 1]
        result = analyze(available, settings)
        decision = result.get("signal_decision", "NO_TRADE")
        if decision not in ("CALL", "PUT"):
            metrics["no_trade_bars"] += 1
            continue

        entry = float(closed[index + 1]["open"])
        exit_price = float(closed[index + expiry]["close"])
        won = exit_price > entry if decision == "CALL" else exit_price < entry
        metrics["trades"] += 1
        if won:
            metrics["wins"] += 1
            balance += payout
        else:
            metrics["losses"] += 1
            balance -= 1
        peak = max(peak, balance)
        drawdown = max(drawdown, peak - balance)
        metrics["trade_log"].append({
            "timestamp": closed[index]["time"],
            "signal": decision,
            "entry": entry,
            "exit": exit_price,
            "outcome": "WIN" if won else "LOSS",
            "confidence": result["signal"]["score"],
            "agreement": result["agreement"]["count"],
        })

    trades = metrics["trades"]
    metrics.update({
        "win_rate": round(metrics["wins"] / trades * 100, 2) if trades else 0,
        "net_return_units": round(balance, 2),
        "max_drawdown_units": round(drawdown, 2),
        "confidence_threshold": int(settings.get("confidence_threshold", 75)),
        "engine": "shared-deterministic-closed-candle",
    })
    return metrics


def run_walk_forward(
    candles: list[dict[str, Any]],
    fast_period: int,
    slow_period: int,
    expiry: int,
    payout: float,
    settings: dict[str, Any] | None = None,
    train_fraction: float = 0.7,
) -> dict[str, Any]:
    closed = [candle for candle in candles if candle.get("closed") is True]
    split = max(30, min(len(closed) - expiry - 1, int(len(closed) * train_fraction)))
    if split < 30 or len(closed) - split < expiry + 2:
        return {"train": _empty_metrics(), "validation": _empty_metrics(), "split_index": split, "error": "Not enough closed candles for walk-forward windows"}
    train = run_backtest(closed, fast_period, slow_period, expiry, payout, settings, 30, split)
    validation = run_backtest(closed, fast_period, slow_period, expiry, payout, settings, split, len(closed))
    return {"train": train, "validation": validation, "split_index": split, "train_fraction": train_fraction, "method": "chronological-no-shuffle"}


def optimize_parameters(candles: list[dict[str, Any]], settings: dict[str, Any], expiry: int, payout: float) -> dict[str, Any]:
    candidates = [(5, 21), (9, 21), (9, 34), (12, 26)]
    results = []
    for fast, slow in candidates:
        metrics = run_backtest(candles, fast, slow, expiry, payout, settings)
        results.append({"fast_period": fast, "slow_period": slow, "net_return_units": metrics["net_return_units"], "win_rate": metrics["win_rate"], "trades": metrics["trades"]})
    ranked = sorted(results, key=lambda item: (item["net_return_units"], item["trades"]), reverse=True)
    return {"candidates": results, "best_in_sample": ranked[0] if ranked else None, "warning": "In-sample ranking is not a guarantee; validate parameters with walk-forward testing."}
