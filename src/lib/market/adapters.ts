import type {
  Candle,
  ExecutionMode,
  MarketDataAdapter,
  MarketSnapshot,
  MarketStatus,
  Timeframe,
} from './types';

const PAIR_LIBRARY: Record<string, number> = {
  EURUSD: 1.0875,
  GBPUSD: 1.2685,
  USDJPY: 151.64,
  USDCHF: 0.8912,
  AUDUSD: 0.6592,
  NZDUSD: 0.6084,
  USDCAD: 1.3622,
  EURGBP: 0.8579,
  EURJPY: 165.08,
  GBPJPY: 192.42,
  XAUUSD: 2359.4,
  BTCUSD: 65600,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildCandles(asset: string, count = 180): Candle[] {
  const start = Date.now() - count * 60_000;
  const base = PAIR_LIBRARY[asset] ?? 1.1;
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const time = new Date(start + index * 60_000).toISOString();
    const drift = Math.sin(index / 9) * base * 0.0025;
    const bias = (index % 28) * 0.0002;
    const open = base + drift + bias;
    const close = base + Math.sin(index / 13) * base * 0.002 + bias * 0.75;
    const high = Math.max(open, close) + Math.abs(Math.cos(index / 8)) * base * 0.0018;
    const low = Math.min(open, close) - Math.abs(Math.sin(index / 6)) * base * 0.0014;
    const volume = 900 + index * 13;
    const payout = 0.78 + (index % 6) * 0.05;

    candles.push({
      time,
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
      volume,
      payout: Number(payout.toFixed(2)),
      tick: Number(close.toFixed(5)),
    });
  }

  return candles;
}

export function resampleCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const stepMap: Record<Timeframe, number> = {
    '1M': 1,
    '5M': 5,
    '15M': 15,
    '30M': 30,
    '1H': 60,
  };

  const step = stepMap[timeframe];
  const result: Candle[] = [];

  for (let index = 0; index < candles.length; index += step) {
    const slice = candles.slice(index, index + step);
    if (slice.length === 0) continue;

    const open = slice[0].open;
    const close = slice[slice.length - 1].close;
    const high = Math.max(...slice.map((candle) => candle.high));
    const low = Math.min(...slice.map((candle) => candle.low));
    const volume = slice.reduce((sum, candle) => sum + (candle.volume ?? 0), 0);
    const time = slice[0].time;

    result.push({
      time,
      open,
      high,
      low,
      close,
      volume,
      tick: close,
      payout: slice[slice.length - 1].payout,
    });
  }

  return result;
}

export class PocketOptionAdapter implements MarketDataAdapter {
  readonly id = 'pocket-option';

  async listAvailablePairs(): Promise<string[]> {
    return Object.keys(PAIR_LIBRARY);
  }

  async getMarketSnapshot(asset: string, otc = false): Promise<MarketSnapshot> {
    const normalizedAsset = (asset || 'EURUSD').toUpperCase();
    const pair = PAIR_LIBRARY[normalizedAsset] ? normalizedAsset : 'EURUSD';
    const candles = buildCandles(pair, 220);
    const last = candles[candles.length - 1];
    return {
      asset: pair,
      otc,
      tick: Number((last?.close ?? 0).toFixed(5)),
      payout: Number((last?.payout ?? 0.79).toFixed(2)),
      candles,
      marketStatus: 'open' as MarketStatus,
      sessionStatus: 'open' as MarketStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

export class HistoricalBacktestAdapter implements MarketDataAdapter {
  readonly id = 'historical-backtest';

  async listAvailablePairs(): Promise<string[]> {
    return Object.keys(PAIR_LIBRARY);
  }

  async getMarketSnapshot(asset: string, otc = false): Promise<MarketSnapshot> {
    const normalizedAsset = (asset || 'EURUSD').toUpperCase();
    const pair = PAIR_LIBRARY[normalizedAsset] ? normalizedAsset : 'EURUSD';
    const base = buildCandles(pair, 200);
    const candles = base.map((candle, index) => ({
      ...candle,
      close: Number((candle.close + index * 0.00004).toFixed(5)),
      high: Number((candle.high + index * 0.00003).toFixed(5)),
      low: Number((candle.low + index * 0.00003).toFixed(5)),
    }));
    const last = candles[candles.length - 1];

    return {
      asset: pair,
      otc,
      tick: Number((last?.close ?? 0).toFixed(5)),
      payout: 0.82,
      candles,
      marketStatus: 'closed',
      sessionStatus: 'closed',
      timestamp: new Date().toISOString(),
    };
  }
}

export class PaperDemoAdapter implements MarketDataAdapter {
  readonly id = 'paper-demo';

  async listAvailablePairs(): Promise<string[]> {
    return Object.keys(PAIR_LIBRARY);
  }

  async getMarketSnapshot(asset: string, otc = false): Promise<MarketSnapshot> {
    const normalizedAsset = (asset || 'EURUSD').toUpperCase();
    const pair = PAIR_LIBRARY[normalizedAsset] ? normalizedAsset : 'EURUSD';
    const candles = buildCandles(pair, 190).map((candle, index) => {
      const drift = 0.00035 * Math.sin(index / 12);
      return {
        ...candle,
        open: Number((candle.open + drift).toFixed(5)),
        high: Number((candle.high + drift).toFixed(5)),
        low: Number((candle.low + drift).toFixed(5)),
        close: Number((candle.close + drift).toFixed(5)),
      };
    });
    const last = candles[candles.length - 1];

    return {
      asset: pair,
      otc,
      tick: Number((last?.close ?? 0).toFixed(5)),
      payout: 0.8,
      candles,
      marketStatus: 'open',
      sessionStatus: 'open',
      timestamp: new Date().toISOString(),
    };
  }
}

export function buildAdapter(mode: ExecutionMode): MarketDataAdapter {
  switch (mode) {
    case 'historical':
      return new HistoricalBacktestAdapter();
    case 'live':
      return new PocketOptionAdapter();
    case 'demo':
      return new PaperDemoAdapter();
    case 'paper':
    default:
      return new PaperDemoAdapter();
  }
}

export function getDefaultPairs(): string[] {
  return Object.keys(PAIR_LIBRARY).slice(0, 12);
}

export function toPairList(source: string[] | undefined): string[] {
  return (source ?? getDefaultPairs()).map((pair) => pair.toUpperCase());
}

export function compactMarketStatus(status: MarketStatus): 'Open' | 'Closed' | 'Unknown' {
  const safe = status ?? 'unknown';
  return safe === 'open' ? 'Open' : safe === 'closed' ? 'Closed' : 'Unknown';
}
