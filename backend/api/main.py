import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.backtest.engine import optimize_parameters, run_backtest, run_walk_forward
from backend.brokers.pocket_option import PocketOptionProvider
from backend.config.settings import FRONTEND_ORIGIN, MODE
from backend.data.database import get_paper_trades, get_settings, get_signal_history, get_signal_journal, get_stored_candles, initialize, put_settings, record_journal_signal, resolve_pending_journal, save_candles, save_paper_trade, save_signal
from backend.data.provider_manager import MarketDataProvider
from backend.models.schemas import BacktestRequest, IndicatorSettings, PaperTradeRequest, RiskRequest
from backend.performance.engine import measure_expiries, summarize_performance
from backend.risk.engine import position_size
from backend.signals.engine import analyze
from backend.timeframes.definitions import TIMEFRAMES
from backend.timeframes.engine import analyze_timeframes

provider = MarketDataProvider()
WEBSOCKET_HEARTBEAT_TIMEOUT = 25


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize()
    yield


app = FastAPI(title="Pocket Analyzer API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[FRONTEND_ORIGIN, "http://127.0.0.1:3000"], allow_credentials=False, allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type"])


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": MODE, "provider": provider.name, "data_status": provider.status(), "broker_integration": "unavailable-official-feed-not-configured"}


@app.get("/api/provider/status")
def provider_status():
    return provider.status()


@app.get("/api/pairs")
def list_pairs():
    pairs = provider.list_pairs()
    return {"pairs": pairs, "source": provider.name, "data_status": provider.status()}


def market_payload(pair: str, timeframe: str, limit: int = 240):
    normalized = pair.upper()
    if normalized not in provider.list_pairs():
        raise HTTPException(status_code=404, detail="Pair not found in the demo data source")
    try:
        candles = provider.candles(normalized, timeframe, limit)
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {error}") from error
    settings = {**get_settings(), "timeframe": timeframe}
    try:
        result = analyze(candles, settings)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    save_candles(normalized, timeframe, candles, source=provider.name)
    resolve_pending_journal(normalized, timeframe)
    _record_analysis(normalized, timeframe, candles, result, 0.82)
    if result["signal_decision"] in ("CALL", "PUT"):
        save_signal(normalized, timeframe, result["last_closed_at"], result["signal_decision"], result["signal"]["score"], result)
    return {"pair": normalized, "timeframe": timeframe, "provider": provider.name, "mode": MODE, "otc": normalized.endswith("-OTC"), "payout": 0.82, "market_status": "demo" if provider.status()["status"] == "DEMO" else "open", "session_status": "demo-only" if provider.status()["status"] == "DEMO" else "open", "tick": candles[-1]["close"], "candles": candles, "data_status": provider.status(), "data_validation": provider.last_validation, "analysis": result}


def _record_analysis(pair: str, timeframe: str, candles: list[dict], analysis: dict, payout: float) -> None:
    session_data = analysis.get("features", {}).get("sessions", {})
    session = "Overlap" if session_data.get("overlap") else session_data.get("primary_session", "Unknown")
    reasons = [analysis.get("signal", {}).get("reason", "")]
    for strategy in analysis.get("strategies", []):
        reasons.extend(f"{strategy['name']}: {reason}" for reason in strategy.get("reasons", []))
    record_journal_signal({
        "pair": pair,
        "timeframe": timeframe,
        "timestamp": analysis["last_closed_at"],
        "decision": analysis["signal_decision"],
        "confidence": analysis.get("signal", {}).get("score", 0),
        "expiry_seconds": analysis.get("recommended_expiry", {}).get("seconds"),
        "entry_price": candles[-1]["close"],
        "payout": payout,
        "session": session,
        "regime": analysis.get("regime", "Unknown"),
        "reasons": [reason for reason in reasons if reason],
        "payload": analysis,
        "source": provider.name,
    })


@app.get("/api/market/{pair}")
def get_market(pair: str, timeframe: str = Query(default="1m", pattern="^(30s|1m|5m|15m|30m|1h)$"), limit: int = Query(default=240, ge=30, le=500)):
    return market_payload(pair, timeframe, limit)


@app.get("/api/analysis/{pair}")
def get_multi_timeframe(pair: str):
    normalized = pair.upper()
    if normalized not in provider.list_pairs():
        raise HTTPException(status_code=404, detail="Pair not found in the demo data source")
    settings = get_settings()
    candles_by_timeframe: dict[str, list[dict]] = {}
    result = analyze_timeframes(normalized, provider, settings, candle_store=candles_by_timeframe)
    validation_by_timeframe = {}
    for timeframe in TIMEFRAMES:
        candles = candles_by_timeframe[timeframe]
        validation_by_timeframe[timeframe] = provider.last_validation
        analyzed = analyze(candles, {**settings, "timeframe": timeframe})
        save_candles(normalized, timeframe, candles, source=provider.name)
        resolve_pending_journal(normalized, timeframe)
        _record_analysis(normalized, timeframe, candles, analyzed, 0.82)
    result["source"] = provider.name
    result["data_status"] = provider.status()
    result["data_validation"] = validation_by_timeframe
    return result


@app.get("/api/scanner")
def scan_pairs(timeframe: str = Query(default="1m", pattern="^(30s|1m|5m|15m|30m|1h)$")):
    settings = get_settings()
    results = []
    for pair in provider.list_pairs():
        candles = provider.candles(pair, timeframe, 240)
        result = analyze(candles, {**settings, "timeframe": timeframe})
        save_candles(pair, timeframe, candles, source=provider.name)
        resolve_pending_journal(pair, timeframe)
        _record_analysis(pair, timeframe, candles, result, 0.82)
        results.append({"pair": pair, "tick": candles[-1]["close"], "payout": 0.82, "analysis": result})
    return {"timeframe": timeframe, "source": provider.name, "data_status": provider.status(), "pairs": results}


@app.get("/api/settings")
def read_settings():
    return get_settings()


@app.put("/api/settings")
def update_settings(settings: IndicatorSettings):
    payload = settings.model_dump()
    if payload["rsi_oversold"] >= payload["rsi_overbought"]:
        raise HTTPException(status_code=422, detail="RSI oversold must be below overbought")
    if payload["macd"][0] >= payload["macd"][1]:
        raise HTTPException(status_code=422, detail="MACD fast period must be below slow period")
    if sorted(payload["ema"]) != payload["ema"] or min(payload["ema"]) < 2:
        raise HTTPException(status_code=422, detail="EMA periods must be positive and ascending")
    put_settings(payload)
    return payload


@app.post("/api/backtest")
def backtest(request: BacktestRequest):
    if request.timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="Unsupported timeframe")
    if request.fast_period >= request.slow_period:
        raise HTTPException(status_code=422, detail="Fast EMA must be below slow EMA")
    try:
        candles = provider.candles(request.pair, request.timeframe, 500)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    settings = {**get_settings(), "timeframe": request.timeframe}
    return {"pair": request.pair, "timeframe": request.timeframe, **run_backtest(candles, request.fast_period, request.slow_period, request.expiry, request.payout, settings), "mode": "historical-demo"}


@app.post("/api/backtest/walk-forward")
def walk_forward(request: BacktestRequest):
    if request.timeframe not in TIMEFRAMES or request.fast_period >= request.slow_period:
        raise HTTPException(status_code=422, detail="Unsupported timeframe or EMA period order")
    try:
        candles = provider.candles(request.pair, request.timeframe, 500)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    result = run_walk_forward(candles, request.fast_period, request.slow_period, request.expiry, request.payout, {**get_settings(), "timeframe": request.timeframe})
    return {"pair": request.pair, "timeframe": request.timeframe, **result}


@app.post("/api/optimizer")
def optimize(request: BacktestRequest):
    if request.timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="Unsupported timeframe")
    try:
        candles = provider.candles(request.pair, request.timeframe, 500)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    result = optimize_parameters(candles, {**get_settings(), "timeframe": request.timeframe}, request.expiry, request.payout)
    return {"pair": request.pair, "timeframe": request.timeframe, **result}


@app.get("/api/replay/{pair}")
def replay_market(pair: str, timeframe: str = Query(default="1m", pattern="^(30s|1m|5m|15m|30m|1h)$"), bars: int = Query(default=120, ge=30, le=500)):
    normalized = pair.upper()
    if normalized not in provider.list_pairs():
        raise HTTPException(status_code=404, detail="Pair not found in the demo data source")
    try:
        candles = provider.candles(normalized, timeframe, 500)[:bars]
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {error}") from error
    try:
        result = analyze(candles, {**get_settings(), "timeframe": timeframe})
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"pair": normalized, "timeframe": timeframe, "replay_bars": len(candles), "replay_timestamp": candles[-1]["time"], "candles": candles, "analysis": result, "mode": "REPLAY", "provider": provider.name, "data_status": provider.status(), "data_validation": provider.last_validation}


@app.get("/api/history")
def signal_history(pair: str | None = None, limit: int = Query(default=100, ge=1, le=500)):
    return {"signals": get_signal_history(pair.upper() if pair else None, limit)}


@app.get("/api/journal")
def read_signal_journal(pair: str | None = None, limit: int = Query(default=500, ge=1, le=5000)):
    return {"signals": get_signal_journal(pair.upper() if pair else None, limit)}


@app.get("/api/performance")
def performance_report(pair: str | None = None, limit: int = Query(default=5000, ge=1, le=20000)):
    records = get_signal_journal(pair.upper() if pair else None, limit)
    sources = sorted({record["source"] for record in records if record.get("source")})
    return summarize_performance(records, source=", ".join(sources) if sources else "no-journal-data")


@app.get("/api/performance/expiry")
def expiry_performance(pair: str, timeframe: str = Query(default="1m", pattern="^(30s|1m|5m|15m|30m|1h)$")):
    normalized = pair.upper()
    candles, sources = get_stored_candles(normalized, timeframe, 2000)
    if len(candles) < 30:
        return {"pair": normalized, "timeframe": timeframe, "source": sources, "enough_data": False, "expiry_performance": {}, "data_notice": "At least 30 stored closed candles are required; no synthetic fallback is used."}
    result = measure_expiries(candles, timeframe, get_settings())
    result.update({"pair": normalized, "source": sources, "enough_data": True})
    return result


@app.get("/api/paper/trades")
def paper_trade_history(limit: int = Query(default=100, ge=1, le=500)):
    return {"trades": get_paper_trades(limit), "mode": "PAPER_ONLY"}


@app.post("/api/paper/trades")
def create_paper_trade(request: PaperTradeRequest):
    pair = request.pair.upper()
    if pair not in provider.list_pairs() or request.timeframe not in TIMEFRAMES or request.direction not in ("CALL", "PUT"):
        raise HTTPException(status_code=422, detail="Paper trades require a listed pair, supported timeframe, and CALL or PUT direction")
    import time
    trade_id = save_paper_trade({**request.model_dump(), "pair": pair, "created_at": int(time.time())})
    return {"id": trade_id, "mode": "PAPER_ONLY", "status": "OPEN"}


@app.post("/api/risk/position-size")
def calculate_position_size(request: RiskRequest):
    try:
        return position_size(request.balance, request.risk_percent, request.stop_distance, request.pip_value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.websocket("/ws/market/{pair}")
async def market_stream(websocket: WebSocket, pair: str, timeframe: str = "1m"):
    if pair.upper() not in provider.list_pairs() or timeframe not in TIMEFRAMES:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(market_payload(pair, timeframe, 240))
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=WEBSOCKET_HEARTBEAT_TIMEOUT)
            except asyncio.TimeoutError:
                await websocket.close(code=1011, reason="Market stream heartbeat timed out")
                return
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": message.get("timestamp")})
    except WebSocketDisconnect:
        return


@app.get("/api/broker/status")
def broker_status():
    adapter = PocketOptionProvider()
    return {"available": adapter.is_authorized, "adapter": adapter.name, "mode": "SIGNAL_ONLY", "message": "Resmi ve belgelenmiş Pocket Option piyasa verisi bağlantısı yapılandırılmadı. Mock/demo veri kullanılıyor."}
