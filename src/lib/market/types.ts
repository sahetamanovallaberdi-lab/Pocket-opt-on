export type Timeframe = '1M' | '5M' | '15M' | '30M' | '1H';
export type ExecutionMode = 'paper' | 'demo' | 'historical' | 'live';
export type MarketTrend = 'bullish' | 'bearish' | 'ranging';
export type MarketStatus = 'open' | 'closed' | 'unknown';
export type SignalDirection = 'bullish' | 'bearish' | 'neutral';

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  payout?: number;
  tick?: number;
}

export interface IndicatorConfig {
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  emaFast: number;
  emaSlow: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  stochasticK: number;
  stochasticD: number;
  stochasticSlow: number;
  atrPeriod: number;
  adxPeriod: number;
  rocPeriod: number;
  ichimokuConversion: number;
  ichimokuBase: number;
  ichimokuLagging: number;
  rangeStrategyEnabled: boolean;
}

export const defaultIndicatorConfig: IndicatorConfig = {
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  emaFast: 9,
  emaSlow: 21,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
  stochasticK: 14,
  stochasticD: 3,
  stochasticSlow: 3,
  atrPeriod: 14,
  adxPeriod: 14,
  rocPeriod: 12,
  ichimokuConversion: 9,
  ichimokuBase: 26,
  ichimokuLagging: 52,
  rangeStrategyEnabled: false,
};

export interface MarketDataAdapter {
  readonly id: string;
  listAvailablePairs(): Promise<string[]>;
  getMarketSnapshot(asset: string, otc?: boolean): Promise<MarketSnapshot>;
}

export interface MarketSnapshot {
  asset: string;
  otc: boolean;
  tick: number;
  payout?: number;
  candles: Candle[];
  marketStatus: MarketStatus;
  sessionStatus: MarketStatus;
  timestamp: string;
}

export interface SignalItem {
  type: string;
  detected: boolean;
  direction: SignalDirection;
  strength: number;
  timestamp: string;
  priceLevel: number;
}

export interface PriceActionDetection {
  type: string;
  detected: boolean;
  direction: SignalDirection;
  strength: number;
  timestamp: string;
  priceLevel: number;
}

export interface MarketRegime {
  trend: MarketTrend;
  volatility: 'high' | 'low' | 'medium';
  summary: string;
  conflict: boolean;
}

export interface TimeframeResult {
  timeframe: Timeframe;
  marketRegime: MarketRegime;
  signals: SignalItem[];
  priceAction: PriceActionDetection[];
  analysis: Record<string, number | string | boolean>;
}
