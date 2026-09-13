import { useEffect, useMemo, useState } from 'react';
import { GitCompare, Sunrise, Sunset } from 'lucide-react';
import { BaseMap, LocationSearch, TimeBudgetSelector } from '@/features/reachability';
import { hitFromOrigin, isInStudyArea, originFromHit } from '@/features/reachability/reachabilityService';
import { CATEGORY_META, CATEGORY_ORDER } from '@/shared/data';
import { loadEssentialServices } from '@/shared/data/adapters/essentialServicesAdapter';
import { computeReachability, TRAVEL_MODE, type IsochroneResult } from '@/shared/data/adapters/routingAdapter';
import { deduplicateServices } from '@/features/essential-services';
import type { ServiceLocation } from '@/shared/types/service';
import type { Journey, Origin } from '@/features/reachability/types';

type CoverageState = { status: 'idle' | 'loading' | 'ready' | 'error'; result: IsochroneResult | null; services: ServiceLocation[]; error: string | null };
const FEED_START = '2019-01-01T00:00';
const FEED_END = '2026-12-31T23:59';
const DEFAULT_TIMES: [string, string] = ['2026-09-03T09:00', '2026-09-03T17:00'];

/** Convert the browser's local datetime value to the Malaysia time sent to OTP. */
function toOtpDateTime(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return `${value}:00+08:00`;
}

function formatTimeLabel(value: string): string {
  const [date, clock] = value.split('T');
  if (!date || !clock) return 'Choose a date and time';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
  return `${weekday} ${clock}`;
}

function isInside(service: ServiceLocation, result: IsochroneResult | null): boolean {
  if (!result || service.lat === undefined || service.lon === undefined) return false;
  return result.regions.some(region => pointInRing(service.lat!, service.lon!, region.outer) && !region.holes.some(hole => pointInRing(service.lat!, service.lon!, hole)));
}

function pointInRing(lat: number, lon: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function TimeComparisonPage({ journey }: { journey: Journey }) {
  // Shared with the rest of the app; only the two departure times belong to this screen.
  const { origin, timeBudget: budget } = journey;
  const setOrigin = journey.onOriginChange;
  const setBudget = journey.onTimeBudgetChange;
  const [times, setTimes] = useState<[string, string]>(DEFAULT_TIMES);
  const [left, setLeft] = useState<CoverageState>({ status: 'idle', result: null, services: [], error: null });
  const [right, setRight] = useState<CoverageState>({ status: 'idle', result: null, services: [], error: null });
  const allServices = useMemo(() => loadEssentialServices(), []);

  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();
    const departureTimes = times.map(toOtpDateTime) as [string | null, string | null];
    if (!departureTimes[0] || !departureTimes[1]) {
      setLeft({ status: 'error', result: null, services: [], error: 'Please choose a valid date and time for both options.' });
      setRight({ status: 'error', result: null, services: [], error: 'Please choose a valid date and time for both options.' });
      return () => controller.abort();
    }
    setLeft({ status: 'loading', result: null, services: [], error: null });
    setRight({ status: 'loading', result: null, services: [], error: null });
    Promise.all([
      computeReachability(origin.at, budget, controller.signal, departureTimes[0]!, TRAVEL_MODE),
      computeReachability(origin.at, budget, controller.signal, departureTimes[1]!, TRAVEL_MODE),
    ])
      .then(([a, b]) => {
        setLeft({ status: 'ready', result: a.result, services: deduplicateServices(allServices.filter(service => isInside(service, a.result))), error: null });
        setRight({ status: 'ready', result: b.result, services: deduplicateServices(allServices.filter(service => isInside(service, b.result))), error: null });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Unable to calculate comparison.';
        setLeft({ status: 'error', result: null, services: [], error: message });
        setRight({ status: 'error', result: null, services: [], error: message });
      });
    return () => controller.abort();
  }, [origin, budget, times, allServices]);

  const chooseOrigin = (next: Origin) => setOrigin(next);
  const updateTime = (side: 0 | 1, value: string) => setTimes(previous => {
    if (previous[side === 0 ? 1 : 0] === value) return previous;
    const next: [string, string] = [...previous]; next[side] = value; return next;
  });

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6"><h1 className="text-3xl font-bold text-slate-900 mb-2">Time-of-Day Service Comparison</h1><p className="text-slate-600">Compare real essential-service coverage at two departure times using the same origin and travel budget.</p></div>
        <div className="glass p-4 mb-6 space-y-4">
          <div className="grid lg:grid-cols-[1fr_auto_auto] gap-4 items-end">
            <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Starting point</label><LocationSearch onSelect={hit => chooseOrigin(originFromHit(hit))} selected={hitFromOrigin(origin)} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Travel budget</label><TimeBudgetSelector value={budget} onChange={setBudget} /></div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {[0, 1].map(side => { const Icon = side === 0 ? Sunrise : Sunset; const color = side === 0 ? '#f59e0b' : '#6366f1'; return <label key={side} className="glass-chip p-3 flex flex-wrap items-center gap-3"><Icon size={18} style={{ color }} /><span className="text-xs font-bold text-slate-500 uppercase">{side === 0 ? 'Option A' : 'Option B'}</span><input type="datetime-local" value={times[side]} min={FEED_START} max={FEED_END} step="60" onChange={event => updateTime(side as 0 | 1, event.target.value)} className="ml-auto bg-transparent text-sm font-semibold text-slate-700 outline-none" /><span className="w-full text-[11px] text-slate-500">{formatTimeLabel(times[side])} · GTFS data valid through 31 Dec 2026</span></label>; })}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <CoveragePanel label={formatTimeLabel(times[0])} color="#f59e0b" icon={Sunrise} state={left} origin={origin} onMapClick={at => isInStudyArea(at) && chooseOrigin({ at, source: 'map' })} />
          <CoveragePanel label={formatTimeLabel(times[1])} color="#6366f1" icon={Sunset} state={right} origin={origin} onMapClick={at => isInStudyArea(at) && chooseOrigin({ at, source: 'map' })} />
        </div>
        <ComparisonTable left={left.services} right={right.services} leftLabel={formatTimeLabel(times[0])} rightLabel={formatTimeLabel(times[1])} />
      </div>
    </div>
  );
}

function CoveragePanel({ label, color, icon: Icon, state, origin, onMapClick }: { label: string; color: string; icon: typeof Sunrise; state: CoverageState; origin: Origin | null; onMapClick: (at: { lat: number; lon: number }) => void }) {
  return <div className="relative rounded-2xl overflow-hidden shadow-lg" style={{ aspectRatio: '10/7', minHeight: '430px' }}><BaseMap origin={origin} regions={state.result?.regions ?? null} onMapClick={onMapClick} services={state.services} /><div className="absolute top-3 left-3 z-[500] glass-strong px-3 py-2 flex items-center gap-2"><Icon size={15} style={{ color }} /><span className="text-sm font-bold text-slate-800">{label}</span></div>{state.status === 'loading' && <Overlay text="Calculating with OTP…" />}{state.status === 'error' && <Overlay text={state.error ?? 'Calculation failed'} />}{state.status === 'ready' && state.services.length === 0 && <div className="absolute bottom-3 left-3 right-3 z-[500] glass-strong px-3 py-2 text-xs text-slate-600">No services found. Try a longer travel time or another travel mode.</div>}</div>;
}

function Overlay({ text }: { text: string }) { return <div className="absolute inset-0 z-[450] flex items-center justify-center bg-white/70"><div className="glass p-4 text-sm text-slate-600">{text}</div></div>; }

function ComparisonTable({ left, right, leftLabel, rightLabel }: { left: ServiceLocation[]; right: ServiceLocation[]; leftLabel: string; rightLabel: string }) {
  return <div className="glass p-5"><div className="flex items-center gap-2 mb-4"><GitCompare size={17} className="text-teal-600" /><h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Reachable services by category</h2></div><div className="grid grid-cols-[1fr_80px_80px_90px] gap-y-2 text-sm"><div className="text-xs font-bold text-slate-400 uppercase">Category</div><div className="text-xs font-bold text-amber-600 text-right">{leftLabel}</div><div className="text-xs font-bold text-indigo-600 text-right">{rightLabel}</div><div className="text-xs font-bold text-slate-400 text-right">Difference</div>{CATEGORY_ORDER.map(category => { const a = left.filter(service => service.category === category).length; const b = right.filter(service => service.category === category).length; return <div key={category} className="contents"><div className="py-2 border-t border-slate-100 text-slate-700">{CATEGORY_META[category].label}</div><div className="py-2 border-t border-slate-100 text-right font-semibold">{a}</div><div className="py-2 border-t border-slate-100 text-right font-semibold">{b}</div><div className={`py-2 border-t border-slate-100 text-right font-semibold ${b - a >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{b - a >= 0 ? '+' : ''}{b - a}</div></div>; })}</div>{left.length === 0 && right.length === 0 && <p className="text-sm text-slate-500 mt-4">No services found for either option. Try a longer travel time or another travel mode.</p>}</div>;
}
