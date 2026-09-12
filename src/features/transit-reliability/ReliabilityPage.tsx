import { useEffect, useMemo, useState } from 'react';
import { Activity, Database, ShieldCheck } from 'lucide-react';
import { ReliabilityResultCard } from './components/ReliabilityResultCard';
import { useReliabilityPrediction } from './hooks/useReliabilityPrediction';
import { loadReliabilityServices } from './services/reliabilityApi';
import type { ReliabilityMode, ReliabilityService } from './types';

function localDatetimeValue() {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ReliabilityPage() {
  const [services, setServices] = useState<ReliabilityService[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReliabilityMode>('BUS');
  const modeLines = useMemo(() => services.filter(line => line.mode === mode), [mode, services]);
  const [lineId, setLineId] = useState('U1510');
  const lineStops = useMemo(() => services.find(line => line.line_id === lineId)?.stops ?? [], [lineId, services]);
  const [stopId, setStopId] = useState('');
  const [datetime, setDatetime] = useState(localDatetimeValue);
  const { result, loading, error, predict } = useReliabilityPrediction();

  useEffect(() => {
    const controller = new AbortController();
    loadReliabilityServices(controller.signal).then(setServices).catch(reason => {
      if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : 'Service catalogue unavailable');
    });
    return () => controller.abort();
  }, []);

  const changeMode = (next: ReliabilityMode) => {
    setMode(next);
    const first = services.find(line => line.mode === next);
    setLineId(first?.line_id ?? '');
    setStopId('');
  };

  return (
    <main className="pt-24 pb-16 px-4 sm:px-6 max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm"><Activity size={18} />AI transit reliability</div>
        <h1 className="text-3xl sm:text-4xl font-extrabold mt-2">Plan for uncertainty, not promises.</h1>
        <p className="text-slate-600 mt-3 max-w-3xl">This MVP predicts historical delay risk for three Rapid KL bus routes using a chronologically evaluated CatBoost model trained on GPS-derived stop arrivals.</p>
      </header>
      <div className="grid lg:grid-cols-[1fr_0.9fr] gap-6">
        <form className="glass p-6 space-y-5" onSubmit={event => { event.preventDefault(); void predict({ mode, lineId, stopId, datetime }); }}>
          <div className="grid sm:grid-cols-3 gap-3">
            {(['BUS', 'MRT', 'LRT', 'BRT'] as ReliabilityMode[]).map(item => <button type="button" key={item} onClick={() => changeMode(item)} className={item === mode ? 'btn-primary' : 'btn-secondary'}>{item}</button>)}
          </div>
          <label className="block text-sm font-semibold">Line<select className="glass-input block w-full mt-2 p-3" value={lineId} onChange={event => { setLineId(event.target.value); setStopId(''); }}><option value="">Select a line</option>{modeLines.map(line => <option key={line.line_id} value={line.line_id}>{line.name}</option>)}</select></label>
          <label className="block text-sm font-semibold">Station or stop<select required className="glass-input block w-full mt-2 p-3" value={stopId} onChange={event => setStopId(event.target.value)}><option value="">Select a stop</option>{lineStops.map(stop => <option key={stop.stop_id} value={stop.stop_id}>{stop.name}</option>)}</select></label>
          <label className="block text-sm font-semibold">Travel date and time<input required type="datetime-local" className="glass-input block w-full mt-2 p-3" value={datetime} onChange={event => setDatetime(event.target.value)} /></label>
          <button className="btn-primary w-full" disabled={loading || !lineId || !stopId}>{loading ? 'Checking reliability…' : 'Check reliability'}</button>
          {error && <p role="alert" className="text-sm text-rose-600">The reliability API is unavailable. Start the backend and try again. Technical detail: {error}</p>}
          {catalogError && <p role="alert" className="text-sm text-rose-600">Could not load service catalogue: {catalogError}</p>}
        </form>
        <div className="space-y-4">
          {result ? <ReliabilityResultCard result={result} /> : <section className="glass p-6 text-sm text-slate-600"><Database className="text-teal-600 mb-3" /><h2 className="font-bold text-slate-900">Data-gated predictions</h2><p className="mt-2">Visible service does not mean prediction-enabled. Unsupported selections return no estimated delay or risk.</p></section>}
          <section className="glass-chip p-5 text-xs text-slate-600"><ShieldCheck className="text-teal-700 mb-2" /><strong className="text-slate-800">Methodology:</strong> expected delay is predicted by CatBoost; risk uses comparable historical quartiles. Labels are derived from matched GPS observations and GTFS schedules. Results are estimates, never guaranteed arrival times.</section>
        </div>
      </div>
    </main>
  );
}
