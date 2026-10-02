from pydantic import BaseModel, Field


class IndicatorSettings(BaseModel):
    ema: list[int] = Field(default=[9, 21, 50, 200], min_length=4, max_length=4)
    rsi_period: int = Field(default=14, ge=2, le=100)
    rsi_overbought: int = Field(default=70, ge=51, le=99)
    rsi_oversold: int = Field(default=30, ge=1, le=49)
    macd: list[int] = Field(default=[12, 26, 9], min_length=3, max_length=3)
    bollinger: list[float] = Field(default=[20, 2], min_length=2, max_length=2)
    stochastic: list[int] = Field(default=[14, 3, 3], min_length=3, max_length=3)
    adx_period: int = Field(default=14, ge=2, le=100)
    atr_period: int = Field(default=14, ge=2, le=100)
    momentum_period: int = Field(default=10, ge=1, le=100)
    confidence_threshold: int = Field(default=75, ge=50, le=95)


class BacktestRequest(BaseModel):
    pair: str = "EURUSD"
    timeframe: str = "1m"
    fast_period: int = Field(default=9, ge=2, le=100)
    slow_period: int = Field(default=21, ge=3, le=200)
    expiry: int = Field(default=3, ge=1, le=30)
    payout: float = Field(default=0.8, gt=0, le=1)


class PaperTradeRequest(BaseModel):
    pair: str
    timeframe: str
    direction: str
    entry_price: float = Field(gt=0)
    stake: float = Field(gt=0)
    expiry_seconds: int = Field(ge=30, le=86400)


class RiskRequest(BaseModel):
    balance: float = Field(gt=0)
    risk_percent: float = Field(gt=0, le=5)
    stop_distance: float = Field(gt=0)
    pip_value: float = Field(default=1, gt=0)
