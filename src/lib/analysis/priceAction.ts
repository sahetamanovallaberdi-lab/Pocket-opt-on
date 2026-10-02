import type { Candle, PriceActionDetection } from '../market/types';

function makeDetection(
  type: string,
  detected: boolean,
  direction: PriceActionDetection['direction'],
  strength: number,
  time: string,
  priceLevel: number,
): PriceActionDetection {
  return {
    type,
    detected,
    direction,
    strength: Number(strength.toFixed(2)),
    timestamp: time,
    priceLevel: Number(priceLevel.toFixed(5)),
  };
}

export function detectPriceAction(candles: Candle[]): PriceActionDetection[] {
  if (candles.length < 5) {
    return [];
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const beforePrevious = candles[candles.length - 3];
  const recentHigh = Math.max(...candles.slice(-12).map((candle) => candle.high));
  const recentLow = Math.min(...candles.slice(-12).map((candle) => candle.low));

  const detections: PriceActionDetection[] = [
    makeDetection(
      'Higher High / Higher Low',
      current.high > previous.high && current.low > previous.low,
      'bullish',
      current.high > previous.high ? 72 : 38,
      current.time,
      current.high,
    ),
    makeDetection(
      'Lower High / Lower Low',
      current.high < previous.high && current.low < previous.low,
      'bearish',
      current.high < previous.high ? 74 : 40,
      current.time,
      current.low,
    ),
    makeDetection(
      'Break of Structure',
      current.high > recentHigh || current.low < recentLow,
      current.high > recentHigh ? 'bullish' : 'bearish',
      80,
      current.time,
      current.high > recentHigh ? current.high : current.low,
    ),
    makeDetection(
      'ChoCh',
      current.close > previous.close && beforePrevious.close < previous.close,
      'bullish',
      67,
      current.time,
      current.close,
    ),
    makeDetection(
      'Support / Resistance',
      current.close > recentLow && current.close < recentHigh,
      current.close >= (recentHigh + recentLow) / 2 ? 'bullish' : 'bearish',
      58,
      current.time,
      (recentHigh + recentLow) / 2,
    ),
    makeDetection(
      'Equal High / Equal Low',
      Math.abs(current.high - previous.high) < 0.0005 && Math.abs(current.low - previous.low) < 0.0005,
      'neutral',
      41,
      current.time,
      current.close,
    ),
    makeDetection(
      'Liquidity Sweep',
      current.low < previous.low && current.close > previous.close,
      'bullish',
      76,
      current.time,
      current.low,
    ),
    makeDetection(
      'Fair Value Gap',
      Math.abs(current.open - previous.close) > Math.abs(previous.high - previous.low) * 0.8,
      current.close > previous.close ? 'bullish' : 'bearish',
      63,
      current.time,
      current.close,
    ),
    makeDetection(
      'Order Block',
      previous.close > previous.open && current.close > previous.close,
      'bullish',
      70,
      previous.time,
      previous.close,
    ),
    makeDetection(
      'Rejection Candle',
      current.close < current.open && Math.abs(current.close - current.open) > (current.high - current.low) * 0.75,
      'bearish',
      62,
      current.time,
      current.open,
    ),
    makeDetection(
      'Engulfing Candle',
      Math.abs(current.close - current.open) > Math.abs(previous.close - previous.open) &&
        ((current.close > previous.open && previous.close < previous.open) ||
          (current.close < previous.open && previous.close > previous.open)),
      current.close > previous.close ? 'bullish' : 'bearish',
      74,
      current.time,
      current.close,
    ),
    makeDetection(
      'Pin Bar',
      current.high - Math.max(current.open, current.close) > (current.high - current.low) * 0.6 &&
        Math.abs(current.close - current.open) < (current.high - current.low) * 0.4,
      current.close > current.open ? 'bullish' : 'bearish',
      69,
      current.time,
      current.close,
    ),
    makeDetection(
      'Momentum Candle',
      Math.abs(current.close - current.open) > (current.high - current.low) * 0.75,
      current.close >= current.open ? 'bullish' : 'bearish',
      79,
      current.time,
      current.close,
    ),
  ];

  return detections.filter((detection) => detection.detected || detection.type === 'Support / Resistance');
}
