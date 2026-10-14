import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Footprints, RefreshCw, TrainFront } from 'lucide-react';
import type { ConfirmedMeetingPlan, StartingPoint } from '@/features/meeting-point/types';
import { describeStep } from '@/features/interchange/interchangeService';
import { usePersonalPass } from '../hooks/usePersonalPass';
import { downloadPassImage } from '../passExport';
import { passTime } from './passPresentation';
import { PrivateJourneyMap } from './PrivateJourneyMap';

interface Props {
  code: string;
  memberId: string;
  plan: ConfirmedMeetingPlan;
  origin: StartingPoint;
  budget: number;
  onClose: () => void;
}

/** Private route-only pass. No publishStatus, group check badges or unilateral time change. */
export function MeetingTravelPass({ code, memberId, plan, origin, budget, onClose }: Props) {
  const personal = usePersonalPass({ roomCode: code, memberId, plan, origin, routeOnly: true, budgetMinutes: budget });
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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
  return <div className="fixed inset-0 z-[1200] bg-[#080f18]/95 p-6 backdrop-blur-xl">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="travel-pass-title" className="mx-auto h-full max-w-6xl overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29] p-6 text-slate-100">
      <button type="button" onClick={onClose} className="btn-secondary mb-5 flex items-center gap-2"><ArrowLeft size={16} aria-hidden="true" />Back to meeting</button>
      <h1 id="travel-pass-title" className="text-2xl font-bold">Your personal travel pass</h1>
      <p className="mt-2 text-sm text-slate-300">{plan.venue.name} · Meet at {passTime(plan.arrivalTime)} MYT · Plan v{plan.version}</p>
      {state.status === 'checking' && <p role="status" className="mt-6">Finding your arrive-by route…</p>}
      {state.status === 'failed' && <div className="mt-6"><p role="alert" className="text-rose-300">{state.message}</p><button type="button" onClick={personal.recheck} className="btn-secondary mt-3">Retry route</button></div>}
      {state.status === 'ready' && <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        <section className="space-y-4">
          <div className="rounded-xl border border-teal-300/30 bg-teal-300/5 p-4"><p className="text-xs text-teal-200">{state.pass.zeroTravel ? 'Starting point matches the meeting point' : 'Suggested departure · MYT'}</p><h2 className="mt-2 text-2xl font-bold">{state.pass.zeroTravel ? 'No travel needed from this start' : `Leave around ${passTime(state.pass.leaveTime)}`}</h2><p className="mt-2 text-sm">From {origin.label ?? 'Your selected starting point'} · {state.pass.zeroTravel ? 'Meeting' : 'Estimated arrival'} {passTime(state.pass.estimatedArrivalTime)}</p></div>
          {state.options.length > 1 && <label className="block text-sm">Route options<select className="glass-input mt-2 w-full p-3" value={state.pass.selectedJourneyId} onChange={event => personal.selectJourney(event.target.value)}>{state.options.map(option => <option key={option.id} value={option.id}>Leave around {passTime(option.leaveTime)} · {Math.ceil(option.durationSeconds / 60)} min · {option.transferCount} transfers</option>)}</select></label>}
          <ol className="space-y-3">{state.pass.legs.map(leg => <li key={leg.id} className="rounded-xl bg-[#192a38] p-4"><h3 className="flex items-center gap-2 font-semibold">{leg.mode === 'WALK' ? <Footprints size={16} aria-hidden="true" /> : <TrainFront size={16} aria-hidden="true" />}{leg.mode === 'WALK' ? 'Walk' : leg.routeLongName ?? leg.routeShortName ?? leg.mode}</h3><p className="mt-2 text-sm">{leg.from.name} → {leg.to.name}</p><p className="mt-1 text-xs text-slate-300">Around {passTime(leg.estimatedStartTime)}–{passTime(leg.estimatedEndTime)} · {Math.ceil(leg.durationSeconds / 60)} min</p>{leg.steps.length > 0 && <details className="mt-2 text-xs text-slate-300"><summary className="cursor-pointer">Walking directions</summary><ol className="mt-2 list-decimal space-y-1 pl-4">{leg.steps.map((step, index) => <li key={index}>{describeStep(step)} · {Math.round(step.distanceMeters)} m</li>)}</ol></details>}</li>)}</ol>
          <p className="text-xs leading-relaxed text-slate-400">OSM/GTFS estimates, not guaranteed departures. Delay, weather and opening-hours checks are not run. This route is private and does not change anyone’s Ready status.</p>
          <div className="flex gap-3"><button type="button" disabled={downloading} className="btn-primary flex items-center gap-2" onClick={() => {
            setDownloading(true); setExportError(null);
            void downloadPassImage(state.pass).catch(() => setExportError('The image could not be downloaded. Try again.')).finally(() => setDownloading(false));
          }}><Download size={16} aria-hidden="true" />Download pass</button><button type="button" className="btn-secondary flex items-center gap-2" onClick={personal.recheck}><RefreshCw size={16} aria-hidden="true" />Refresh route</button></div>
          <p className="text-xs text-teal-200">Saved in My Passes on this device.</p>
          {exportError && <p role="alert" className="text-sm text-rose-300">{exportError}</p>}
        </section><PrivateJourneyMap pass={state.pass} />
      </div>}
    </div>
  </div>;
}
