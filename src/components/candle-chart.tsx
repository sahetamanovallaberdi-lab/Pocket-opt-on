'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';

export type ChartCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

export default function CandleChart({ candles }: { candles: ChartCandle[] }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const instance = createChart(element.current, {
      width: element.current.clientWidth,
      height: 390,
      layout: { background: { type: ColorType.Solid, color: '#111a1d' }, textColor: '#9baaa4', fontFamily: 'IBM Plex Mono, monospace' },
      grid: { vertLines: { color: '#202c2d' }, horzLines: { color: '#202c2d' } },
      rightPriceScale: { borderColor: '#2b393a' },
      timeScale: { borderColor: '#2b393a', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#697b73', labelBackgroundColor: '#20312d' }, horzLine: { color: '#697b73', labelBackgroundColor: '#20312d' } },
    });
    const candleSeries = instance.addSeries(CandlestickSeries, { upColor: '#9be3b0', downColor: '#ef806b', borderVisible: false, wickUpColor: '#9be3b0', wickDownColor: '#ef806b' });
    const volumeSeries = instance.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    candleSeries.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    volumeSeries.setData(candles.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.volume ?? 0, color: candle.close >= candle.open ? 'rgba(155,227,176,.34)' : 'rgba(239,128,107,.34)' })));
    instance.timeScale().fitContent();
    chart.current = instance;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) instance.applyOptions({ width });
    });
    observer.observe(element.current);
    return () => { observer.disconnect(); instance.remove(); chart.current = null; };
  }, [candles]);

  return <div ref={element} className="h-[390px] w-full" aria-label="Closed OHLC candles and tick volume chart" />;
}
