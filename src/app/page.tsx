'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildAdapter, resampleCandles } from '@/lib/market/adapters';
import type {
  ExecutionMode,
  IndicatorConfig,
  MarketSnapshot,
  Timeframe,
  TimeframeResult,
} from '@/lib/market/types';
import { defaultIndicatorConfig } from '@/lib/market/types';
import { evaluateMultiTimeframe } from '@/lib/analysis/engine';

const timeframes: Timeframe[] = ['1M', '5M', '15M', '30M', '1H'];

function formatNumber(value: number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  });
}

function PreviousDashboard() {
  const [mode, setMode] = useState<ExecutionMode>('paper');
  const [asset, setAsset] = useState('EURUSD');
  const [otc, setOtc] = useState(false);
  const [pairs, setPairs] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(defaultIndicatorConfig);

  useEffect(() => {
    const adapter = buildAdapter(mode);
    adapter.listAvailablePairs().then((availablePairs) => {
      setPairs(availablePairs);
      setAsset((current) => (availablePairs.includes(current) ? current : availablePairs[0]));
    });
  }, [mode]);

  useEffect(() => {
    const adapter = buildAdapter(mode);
    adapter.getMarketSnapshot(asset, otc).then((marketSnapshot) => {
      setSnapshot(marketSnapshot);
    });
  }, [asset, mode, otc]);

  const timeframeAnalysis = useMemo<Partial<Record<Timeframe, TimeframeResult>>>(() => {
    if (!snapshot) return {};
    return evaluateMultiTimeframe({
      asset: snapshot.asset,
      snapshot,
      mode,
      indicatorConfig,
    });
  }, [snapshot, mode, indicatorConfig]);

  const primaryAnalysis = useMemo(() => {
    if (!timeframeAnalysis) return null;
    const ordered = timeframes
      .map((timeframe) => timeframeAnalysis[timeframe])
      .filter((entry): entry is TimeframeResult => Boolean(entry));
    return ordered.sort((left, right) => right.signals.length - left.signals.length)[0] ?? null;
  }, [timeframeAnalysis]);

  const updateIndicator = (key: keyof IndicatorConfig, value: number | boolean) => {
    setIndicatorConfig((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <main className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Pocket Option analysis panel</p>
          <h1>Pocket Analyzer</h1>
        </div>
        <div className="mode-toggle" aria-label="Execution mode">
          {['paper', 'demo', 'historical', 'live'].map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'active' : ''}
              onClick={() => setMode(value as ExecutionMode)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <section className="dashboard-grid">
        <div className="panel overview-panel">
          <div className="asset-controls">
            <label>
              Asset
              <select value={asset} onChange={(event) => setAsset(event.target.value)}>
                {pairs.map((pair) => (
                  <option key={pair} value={pair}>
                    {pair}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={otc} onChange={(event) => setOtc(event.target.checked)} />
              OTC market
            </label>
          </div>

          <div className="stats-row">
            <div className="stat-card">
              <span>Tick</span>
              <strong>{snapshot ? formatNumber(snapshot.tick) : '--'}</strong>
            </div>
            <div className="stat-card">
              <span>Payout</span>
              <strong>{snapshot ? `${snapshot.payout ?? 0.8}` : '--'}</strong>
            </div>
            <div className="stat-card">
              <span>Trend</span>
              <strong>{primaryAnalysis?.marketRegime.trend ?? 'ranging'}</strong>
            </div>
            <div className="stat-card">
              <span>Volatility</span>
              <strong>{primaryAnalysis?.marketRegime.volatility ?? 'medium'}</strong>
            </div>
          </div>

          <div className="signal-summary">
            <div>
              <p>Execution mode</p>
              <strong>{mode.toUpperCase()}</strong>
            </div>
            <div>
              <p>Market status</p>
              <strong>{snapshot?.marketStatus ?? 'open'}</strong>
            </div>
            <div>
              <p>Session status</p>
              <strong>{snapshot?.sessionStatus ?? 'open'}</strong>
            </div>
          </div>
        </div>

        <aside className="panel config-panel">
          <h2>Indicator config</h2>
          <div className="config-grid">
            <label>
              RSI period
              <input
                type="number"
                value={indicatorConfig.rsiPeriod}
                onChange={(event) => updateIndicator('rsiPeriod', Number(event.target.value))}
              />
            </label>
            <label>
              RSI OB
              <input
                type="number"
                value={indicatorConfig.rsiOverbought}
                onChange={(event) => updateIndicator('rsiOverbought', Number(event.target.value))}
              />
            </label>
            <label>
              RSI OS
              <input
                type="number"
                value={indicatorConfig.rsiOversold}
                onChange={(event) => updateIndicator('rsiOversold', Number(event.target.value))}
              />
            </label>
            <label>
              EMA fast
              <input
                type="number"
                value={indicatorConfig.emaFast}
                onChange={(event) => updateIndicator('emaFast', Number(event.target.value))}
              />
            </label>
            <label>
              EMA slow
              <input
                type="number"
                value={indicatorConfig.emaSlow}
                onChange={(event) => updateIndicator('emaSlow', Number(event.target.value))}
              />
            </label>
            <label>
              ATR
              <input
                type="number"
                value={indicatorConfig.atrPeriod}
                onChange={(event) => updateIndicator('atrPeriod', Number(event.target.value))}
              />
            </label>
            <label>
              ADX
              <input
                type="number"
                value={indicatorConfig.adxPeriod}
                onChange={(event) => updateIndicator('adxPeriod', Number(event.target.value))}
              />
            </label>
            <label>
              MACD fast
              <input
                type="number"
                value={indicatorConfig.macdFast}
                onChange={(event) => updateIndicator('macdFast', Number(event.target.value))}
              />
            </label>
            <label>
              MACD slow
              <input
                type="number"
                value={indicatorConfig.macdSlow}
                onChange={(event) => updateIndicator('macdSlow', Number(event.target.value))}
              />
            </label>
            <label>
              MACD signal
              <input
                type="number"
                value={indicatorConfig.macdSignal}
                onChange={(event) => updateIndicator('macdSignal', Number(event.target.value))}
              />
            </label>
            <label>
              Bollinger period
              <input
                type="number"
                value={indicatorConfig.bollingerPeriod}
                onChange={(event) => updateIndicator('bollingerPeriod', Number(event.target.value))}
              />
            </label>
            <label>
              Bollinger std dev
              <input
                type="number"
                value={indicatorConfig.bollingerStdDev}
                onChange={(event) => updateIndicator('bollingerStdDev', Number(event.target.value))}
              />
            </label>
            <label>
              Stochastic K
              <input
                type="number"
                value={indicatorConfig.stochasticK}
                onChange={(event) => updateIndicator('stochasticK', Number(event.target.value))}
              />
            </label>
            <label>
              Stochastic D
              <input
                type="number"
                value={indicatorConfig.stochasticD}
                onChange={(event) => updateIndicator('stochasticD', Number(event.target.value))}
              />
            </label>
            <label className="checkbox-row full-width">
              <input
                type="checkbox"
                checked={indicatorConfig.rangeStrategyEnabled}
                onChange={(event) => updateIndicator('rangeStrategyEnabled', event.target.checked)}
              />
              Allow range strategy when market is choppy
            </label>
          </div>
        </aside>
      </section>

      <section className="panel timeframe-panel">
        <h2>Multi-timeframe analysis</h2>
        <div className="timeframe-grid">
          {timeframes.map((timeframe) => {
            const result = timeframeAnalysis[timeframe];
            if (!result) return null;

            return (
              <article key={timeframe} className="timeframe-card">
                <div className="timeframe-header">
                  <strong>{timeframe}</strong>
                  <span className={`trend-badge ${result.marketRegime.trend}`}>{result.marketRegime.trend}</span>
                </div>
                <p>{result.marketRegime.summary}</p>
                <ul>
                  {result.signals.slice(0, 3).map((signal) => (
                    <li key={`${timeframe}-${signal.type}`}>
                      <span>{signal.type}</span>
                      <strong>{signal.direction}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel pulse-panel">
        <h2>Closed-candle signal radar</h2>
        {primaryAnalysis && (
          <div className="signal-list">
            {primaryAnalysis.signals.map((signal) => (
              <div key={`${signal.type}-${signal.timestamp}`} className="signal-item">
                <div>
                  <span className="signal-label">{signal.type}</span>
                  <strong>{signal.direction}</strong>
                </div>
                <div>
                  <span>Strength</span>
                  <strong>{signal.strength}%</strong>
                </div>
                <div>
                  <span>Price</span>
                  <strong>{formatNumber(signal.priceLevel)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export { default } from './advanced-dashboard';
