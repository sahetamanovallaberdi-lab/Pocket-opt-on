import { describe, expect, it } from 'vitest';
import { evaluateMarket } from './engine';

describe('evaluateMarket', () => {
  it('produces a regime and signal set from closed candles for a timeframe', () => {
    const candles = Array.from({ length: 80 }, (_, index) => ({
      time: new Date(Date.now() - (79 - index) * 60_000).toISOString(),
      open: 1.1 + index * 0.0008,
      high: 1.102 + index * 0.0008,
      low: 1.098 + index * 0.0008,
      close: 1.101 + index * 0.0008,
      volume: 1000 + index * 10,
    }));

    const result = evaluateMarket({
      asset: 'EURUSD',
      timeframe: '1M',
      candles,
      mode: 'paper',
    });

    expect(result.marketRegime).toBeTruthy();
    expect(result.analysis).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
  });
});
