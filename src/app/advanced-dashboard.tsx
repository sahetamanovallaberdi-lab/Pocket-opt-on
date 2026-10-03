'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, BookOpen, CandlestickChart, Gauge, History, LayoutDashboard,
  ListFilter, Play, RefreshCw, ShieldCheck, SlidersHorizontal, WalletCards, Wifi,
} from 'lucide-react';
import CandleChart, { type ChartCandle } from '@/components/candle-chart';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';
const timeframes = ['30s', '1m', '5m', '15m', '30m', '1h'] as const;
type Timeframe = (typeof timeframes)[number];
type Tab = 'dashboard' | 'scanner' | 'backtest' | 'replay' | 'journal' | 'performance' | 'history' | 'paper' | 'settings';
type Strategy = { name: string; signal: 'CALL' | 'PUT' | 'NO_TRADE'; confidence: number; reasons: string[]; strategy_status: string; lifecycle: string };
type StructureEvent = { name: string; detected: boolean; direction: string; strength: number; priceLevel: number; timestamp: number };
type Analysis = {
  regime: string;
  regime_category: string;
  volatility: string;
  trend_direction: string;
  signal_decision: 'CALL' | 'PUT' | 'NO_TRADE';
  signal: { direction: string; score: number; allowed: boolean; reason: string };
  strategies: Strategy[];
  agreement: { count: number; total: number; direction: string; votes: Record<string, number> };
  false_signal_filter: { passed: boolean; reasons: string[]; confidence_threshold: number };
  signal_lifecycle: string;
  candle_count: number;
  recommended_expiry: { candle_count: number | null; seconds: number | null };
  indicators: { ema: Record<string, number>; rsi: number; macd_histogram: number; bollinger: { upper: number; middle: number; lower: number }; stochastic: number; adx: number; atr: number; tick_volume: number; volume_average: number; momentum: number };
  structure: StructureEvent[];
  features: { divergence: Record<string, StructureEvent[]>; fibonacci: { high: number | null; low: number | null; levels: Record<string, number> }; sessions: { active_sessions: string[]; primary_session: string; overlap: boolean; timezone: string }; };
};
type Market = { pair: string; timeframe: string; provider: string; mode: string; otc: boolean; payout: number; market_status: string; tick: number; candles: ChartCandle[]; analysis: Analysis };
type ProviderStatus = { status: 'CONNECTED' | 'DISCONNECTED' | 'DEMO' | 'UNAVAILABLE'; last_update: string | null; source: string; connected: boolean; latency_ms: number | null; error: string | null };
type Mtf = { pair: string; timeframes: Record<Timeframe, { direction: string; confidence: number; regime: string; regime_category: string }>; higher_timeframe_direction: string; agreement: { count: number; total: number; direction: string } };
type Settings = { ema: number[]; rsi_period: number; rsi_overbought: number; rsi_oversold: number; macd: number[]; bollinger: number[]; stochastic: number[]; adx_period: number; atr_period: number; momentum_period: number; confidence_threshold: number };
type ScannerRow = { pair: string; tick: number; analysis: Analysis };
type JsonRecord = Record<string, string | number | boolean | null>;
type JournalSignal = { id: number; pair: string; timeframe: string; timestamp: number; decision: string; confidence: number; expiry_seconds: number | null; session: string; regime: string; reasons: string[]; source: string; status: string; result: string; profit_units: number };
type Metrics = { total_trades: number; wins: number; losses: number; ties: number; no_trade_signals: number; pending_trades: number; win_rate: number | null; profit_factor: number | null; expectancy_units: number | null; net_profit_units: number; max_drawdown_units: number; max_consecutive_losses: number };
type Performance = { source: string; has_resolved_results: boolean; sample_size: number; overall: Metrics; pair_performance: Record<string, Metrics>; timeframe_performance: Record<string, Metrics>; session_performance: Record<string, Metrics>; confidence_performance: Record<string, Metrics>; expiry_performance: Record<string, Metrics>; data_notice: string };
type ExpiryPerformance = { pair: string; timeframe: string; source: string[]; enough_data: boolean; expiry_performance: Record<string, Metrics & { measured_signals: number; expiry_seconds: number }> ; data_notice: string };

const defaults: Settings = { ema: [9, 21, 50, 200], rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30, macd: [12, 26, 9], bollinger: [20, 2], stochastic: [14, 3, 3], adx_period: 14, atr_period: 14, momentum_period: 10, confidence_threshold: 75 };
const navigation: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'Scanner', icon: ListFilter },
  { id: 'backtest', label: 'Backtest', icon: BarChart3 },
  { id: 'replay', label: 'Replay', icon: Play },
  { id: 'journal', label: 'Signal journal', icon: BookOpen },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'history', label: 'History', icon: History },
  { id: 'paper', label: 'Paper', icon: WalletCards },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store', ...init });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const fmt = (value?: number | null, digits = 5) => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const directionClass = (direction: string) => direction === 'CALL' || direction === 'BULLISH' || direction === 'bullish' ? 'text-[#247651]' : direction === 'PUT' || direction === 'BEARISH' || direction === 'bearish' ? 'text-[#b65340]' : 'text-[#78837b]';

export default function AdvancedDashboard() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [pairs, setPairs] = useState<string[]>([]);
  const [pair, setPair] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('1m');
  const [market, setMarket] = useState<Market | null>(null);
  const [mtf, setMtf] = useState<Mtf | null>(null);
  const [scanner, setScanner] = useState<ScannerRow[]>([]);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [backtest, setBacktest] = useState<JsonRecord | null>(null);
  const [walkForward, setWalkForward] = useState<Record<string, unknown> | null>(null);
  const [optimizer, setOptimizer] = useState<Record<string, unknown> | null>(null);
  const [replayBars, setReplayBars] = useState(120);
  const [replay, setReplay] = useState<Market | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; pair: string; timeframe: string; timestamp: number; direction: string; score: number; payload: Analysis }>>([]);
  const [journal, setJournal] = useState<JournalSignal[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [expiryPerformance, setExpiryPerformance] = useState<ExpiryPerformance | null>(null);
  const [paperTrades, setPaperTrades] = useState<Array<{ id: number; pair: string; timeframe: string; direction: string; entry_price: number; stake: number; expiry_seconds: number; status: string; created_at: number }>>([]);
  const [stake, setStake] = useState(10);
  const [balance, setBalance] = useState(1000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [stopDistance, setStopDistance] = useState(0.001);
  const [risk, setRisk] = useState<{ risk_amount: number; position_size: number } | null>(null);

  const loadMarket = useCallback(async (selectedPair = pair, selectedTimeframe = timeframe) => {
    const payload = await request<Market>(`/api/market/${encodeURIComponent(selectedPair)}?timeframe=${selectedTimeframe}`);
    setMarket(payload);
    const status = (payload as Market & { data_status?: ProviderStatus }).data_status;
    if (status) setProviderStatus(status);
  }, [pair, timeframe]);

  useEffect(() => {
    let active = true;
    Promise.all([request<{ pairs: string[] }>('/api/pairs'), request<Settings>('/api/settings'), request<ProviderStatus>('/api/provider/status')])
      .then(([pairPayload, savedSettings, dataStatus]) => {
        if (!active) return;
        setPairs(pairPayload.pairs);
        setPair((current) => pairPayload.pairs.includes(current) ? current : pairPayload.pairs[0] ?? 'EURUSD');
        setSettings({ ...defaults, ...savedSettings });
        setProviderStatus(dataStatus);
      })
      .catch((cause: Error) => active && setError(`${cause.message}. Run the FastAPI service on port 8001.`));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pair) return;
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let retryDelay = 1000;
    loadMarket().catch((cause: Error) => active && setError(cause.message));
    request<Mtf>(`/api/analysis/${encodeURIComponent(pair)}`).then((value) => active && setMtf(value)).catch((cause: Error) => active && setError(cause.message));
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = () => {
      if (!active) return;
      const currentSocket = new WebSocket(`${scheme}://${new URL(API).host}/ws/market/${encodeURIComponent(pair)}?timeframe=${timeframe}`);
      socket = currentSocket;
      connectionTimer = setTimeout(() => {
        if (currentSocket.readyState === WebSocket.CONNECTING) currentSocket.close();
      }, 10000);
      currentSocket.onopen = () => {
        if (connectionTimer) clearTimeout(connectionTimer);
        setConnected(true);
        retryDelay = 1000;
        setError('');
        heartbeatInterval = setInterval(() => {
          if (currentSocket.readyState !== WebSocket.OPEN) return;
          currentSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          heartbeatTimeout = setTimeout(() => currentSocket.close(4000, 'heartbeat timeout'), 15000);
        }, 10000);
      };
      currentSocket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as (Market & { data_status?: ProviderStatus }) | { type: string };
          if ('type' in payload && payload.type === 'pong') {
            if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
            return;
          }
          if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
          if (!('candles' in payload)) return;
          setMarket(payload);
          if (payload.data_status) setProviderStatus(payload.data_status);
        } catch {
          setError('Market WebSocket sent an invalid payload. Retrying the connection.');
          currentSocket.close();
        }
      };
      currentSocket.onerror = () => { setConnected(false); currentSocket.close(); };
      currentSocket.onclose = () => {
        if (connectionTimer) clearTimeout(connectionTimer);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        setConnected(false);
        if (active) {
          reconnectTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };
    };
    connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connectionTimer) clearTimeout(connectionTimer);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      socket?.close();
    };
  }, [pair, timeframe, loadMarket]);

  useEffect(() => {
    if (!pairs.length) return;
    request<{ pairs: ScannerRow[] }>(`/api/scanner?timeframe=${timeframe}`).then((payload) => setScanner(payload.pairs)).catch(() => undefined);
  }, [pairs, timeframe]);

  useEffect(() => {
    if (tab === 'history') request<{ signals: typeof history }>('/api/history').then((payload) => setHistory(payload.signals)).catch((cause: Error) => setError(cause.message));
    if (tab === 'journal') request<{ signals: JournalSignal[] }>('/api/journal?limit=1000').then((payload) => setJournal(payload.signals)).catch((cause: Error) => setError(cause.message));
    if (tab === 'performance') Promise.all([
      request<Performance>('/api/performance'),
      request<ExpiryPerformance>(`/api/performance/expiry?pair=${encodeURIComponent(pair)}&timeframe=${timeframe}`),
    ]).then(([summary, expiryResults]) => { setPerformance(summary); setExpiryPerformance(expiryResults); }).catch((cause: Error) => setError(cause.message));
    if (tab === 'paper') request<{ trades: typeof paperTrades }>('/api/paper/trades').then((payload) => setPaperTrades(payload.trades)).catch((cause: Error) => setError(cause.message));
  }, [tab, pair, timeframe]);

  const filteredScanner = useMemo(() => scanner.filter((item) => item.pair.toLowerCase().includes(search.toLowerCase())), [scanner, search]);
  const detectedStructure = market?.analysis.structure.filter((event) => event.detected) ?? [];
  const replayCandles = replay?.candles ?? [];

  const saveSettings = async () => {
    setBusy(true);
    try {
      const saved = await request<Settings>('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      setSettings(saved);
      await loadMarket();
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const runBacktest = async (mode: 'standard' | 'walk-forward' | 'optimizer') => {
    setBusy(true);
    try {
      const route = mode === 'walk-forward' ? '/api/backtest/walk-forward' : mode === 'optimizer' ? '/api/optimizer' : '/api/backtest';
      const result = await request<Record<string, unknown>>(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, timeframe, fast_period: settings.ema[0], slow_period: settings.ema[1], expiry: 3, payout: market?.payout ?? 0.82 }),
      });
      if (mode === 'standard') setBacktest(result as JsonRecord);
      if (mode === 'walk-forward') setWalkForward(result);
      if (mode === 'optimizer') setOptimizer(result);
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const loadReplay = async (bars = replayBars) => {
    setBusy(true);
    try {
      const result = await request<Omit<Market, 'provider' | 'mode' | 'otc' | 'payout' | 'market_status' | 'tick'> & { replay_bars: number }>(`/api/replay/${encodeURIComponent(pair)}?timeframe=${timeframe}&bars=${bars}`);
      const last = result.candles[result.candles.length - 1];
      setReplay({ ...result, provider: 'mock-demo', mode: 'REPLAY', otc: pair.endsWith('-OTC'), payout: 0.82, market_status: 'historical', tick: last?.close ?? 0 });
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const createPaperTrade = async () => {
    if (!market || !['CALL', 'PUT'].includes(market.analysis.signal_decision)) return;
    setBusy(true);
    try {
      await request('/api/paper/trades', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, timeframe, direction: market.analysis.signal_decision, entry_price: market.tick, stake, expiry_seconds: market.analysis.recommended_expiry.seconds ?? 60 }),
      });
      const trades = await request<{ trades: typeof paperTrades }>('/api/paper/trades');
      setPaperTrades(trades.trades);
      setTab('paper');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const calculateRisk = async () => {
    try {
      const result = await request<{ risk_amount: number; position_size: number }>('/api/risk/position-size', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance, risk_percent: riskPercent, stop_distance: stopDistance, pip_value: 1 }),
      });
      setRisk(result);
    } catch (cause) { setError((cause as Error).message); }
  };

  const setEma = (index: number, value: number) => setSettings((current) => ({ ...current, ema: current.ema.map((old, i) => i === index ? value : old) }));
  const setMacd = (index: number, value: number) => setSettings((current) => ({ ...current, macd: current.macd.map((old, i) => i === index ? value : old) }));

  return <div className="min-h-screen bg-[#f2f4ef] pb-16 text-[#25312d] lg:pb-0">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[218px] flex-col border-r border-[#dfe4dd] bg-[#fbfcf8] px-4 py-5 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-2"><div className="grid size-9 place-items-center rounded bg-[#1d6249] text-white"><Activity size={19}/></div><div><div className="font-semibold">pocket</div><div className="text-[10px] uppercase tracking-[.18em] text-[#7d8982]">analyzer</div></div></div>
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#8c9690]">Analysis desk</div>
      <nav className="grid gap-1">{navigation.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`flex h-10 items-center gap-3 rounded px-3 text-left text-[13px] ${tab === id ? 'bg-[#e7f0e9] font-semibold text-[#246b50]' : 'text-[#718079] hover:bg-[#f0f3ed]'}`}><Icon size={16}/>{label}</button>)}</nav>
      <div className="mt-auto border border-[#dfe5de] bg-white p-3"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#51625a]"><ShieldCheck size={15} className="text-[#438668]"/> Signal only</div><p className="m-0 text-[10px] leading-relaxed text-[#859089]">Demo data. No broker execution or AI API.</p></div>
    </aside>

    <main className="lg:pl-[218px]">
      <header className="sticky top-0 z-10 flex min-h-[62px] flex-wrap items-center justify-between gap-2 border-b border-[#dfe4dd] bg-[#f8f9f5]/95 px-4 py-2 backdrop-blur md:px-8"><div className="font-semibold capitalize">{tab === 'dashboard' ? 'Market overview' : tab.replace('-', ' ')}</div><div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#718079]"><span className="font-bold text-[#344139]">Status: {providerStatus?.status ?? (connected ? 'CONNECTED' : 'DISCONNECTED')}</span><span>Last update: {providerStatus?.last_update ? new Date(providerStatus.last_update).toLocaleTimeString() : '—'}</span><span>Source: {providerStatus?.source ?? 'unknown'}</span><span>Latency: {providerStatus?.latency_ms == null ? '—' : `${providerStatus.latency_ms} ms`}</span><span className="border border-[#d9e1d8] bg-white px-2 py-1 font-bold tracking-wide text-[#326c52]">PAPER / SIGNAL ONLY</span></div></header>
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-5 md:px-8 md:py-7">
        {error && <div className="mb-4 flex items-start justify-between gap-3 border border-[#e6c2b8] bg-[#fff5f1] px-4 py-3 text-xs text-[#a34936]"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

        {tab === 'dashboard' && <>
          {providerStatus?.status === 'DEMO' && <div className="mb-4 border-2 border-[#bd8427] bg-[#fff1d8] px-4 py-3 text-base font-black text-[#744d0c]">DEMO DATA · Official Pocket Option feed is unavailable; analysis uses local deterministic data.</div>}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-[#77847c]">Mock/demo · closed candles</p><h1 className="m-0 text-2xl font-semibold">Market overview</h1></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor="pair-picker">Pair</label><select id="pair-picker" value={pair} onChange={(event) => setPair(event.target.value)} className="h-10 min-w-36 border border-[#d9dfd9] bg-white px-3 text-sm font-semibold">{pairs.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => loadMarket().catch((cause) => setError((cause as Error).message))} className="grid size-10 place-items-center border border-[#d9dfd9] bg-white" aria-label="Refresh market"><RefreshCw size={15}/></button></div></div>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 border-y border-[#dce2da] py-3 text-[11px] text-[#78847d]"><span>Status <b className="text-[#34423a]">{providerStatus?.status ?? 'DISCONNECTED'}</b></span><span>Source <b className="text-[#34423a]">{providerStatus?.source ?? market?.provider ?? '—'}</b></span><span>Last update <b className="text-[#34423a]">{providerStatus?.last_update ? new Date(providerStatus.last_update).toLocaleTimeString() : '—'}</b></span><span>Latency <b className="text-[#34423a]">{providerStatus?.latency_ms == null ? '—' : `${providerStatus.latency_ms} ms`}</b></span><span>Session <b className="text-[#34423a]">{market?.analysis.features.sessions.primary_session ?? '—'}</b></span><span>Market <b className="text-[#34423a]">{market?.market_status ?? '—'}</b></span><span>Payout <b className="text-[#34423a]">{market ? `${Math.round(market.payout * 100)}%` : '—'}</b></span><span className="flex items-center gap-1"><Wifi size={12}/> {market?.analysis.features.sessions.active_sessions.join(' + ') || 'Off-session'}</span><span className="basis-full text-[#9a6630]">Error: {providerStatus?.error ?? 'None'}</span></div>
          <div className="mb-4 grid grid-cols-2 gap-px border border-[#dce2da] bg-[#dce2da] sm:grid-cols-3 xl:grid-cols-6"><Metric label="Last price" value={fmt(market?.tick)}/><Metric label="Regime" value={market?.analysis.regime_category ?? '—'}/><Metric label="Volatility" value={market?.analysis.volatility ?? '—'}/><Metric label="Strategy match" value={market ? `${market.analysis.agreement.count}/${market.analysis.agreement.total}` : '—'}/><Metric label="Decision" value={market?.analysis.signal_decision ?? '—'} tone={market?.analysis.signal_decision}/><Metric label="Confidence floor" value={`${settings.confidence_threshold}%`}/></div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="overflow-hidden border border-[#273435] bg-[#111a1d]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293536] px-3 py-3 sm:px-4"><div className="flex items-baseline gap-3"><b className="font-mono text-sm text-[#e6ede8]">{pair}</b><span className="font-mono text-xs text-[#91a098]">{fmt(market?.tick)}</span></div><div className="flex flex-wrap gap-1">{timeframes.map((item) => <button key={item} onClick={() => setTimeframe(item)} className={`px-2.5 py-1 text-[10px] ${timeframe === item ? 'bg-[#2a473d] text-[#a9e0bf]' : 'text-[#8c9a92] hover:bg-[#263332]'}`}>{item}</button>)}</div></div><div className="px-1 pt-2 sm:px-2">{market?.candles.length ? <CandleChart candles={market.candles}/> : <div className="grid h-[390px] place-items-center text-sm text-[#78847e]">Waiting for closed candles…</div>}</div><div className="flex justify-between border-t border-[#293536] px-4 py-2 text-[10px] text-[#78867e]"><span>OHLC · tick volume · {timeframe}</span><span>{market?.analysis.candle_count ?? market?.candles.length ?? 0} closed bars</span></div></section>
            <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Strategy agreement" icon={Activity} trailing={market ? `${market.analysis.agreement.count}/${market.analysis.agreement.total}` : '—'}/><div className="p-4"><div className={`mb-3 border-l-[3px] px-3 py-2 ${market?.analysis.signal_decision === 'CALL' ? 'border-[#31875f] bg-[#edf5ee]' : market?.analysis.signal_decision === 'PUT' ? 'border-[#c36a56] bg-[#fbefeb]' : 'border-[#aab4ac] bg-[#f1f3ef]'}`}><div className="text-[10px] uppercase tracking-widest text-[#7b8780]">{market?.analysis.signal_lifecycle ?? 'WATCHING'} · {market?.analysis.false_signal_filter.passed ? 'Filters passed' : 'No confirmed setup'}</div><div className={`mt-1 text-lg font-semibold ${directionClass(market?.analysis.signal_decision ?? 'NO_TRADE')}`}>{market?.analysis.signal_decision ?? 'NO_TRADE'}{market?.analysis.signal_decision !== 'NO_TRADE' && <span className="ml-2 text-xs">{market?.analysis.signal.score}%</span>}</div></div><p className="mb-4 text-[11px] leading-relaxed text-[#7c8881]">{market?.analysis.signal.reason ?? 'Waiting for API data.'}</p><div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-[#849088]"><span>Regime</span><b className="text-right text-[#35423b]">{market?.analysis.regime ?? '—'}</b><span>ADX</span><b className="text-right text-[#35423b]">{market?.analysis.indicators.adx ?? '—'}</b><span>ATR</span><b className="text-right text-[#35423b]">{fmt(market?.analysis.indicators.atr)}</b><span>Expiry guide</span><b className="text-right text-[#35423b]">{market?.analysis.recommended_expiry.seconds ? `${market.analysis.recommended_expiry.seconds}s` : '—'}</b></div><div className="grid gap-2">{market?.analysis.strategies.map((strategy) => <div key={strategy.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-[#e9ece6] pt-2 text-[10px]"><span className="text-[#536158]">{strategy.name}</span><b className={directionClass(strategy.signal)}>{strategy.signal}</b><span className="w-16 text-right font-mono text-[#718079]">{strategy.confidence}%</span></div>)}</div><button onClick={createPaperTrade} disabled={busy || !market || market.analysis.signal_decision === 'NO_TRADE'} className="mt-4 h-9 w-full bg-[#24694e] text-xs font-semibold text-white disabled:bg-[#d9dfd9] disabled:text-[#8a938d]">Record paper trade</button></div></section>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
            <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="MTF heatmap" icon={Gauge} trailing={mtf ? `${mtf.agreement.count}/${mtf.agreement.total}` : '—'}/><div className="grid grid-cols-[54px_1fr_70px_55px] items-center gap-y-1 px-4 py-3 text-[9px] uppercase tracking-wide text-[#849088]"><span>TF</span><span>Direction</span><span>Regime</span><span className="text-right">Conf.</span>{timeframes.slice().reverse().map((tf) => { const row = mtf?.timeframes[tf]; return <div key={tf} className="contents"><b className="py-1 text-[#4c5c52]">{tf}</b><span className={`py-1 font-semibold ${directionClass(row?.direction ?? 'NEUTRAL')}`}>{row?.direction ?? '—'}</span><span className="truncate py-1 text-[#758179]">{row?.regime_category?.replaceAll('_', ' ') ?? '—'}</span><span className="py-1 text-right font-mono text-[#58655d]">{row?.confidence ?? 0}%</span></div>; })}</div><div className="border-t border-[#e5e9e2] px-4 py-2 text-[10px] text-[#758179]">Higher timeframe bias <b className={directionClass(mtf?.higher_timeframe_direction ?? 'NEUTRAL')}>{mtf?.higher_timeframe_direction ?? '—'}</b> · agreement {mtf?.agreement.count ?? 0}/{mtf?.agreement.total ?? 6}</div></section>
            <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Indicator panel" icon={CandlestickChart} trailing={timeframe}/><div className="grid grid-cols-2 gap-x-4 px-4 py-2">{[['EMA 9',market?.analysis.indicators.ema['9']],['EMA 21',market?.analysis.indicators.ema['21']],['EMA 50',market?.analysis.indicators.ema['50']],['EMA 200',market?.analysis.indicators.ema['200']],['RSI',market?.analysis.indicators.rsi],['MACD hist.',market?.analysis.indicators.macd_histogram],['Bollinger mid',market?.analysis.indicators.bollinger.middle],['Stochastic',market?.analysis.indicators.stochastic],['ADX',market?.analysis.indicators.adx],['ATR',market?.analysis.indicators.atr],['Tick volume',market?.analysis.indicators.tick_volume],['Momentum',market?.analysis.indicators.momentum]].map(([label,value]) => <Metric key={label} label={String(label)} value={typeof value === 'number' ? fmt(value) : '—'}/>)}</div></section>
            <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Structure & filters" icon={ShieldCheck} trailing={market?.analysis.false_signal_filter.passed ? 'PASS' : 'FILTERED'}/><div className="max-h-[290px] overflow-auto px-4 py-3"><div className="mb-3 flex flex-wrap gap-1">{detectedStructure.slice(0, 12).map((event) => <span key={`${event.name}-${event.timestamp}`} className="border border-[#e1e6df] bg-white px-2 py-1 text-[9px] text-[#647169]">{event.name}</span>)}</div><div className="mb-3 text-[10px] text-[#66736a]">Session: {market?.analysis.features.sessions.active_sessions.join(' + ') || 'Off-session'} UTC {market?.analysis.features.sessions.overlap ? 'overlap' : ''}</div><div className="mb-3 grid grid-cols-4 gap-1 text-[9px]">{Object.entries(market?.analysis.features.fibonacci.levels ?? {}).map(([ratio, level]) => <div key={ratio} className="border border-[#e7ebe5] px-1.5 py-1"><div className="text-[#8b958e]">{ratio}</div><b className="font-mono">{fmt(level)}</b></div>)}</div><div className="space-y-1">{market?.analysis.false_signal_filter.reasons.map((reason) => <p key={reason} className="m-0 text-[10px] text-[#a15b48]">{reason}</p>)}</div></div></section>
          </div>
        </>}

        {tab === 'scanner' && <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Pair-by-pair market scanner" icon={ListFilter} trailing={`${filteredScanner.length} pairs`}/><div className="flex flex-wrap items-center justify-between gap-3 p-4"><input aria-label="Search pairs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pairs" className="h-9 w-48 border border-[#d9dfd9] bg-white px-3 text-xs"/><div className="flex gap-1">{timeframes.map((tf) => <button key={tf} onClick={() => setTimeframe(tf)} className={`px-2 py-1 text-[10px] ${timeframe === tf ? 'bg-[#24694e] text-white' : 'border border-[#d9dfd9] bg-white'}`}>{tf}</button>)}</div></div><div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase tracking-wider text-[#849088]"><tr>{['Pair', 'Price', 'Regime', 'Volatility', 'Direction', 'Agreement', 'Confidence'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody>{filteredScanner.map((item) => <tr key={item.pair} onClick={() => { setPair(item.pair); setTab('dashboard'); }} className="cursor-pointer border-t border-[#edf0ea] hover:bg-[#f4f6f1]"><td className="px-4 py-3 font-semibold">{item.pair}</td><td className="px-4 py-3 font-mono">{fmt(item.tick)}</td><td className="px-4 py-3">{item.analysis.regime.replaceAll('_', ' ')}</td><td className="px-4 py-3">{item.analysis.volatility}</td><td className={`px-4 py-3 ${directionClass(item.analysis.signal_decision)}`}>{item.analysis.signal_decision}</td><td className="px-4 py-3">{item.analysis.agreement.count}/{item.analysis.agreement.total}</td><td className="px-4 py-3">{item.analysis.signal.score}%</td></tr>)}</tbody></table></div></section>}

        {tab === 'backtest' && <section className="max-w-5xl border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Backtesting & walk-forward" icon={BarChart3} trailing="Shared deterministic engine"/><div className="grid gap-4 p-4 md:grid-cols-3"><ActionBox title="Historical backtest" description="Run the same strategy and confidence gates against historical demo candles." action="Run backtest" busy={busy} onClick={() => runBacktest('standard')}/><ActionBox title="Walk-forward test" description="Chronological 70/30 train-validation split. No random shuffling." action="Run walk-forward" busy={busy} onClick={() => runBacktest('walk-forward')}/><ActionBox title="Parameter optimizer" description="Compare a small EMA grid in-sample; validate before use." action="Optimize" busy={busy} onClick={() => runBacktest('optimizer')}/></div><div className="grid gap-px border-t border-[#e5e9e2] bg-[#e5e9e2] md:grid-cols-3"><ResultBlock title="Backtest" data={backtest}/><ResultBlock title="Walk-forward" data={walkForward}/><ResultBlock title="Optimizer" data={optimizer}/></div><p className="m-0 border-t border-[#e5e9e2] px-4 py-3 text-[10px] text-[#849088]">Signals use only candles available at each historical decision. Future candles are used only for outcome scoring. Demo results do not predict future returns.</p></section>}

        {tab === 'replay' && <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Historical replay" icon={Play} trailing="Closed-candle replay"/><div className="flex flex-wrap items-center gap-4 p-4"><label className="grid gap-1 text-[10px] text-[#718079]">Bars up to replay point <input type="range" min={30} max={500} step={10} value={replayBars} onChange={(event) => setReplayBars(Number(event.target.value))}/></label><span className="font-mono text-xs">{replayBars} bars</span><button disabled={busy} onClick={() => loadReplay()} className="h-9 bg-[#24694e] px-4 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Loading…' : 'Load replay point'}</button></div>{replay ? <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_300px]"><div className="overflow-hidden border border-[#273435] bg-[#111a1d] p-2"><CandleChart candles={replayCandles}/><div className="px-2 py-2 text-[10px] text-[#87928b]">Replay analysis uses {replay.analysis.candle_count} historical closed bars through {new Date(replayCandles.at(-1)?.time ? replayCandles.at(-1)!.time * 1000 : 0).toLocaleString()}</div></div><div><Metric label="Signal" value={replay.analysis.signal_decision}/><Metric label="Regime" value={replay.analysis.regime}/><Metric label="Agreement" value={`${replay.analysis.agreement.count}/${replay.analysis.agreement.total}`}/>{replay.analysis.strategies.map((strategy) => <div key={strategy.name} className="flex justify-between border-b border-[#e7ebe5] py-2 text-xs"><span>{strategy.name}</span><b className={directionClass(strategy.signal)}>{strategy.signal} · {strategy.confidence}%</b></div>)}</div></div> : <div className="p-8 text-center text-xs text-[#87928b]">Choose a historical cutoff and load replay. Analysis cannot see later bars.</div>}</section>}

        {tab === 'journal' && <section className="overflow-x-auto border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Signal journal · all decisions" icon={BookOpen} trailing={`${journal.length} records`}/><table className="w-full min-w-[1100px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase text-[#849088]"><tr>{['Time (UTC)', 'Pair', 'TF', 'Decision', 'Confidence', 'Expiry', 'Session', 'Outcome', 'Reasons'].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody>{journal.map((item) => <tr key={item.id} className="border-t border-[#edf0ea] align-top"><td className="whitespace-nowrap px-3 py-3">{new Date(item.timestamp * 1000).toLocaleString()}</td><td className="px-3 py-3 font-semibold">{item.pair}</td><td className="px-3 py-3">{item.timeframe}</td><td className={`px-3 py-3 font-semibold ${directionClass(item.decision)}`}>{item.decision}</td><td className="px-3 py-3">{item.confidence}%</td><td className="px-3 py-3">{item.expiry_seconds ? `${item.expiry_seconds}s` : '—'}</td><td className="px-3 py-3">{item.session}</td><td className="px-3 py-3">{item.status === 'PENDING' ? 'PENDING' : item.result}{item.status === 'RESOLVED' ? ` (${fmt(item.profit_units, 2)}u)` : ''}</td><td className="max-w-[350px] px-3 py-3"><details><summary className="cursor-pointer text-[#486753]">{item.reasons.length} reasons</summary><ul className="mt-2 list-disc pl-4 text-[10px] leading-relaxed text-[#69766e]">{item.reasons.map((reason, index) => <li key={`${item.id}-${index}`}>{reason}</li>)}</ul></details></td></tr>)}</tbody></table>{journal.length === 0 && <p className="p-6 text-center text-xs text-[#87928b]">No journal records yet. Market and scanner analysis will be recorded here.</p>}</section>}

        {tab === 'performance' && <div className="grid gap-4"><section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Measured performance" icon={Gauge} trailing={performance ? `${performance.sample_size} resolved` : 'Loading'}/><div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-[#e7ebe5] px-4 py-3 text-[10px] text-[#718079]"><span>Source <b className="text-[#344139]">{performance?.source ?? '—'}</b></span><span>Current test <b className="text-[#344139]">{pair} · {timeframe}</b></span><span>Pending <b className="text-[#344139]">{performance?.overall.pending_trades ?? 0}</b></span><span>No-trade <b className="text-[#344139]">{performance?.overall.no_trade_signals ?? 0}</b></span></div><div className="grid grid-cols-2 gap-px bg-[#dce2da] sm:grid-cols-3 xl:grid-cols-6"><Metric label="Resolved trades" value={String(performance?.overall.total_trades ?? 0)}/><Metric label="Win rate" value={performance?.overall.win_rate == null ? 'N/A' : `${performance.overall.win_rate}%`}/><Metric label="Profit factor" value={performance?.overall.profit_factor == null ? 'N/A' : String(performance.overall.profit_factor)}/><Metric label="Expectancy" value={performance?.overall.expectancy_units == null ? 'N/A' : `${performance.overall.expectancy_units}u`}/><Metric label="Max drawdown" value={`${performance?.overall.max_drawdown_units ?? 0}u`}/><Metric label="Consecutive losses" value={String(performance?.overall.max_consecutive_losses ?? 0)}/></div><p className="m-0 border-t border-[#e5e9e2] px-4 py-3 text-[10px] leading-relaxed text-[#849088]">{performance?.data_notice ?? 'Waiting for performance data.'}</p>{performance && !performance.has_resolved_results && <p className="m-0 px-4 pb-4 text-xs text-[#936b36]">No outcome has been measured yet. Win rate, profit factor and expectancy are unavailable, not zero.</p>}</section>
          <div className="grid gap-4 xl:grid-cols-2"><BreakdownTable title="By pair" rows={performance?.pair_performance ?? {}}/><BreakdownTable title="By timeframe" rows={performance?.timeframe_performance ?? {}}/><BreakdownTable title="By session" rows={performance?.session_performance ?? {}}/><BreakdownTable title="By confidence" rows={performance?.confidence_performance ?? {}}/><BreakdownTable title="Journal expiry results" rows={performance?.expiry_performance ?? {}}/></div>
          <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Expiry comparison · stored closed candles" icon={BarChart3} trailing={expiryPerformance?.source.join(', ') || 'No candle source'}/>{expiryPerformance?.enough_data ? <><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase text-[#849088]"><tr>{['Expiry', 'Measured trades', 'Win rate', 'Profit factor', 'Expectancy', 'Max drawdown', 'Max loss streak'].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody>{Object.entries(expiryPerformance.expiry_performance).map(([label, stats]) => <tr key={label} className="border-t border-[#edf0ea]"><td className="px-3 py-3 font-semibold">{label}</td><td className="px-3 py-3">{stats.total_trades}</td><td className="px-3 py-3">{stats.win_rate == null ? 'N/A' : `${stats.win_rate}%`}</td><td className="px-3 py-3">{stats.profit_factor == null ? 'N/A' : stats.profit_factor}</td><td className="px-3 py-3">{stats.expectancy_units == null ? 'N/A' : `${stats.expectancy_units}u`}</td><td className="px-3 py-3">{stats.max_drawdown_units}u</td><td className="px-3 py-3">{stats.max_consecutive_losses}</td></tr>)}</tbody></table></div><p className="m-0 border-t border-[#e5e9e2] px-4 py-3 text-[10px] text-[#849088]">{expiryPerformance.data_notice}</p></> : <p className="p-5 text-xs text-[#87928b]">At least 30 stored closed candles are required. No synthetic history is generated for this report.</p>}</section>
        </div>}

        {tab === 'history' && <section className="overflow-x-auto border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Confirmed signal history" icon={History} trailing={`${history.length} events`}/><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase text-[#849088]"><tr>{['Time (UTC)', 'Pair', 'Timeframe', 'Direction', 'Score', 'Regime'].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody>{history.map((item) => <tr key={item.id} className="border-t border-[#edf0ea]"><td className="px-4 py-3">{new Date(item.timestamp * 1000).toLocaleString()}</td><td className="px-4 py-3 font-semibold">{item.pair}</td><td className="px-4 py-3">{item.timeframe}</td><td className={`px-4 py-3 ${directionClass(item.direction)}`}>{item.direction}</td><td className="px-4 py-3">{item.score}%</td><td className="px-4 py-3">{item.payload.regime}</td></tr>)}</tbody></table>{history.length === 0 && <p className="p-6 text-center text-xs text-[#87928b]">No signals have passed all confirmation filters yet.</p>}</section>}

        {tab === 'paper' && <section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Paper trading ledger" icon={WalletCards} trailing="No live execution"/><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase text-[#849088]"><tr>{['Opened (UTC)', 'Pair', 'Timeframe', 'Direction', 'Entry', 'Stake', 'Expiry', 'Status'].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody>{paperTrades.map((trade) => <tr key={trade.id} className="border-t border-[#edf0ea]"><td className="px-4 py-3">{new Date(trade.created_at * 1000).toLocaleString()}</td><td className="px-4 py-3 font-semibold">{trade.pair}</td><td className="px-4 py-3">{trade.timeframe}</td><td className={`px-4 py-3 ${directionClass(trade.direction)}`}>{trade.direction}</td><td className="px-4 py-3 font-mono">{fmt(trade.entry_price)}</td><td className="px-4 py-3">{fmt(trade.stake, 2)}</td><td className="px-4 py-3">{trade.expiry_seconds}s</td><td className="px-4 py-3">{trade.status}</td></tr>)}</tbody></table></div>{paperTrades.length === 0 && <p className="p-6 text-center text-xs text-[#87928b]">No paper positions recorded. A confirmed dashboard signal can be recorded for simulation.</p>}<p className="m-0 border-t border-[#e5e9e2] p-4 text-[10px] text-[#87928b]">Paper entries are locally recorded for analysis only. They are never sent to Pocket Option.</p></section>}

        {tab === 'settings' && <div className="grid max-w-5xl gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,.8fr)]"><section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Indicator & signal settings" icon={SlidersHorizontal} trailing="Saved to SQLite"/><div className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{settings.ema.map((value, index) => <Field key={`ema-${index}`} label={`EMA ${[9, 21, 50, 200][index]}`} value={value} update={(next) => setEma(index, next)} min={2} max={500}/>)}<Field label="RSI period" value={settings.rsi_period} update={(value) => setSettings({ ...settings, rsi_period: value })}/><Field label="RSI overbought" value={settings.rsi_overbought} update={(value) => setSettings({ ...settings, rsi_overbought: value })}/><Field label="RSI oversold" value={settings.rsi_oversold} update={(value) => setSettings({ ...settings, rsi_oversold: value })}/>{settings.macd.map((value, index) => <Field key={`macd-${index}`} label={`MACD ${['fast', 'slow', 'signal'][index]}`} value={value} update={(next) => setMacd(index, next)}/>)}<Field label="Bollinger period" value={settings.bollinger[0]} update={(value) => setSettings({ ...settings, bollinger: [value, settings.bollinger[1]] })}/><Field label="Bollinger deviation" value={settings.bollinger[1]} update={(value) => setSettings({ ...settings, bollinger: [settings.bollinger[0], value] })} min={0.5} max={5}/>{settings.stochastic.map((value, index) => <Field key={`stoch-${index}`} label={`Stochastic ${['K', 'D', 'slow'][index]}`} value={value} update={(next) => setSettings({ ...settings, stochastic: settings.stochastic.map((old, i) => i === index ? next : old) })}/>)}<Field label="ADX period" value={settings.adx_period} update={(value) => setSettings({ ...settings, adx_period: value })}/><Field label="ATR period" value={settings.atr_period} update={(value) => setSettings({ ...settings, atr_period: value })}/><Field label="Momentum period" value={settings.momentum_period} update={(value) => setSettings({ ...settings, momentum_period: value })}/><Field label="Confidence threshold %" value={settings.confidence_threshold} update={(value) => setSettings({ ...settings, confidence_threshold: value })} min={50} max={95}/></div><div className="flex items-center justify-between border-t border-[#e5e9e2] px-5 py-4"><p className="m-0 text-[10px] text-[#849088]">Defaults are starting values, not optimized recommendations.</p><button disabled={busy} onClick={saveSettings} className="h-9 bg-[#24694e] px-4 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save settings'}</button></div></section><section className="border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title="Risk sizing" icon={ShieldCheck} trailing="Calculation only"/><div className="grid gap-3 p-4"><Field label="Account balance" value={balance} update={setBalance} min={1}/><Field label="Risk %" value={riskPercent} update={setRiskPercent} min={0.1} max={5}/><Field label="Stop distance" value={stopDistance} update={setStopDistance} min={0.00001}/><button onClick={calculateRisk} className="h-9 bg-[#24694e] text-xs font-semibold text-white">Calculate size</button>{risk && <div className="grid grid-cols-2 gap-2 border-t border-[#e5e9e2] pt-3"><Metric label="Risk amount" value={fmt(risk.risk_amount, 2)}/><Metric label="Position size" value={fmt(risk.position_size, 4)}/></div>}<p className="m-0 text-[10px] leading-relaxed text-[#87928b]">Sizing is a calculator only. It does not place orders or guarantee a maximum loss.</p></div></section></div>}

        <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-[#dce2da] pt-4 text-[10px] text-[#88938b]"><span>Pocket Analyzer · deterministic market analysis</span><span>No AI API · no official Pocket Option feed configured · no live trading</span></footer>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-[#dfe4dd] bg-[#fbfcf8] p-1 lg:hidden">{navigation.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`grid min-w-[64px] flex-1 justify-items-center gap-1 py-1 text-[9px] ${tab === id ? 'text-[#246b50]' : 'text-[#87928b]'}`}><Icon size={16}/>{label}</button>)}</nav>
    </main>
  </div>;
}

function PanelTitle({ title, icon: Icon, trailing }: { title: string; icon: typeof Activity; trailing: string }) {
  return <div className="flex items-center justify-between border-b border-[#e4e8e1] px-4 py-3"><h2 className="m-0 flex items-center gap-2 text-[12px] font-semibold"><Icon size={15} className="text-[#58806a]"/>{title}</h2><span className="text-[10px] text-[#87928b]">{trailing}</span></div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="min-w-0 bg-[#fbfcf8] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#87928b]">{label}</div><div className={`mt-1 truncate text-[13px] font-semibold ${tone ? directionClass(tone) : 'text-[#344139]'}`}>{value}</div></div>;
}

function Field({ label, value, update, min = 1, max = 200 }: { label: string; value: number; update: (value: number) => void; min?: number; max?: number }) {
  return <label className="grid gap-2 text-[10px] font-medium uppercase tracking-wide text-[#718079]">{label}<input type="number" min={min} max={max} value={value} onChange={(event) => update(Math.min(max, Math.max(min, Number(event.target.value))))} className="h-10 border border-[#d9dfd9] bg-white px-3 text-sm text-[#24302b] outline-none focus:border-[#388c6c]"/></label>;
}

function ActionBox({ title, description, action, busy, onClick }: { title: string; description: string; action: string; busy: boolean; onClick: () => void }) {
  return <div className="border border-[#e3e8e1] bg-white p-4"><h3 className="m-0 text-sm font-semibold">{title}</h3><p className="min-h-12 text-[11px] leading-relaxed text-[#748078]">{description}</p><button disabled={busy} onClick={onClick} className="h-9 bg-[#24694e] px-4 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Running…' : action}</button></div>;
}

function ResultBlock({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return <div className="min-w-0 bg-[#fbfcf8] p-4"><h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#67746b]">{title}</h3>{data ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[#66736a]">{JSON.stringify(data, null, 2)}</pre> : <p className="text-xs text-[#8a948d]">No results yet</p>}</div>;
}

function BreakdownTable({ title, rows }: { title: string; rows: Record<string, Metrics> }) {
  const entries = Object.entries(rows);
  return <section className="overflow-x-auto border border-[#dce2da] bg-[#fbfcf8]"><PanelTitle title={title} icon={Gauge} trailing={`${entries.length} groups`}/><table className="w-full min-w-[540px] text-left text-[10px]"><thead className="bg-[#f5f7f2] uppercase text-[#849088]"><tr>{['Group', 'Trades', 'Win rate', 'PF', 'Expectancy'].map((label) => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead><tbody>{entries.map(([name, metrics]) => <tr key={name} className="border-t border-[#edf0ea]"><td className="px-3 py-2.5 font-semibold">{name}</td><td className="px-3 py-2.5">{metrics.total_trades}</td><td className="px-3 py-2.5">{metrics.win_rate == null ? 'N/A' : `${metrics.win_rate}%`}</td><td className="px-3 py-2.5">{metrics.profit_factor == null ? 'N/A' : metrics.profit_factor}</td><td className="px-3 py-2.5">{metrics.expectancy_units == null ? 'N/A' : `${metrics.expectancy_units}u`}</td></tr>)}</tbody></table>{entries.length === 0 && <p className="px-3 py-3 text-[10px] text-[#87928b]">No resolved outcomes in this group yet.</p>}</section>;
}
