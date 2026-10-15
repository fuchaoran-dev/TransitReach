import { RefreshCw } from 'lucide-react';
import type { ConfirmedMeetingPlan, StartingPoint } from '@/features/meeting-point/types';
import { usePersonalPass } from '../hooks/usePersonalPass';
import { TravelPassContent } from './TravelPassContent';
import { TravelPassDialog } from './TravelPassDialog';

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
  const state = personal.state;
  const originLabel = origin.label ?? 'Your starting point';
  return <TravelPassDialog plan={plan} backLabel="Back to meeting" onClose={onClose}>
    {state.status === 'checking' && <p role="status" className="flex items-center gap-2 text-slate-300"><RefreshCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Finding your arrive-by route…</p>}
    {state.status === 'failed' && <div><p role="alert" className="text-rose-300">{state.message}</p><button type="button" onClick={personal.recheck} className="btn-secondary mt-3">Retry route</button></div>}
    {state.status === 'ready' && <TravelPassContent pass={state.pass} options={state.options} originLabel={originLabel} onSelectJourney={personal.selectJourney} onRecheck={personal.recheck} />}
  </TravelPassDialog>;
}
