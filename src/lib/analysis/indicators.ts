import type { Candle, IndicatorConfig, SignalDirection } from '../market/types';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const lastValue = (values: number[]): number => values[values.length - 1] ?? 0;

export function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let previous = values[0];
  values.forEach((value) => {
    previous = previous === 0 ? value : value * k + previous * (1 - k);
    result.push(previous);
  });
  return result;
}

export function calcSMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const result: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const slice = values.slice(Math.max(0, index - period + 1), index + 1);
    result.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }
  return result;
}

export function calcRSI(values: number[], period: number, overbought = 70, oversold = 30): number[] {
  if (values.length < 2 || period <= 0) return new Array(values.length).fill(50);

  const result: number[] = new Array(values.length).fill(50);
  let gains = 0;
  let losses = 0;

  for (let index = 0; index < values.length; index += 1) {
    if (index === 0) {
      result[index] = 50;
      continue;
    }

    const change = values[index] - values[index - 1];
    if (index <= period) {
      gains += change > 0 ? change : 0;
      losses += change < 0 ? Math.abs(change) : 0;
    }

    if (index === period) {
      const avgGain = gains / period;
      const avgLoss = losses / period;
      result[index] = avgLoss === 0 ? 100 : clamp(100 - 100 / (1 + avgGain / avgLoss), 0, 100);
      continue;
    }

    if (index > period) {
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;
      const prev = result[index - 1];
      const avgGain = ((prev / 100) * (period - 1) + currentGain) / period;
      const avgLoss = ((100 - prev) / 100 * (period - 1) + currentLoss) / period;
      const relativeStrength = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result[index] = clamp(100 - 100 / (1 + relativeStrength), 0, 100);
    }
  }

  return result.map((value) => Number(value.toFixed(2)));
}

export function calcMACD(values: number[], fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  const fast = calcEMA(values, fastPeriod);
  const slow = calcEMA(values, slowPeriod);
  const diff = fast.map((value, index) => value - (slow[index] ?? value));
  const signal = calcEMA(diff, signalPeriod);
  const histogram = diff.map((value, index) => value - (signal[index] ?? value));
  return { fast, slow, diff, signal, histogram };
}

export function calcBollingerBands(values: number[], period: number, stdDev: number) {
  const middle = calcSMA(values, period);
  const upper: number[] = [];
  const lower: number[] = [];

  values.forEach((_, index) => {
    const window = values.slice(Math.max(0, index - period + 1), index + 1);
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / window.length;
    const sigma = Math.sqrt(variance);
    const band = stdDev * sigma;
    upper.push(average + band);
    lower.push(average - band);
  });

  return { middle, upper, lower };
}

export function calcStochastic(values: number[], kPeriod: number, dPeriod: number, slowPeriod: number) {
  const k: number[] = [];
  const d: number[] = [];

  values.forEach((_, index) => {
    const window = values.slice(Math.max(0, index - kPeriod + 1), index + 1);
    const lowest = Math.min(...window);
    const highest = Math.max(...window);
    const range = highest - lowest || 0.0001;
    k.push(((values[index] - lowest) / range) * 100);
  });

  for (let index = 0; index < k.length; index += 1) {
    const slice = k.slice(Math.max(0, index - dPeriod + 1), index + 1);
    d.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }

  const slowK = calcSMA(d, slowPeriod);
  const slowD = calcSMA(slowK, slowPeriod);

  return { k, d, slowK, slowD };
}

export function calcATR(candles: Candle[], period: number): number[] {
  const trueRanges: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1] ?? current;
    const range = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trueRanges.push(range);
  }

  return calcSMA(trueRanges, period);
}

export function calcADX(candles: Candle[], period: number): number[] {
  const upMove = candles.map((current, index) => {
    const previous = candles[index - 1] ?? current;
    return current.high - previous.high;
  });
  const downMove = candles.map((current, index) => {
    const previous = candles[index - 1] ?? current;
    return previous.low - current.low;
  });

  const plusDM = upMove.map((value, index) => (value > downMove[index] && value > 0 ? value : 0));
  const minusDM = downMove.map((value, index) => (value > upMove[index] && value > 0 ? value : 0));
  const tr = calcATR(candles, period);
  const smoothPlus = calcEMA(plusDM, period);
  const smoothMinus = calcEMA(minusDM, period);
  const diPlus = smoothPlus.map((value, index) => (tr[index] === 0 ? 0 : (value / tr[index]) * 100));
  const diMinus = smoothMinus.map((value, index) => (tr[index] === 0 ? 0 : (value / tr[index]) * 100));
  const dx = diPlus.map((value, index) => {
    const denom = Math.abs(value - diMinus[index]) || 0.0001;
    const dividend = Math.abs(value + diMinus[index]) || 0.0001;
    return (Math.abs(value - diMinus[index]) / (dividend || denom)) * 100;
  });

  return calcSMA(dx, period);
}

export function calcROC(values: number[], period: number): number[] {
  if (values.length < period) return new Array(values.length).fill(0);
  return values.map((value, index) => {
    const previous = values[index - period] ?? value;
    return previous === 0 ? 0 : ((value - previous) / previous) * 100;
  });
}

export function calcOBV(candles: Candle[]): number[] {
  let cumulative = 0;
  return candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;
    const direction = candle.close > previousClose ? 1 : candle.close < previousClose ? -1 : 0;
    cumulative += direction * (candle.volume ?? 0);
    return cumulative;
  });
}

export function calcIchimoku(candles: Candle[], conversionPeriod: number, basePeriod: number, laggingPeriod: number) {
  const conversion = candles.map((_, index) => {
    const window = candles.slice(Math.max(0, index - conversionPeriod + 1), index + 1);
    const highest = Math.max(...window.map((bar) => bar.high));
    const lowest = Math.min(...window.map((bar) => bar.low));
    return (highest + lowest) / 2;
  });

  const base = candles.map((_, index) => {
    const window = candles.slice(Math.max(0, index - basePeriod + 1), index + 1);
    const highest = Math.max(...window.map((bar) => bar.high));
    const lowest = Math.min(...window.map((bar) => bar.low));
    return (highest + lowest) / 2;
  });

  const leadingSpanA = conversion.map((value, index) => (value + base[index]) / 2);
  const leadingSpanB = candles.map((_, index) => {
    const window = candles.slice(Math.max(0, index - laggingPeriod + 1), index + 1);
    const highest = Math.max(...window.map((bar) => bar.high));
    const lowest = Math.min(...window.map((bar) => bar.low));
    return (highest + lowest) / 2;
  });

  return { conversion, base, leadingSpanA, leadingSpanB };
}

export function buildIndicatorSummary(candles: Candle[], config: IndicatorConfig) {
  const closes = candles.map((candle) => candle.close);
  const emaFast = calcEMA(closes, config.emaFast);
  const emaSlow = calcEMA(closes, config.emaSlow);
  const rsi = calcRSI(closes, config.rsiPeriod, config.rsiOverbought, config.rsiOversold);
  const macd = calcMACD(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const bollinger = calcBollingerBands(closes, config.bollingerPeriod, config.bollingerStdDev);
  const stochastic = calcStochastic(closes, config.stochasticK, config.stochasticD, config.stochasticSlow);
  const atr = calcATR(candles, config.atrPeriod);
  const adx = calcADX(candles, config.adxPeriod);
  const roc = calcROC(closes, config.rocPeriod);
  const obv = calcOBV(candles);
  const ichimoku = calcIchimoku(
    candles,
    config.ichimokuConversion,
    config.ichimokuBase,
    config.ichimokuLagging,
  );

  return {
    emaFast,
    emaSlow,
    rsi,
    macd,
    bollinger,
    stochastic,
    atr,
    adx,
    roc,
    obv,
    ichimoku,
    close: closes,
    last: {
      emaFast: lastValue(emaFast),
      emaSlow: lastValue(emaSlow),
      rsi: lastValue(rsi),
      macd: lastValue(macd.histogram),
      atr: lastValue(atr),
      adx: lastValue(adx),
      roc: lastValue(roc),
      obv: lastValue(obv),
      ichimoku: lastValue(ichimoku.conversion),
      close: lastValue(closes),
    },
  };
}

export function directionFromValue(value: number): SignalDirection {
  if (value > 0) return 'bullish';
  if (value < 0) return 'bearish';
  return 'neutral';
}
