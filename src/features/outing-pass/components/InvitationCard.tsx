import { ArrowRight, CalendarClock, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import type { MeetingRoom } from '@/features/meeting-point/types';
import { passDate, passTime } from './passPresentation';

interface Props {
  room: MeetingRoom;
  memberCount: number;
  hasOrigin: boolean;
  onOpen: () => void;
  onEditOrigin: () => void;
  onSuggestTime: () => void;
}

export function InvitationCard({ room, memberCount, hasOrigin, onOpen, onEditOrigin, onSuggestTime }: Props) {
  const plan = room.confirmedPlan;
  if (!plan) return null;
  return (
    <section className="outing-card outing-ticket space-y-6" aria-labelledby="invitation-title">
      <div className="flex justify-between flex-wrap gap-2"><span className="outing-accent flex items-center gap-2 text-xs font-bold tracking-widest uppercase"><Ticket size={18} aria-hidden="true" />You're invited</span><span className="outing-badge">Group outing · Plan v{plan.version}</span></div>
      <div><h1 id="invitation-title" className="text-3xl md:text-4xl font-bold leading-tight break-words">Meet at {plan.venue.name}</h1><p className="outing-muted mt-3">A confirmed meeting for {memberCount} {memberCount === 1 ? 'member' : 'members'}.</p></div>
      <div className="outing-card-inset space-y-6">
        <div className="flex gap-4"><CalendarClock className="outing-accent shrink-0 mt-1" aria-hidden="true" /><div><h2 className="font-bold text-xl">{passDate(plan.arrivalTime)}</h2><p className="outing-accent mt-2">Agreed arrival · {passTime(plan.arrivalTime)} MYT</p></div></div>
        <div className="border-t border-slate-700 pt-6 flex gap-4"><MapPin className="outing-accent shrink-0 mt-1" aria-hidden="true" /><div><h2 className="font-bold text-xl break-words">{plan.venue.name}</h2><p className="outing-muted mt-2 break-words">{plan.venue.address ?? plan.venue.kindLabel}</p></div></div>
      </div>
      <div className="outing-card-inset outing-private flex gap-3"><ShieldCheck className="outing-accent shrink-0" aria-hidden="true" /><div><h2 className="font-bold text-lg">Your own journey, kept private</h2><p className="outing-muted mt-2 text-sm leading-relaxed">Your pass uses only your starting point. Other members see your name and coarse arrival status.</p></div></div>
      <button className="btn-primary w-full flex justify-center items-center gap-3 py-4 text-lg" onClick={hasOrigin ? onOpen : onEditOrigin}><Ticket size={22} aria-hidden="true" />{hasOrigin ? 'Open my pass' : 'Set my starting point'}<ArrowRight size={20} aria-hidden="true" /></button>
      <button className="btn-secondary w-full py-3" onClick={onSuggestTime}>Suggest another meeting time</button>
      <p className="outing-muted text-xs text-center">Journey times are estimates. A suggestion changes the agreement only after the room confirms it.</p>
    </section>
  );
}
