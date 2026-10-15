import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Download, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ConfirmedMeetingPlan, StartingPoint } from '@/features/meeting-point/types';
import { usePersonalPass } from '../hooks/usePersonalPass';
import { downloadPassImage } from '../passExport';
import { passTime } from './passPresentation';
import { countdownLabel, minutesLabel } from './legPresentation';
import { JourneyTimeline } from './JourneyTimeline';
import { PrivateJourneyMap } from './PrivateJourneyMap';
import { RouteOptionCards } from './RouteOptionCards';

interface Props {
  code: string;
  memberId: string;
  plan: ConfirmedMeetingPlan;
  origin: StartingPoint;
  budget: number;
  onClose: () => void;
}

/** Re-renders the countdown without re-running the route check. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ArrivalFit({ arrival, meeting }: { arrival: string; meeting: string }) {
  const spare = Math.round((Date.parse(meeting) - Date.parse(arrival)) / 1000);
  if (!Number.isFinite(spare)) return null;
  const early = spare >= 0;
  return <p className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${early ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
    {early ? <CheckCircle2 size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
    <span>
      Arrive <strong className="tabular-nums">{passTime(arrival)}</strong> ·{' '}
      {early
        ? spare < 60 ? 'right on time for' : `${minutesLabel(spare)} before`
        : `${minutesLabel(-spare)} after`} the <span className="tabular-nums">{passTime(meeting)}</span> meet-up
    </span>
  </p>;
}

/** Private route-only pass. No publishStatus, group check badges or unilateral time change. */
export function MeetingTravelPass({ code, memberId, plan, origin, budget, onClose }: Props) {
  const personal = usePersonalPass({ roomCode: code, memberId, plan, origin, routeOnly: true, budgetMinutes: budget });
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const now = useNow(30_000);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab' || !element) return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href], summary')];
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
    };
    element?.addEventListener('keydown', keydown);
    return () => { element?.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  const state = personal.state;
  const originLabel = origin.label ?? 'Your starting point';
  return <div className="fixed inset-0 z-[1200] bg-[#080f18]/95 p-3 backdrop-blur-xl md:p-6">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="travel-pass-title" className="travel-pass-scroll mx-auto h-full max-w-7xl overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29] text-slate-100">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#294456] bg-[#0e1c29]/95 px-5 py-4 backdrop-blur md:px-6">
        <button type="button" onClick={onClose} className="btn-icon shrink-0" aria-label="Back to meeting"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div className="min-w-0">
          <h1 id="travel-pass-title" className="text-lg font-bold leading-tight md:text-xl">Your travel pass</h1>
          <p className="truncate text-sm text-slate-300">{plan.venue.name} · Meet at <span className="tabular-nums">{passTime(plan.arrivalTime)}</span> MYT</p>
        </div>
      </header>
      <div className="p-5 md:p-6">
        {state.status === 'checking' && <p role="status" className="flex items-center gap-2 text-slate-300"><RefreshCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Finding your arrive-by route…</p>}
        {state.status === 'failed' && <div><p role="alert" className="text-rose-300">{state.message}</p><button type="button" onClick={personal.recheck} className="btn-secondary mt-3">Retry route</button></div>}
        {state.status === 'ready' && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section className="order-2 min-w-0 space-y-6 lg:order-1">
            <div className="rounded-2xl border border-teal-300/30 bg-gradient-to-br from-teal-300/10 to-transparent p-5">
              {state.pass.zeroTravel
                ? <><p className="text-xs font-semibold uppercase tracking-wider text-teal-200">Starting point matches the meeting point</p><h2 className="mt-2 text-3xl font-extrabold">No travel needed</h2></>
                : <>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-200"><Clock size={14} aria-hidden="true" />{countdownLabel(state.pass.leaveTime, now)}</p>
                  <h2 className="mt-2 text-3xl font-extrabold md:text-4xl">Leave at <span className="tabular-nums text-teal-200">{passTime(state.pass.leaveTime)}</span></h2>
                  <p className="mt-1 text-sm text-slate-300">from {originLabel} · {minutesLabel(Date.parse(state.pass.estimatedArrivalTime) / 1000 - Date.parse(state.pass.leaveTime) / 1000)} door to door</p>
                  <ArrivalFit arrival={state.pass.estimatedArrivalTime} meeting={plan.arrivalTime} />
                </>}
            </div>
            {state.options.length > 1 && <RouteOptionCards options={state.options} selectedId={state.pass.selectedJourneyId} onSelect={personal.selectJourney} />}
            {!state.pass.zeroTravel && <div>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Your journey</h2>
              <JourneyTimeline legs={state.pass.legs} originLabel={originLabel} destinationLabel={plan.venue.name} />
            </div>}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={downloading} className="btn-primary flex items-center gap-2" onClick={() => {
                setDownloading(true); setExportError(null);
                void downloadPassImage(state.pass).catch(() => setExportError('The image could not be downloaded. Try again.')).finally(() => setDownloading(false));
              }}><Download size={16} aria-hidden="true" />Download pass</button>
              <button type="button" className="btn-secondary flex items-center gap-2" onClick={personal.recheck}><RefreshCw size={16} aria-hidden="true" />Refresh route</button>
            </div>
            {exportError && <p role="alert" className="text-sm text-rose-300">{exportError}</p>}
            <details className="travel-steps text-xs text-slate-400">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 hover:text-slate-200"><Info size={14} aria-hidden="true" />About these times · saved in My Passes on this device</summary>
              <p className="mt-2 leading-relaxed">OSM/GTFS estimates, not guaranteed departures. Delay, weather and opening-hours checks are not run. This route is private and does not change anyone’s Ready status.</p>
            </details>
          </section>
          <div className="order-1 min-w-0 lg:order-2"><div className="travel-pass-map-wrap"><PrivateJourneyMap pass={state.pass} /></div></div>
        </div>}
      </div>
    </div>
  </div>;
}
