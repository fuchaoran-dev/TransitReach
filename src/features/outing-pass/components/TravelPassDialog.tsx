import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import type { ConfirmedMeetingPlan } from '@/features/meeting-point/types';
import { passTime } from './passPresentation';

interface Props {
  plan: ConfirmedMeetingPlan;
  backLabel: string;
  onClose: () => void;
  children: ReactNode;
}

/** Shared reading surface; opening a saved pass must not mount the live route hook. */
export function TravelPassDialog({ plan, backLabel, onClose, children }: Props) {
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

  return createPortal(<div className="transit-shell travel-pass-modal fixed inset-0 z-[1200] bg-[#080f18]/95 p-3 backdrop-blur-xl md:p-6">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="travel-pass-title" className="travel-pass-scroll mx-auto h-full max-w-7xl overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29] text-slate-100">
      <header className="travel-pass-header sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#294456] bg-[#0e1c29]/95 px-5 py-4 backdrop-blur md:px-6">
        <button type="button" onClick={onClose} className="btn-icon shrink-0" aria-label={backLabel}><ArrowLeft size={18} aria-hidden="true" /></button>
        <div className="min-w-0">
          <h1 id="travel-pass-title" className="text-lg font-bold leading-tight md:text-xl">Your travel pass</h1>
          <p className="truncate text-sm text-slate-300">{plan.venue.name} · Meet at <span className="tabular-nums">{passTime(plan.arrivalTime)}</span> MYT</p>
        </div>
      </header>
      <div className="travel-pass-body p-5 md:p-6">{children}</div>
    </div>
  </div>, document.body);
}
