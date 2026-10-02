from abc import ABC, abstractmethod
from typing import Any


class MarketDataAdapter(ABC):
    """Normalized, read-only market data boundary; never exposes execution methods."""

    name: str
    is_authorized: bool = False

    @abstractmethod
    def list_pairs(self) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def candles(self, pair: str, timeframe: str, limit: int = 240) -> list[dict[str, Any]]:
        raise NotImplementedError
