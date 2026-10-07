import { ShieldCheck, Users } from 'lucide-react';
import type { ArrivalStatus, SharedMemberStatus } from '@/features/meeting-point/types';

export function ArrivalBadge({ status }: { status: ArrivalStatus }) {
  const tone = status === 'Ready' ? 'outing-badge-ready' : status === 'Check needed' ? 'outing-badge-attention' : '';
  return <span className={`outing-badge ${tone}`}><span aria-hidden="true">●</span>{status}</span>;
}

export function GroupStatus({ members }: { members: SharedMemberStatus[] }) {
  return (
    <section className="outing-card space-y-5" aria-labelledby="group-status-title">
      <div className="flex items-center justify-between gap-3">
        <div><h2 id="group-status-title" className="text-2xl font-bold">Group arrival readiness</h2><p className="outing-muted text-sm mt-2">Only names and coarse arrival status are shared.</p></div>
        <Users className="outing-accent shrink-0" size={26} aria-hidden="true" />
      </div>
      <ul className="space-y-3">
        {members.map(member => <li key={member.id} className="outing-card-inset flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span aria-hidden="true" className="w-11 h-11 rounded-full bg-teal-900 flex items-center justify-center outing-accent font-bold shrink-0">{member.displayName.slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0"><p className="font-bold break-words">{member.displayName}{member.isSelf && <span className="outing-muted text-xs ml-2">You</span>}</p><p className="text-xs outing-muted mt-1">Personal journey stays private</p></div>
          </div><ArrivalBadge status={member.arrivalStatus} />
        </li>)}
      </ul>
      <div className="outing-card-inset outing-private">
        <h3 className="flex items-center gap-2 font-bold text-lg"><ShieldCheck size={20} aria-hidden="true" />Private by design</h3>
        <p className="outing-muted mt-3 text-sm leading-relaxed">Other members cannot read your starting point, journey legs, route or personal check details. The room receives only Ready, Check needed or Not checked.</p>
        <p className="outing-muted mt-3 text-xs leading-relaxed">The transit service uses your private starting point to calculate common meeting options. Your personal pass is saved in this browser on this device.</p>
      </div>
    </section>
  );
}
