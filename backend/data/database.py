import json
import sqlite3
from typing import Any

from backend.config.settings import DATA_DIR, DATABASE_PATH


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize() -> None:
    with connect() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS candles (pair TEXT NOT NULL, timeframe TEXT NOT NULL, timestamp INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume INTEGER NOT NULL, closed INTEGER NOT NULL, PRIMARY KEY(pair, timeframe, timestamp));
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS signal_events (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, timeframe TEXT NOT NULL, timestamp INTEGER NOT NULL, direction TEXT NOT NULL, score REAL NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS paper_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, timeframe TEXT NOT NULL, direction TEXT NOT NULL, entry_price REAL NOT NULL, stake REAL NOT NULL, expiry_seconds INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS signal_journal (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, timeframe TEXT NOT NULL, timestamp INTEGER NOT NULL, decision TEXT NOT NULL, confidence REAL NOT NULL, expiry_seconds INTEGER, expiry_key INTEGER NOT NULL DEFAULT 0, entry_price REAL NOT NULL, payout REAL NOT NULL, session TEXT NOT NULL, regime TEXT NOT NULL, reasons TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL, profit_units REAL NOT NULL DEFAULT 0, exit_timestamp INTEGER, UNIQUE(pair,timeframe,timestamp,decision,expiry_key));
        """)
        candle_columns = {row[1] for row in connection.execute("PRAGMA table_info(candles)")}
        if "source" not in candle_columns:
            connection.execute("ALTER TABLE candles ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy-unknown'")
        defaults = {"ema": [9, 21, 50, 200], "rsi_period": 14, "rsi_overbought": 70, "rsi_oversold": 30, "macd": [12, 26, 9], "bollinger": [20, 2], "stochastic": [14, 3, 3], "adx_period": 14, "atr_period": 14, "momentum_period": 10, "confidence_threshold": 75}
        connection.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('indicators',?)", (json.dumps(defaults),))


def save_candles(pair: str, timeframe: str, candles: list[dict[str, Any]], source: str = "unknown") -> None:
    with connect() as connection:
        connection.executemany("INSERT OR REPLACE INTO candles(pair,timeframe,timestamp,open,high,low,close,volume,closed,source) VALUES(?,?,?,?,?,?,?,?,?,?)", [(pair, timeframe, c["time"], c["open"], c["high"], c["low"], c["close"], c.get("volume", 0), int(c.get("closed", True)), source) for c in candles])


def get_settings() -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT value FROM settings WHERE key='indicators'").fetchone()
    defaults = {"ema": [9, 21, 50, 200], "rsi_period": 14, "rsi_overbought": 70, "rsi_oversold": 30, "macd": [12, 26, 9], "bollinger": [20, 2], "stochastic": [14, 3, 3], "adx_period": 14, "atr_period": 14, "momentum_period": 10, "confidence_threshold": 75}
    return {**defaults, **json.loads(row["value"])} if row else defaults


def put_settings(settings: dict[str, Any]) -> None:
    with connect() as connection:
        connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('indicators',?)", (json.dumps(settings),))


def save_signal(pair: str, timeframe: str, timestamp: int, direction: str, score: float, payload: dict[str, Any]) -> None:
    with connect() as connection:
        connection.execute("INSERT INTO signal_events(pair,timeframe,timestamp,direction,score,payload) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM signal_events WHERE pair=? AND timeframe=? AND timestamp=? AND direction=?)", (pair, timeframe, timestamp, direction, score, json.dumps(payload), pair, timeframe, timestamp, direction))


def get_signal_history(pair: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = "SELECT id,pair,timeframe,timestamp,direction,score,payload FROM signal_events"
    params: list[Any] = []
    if pair:
        query += " WHERE pair=?"
        params.append(pair)
    query += " ORDER BY timestamp DESC,id DESC LIMIT ?"
    params.append(limit)
    with connect() as connection:
        rows = connection.execute(query, params).fetchall()
    return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]


def save_paper_trade(trade: dict[str, Any]) -> int:
    with connect() as connection:
        cursor = connection.execute(
            "INSERT INTO paper_trades(pair,timeframe,direction,entry_price,stake,expiry_seconds,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (trade["pair"], trade["timeframe"], trade["direction"], trade["entry_price"], trade["stake"], trade["expiry_seconds"], "OPEN", trade["created_at"]),
        )
        return int(cursor.lastrowid)


def get_paper_trades(limit: int = 100) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM paper_trades ORDER BY created_at DESC,id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


def record_journal_signal(signal: dict[str, Any]) -> int:
    decision = signal["decision"]
    expiry = signal.get("expiry_seconds")
    status = "PENDING" if decision in ("CALL", "PUT") and expiry else "NO_TRADE" if decision == "NO_TRADE" else "PENDING"
    result = "PENDING" if status == "PENDING" else "SKIPPED"
    with connect() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO signal_journal(pair,timeframe,timestamp,decision,confidence,expiry_seconds,expiry_key,entry_price,payout,session,regime,reasons,payload,source,status,result) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (signal["pair"], signal["timeframe"], signal["timestamp"], decision, signal.get("confidence", 0), expiry, int(expiry or 0), signal.get("entry_price", 0), signal.get("payout", 0), signal.get("session", "Unknown"), signal.get("regime", "Unknown"), json.dumps(signal.get("reasons", [])), json.dumps(signal.get("payload", {})), signal.get("source", "unknown"), status, result),
        )
        row = connection.execute("SELECT id FROM signal_journal WHERE pair=? AND timeframe=? AND timestamp=? AND decision=? AND expiry_key=?", (signal["pair"], signal["timeframe"], signal["timestamp"], decision, int(expiry or 0))).fetchone()
    return int(row["id"])


def get_signal_journal(pair: str | None = None, limit: int = 1000) -> list[dict[str, Any]]:
    query = "SELECT * FROM signal_journal"
    params: list[Any] = []
    if pair:
        query += " WHERE pair=?"
        params.append(pair)
    query += " ORDER BY timestamp DESC,id DESC LIMIT ?"
    params.append(limit)
    with connect() as connection:
        rows = connection.execute(query, params).fetchall()
    return [{**dict(row), "reasons": json.loads(row["reasons"]), "payload": json.loads(row["payload"])} for row in rows]


def resolve_pending_journal(pair: str, timeframe: str) -> int:
    with connect() as connection:
        pending = connection.execute("SELECT * FROM signal_journal WHERE pair=? AND timeframe=? AND status='PENDING' AND expiry_seconds IS NOT NULL", (pair, timeframe)).fetchall()
        resolved = 0
        for signal in pending:
            target_timestamp = int(signal["timestamp"]) + int(signal["expiry_seconds"])
            candle = connection.execute("SELECT timestamp,close FROM candles WHERE pair=? AND timeframe=? AND timestamp=? AND closed=1", (pair, timeframe, target_timestamp)).fetchone()
            if candle is None:
                continue
            exit_price = float(candle["close"])
            entry_price = float(signal["entry_price"])
            direction = signal["decision"]
            win = exit_price > entry_price if direction == "CALL" else exit_price < entry_price
            tie = exit_price == entry_price
            result = "TIE" if tie else "WIN" if win else "LOSS"
            profit_units = 0.0 if tie else float(signal["payout"]) if win else -1.0
            connection.execute("UPDATE signal_journal SET status='RESOLVED',result=?,profit_units=?,exit_timestamp=? WHERE id=? AND status='PENDING'", (result, profit_units, int(candle["timestamp"]), int(signal["id"])))
            resolved += 1
    return resolved


def get_stored_candles(pair: str, timeframe: str, limit: int = 500) -> tuple[list[dict[str, Any]], list[str]]:
    with connect() as connection:
        rows = connection.execute("SELECT timestamp AS time,open,high,low,close,volume,closed,source FROM candles WHERE pair=? AND timeframe=? AND closed=1 ORDER BY timestamp DESC LIMIT ?", (pair, timeframe, limit)).fetchall()
        sources = connection.execute("SELECT DISTINCT source FROM candles WHERE pair=? AND timeframe=?", (pair, timeframe)).fetchall()
    return [dict(row) for row in reversed(rows)], [str(row[0]) for row in sources]
