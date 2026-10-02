from collections import defaultdict
from typing import Any


CONFIDENCE_BUCKETS = ((75, 80, "75-80%"), (80, 85, "80-85%"), (85, 101, "85%+"))
EXPIRY_LABELS = {60: "1m", 180: "3m", 300: "5m", 600: "10m", 900: "15m"}


def _resolved(row: dict[str, Any]) -> bool:
    return row.get("status") == "RESOLVED" and row.get("result") in ("WIN", "LOSS", "TIE")


def summarize_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    resolved = sorted((row for row in rows if _resolved(row)), key=lambda row: (row.get("timestamp", 0), row.get("id", 0)))
    wins = sum(row["result"] == "WIN" for row in resolved)
    losses = sum(row["result"] == "LOSS" for row in resolved)
    ties = sum(row["result"] == "TIE" for row in resolved)
    profits = [float(row.get("profit_units", 0)) for row in resolved]
    gross_profit = sum(value for value in profits if value > 0)
    gross_loss = abs(sum(value for value in profits if value < 0))
    equity = peak = max_drawdown = 0.0
    consecutive = max_consecutive = 0
    for row, profit in zip(resolved, profits):
        equity += profit
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
        consecutive = consecutive + 1 if row["result"] == "LOSS" else 0
        max_consecutive = max(max_consecutive, consecutive)
    decisive = wins + losses
    return {
        "total_trades": len(resolved),
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "no_trade_signals": sum(row.get("decision") == "NO_TRADE" for row in rows),
        "pending_trades": sum(row.get("status") == "PENDING" for row in rows),
        "win_rate": round(wins / decisive * 100, 2) if decisive else None,
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss else (None if not gross_profit else None),
        "expectancy_units": round(sum(profits) / len(profits), 4) if profits else None,
        "net_profit_units": round(sum(profits), 4) if profits else 0,
        "gross_profit_units": round(gross_profit, 4),
        "gross_loss_units": round(gross_loss, 4),
        "max_drawdown_units": round(max_drawdown, 4),
        "max_consecutive_losses": max_consecutive,
    }


def _breakdown(rows: list[dict[str, Any]], key_fn) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = key_fn(row)
        if key is not None:
            groups[str(key)].append(row)
    return {key: summarize_metrics(group) for key, group in sorted(groups.items())}


def _confidence_bucket(row: dict[str, Any]) -> str | None:
    confidence = row.get("confidence")
    if confidence is None:
        return None
    return next((label for lower, upper, label in CONFIDENCE_BUCKETS if lower <= float(confidence) < upper), None)


def _expiry_label(row: dict[str, Any]) -> str | None:
    seconds = row.get("expiry_seconds")
    if seconds is None:
        return None
    return EXPIRY_LABELS.get(int(seconds), f"{int(seconds)}s")


def summarize_performance(rows: list[dict[str, Any]], source: str) -> dict[str, Any]:
    settled = [row for row in rows if _resolved(row)]
    return {
        "source": source,
        "has_resolved_results": bool(settled),
        "sample_size": len(settled),
        "overall": summarize_metrics(rows),
        "pair_performance": _breakdown(rows, lambda row: row.get("pair")),
        "timeframe_performance": _breakdown(rows, lambda row: row.get("timeframe")),
        "session_performance": _breakdown(rows, lambda row: row.get("session")),
        "confidence_performance": _breakdown(rows, _confidence_bucket),
        "expiry_performance": _breakdown(rows, _expiry_label),
        "data_notice": "Statistics include only journal outcomes resolved from stored closed candles. Mock/demo results are not real-market performance.",
    }


def measure_expiries(
    candles: list[dict[str, Any]],
    timeframe: str,
    settings: dict[str, Any],
    payout: float = 0.82,
    expiries: tuple[int, ...] = (60, 180, 300, 600, 900),
) -> dict[str, Any]:
    from backend.signals.engine import analyze
    from backend.signals.features import session_analysis
    from backend.timeframes.definitions import TIMEFRAMES

    closed = [candle for candle in candles if candle.get("closed") is True]
    interval = TIMEFRAMES.get(timeframe)
    if interval is None:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    outcomes: dict[int, list[dict[str, Any]]] = {expiry: [] for expiry in expiries}
    no_trade = 0
    for index in range(29, len(closed)):
        result = analyze(closed[:index + 1], {**settings, "timeframe": timeframe})
        decision = result["signal_decision"]
        if decision not in ("CALL", "PUT"):
            no_trade += 1
            continue
        entry = float(closed[index]["close"])
        for expiry in expiries:
            horizon_bars = max(1, (expiry + interval - 1) // interval)
            exit_index = index + horizon_bars
            if exit_index >= len(closed):
                continue
            exit_price = float(closed[exit_index]["close"])
            win = exit_price > entry if decision == "CALL" else exit_price < entry
            tie = exit_price == entry
            outcomes[expiry].append({
                "id": index,
                "timestamp": int(closed[index]["time"]),
                "decision": decision,
                "confidence": result["signal"]["score"],
                "session": session_analysis(int(closed[index]["time"]))["primary_session"],
                "expiry_seconds": expiry,
                "status": "RESOLVED",
                "result": "TIE" if tie else "WIN" if win else "LOSS",
                "profit_units": 0 if tie else payout if win else -1,
            })
    report = {}
    for expiry, records in outcomes.items():
        report[EXPIRY_LABELS.get(expiry, f"{expiry}s")] = {**summarize_metrics(records), "expiry_seconds": expiry, "measured_signals": len(records), "no_trade_signals": no_trade}
    return {
        "timeframe": timeframe,
        "pair": None,
        "source": "stored-candles",
        "engine": "shared-deterministic-closed-candle",
        "expiry_performance": report,
        "data_notice": "Outcomes are measured against later stored closed candles. These results inherit the stored candle source and are not live-market claims.",
    }
