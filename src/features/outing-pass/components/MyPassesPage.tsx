import { useEffect, useState } from 'react';
import { CalendarClock, LockKeyhole, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '@/features/meeting-point/supabaseClient';
import { loadRoom } from '@/features/meeting-point/roomService';
import { listStoredPasses } from '../passStorage';
import type { StoredPassSummary } from '../types';
import { ArrivalBadge } from './GroupStatus';
import { passDate, passTime } from './passPresentation';

type LibraryState = { status: 'loading' } | { status: 'ready'; passes: StoredPassSummary[]; liveCheckFailed: boolean } | { status: 'failed'; message: string };

export function MyPassesPage({ onOpenRoom }: { onOpenRoom: (code: string) => void }) {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    const client = supabase;
    if (!client) { setState({ status: 'failed', message: 'The room service is not configured. Saved passes require this device’s original member identity.' }); return; }
    void client.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (!data.session) { if (!cancelled) setState({ status: 'ready', passes: [], liveCheckFailed: false }); return; }
      const memberId = data.session.user.id;
      const saved = listStoredPasses(memberId);
      if (!cancelled) setState({ status: 'ready', passes: saved, liveCheckFailed: saved.length > 0 });
      const snapshots = await Promise.allSettled(saved.map(pass => loadRoom(client, pass.roomCode)));
      if (cancelled) return;
      const versions: Record<string, number> = {};
      let liveCheckFailed = false;
      snapshots.forEach((snapshot, index) => {
        if (snapshot.status === 'fulfilled' && snapshot.value?.room.confirmedPlan) versions[saved[index].roomCode] = snapshot.value.room.confirmedPlan.version;
        else liveCheckFailed = true;
      });
      setState({ status: 'ready', passes: listStoredPasses(memberId, versions), liveCheckFailed });
    }).catch(() => { if (!cancelled) setState({ status: 'failed', message: 'Your saved passes could not be loaded. Restore this device’s member session and retry.' }); });
    return () => { cancelled = true; };
  }, []);

  return <main className="outing-page max-w-5xl">
    <header className="flex flex-wrap justify-between items-center gap-3 mb-6"><h1 className="text-3xl font-bold">My passes</h1>{state.status === 'ready' && <span className="outing-badge">{state.passes.length} upcoming</span>}</header>
    <div className="outing-card-inset flex gap-3 items-center mb-4"><ShieldCheck className="outing-accent shrink-0" aria-hidden="true" /><p className="font-bold">Saved on this device</p></div>
    <p className="outing-muted mb-6 text-sm leading-relaxed">Your personal passes are saved in this browser under your member identity. Opening a pass checks the latest room agreement, delay evidence and forecasts again.</p>
    {state.status === 'loading' && <p role="status" className="outing-card">Loading your saved passes…</p>}
    {state.status === 'failed' && <p role="alert" className="outing-warning">{state.message}</p>}
    {state.status === 'ready' && <>
      {state.liveCheckFailed && <p role="status" className="outing-card-inset text-sm mb-5">Some current room versions could not be verified. Saved check results are historical; open a pass to re-check before travelling.</p>}
      {state.passes.length === 0 && <section className="outing-card text-center py-12"><Ticket size={36} className="outing-accent mx-auto mb-4" aria-hidden="true" /><h2 className="font-bold text-xl">No upcoming passes yet</h2><p className="outing-muted mt-3 text-sm">Confirm a meeting in Meet and open your personal pass to save it here.</p><button className="btn-primary mt-5" onClick={() => onOpenRoom('')}>Go to Meet</button></section>}
      <div className="grid md:grid-cols-2 gap-5">{state.passes.map(pass => <article className="outing-card outing-ticket space-y-4" key={pass.id}>
        <div className="flex justify-between flex-wrap gap-2"><span className="outing-badge">Group · Plan v{pass.planVersion}</span>{pass.outdated ? <span className="outing-badge outing-badge-failed">Outdated</span> : <ArrivalBadge status={pass.status} />}</div>
        <h2 className="font-bold text-xl break-words">{pass.meetingName}</h2><p className="text-xs outing-muted flex items-center gap-2"><MapPin size={14} aria-hidden="true" />Room {pass.roomCode}</p>
        <div className="outing-card-inset"><p className="text-sm font-bold flex gap-2"><CalendarClock size={18} aria-hidden="true" />{passDate(pass.meetingTime)}</p><div className="grid grid-cols-2 gap-3 mt-4 text-sm"><div><p className="outing-muted text-xs">Leave around</p><p className="outing-accent font-bold mt-1">{passTime(pass.leaveTime)}</p></div><div><p className="outing-muted text-xs">Agreed arrival</p><p className="font-bold mt-1">{passTime(pass.meetingTime)}</p></div></div></div>
        <p className="outing-muted text-xs">Last checked {passDate(pass.checkedAt)} · {passTime(pass.checkedAt)} MYT</p>{pass.outdated && <p className="text-sm text-amber-200">The group agreement changed. This pass needs a new journey check.</p>}
        <div className="outing-ticket-divider" /><button className="btn-primary w-full flex justify-center gap-2" onClick={() => onOpenRoom(pass.roomCode)}><Ticket size={18} aria-hidden="true" />Open and re-check pass</button>
      </article>)}</div>
    </>}
    <p className="outing-muted text-xs text-center flex justify-center gap-2 mt-8"><LockKeyhole size={14} aria-hidden="true" />Your saved route stays on this device. Download a pass image for offline reference.</p>
  </main>;
}
