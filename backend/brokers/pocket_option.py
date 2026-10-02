from backend.brokers.base import MarketDataAdapter


class PocketOptionProvider(MarketDataAdapter):
    """Fail-closed until an official, documented data feed is configured."""

    name = "pocket-option"
    is_authorized = False

    def list_pairs(self) -> list[str]:
        return []

    def candles(self, pair: str, timeframe: str, limit: int = 240) -> list[dict]:
        raise RuntimeError(
            "No officially supported Pocket Option market-data integration is configured. "
            "Private APIs and browser automation are intentionally not used."
        )


PocketOptionAdapter = PocketOptionProvider
