import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarClock, QrCode, ShieldCheck } from 'lucide-react';
import type { ArrivalStatus, MeetingRoom, Participant, SharedMemberStatus, StartingPoint } from '@/features/meeting-point/types';
import { shareLinkFor } from '@/features/meeting-point/roomLink';
import { usePersonalPass } from '../hooks/usePersonalPass';
import { loadStoredPass } from '../passStorage';
import { downloadPassImage, generateRoomQrDataUrl } from '../passExport';
import { GroupStatus } from './GroupStatus';
import { InvitationCard } from './InvitationCard';
import { PersonalPassView } from './PersonalPassView';
import { PrivateJourneyMap } from './PrivateJourneyMap';
import { malaysiaInputTime } from './passPresentation';

interface Props {
  room: MeetingRoom;
  me: Participant | null;
  members: SharedMemberStatus[];
  onBack: () => void;
  onSuggestTime: (arrivalTime: string) => Promise<void>;
  onPublishStatus: (status: ArrivalStatus, version: number) => Promise<void>;
}

export function GroupOutingView({ room, me, members, onBack, onSuggestTime, onPublishStatus }: Props) {
  const plan = room.confirmedPlan;
  const [passOpen, setPassOpen] = useState(() => {
    try { return Boolean(plan && me && loadStoredPass(room.code, me.userId)); }
    catch { return false; }
  });
  const [showProposal, setShowProposal] = useState(false);
  const [proposedTime, setProposedTime] = useState(() => plan ? malaysiaInputTime(plan.arrivalTime) : '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const latitude = me?.at?.lat;
  const longitude = me?.at?.lon;
  const originSource = me?.source;
  const originLabel = me?.label ?? null;
  const memberId = me?.id;
  const planVersion = plan?.version;
  const origin = useMemo<StartingPoint | null>(() => latitude !== undefined && longitude !== undefined && originSource ? { at: { lat: latitude, lon: longitude }, source: originSource, label: originLabel } : null, [latitude, longitude, originSource, originLabel]);
  const personal = usePersonalPass({ roomCode: room.code, memberId: me?.userId ?? '', plan: passOpen && me ? plan : null, origin });
  // A new room version must not briefly render the previous version as a current pass
  // while the hook's effect schedules its replacement check.
  const state = personal.state.status === 'ready' && personal.state.pass.planVersion !== planVersion
    ? { status: 'checking' as const, previous: personal.state.pass }
    : personal.state;
  const publishRef = useRef(onPublishStatus);
  publishRef.current = onPublishStatus;

  useEffect(() => {
    let cancelled = false;
    void generateRoomQrDataUrl(room.code).then(url => { if (!cancelled) setQr(url); }).catch(() => { if (!cancelled) setError('The room QR could not be generated. Use the invitation link instead.'); });
    return () => { cancelled = true; };
  }, [room.code]);

  const publishedStatus = state.status === 'ready' && state.pass.planVersion === planVersion ? state.pass.status : 'Not checked';
  useEffect(() => {
    if (!passOpen || planVersion === undefined || !memberId) return;
    let cancelled = false;
    void publishRef.current(publishedStatus, planVersion).catch(() => { if (!cancelled) setError('Your private check could not update your shared arrival status. Re-check to retry.'); });
    return () => { cancelled = true; };
  }, [publishedStatus, planVersion, passOpen, memberId]);

  if (!plan) return null;
  const runDownload = async () => {
    if (state.status !== 'ready') return;
    setError(null);
    setActionBusy(true);
    try { await downloadPassImage(state.pass); setNotice('Your private pass image is ready. Check your browser’s downloads.'); }
    catch { setError('The image could not be downloaded. Try again.'); }
    finally { setActionBusy(false); }
  };

  return <main className="outing-page">
    <div className="flex flex-wrap justify-between gap-3 items-center mb-6"><button className="flex items-center gap-2 outing-muted text-sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to planning</button><span className="outing-badge">Room {room.code} · Plan v{plan.version}</span></div>
    {error && <p className="outing-warning mb-5" role="alert">{error}</p>}
    {notice && <p className="outing-card-inset mb-5 outing-accent" role="status">{notice}</p>}
    <div className={`grid gap-6 ${passOpen && state.status === 'ready' ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : 'lg:grid-cols-2'}`}>
      <div className="min-w-0">
        {!passOpen && <InvitationCard room={room} memberCount={members.length} hasOrigin={Boolean(origin)} onOpen={() => setPassOpen(true)} onEditOrigin={onBack} onSuggestTime={() => setShowProposal(true)} />}
        {passOpen && state.status === 'checking' && <section className="outing-card space-y-4" role="status"><h1 className="text-2xl font-bold">Checking your personal journey…</h1><p className="outing-muted">Calculating an arrive-by route and checking current delay and forecast evidence.</p>{state.previous && <p className="outing-muted text-sm">Saved plan v{state.previous.planVersion} is awaiting a fresh check.</p>}</section>}
        {passOpen && state.status === 'failed' && <section className="outing-card space-y-4"><h1 className="text-2xl font-bold">Your journey needs a check</h1><p role="alert" className="text-rose-200">{state.message}</p><p className="outing-muted">A failed check cannot confirm that your plan still holds.</p><button className="btn-primary" onClick={personal.recheck}>Retry check</button><button className="btn-secondary ml-3" onClick={onBack}>Edit starting point</button></section>}
        {passOpen && state.status === 'idle' && <section className="outing-card space-y-4"><h1 className="text-2xl font-bold">Set your own starting point</h1><p className="outing-muted">Your personal pass needs your starting point before a journey can be checked.</p><button className="btn-primary" onClick={onBack}>Set starting point</button></section>}
        {passOpen && state.status === 'ready' && <PersonalPassView pass={state.pass} options={state.options} busy={actionBusy} onBack={() => setPassOpen(false)} onRecheck={() => { setError(null); setNotice(null); personal.recheck(); }} onSelectJourney={personal.selectJourney} onLeaveEarlier={() => personal.leaveEarlier(10)} onDownload={() => void runDownload()} onSuggestTime={() => setShowProposal(true)} />}
      </div>
      <div className="min-w-0 space-y-6">
        {passOpen && state.status === 'ready' && <PrivateJourneyMap pass={state.pass} />}
        <GroupStatus members={members} />
        <section className="outing-card flex flex-wrap items-center gap-5"><div>{qr ? <img className="outing-qr" src={qr} alt={`QR opens the invitation for room ${room.code}`} /> : <QrCode size={64} aria-hidden="true" />}</div><div className="flex-1 min-w-[180px]"><h2 className="font-bold text-lg">Room invitation</h2><p className="text-sm outing-muted mt-2">This code contains only an opaque room reference. On another device, join and set your own starting point.</p><a className="outing-accent underline text-sm inline-block mt-3 break-all" href={shareLinkFor(room.code)}>Open room invitation</a></div></section>
        <p className="text-xs outing-muted flex gap-2"><ShieldCheck size={16} className="shrink-0" aria-hidden="true" />A new confirmed place or time creates a new plan version and requires a fresh personal check.</p>
      </div>
    </div>
    {showProposal && <section className="outing-card mt-6 max-w-xl" aria-labelledby="proposal-title"><h2 id="proposal-title" className="font-bold text-xl flex gap-2 items-center"><CalendarClock size={20} aria-hidden="true" />Suggest another time</h2><p className="outing-muted text-sm mt-3">The agreed meeting stays unchanged until the room explicitly confirms your proposal.</p><form className="mt-5 space-y-4" onSubmit={event => {
      event.preventDefault();
      setActionBusy(true); setError(null);
      void onSuggestTime(`${proposedTime}:00+08:00`).then(() => { setNotice('Your proposed time was sent to the room for confirmation.'); setShowProposal(false); onBack(); }).catch(() => setError('Your suggestion could not be saved. Please retry.')).finally(() => setActionBusy(false));
    }}><label className="block text-sm">Proposed arrival time · MYT<input type="datetime-local" className="glass-input block w-full p-3 mt-2" required value={proposedTime} onChange={event => setProposedTime(event.target.value)} /></label><div className="flex gap-3"><button className="btn-primary" disabled={actionBusy}>Send proposal</button><button type="button" className="btn-secondary" onClick={() => setShowProposal(false)}>Cancel</button></div></form></section>}
  </main>;
}
