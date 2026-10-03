# Pocket Analyzer

Pocket Analyzer is a deterministic market-analysis dashboard. It uses closed OHLC candles, a local SQLite database, a FastAPI API/WebSocket, and TradingView Lightweight Charts. No AI service or API key is used.

The current provider is deterministic Mock/Demo data. The Pocket Option adapter deliberately remains unavailable until an officially supported, documented market-data integration is configured. Private APIs, browser automation, and live order execution are not used. The UI starts in signal-only/paper mode.

## Run locally

Install the Python API dependencies and start FastAPI in one terminal:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8001
```

Install frontend dependencies and start Next.js in another terminal:

```bash
npm install
NEXT_PUBLIC_API_URL=http://localhost:8001 npm run dev -- --hostname 0.0.0.0 --port 3000
```

## Verify

```bash
python3 -m unittest discover -s backend/tests -v
npm test
npm run build
```

Analysis includes six independent timeframes, configurable indicators and a 75% default confidence threshold, strategy agreement, signal lifecycle, structure/SMC and candle-pattern checks, divergences, Fibonacci levels, session windows, replay, backtest, chronological walk-forward testing, parameter search, risk sizing, signal history, and a paper-trade ledger. Backtests and replay call the same signal engine as current market analysis and only provide candles available at each decision point.

Signals and backtest results are informational and are not guarantees of profit or recommendations to place a trade. Session windows are UTC approximations and do not model daylight-saving changes.