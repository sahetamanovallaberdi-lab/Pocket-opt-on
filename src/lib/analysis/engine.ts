import { buildAdapter, resampleCandles } from '../market/adapters';
import type {
  Candle,
  IndicatorConfig,
  MarketRegime,
  MarketSnapshot,
  SignalItem,
  Timeframe,
  TimeframeResult,
  ExecutionMode,
  PriceActionDetection,
} from '../market/types';
import { defaultIndicatorConfig } from '../market/types';
import { buildIndicatorSummary, directionFromValue } from './indicators';
import { detectPriceAction } from './priceAction';

const TIMEFRAMES: Timeframe[] = ['1M', '5M', '15M', '30M', '1H'];

function lastValue(values: number[]): number {
  return values[values.length - 1] ?? 0;
}

function detectMarketRegime(
  candles: Candle[],
  indicators: ReturnType<typeof buildIndicatorSummary>,
  config: IndicatorConfig,
): MarketRegime {
  const closes = candles.map((candle) => candle.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  const emaFast = lastValue(indicators.emaFast);
  const emaSlow = lastValue(indicators.emaSlow);
  const adx = lastValue(indicators.adx);
  const atr = lastValue(indicators.atr);
  const recentHigh = Math.max(...candles.slice(-14).map((candle) => candle.high));
  const recentLow = Math.min(...candles.slice(-14).map((candle) => candle.low));
  const emaSpread = Math.abs(emaFast - emaSlow);
  const rangeWidth = recentHigh - recentLow;
  const trendFactor = emaFast > emaSlow ? 1 : emaFast < emaSlow ? -1 : 0;

  const strongTrend = emaSpread > atr * 0.75 && adx > 25;
  const ranging = emaSpread < atr * 0.35 && adx < 25 && rangeWidth > atr * 1.5;

  let trend: MarketRegime['trend'] = 'ranging';
  if (strongTrend && trendFactor > 0) trend = 'bullish';
  if (strongTrend && trendFactor < 0) trend = 'bearish';
  if (ranging) trend = 'ranging';

  const volatility = atr / Math.max(lastClose, 0.0001) > 0.008 ? 'high' : atr / Math.max(lastClose, 0.0001) < 0.003 ? 'low' : 'medium';
  const conflict = trend !== 'ranging' && config.rangeStrategyEnabled === false && (lastClose < recentLow || lastClose > recentHigh);

  return {
    trend,
    volatility,
    summary: trend === 'bullish' ? 'Bullish structure with trend confirmation' : trend === 'bearish' ? 'Bearish pressure with trending structure' : 'Range-bound market with conflicting momentum',
    conflict,
  };
}

function buildSignals(
  candles: Candle[],
  regime: MarketRegime,
  indicators: ReturnType<typeof buildIndicatorSummary>,
  priceAction: PriceActionDetection[],
  config: IndicatorConfig,
): SignalItem[] {
  const last = candles[candles.length - 1];
  const close = last?.close ?? 0;
  const emaFast = lastValue(indicators.emaFast);
  const emaSlow = lastValue(indicators.emaSlow);
  const rsi = lastValue(indicators.rsi);
  const macd = lastValue(indicators.macd.histogram);
  const roc = lastValue(indicators.roc);

  const trendSignalDirection = regime.trend === 'bullish' ? 'bullish' : regime.trend === 'bearish' ? 'bearish' : 'neutral';
  const trendDetected = regime.trend !== 'ranging' && !regime.conflict;
  const trendSignal: SignalItem = {
    type: 'Trend',
    detected: trendDetected,
    direction: trendSignalDirection,
    strength: trendDetected ? 82 : 28,
    timestamp: last?.time ?? new Date().toISOString(),
    priceLevel: close,
  };

  const momentumStrength = ((macd + roc) / 2) * 4.5;
  const momentumSignal: SignalItem = {
    type: 'Momentum',
    detected: regime.trend !== 'ranging' && !regime.conflict && (rsi > 55 || rsi < 45),
    direction: rsi > 55 ? 'bullish' : rsi < 45 ? 'bearish' : 'neutral',
    strength: Math.min(Math.max(Math.abs(momentumStrength), 0), 100),
    timestamp: last?.time ?? new Date().toISOString(),
    priceLevel: close,
  };

  const actionSignal = priceAction[0]
    ? {
        type: priceAction[0].type,
        detected: priceAction[0].detected,
        direction: priceAction[0].direction,
        strength: priceAction[0].strength,
        timestamp: priceAction[0].timestamp,
        priceLevel: priceAction[0].priceLevel,
      }
    : {
        type: 'Price Action',
        detected: false,
        direction: 'neutral' as const,
        strength: 0,
        timestamp: last?.time ?? new Date().toISOString(),
        priceLevel: close,
      };

  const rangeRules = config.rangeStrategyEnabled && regime.trend === 'ranging';
  const rangeSignal: SignalItem = {
    type: 'Range',
    detected: rangeRules,
    direction: emaFast > emaSlow ? 'bullish' : emaFast < emaSlow ? 'bearish' : 'neutral',
    strength: rangeRules ? 68 : 18,
    timestamp: last?.time ?? new Date().toISOString(),
    priceLevel: close,
  };

  return [trendSignal, momentumSignal, actionSignal, rangeSignal].filter((signal) => signal.type !== 'Range' || signal.detected || config.rangeStrategyEnabled);
}

export function evaluateMarket({
  asset,
  timeframe,
  candles,
  mode,
  indicatorConfig,
}: {
  asset: string;
  timeframe: Timeframe;
  candles: Candle[];
  mode: ExecutionMode;
  indicatorConfig?: Partial<IndicatorConfig>;
}) {
  const config = { ...defaultIndicatorConfig, ...indicatorConfig };
  const closedCandles = candles.length > 1 ? candles.slice(0, candles.length - 1) : candles;
  const indicators = buildIndicatorSummary(closedCandles, config);
  const priceAction = detectPriceAction(closedCandles);
  const marketRegime = detectMarketRegime(closedCandles, indicators, config);
  const signals = buildSignals(closedCandles, marketRegime, indicators, priceAction, config);

  return {
    asset,
    timeframe,
    mode,
    marketRegime,
    analysis: {
      lastClose: closedCandles[closedCandles.length - 1]?.close ?? 0,
      emaStructure: (indicators.emaFast.at(-1) ?? 0) > (indicators.emaSlow.at(-1) ?? 0),
      adx: lastValue(indicators.adx),
      atr: lastValue(indicators.atr),
      volatility: marketRegime.volatility,
      signalCount: signals.length,
    },
    indicators,
    priceAction,
    signals,
  };
}

export function evaluateMultiTimeframe({
  asset,
  snapshot,
  mode,
  indicatorConfig,
}: {
  asset: string;
  snapshot: MarketSnapshot;
  mode: ExecutionMode;
  indicatorConfig?: Partial<IndicatorConfig>;
}) {
  const seriesByTimeframe: Record<Timeframe, Candle[]> = {
    '1M': snapshot.candles,
    '5M': resampleCandles(snapshot.candles, '5M'),
    '15M': resampleCandles(snapshot.candles, '15M'),
    '30M': resampleCandles(snapshot.candles, '30M'),
    '1H': resampleCandles(snapshot.candles, '1H'),
  };

  const results: Record<Timeframe, TimeframeResult> = {} as Record<Timeframe, TimeframeResult>;

  TIMEFRAMES.forEach((timeframe) => {
    const result = evaluateMarket({
      asset,
      timeframe,
      candles: seriesByTimeframe[timeframe],
      mode,
      indicatorConfig,
    });

    results[timeframe] = {
      timeframe,
      marketRegime: result.marketRegime,
      signals: result.signals,
      priceAction: result.priceAction,
      analysis: result.analysis,
    };
  });

  return results;
}

export function getPrimarySignal(results: Record<Timeframe, TimeframeResult>): TimeframeResult | undefined {
  const timeframes = TIMEFRAMES.map((tf) => results[tf]).filter(Boolean);
  if (timeframes.length === 0) return undefined;
  return timeframes.sort((left, right) => right.signals.length - left.signals.length)[0];
}

export function getAdapterForMode(mode: ExecutionMode) {
  return buildAdapter(mode);
}
