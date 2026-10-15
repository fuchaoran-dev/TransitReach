import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { ConfirmedMeetingPlan, StartingPoint } from '@/features/meeting-point/types';
import { usePersonalPass } from '../hooks/usePersonalPass';
import { passTime } from './passPresentation';
import { TravelPassContent } from './TravelPassContent';

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
  return createPortal(<div className="transit-shell travel-pass-modal fixed inset-0 z-[1200] bg-[#080f18]/95 p-3 backdrop-blur-xl md:p-6">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="travel-pass-title" className="travel-pass-scroll mx-auto h-full max-w-7xl overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29] text-slate-100">
      <header className="travel-pass-header sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#294456] bg-[#0e1c29]/95 px-5 py-4 backdrop-blur md:px-6">
        <button type="button" onClick={onClose} className="btn-icon shrink-0" aria-label="Back to meeting"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div className="min-w-0">
          <h1 id="travel-pass-title" className="text-lg font-bold leading-tight md:text-xl">Your travel pass</h1>
          <p className="truncate text-sm text-slate-300">{plan.venue.name} · Meet at <span className="tabular-nums">{passTime(plan.arrivalTime)}</span> MYT</p>
        </div>
      </header>
      <div className="travel-pass-body p-5 md:p-6">
        {state.status === 'checking' && <p role="status" className="flex items-center gap-2 text-slate-300"><RefreshCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Finding your arrive-by route…</p>}
        {state.status === 'failed' && <div><p role="alert" className="text-rose-300">{state.message}</p><button type="button" onClick={personal.recheck} className="btn-secondary mt-3">Retry route</button></div>}
        {state.status === 'ready' && <TravelPassContent pass={state.pass} options={state.options} originLabel={originLabel} onSelectJourney={personal.selectJourney} onRecheck={personal.recheck} />}
      </div>
    </div>
  </div>, document.body);
}
