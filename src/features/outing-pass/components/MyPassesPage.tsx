import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, LockKeyhole, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '@/features/meeting-point/supabaseClient';
import { listStoredPasses, loadStoredPass } from '../passStorage';
import type { PersonalPass, StoredPassSummary } from '../types';
import { usePassClock } from '../hooks/usePassClock';
import { isPastMeeting, passDate, passTime } from './passPresentation';
import { SavedTravelPass } from './SavedTravelPass';

type LibraryState = { status: 'loading' } | { status: 'ready'; memberId: string | null; passes: StoredPassSummary[] } | { status: 'failed'; message: string };

export function MyPassesPage({ onOpenRoom }: { onOpenRoom: (code?: string) => void }) {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  const [openedPass, setOpenedPass] = useState<PersonalPass | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const closePass = useCallback(() => setOpenedPass(null), []);
  const now = usePassClock();
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const client = supabase;
    if (!client) { setState({ status: 'failed', message: 'The room service is not configured. Saved passes require this device’s original member identity.' }); return; }
    void client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (cancelled) return;
      if (!data.session) { setState({ status: 'ready', memberId: null, passes: [] }); return; }
      const memberId = data.session.user.id;
      // The original device identity scopes private storage; room membership is not needed.
      setState({ status: 'ready', memberId, passes: listStoredPasses(memberId) });
    }).catch(() => { if (!cancelled) setState({ status: 'failed', message: 'Your saved passes could not be loaded. Restore this device’s member session and retry.' }); });
    return () => { cancelled = true; };
  }, [attempt]);

  const openPass = (summary: StoredPassSummary) => {
    if (state.status !== 'ready' || !state.memberId) return;
    setOpenError(null);
    try {
      const pass = loadStoredPass(summary.roomCode, state.memberId);
      if (!pass || pass.id !== summary.id) throw new Error('Saved pass unavailable');
      setOpenedPass(pass);
    } catch {
      setOpenError('This saved journey could not be opened. Return to My Passes and try again.');
    }
  };

  return <main className="outing-page max-w-5xl">
    <header className="flex flex-wrap justify-between items-center gap-3 mb-6"><h1 className="text-3xl font-bold">My passes</h1>{state.status === 'ready' && <span className="outing-badge">{state.passes.length} saved</span>}</header>
    <div className="outing-card-inset flex gap-3 items-center mb-4"><ShieldCheck className="outing-accent shrink-0" aria-hidden="true" /><p className="font-bold">Saved on this device</p></div>
    <p className="outing-muted mb-6 text-sm">Your saved personal journeys, including past meetings. Routes are not updated live. Use Meet to plan again.</p>
    {state.status === 'loading' && <p role="status" className="outing-card">Loading your saved passes…</p>}
    {state.status === 'failed' && <div className="outing-warning"><p role="alert">{state.message}</p><button type="button" className="btn-secondary mt-3" onClick={() => setAttempt(value => value + 1)}>Retry saved passes</button></div>}
    {openError && <p role="alert" className="outing-warning mb-5">{openError}</p>}
    {state.status === 'ready' && <>
      {state.passes.length === 0 && <section className="outing-card text-center py-12"><Ticket size={36} className="outing-accent mx-auto mb-4" aria-hidden="true" /><h2 className="font-bold text-xl">No saved passes yet</h2><p className="outing-muted mt-3 text-sm">Choose a meeting by vote, then generate your pass.</p><button className="btn-primary mt-5" onClick={() => onOpenRoom()}>Go to Meet</button></section>}
      <div className="grid md:grid-cols-2 gap-5">{state.passes.map(pass => <article className="outing-card outing-ticket space-y-4" key={pass.id}>
        <div className="flex justify-between flex-wrap gap-2"><span className="outing-badge">Personal travel pass</span><span className="outing-badge">{isPastMeeting(pass.meetingTime, now) ? 'Historical journey' : 'Saved journey'}</span></div>
        <h2 className="font-bold text-xl break-words">{pass.meetingName}</h2><p className="text-xs outing-muted flex items-center gap-2"><MapPin size={14} aria-hidden="true" />Room {pass.roomCode}</p>
        <div className="outing-card-inset"><p className="text-sm font-bold flex gap-2"><CalendarClock size={18} aria-hidden="true" />{passDate(pass.meetingTime)}</p><div className="grid grid-cols-2 gap-3 mt-4 text-sm"><div><p className="outing-muted text-xs">{pass.zeroTravel ? 'Same starting point' : isPastMeeting(pass.meetingTime, now) ? 'Planned departure' : 'Leave around'}</p><p className="outing-accent font-bold tabular-nums mt-1">{pass.zeroTravel ? 'No travel needed' : passTime(pass.leaveTime)}</p></div><div><p className="outing-muted text-xs">Agreed arrival</p><p className="font-bold tabular-nums mt-1">{passTime(pass.meetingTime)}</p></div></div></div>
        <p className="outing-muted text-xs">Saved {passDate(pass.checkedAt)} · {passTime(pass.checkedAt)} MYT</p>
        <div className="outing-ticket-divider" /><button type="button" className="btn-primary w-full flex justify-center gap-2" onClick={() => openPass(pass)}><Ticket size={18} aria-hidden="true" />View journey<span className="sr-only"> to {pass.meetingName}</span></button>
      </article>)}</div>
    </>}
    <p className="outing-muted text-xs text-center flex justify-center gap-2 mt-8"><LockKeyhole size={14} aria-hidden="true" />Your saved route stays on this device. Download a pass image for offline reference.</p>
    {openedPass && <SavedTravelPass pass={openedPass} onClose={closePass} />}
  </main>;
}
