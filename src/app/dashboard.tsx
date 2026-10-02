'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Bell, ChevronDown, CircleHelp, Clock3, Gauge, History, LayoutDashboard, ListFilter, Radio, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, TrendingDown, TrendingUp, WalletCards, Wifi, WifiOff } from 'lucide-react';
import CandleChart, { type ChartCandle } from '@/components/candle-chart';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const timeframes = ['30s', '1m', '5m', '15m', '30m', '1h'];
type PairResult = { pair: string; tick: number; payout: number; analysis: { regime: string; volatility: string; signal: { direction: string; score: number; allowed: boolean; reason: string }; indicators: Record<string, any>; structure: Array<{name: string; detected: boolean; direction: string; strength: number; priceLevel: number}>; last_closed_at: number } };
type Market = { pair: string; timeframe: string; provider: string; mode: string; otc: boolean; payout: number; market_status: string; tick: number; candles: ChartCandle[]; analysis: PairResult['analysis'] };
type Settings = { ema: number[]; rsi_period: number; rsi_overbought: number; rsi_oversold: number; macd: number[]; bollinger: number[]; stochastic: number[]; adx_period: number; atr_period: number; momentum_period: number };
type Tab = 'dashboard' | 'scanner' | 'backtest' | 'settings';

const navItems: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'Pair scanner', icon: ListFilter },
  { id: 'backtest', label: 'Backtest', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];
const defaultSettings: Settings = { ema: [9, 21, 50, 200], rsi_period: 14, rsi_overbought: 70, rsi_oversold: 30, macd: [12, 26, 9], bollinger: [20, 2], stochastic: [14, 3, 3], adx_period: 14, atr_period: 14, momentum_period: 10 };
const number = (value?: number) => value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 5 });

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [pairs, setPairs] = useState<string[]>([]);
  const [pair, setPair] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('1m');
  const [market, setMarket] = useState<Market | null>(null);
  const [scanner, setScanner] = useState<PairResult[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState('');
  const [backtest, setBacktest] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const loadMarket = useCallback(async (selectedPair = pair, selectedTimeframe = timeframe) => {
    const response = await fetch(`${API}/api/market/${encodeURIComponent(selectedPair)}?timeframe=${selectedTimeframe}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Market endpoint error ${response.status}`);
    setMarket(await response.json());
  }, [pair, timeframe]);

  useEffect(() => {
    let active = true;
    Promise.all([fetch(`${API}/api/pairs`), fetch(`${API}/api/settings`)]).then(async ([pairResponse, settingsResponse]) => {
      if (!pairResponse.ok || !settingsResponse.ok) throw new Error('Backend API is not available');
      const pairPayload = await pairResponse.json();
      const settingsPayload = await settingsResponse.json();
      if (active) {
        setPairs(pairPayload.pairs);
        setPair((current) => pairPayload.pairs.includes(current) ? current : pairPayload.pairs[0]);
        setSettings(settingsPayload);
      }
    }).catch((cause: Error) => active && setError(`${cause.message}. Start the API with python3 -m uvicorn backend.api.main:app --port 8000`));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pair) return;
    loadMarket().catch((cause: Error) => setError(cause.message));
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${new URL(API).host}/ws/market/${encodeURIComponent(pair)}?timeframe=${timeframe}`);
    socket.onopen = () => { setSocketConnected(true); setError(''); };
    socket.onmessage = (event) => setMarket(JSON.parse(event.data));
    socket.onerror = () => setSocketConnected(false);
    socket.onclose = () => setSocketConnected(false);
    return () => socket.close();
  }, [pair, timeframe, loadMarket]);

  useEffect(() => {
    if (!pairs.length) return;
    fetch(`${API}/api/scanner?timeframe=${timeframe}`, { cache: 'no-store' }).then((response) => response.ok ? response.json() : Promise.reject()).then((data) => setScanner(data.pairs)).catch(() => undefined);
  }, [pairs, timeframe]);

  const filteredScanner = useMemo(() => scanner.filter((item) => item.pair.toLowerCase().includes(search.toLowerCase())), [scanner, search]);
  const visibleEvents = market?.analysis.structure.filter((event) => event.detected) ?? [];

  const saveSettings = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error('Settings were rejected. Check EMA/MACD period ordering.');
      setSettings(await response.json());
      await loadMarket();
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const runBacktest = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/backtest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pair, timeframe, fast_period: settings.ema[0], slow_period: settings.ema[1], expiry: 3, payout: market?.payout ?? 0.8 }) });
      if (!response.ok) throw new Error('Backtest request failed');
      setBacktest(await response.json());
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const setEma = (index: number, value: number) => setSettings((current) => ({ ...current, ema: current.ema.map((old, item) => item === index ? value : old) }));
  const setMacd = (index: number, value: number) => setSettings((current) => ({ ...current, macd: current.macd.map((old, item) => item === index ? value : old) }));
  const field = (label: string, value: number, update: (value: number) => void, min = 1, max = 200) => <label key={label} className="grid gap-2 text-[11px] font-medium uppercase tracking-wide text-[#718079]">{label}<input aria-label={label} type="number" min={min} max={max} value={value} onChange={(event) => update(Math.max(min, Number(event.target.value)))} className="h-10 rounded border border-[#d9dfd9] bg-white px-3 text-sm text-[#24302b] outline-none focus:border-[#388c6c]" /></label>;

  return <div className="min-h-screen bg-[#f2f4ef] text-[#25312d]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[218px] flex-col border-r border-[#dfe4dd] bg-[#fbfcf8] px-4 py-5 lg:flex">
      <div className="mb-9 flex items-center gap-3 px-2"><div className="grid size-9 place-items-center rounded bg-[#1d6249] text-white"><Activity size={19}/></div><div><div className="font-semibold tracking-tight">pocket</div><div className="text-[10px] uppercase tracking-[.18em] text-[#7d8982]">analyzer</div></div></div>
      <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#8c9690]">Workspace</div>
      <nav className="grid gap-1">{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`flex h-10 items-center gap-3 rounded px-3 text-left text-[13px] ${tab === id ? 'bg-[#e7f0e9] font-semibold text-[#246b50]' : 'text-[#718079] hover:bg-[#f0f3ed]'}`}><Icon size={17}/>{label}</button>)}</nav>
      <div className="mt-auto rounded border border-[#dfe5de] bg-white p-3"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[#51625a]"><ShieldCheck size={15} className="text-[#438668]"/> Signal only</div><p className="m-0 text-[10px] leading-relaxed text-[#859089]">Demo market data. No broker execution or AI services.</p></div>
    </aside>

    <main className="lg:pl-[218px]">
      <header className="sticky top-0 z-10 flex h-[66px] items-center justify-between border-b border-[#dfe4dd] bg-[#f8f9f5]/95 px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><div className="font-semibold capitalize">{tab === 'dashboard' ? 'Market overview' : tab}</div><span className="hidden h-4 w-px bg-[#d8ded7] sm:block"/><span className="hidden text-xs text-[#7b8780] sm:block">{market?.provider ?? 'Connecting to demo feed'}</span></div>
        <div className="flex items-center gap-4"><span className="hidden items-center gap-1.5 text-[11px] text-[#75827a] sm:flex"><span className={`size-1.5 rounded-full ${socketConnected ? 'bg-[#40a678]' : 'bg-[#cf9b54]'}`}/>{socketConnected ? 'Stream connected' : 'Connecting'}</span><span className="rounded border border-[#d9e1d8] bg-white px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#326c52]">SIGNAL ONLY</span><button className="text-[#77847c]" title="Notifications"><Bell size={17}/></button><div className="grid size-8 place-items-center rounded-full bg-[#dce9de] text-[11px] font-semibold text-[#31684f]">PA</div></div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
        {error && <div className="mb-4 flex items-center justify-between gap-3 border border-[#e6c2b8] bg-[#fff5f1] px-4 py-3 text-xs text-[#a34936]"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {tab === 'dashboard' && <>
          <section className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-[#77847c]">Analysis desk / paper environment</p><h1 className="m-0 text-[25px] font-semibold tracking-tight">Market overview</h1></div><div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="pair-picker">Select pair</label><select id="pair-picker" value={pair} onChange={(event) => setPair(event.target.value)} className="h-10 min-w-36 rounded border border-[#d9dfd9] bg-white px-3 text-sm font-semibold"><optgroup label="Forex & assets">{pairs.filter((item) => !item.endsWith('-OTC')).map((item) => <option key={item}>{item}</option>)}</optgroup><optgroup label="OTC">{pairs.filter((item) => item.endsWith('-OTC')).map((item) => <option key={item}>{item}</option>)}</optgroup></select><button onClick={() => loadMarket().catch((cause) => setError((cause as Error).message))} className="grid size-10 place-items-center rounded border border-[#d9dfd9] bg-white text-[#637168]" title="Refresh"><RefreshCw size={16}/></button></div></section>
          <div className="mb-4 flex flex-wrap items-center gap-5 border-y border-[#dce2da] py-3 text-[11px]"><span className="flex items-center gap-2 text-[#78847d]"><span className="size-2 rounded-full bg-[#43a778]"/> Mock / demo source</span><span className="text-[#78847d]">Market: <b className="text-[#34423a]">{market?.market_status ?? '—'}</b></span><span className="text-[#78847d]">Payout: <b className="text-[#34423a]">{market?.payout ? `${Math.round(market.payout * 100)}%` : '—'}</b></span><span className="flex items-center gap-1 text-[#78847d]"><Clock3 size={13}/> Closed-candle analysis</span><span className="ml-auto text-[10px] font-semibold text-[#87928b]">{market?.otc ? 'OTC' : 'SPOT DEMO'}</span></div>
          <div className="mb-4 grid grid-cols-2 gap-px border border-[#dce2da] bg-[#dce2da] sm:grid-cols-4"><Metric label="Last price" value={number(market?.tick)} note={market?.pair ?? pair}/><Metric label="Market regime" value={market?.analysis.regime ?? '—'} note={`ADX ${market?.analysis.indicators.adx ?? '—'}`}/><Metric label="Volatility" value={market?.analysis.volatility ?? '—'} note={`ATR ${number(market?.analysis.indicators.atr)}`}/><Metric label="Signal score" value={market?.analysis.signal.allowed ? `${market.analysis.signal.score}%` : 'Filtered'} note={market?.analysis.signal.direction ?? 'neutral'} positive={market?.analysis.signal.direction === 'bullish'} negative={market?.analysis.signal.direction === 'bearish'}/></div>
          <section className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="overflow-hidden border border-[#273435] bg-[#111a1d]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#293536] px-4 py-3"><div className="flex items-baseline gap-3"><b className="font-mono text-sm text-[#e6ede8]">{pair}</b><span className="font-mono text-xs text-[#91a098]">{number(market?.tick)}</span></div><div className="flex gap-1">{timeframes.map((item) => <button key={item} onClick={() => setTimeframe(item)} className={`rounded px-2.5 py-1 text-[10px] font-medium ${timeframe === item ? 'bg-[#2a473d] text-[#a9e0bf]' : 'text-[#8c9a92] hover:bg-[#263332]'}`}>{item}</button>)}</div></div><div className="px-2 pt-2">{market?.candles?.length ? <CandleChart candles={market.candles}/> : <div className="grid h-[390px] place-items-center text-sm text-[#78847e]">Loading closed candles…</div>}</div><div className="flex items-center justify-between border-t border-[#293536] px-4 py-2 text-[10px] text-[#78867e]"><span>OHLC · tick volume · {timeframe}</span><span>Last close {market?.analysis.last_closed_at ? new Date(market.analysis.last_closed_at * 1000).toLocaleTimeString() : '—'}</span></div></div>
            <div className="border border-[#dce2da] bg-[#fbfcf8]"><div className="flex items-center justify-between border-b border-[#e4e8e1] px-4 py-3"><h2 className="m-0 text-[12px] font-semibold uppercase tracking-wide">Signal panel</h2><Radio size={15} className="text-[#538b6d]"/></div><div className="p-4"><div className={`mb-3 border-l-[3px] px-3 py-2 ${market?.analysis.signal.allowed ? market.analysis.signal.direction === 'bullish' ? 'border-[#31875f] bg-[#edf5ee]' : 'border-[#c36a56] bg-[#fbefeb]' : 'border-[#aab4ac] bg-[#f1f3ef]'}`}><div className="text-[10px] uppercase tracking-widest text-[#7b8780]">{market?.analysis.signal.allowed ? 'Trend signal' : 'No trade signal'}</div><div className="mt-1 flex items-center gap-2 text-base font-semibold capitalize">{market?.analysis.signal.direction === 'bullish' ? <TrendingUp size={17} className="text-[#278057]"/> : market?.analysis.signal.direction === 'bearish' ? <TrendingDown size={17} className="text-[#bc634e]"/> : <Activity size={16} className="text-[#77847c]"/>}{market?.analysis.signal.direction ?? 'neutral'}{market?.analysis.signal.allowed && <span className="ml-auto font-mono text-xs">{market.analysis.signal.score}%</span>}</div></div><p className="mb-4 text-[11px] leading-relaxed text-[#7c8881]">{market?.analysis.signal.reason ?? 'Waiting for closed candles.'}</p><div className="mb-2 flex justify-between text-[10px] text-[#849088]"><span>EMA structure</span><b className="font-mono text-[#35423b]">{market?.analysis.indicators.ema['9'] > market?.analysis.indicators.ema['21'] ? '9 above 21' : '9 below 21'}</b></div><div className="mb-2 flex justify-between text-[10px] text-[#849088]"><span>RSI (14)</span><b className="font-mono text-[#35423b]">{market?.analysis.indicators.rsi ?? '—'}</b></div><div className="mb-2 flex justify-between text-[10px] text-[#849088]"><span>MACD histogram</span><b className="font-mono text-[#35423b]">{number(market?.analysis.indicators.macd_histogram)}</b></div><div className="mt-4 border-t border-[#e2e7df] pt-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#7d8981]">Structure events</div>{visibleEvents.slice(0, 5).map((event) => <div key={event.name} className="flex justify-between border-b border-[#edf0ea] py-1.5 text-[10px]"><span className="text-[#69766e]">{event.name}</span><b className={event.direction === 'bullish' ? 'text-[#35835d]' : event.direction === 'bearish' ? 'text-[#b75e4e]' : 'text-[#79857d]'}>{event.direction}</b></div>)}{visibleEvents.length === 0 && <div className="text-[10px] text-[#87928b]">No recent structures detected</div>}</div></div></div>
          </section>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="border border-[#dce2da] bg-[#fbfcf8]"><SectionTitle icon={ListFilter} title="Pair scanner" trailing={`${filteredScanner.length} markets`}/><div className="grid grid-cols-[1fr_90px_100px_90px] border-b border-[#e5e9e2] px-4 py-2 text-[9px] font-semibold uppercase tracking-wider text-[#87928b]"><span>Instrument</span><span className="text-right">Price</span><span className="text-right">Regime</span><span className="text-right">Score</span></div>{filteredScanner.slice(0, 7).map((item) => <button key={item.pair} onClick={() => {setPair(item.pair); setTab('dashboard');}} className="grid w-full grid-cols-[1fr_90px_100px_90px] border-b border-[#eef0eb] px-4 py-2.5 text-left text-[11px] hover:bg-[#f4f6f1]"><span className="font-semibold">{item.pair}</span><span className="text-right font-mono text-[#68756d]">{number(item.tick)}</span><span className="text-right capitalize text-[#68756d]">{item.analysis.regime.replace(' trend','')}</span><span className={`text-right font-mono ${item.analysis.signal.allowed ? 'text-[#388560]' : 'text-[#919b93]'}`}>{item.analysis.signal.allowed ? `${item.analysis.signal.score}%` : '—'}</span></button>)}{!scanner.length && <div className="px-4 py-6 text-center text-xs text-[#87928b]">Loading pair scan…</div>}</section><section className="border border-[#dce2da] bg-[#fbfcf8]"><SectionTitle icon={Gauge} title="Indicator snapshot" trailing={timeframe}/><div className="grid grid-cols-2 gap-0 px-4 pb-3">{[['EMA 9',market?.analysis.indicators.ema['9']],['EMA 21',market?.analysis.indicators.ema['21']],['EMA 50',market?.analysis.indicators.ema['50']],['EMA 200',market?.analysis.indicators.ema['200']],['Bollinger upper',market?.analysis.indicators.bollinger.upper],['Bollinger lower',market?.analysis.indicators.bollinger.lower],['Stochastic',market?.analysis.indicators.stochastic],['Tick volume',market?.analysis.indicators.tick_volume]].map(([label,value])=><div key={String(label)} className="flex justify-between border-b border-[#edf0ea] py-2 text-[10px]"><span className="text-[#7e8982]">{label}</span><b className="font-mono font-medium">{number(value as number)}</b></div>)}</div></section></div>
        </>}

        {tab === 'scanner' && <section className="border border-[#dce2da] bg-[#fbfcf8]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8e1] p-4"><div><h1 className="m-0 text-xl font-semibold">Pair scanner</h1><p className="mb-0 mt-1 text-xs text-[#818c85]">Independent closed-candle analysis for all demo instruments</p></div><div className="flex gap-2"><div className="flex h-9 items-center gap-2 border border-[#d9dfd9] bg-white px-3"><Search size={14} className="text-[#89948d]"/><input aria-label="Search pairs" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Find instrument" className="w-28 border-0 bg-transparent text-xs outline-none"/></div><TimeframeSelector timeframe={timeframe} setTimeframe={setTimeframe}/></div></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-[#f5f7f2] text-[9px] uppercase tracking-wider text-[#849088]"><tr>{['Pair','Price','Market regime','Volatility','RSI','ADX','Signal','Score'].map((head)=><th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody>{filteredScanner.map((item)=><tr key={item.pair} onClick={()=>{setPair(item.pair);setTab('dashboard')}} className="cursor-pointer border-t border-[#edf0ea] hover:bg-[#f4f6f1]"><td className="px-4 py-3 font-semibold">{item.pair}</td><td className="px-4 py-3 font-mono">{number(item.tick)}</td><td className="px-4 py-3 capitalize">{item.analysis.regime}</td><td className="px-4 py-3 capitalize">{item.analysis.volatility}</td><td className="px-4 py-3 font-mono">{item.analysis.indicators.rsi}</td><td className="px-4 py-3 font-mono">{item.analysis.indicators.adx}</td><td className="px-4 py-3 capitalize">{item.analysis.signal.allowed ? item.analysis.signal.direction : 'filtered'}</td><td className="px-4 py-3 font-mono">{item.analysis.signal.allowed ? `${item.analysis.signal.score}%` : '—'}</td></tr>)}</tbody></table></div></section>}

        {tab === 'backtest' && <section className="max-w-4xl border border-[#dce2da] bg-[#fbfcf8]"><SectionTitle icon={History} title="Historical backtest" trailing="EMA crossover · demo history"/><div className="grid gap-6 p-5 md:grid-cols-[1fr_1.2fr]"><div><p className="mt-0 text-xs leading-relaxed text-[#748078]">Evaluate a simple EMA crossover against the selected pair's deterministic historical demo candles. Results are educational, do not predict future outcomes, and exclude fees or real execution.</p><button onClick={runBacktest} disabled={busy} className="mt-3 flex h-10 items-center gap-2 bg-[#24694e] px-4 text-xs font-semibold text-white disabled:opacity-50"><BarChart3 size={15}/>{busy ? 'Running…' : 'Run backtest'}</button></div>{backtest ? <div className="grid grid-cols-2 gap-px bg-[#e3e8e1]">{Object.entries(backtest).filter(([key])=>key!=='mode').map(([key,value])=><Metric key={key} label={key.replaceAll('_',' ')} value={String(value)} note={key==='win_rate'?'historical demo only':''}/>)}</div> : <div className="grid min-h-32 place-items-center border border-dashed border-[#d9dfd9] text-xs text-[#87928b]">Run the backtest to view results</div>}</div></section>}

        {tab === 'settings' && <section className="max-w-4xl border border-[#dce2da] bg-[#fbfcf8]"><SectionTitle icon={SlidersHorizontal} title="Indicator settings" trailing="Saved to local SQLite"/><div className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{settings.ema.map((value,index)=>field(`EMA ${[9,21,50,200][index]} period`,value,(next)=>setEma(index,next),2,500))}{field('RSI period',settings.rsi_period,(v)=>setSettings({...settings,rsi_period:v}),2,100)}{field('RSI overbought',settings.rsi_overbought,(v)=>setSettings({...settings,rsi_overbought:v}),51,99)}{field('RSI oversold',settings.rsi_oversold,(v)=>setSettings({...settings,rsi_oversold:v}),1,49)}{settings.macd.map((value,index)=>field(`MACD ${['fast','slow','signal'][index]}`,value,(next)=>setMacd(index,next),2,100))}{field('Bollinger period',settings.bollinger[0],(v)=>setSettings({...settings,bollinger:[v,settings.bollinger[1]]}),2,100)}{field('Bollinger deviations',settings.bollinger[1],(v)=>setSettings({...settings,bollinger:[settings.bollinger[0],v]}),0.5,5)}{settings.stochastic.map((value,index)=>field(`Stochastic ${['K','D','slowing'][index]}`,value,(next)=>setSettings({...settings,stochastic:settings.stochastic.map((n,i)=>i===index?next:n)}),1,100))}{field('ADX period',settings.adx_period,(v)=>setSettings({...settings,adx_period:v}),2,100)}{field('ATR period',settings.atr_period,(v)=>setSettings({...settings,atr_period:v}),2,100)}{field('Momentum period',settings.momentum_period,(v)=>setSettings({...settings,momentum_period:v}),1,100)}</div><div className="flex items-center justify-between border-t border-[#e5e9e2] px-5 py-4"><p className="m-0 text-[10px] text-[#849088]">Parameters are configurable; defaults are not optimized recommendations.</p><button disabled={busy} onClick={saveSettings} className="h-9 bg-[#24694e] px-4 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save settings'}</button></div></section>}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-[#dce2da] pt-4 text-[10px] text-[#88938b]"><span>Pocket Analyzer · local demo provider · analysis only</span><span className="flex items-center gap-2"><Wifi size={12}/> No broker connection · No AI API · No live execution</span></footer>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-[#dfe4dd] bg-[#fbfcf8] p-1 lg:hidden">{navItems.map(({id,label,icon:Icon})=><button key={id} onClick={()=>setTab(id)} className={`grid justify-items-center gap-1 py-1 text-[9px] ${tab===id?'text-[#246b50]':'text-[#87928b]'}`}><Icon size={17}/>{label}</button>)}</nav>
    </main>
  </div>;
}

function Metric({ label, value, note, positive, negative }: {label: string; value: string; note?: string; positive?: boolean; negative?: boolean}) { return <div className="min-w-0 bg-[#fbfcf8] px-4 py-3"><div className="text-[9px] font-semibold uppercase tracking-[.13em] text-[#87928b]">{label}</div><div className={`mt-1 truncate text-[15px] font-semibold capitalize ${positive?'text-[#32805b]':negative?'text-[#bb5e4c]':'text-[#344139]'}`}>{value}</div>{note && <div className="mt-0.5 truncate text-[10px] text-[#87928b]">{note}</div>}</div>; }
function SectionTitle({icon:Icon,title,trailing}:{icon:typeof Activity;title:string;trailing:string}){return <div className="flex items-center justify-between border-b border-[#e4e8e1] px-4 py-3"><h2 className="m-0 flex items-center gap-2 text-[12px] font-semibold"><Icon size={15} className="text-[#58806a]"/>{title}</h2><span className="text-[10px] text-[#87928b]">{trailing}</span></div>}
function TimeframeSelector({timeframe,setTimeframe}:{timeframe:string;setTimeframe:(value:string)=>void}){return <select aria-label="Scanner timeframe" value={timeframe} onChange={(event)=>setTimeframe(event.target.value)} className="h-9 border border-[#d9dfd9] bg-white px-2 text-xs">{timeframes.map((value)=><option key={value}>{value}</option>)}</select>}
