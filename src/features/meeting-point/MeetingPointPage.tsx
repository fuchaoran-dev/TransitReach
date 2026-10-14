import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RefreshCw, Users, Vote } from 'lucide-react';
import { BaseMap, TimeBudgetSelector } from '@/features/reachability';
import { isInStudyArea } from '@/features/reachability/reachabilityService';
import type { Origin } from '@/features/reachability/types';
import { malaysiaInputTime } from '@/features/outing-pass/components/passPresentation';
import { MeetingTravelPass } from '@/features/outing-pass/components/MeetingTravelPass';
import { meetingPreviewStart } from './meetingTime';
import { FocusOnPlace, RankedPlaceMarkers } from './components/RankedPlaceMarkers';
import { MyStartingPoint } from './components/MyStartingPoint';
import { RoomLobby } from './components/RoomLobby';
import { ShareLink } from './components/ShareLink';
import { SharedMeetingMap } from './components/SharedMeetingMap';
import { OverlapLayer } from './components/OverlapLayer';
import { intersectAreas } from './overlapService';
import type { RankedPlace } from './fairnessRanking';
import { useMeetingRoom } from './hooks/useMeetingRoom';
import { useServerCommonGround } from './hooks/useServerCommonGround';
import { ROOM_ERROR_MESSAGES, type StartingPoint } from './types';
import { VENUE_TYPES, type VenueType } from './venueService';

const ALL_VENUE_TYPES = new Set<VenueType>(VENUE_TYPES.map(option => option.id));
function futureInput(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 15) * 15, 0, 0);
  return malaysiaInputTime(date.toISOString());
}
function inputIso(input: string): string {
  const date = new Date(`${input}:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid time');
  return date.toISOString();
}
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Ready means a starting point is saved, not that a personal journey has been checked. */
export function MeetingPointPage() {
  const meeting = useMeetingRoom();
  if (meeting.view.status === 'ready') return <MeetingPlanner key={meeting.view.room.code} meeting={meeting} />;
  return <main className="min-h-screen bg-[#080f18] px-6 pb-8 pt-24 text-slate-100">
    <header className="mx-auto mb-8 max-w-5xl">
      <p className="flex items-center gap-2 text-sm font-semibold text-teal-300"><Users size={18} aria-hidden="true" />Meet up</p>
      <h1 className="mt-2 text-3xl font-extrabold text-white">Find somewhere everyone can reach.</h1>
      <p className="mt-3 text-slate-300">Share starting points, explore common ground, then vote together.</p>
    </header>
    <div className="mx-auto max-w-5xl">
      {meeting.view.status === 'unconfigured' && <p className="glass max-w-xl p-6">Shared rooms are not set up on this deployment.</p>}
      {meeting.view.status === 'checking' && <p role="status" className="glass max-w-xl p-6">Opening room {meeting.view.code}…</p>}
      {meeting.view.status === 'lobby' && <RoomLobby invitedCode={meeting.view.invitedCode} invitation={meeting.view.invitation} busy={meeting.busy} error={meeting.error} onCreate={nickname => void meeting.create(nickname)} onJoin={(code, nickname) => void meeting.join(code, nickname)} />}
    </div>
  </main>;
}

type PlannerController = Pick<ReturnType<typeof useMeetingRoom>, 'view' | 'busy' | 'error' | 'setMyPoint' | 'changeBudget' | 'leave' | 'startPlanning' | 'reopenPlanning' | 'proposeVenue' | 'vote'>;

export function MeetingPlanner({ meeting, commonGround }: { meeting: PlannerController; commonGround?: ReturnType<typeof useServerCommonGround> }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StartingPoint | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [passOpen, setPassOpen] = useState(false);
  const closePass = useCallback(() => setPassOpen(false), []);
  const [venueTypes, setVenueTypes] = useState<ReadonlySet<VenueType>>(ALL_VENUE_TYPES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrivalInput, setArrivalInput] = useState(() => meeting.view.status === 'ready' && meeting.view.room.votingArrivalTime ? malaysiaInputTime(meeting.view.room.votingArrivalTime) : futureInput(90));
  const [frameRequest, setFrameRequest] = useState(0);
  const snapshot = meeting.view.status === 'ready' ? meeting.view : null;
  const room = snapshot?.room;
  const serverCommon = useServerCommonGround(!commonGround && room?.planningStarted ? room.code : null, room?.timeBudget ?? 30, ALL_VENUE_TYPES, String(room?.planningRevision ?? 0));
  const common = commonGround ?? serverCommon;
  const result = common.state.status === 'ready' && common.state.result.roomRevision === room?.planningRevision && common.state.result.arrivalTime && Date.parse(common.state.result.arrivalTime) === Date.parse(room?.votingArrivalTime ?? '') ? common.state.result : null;
  const overlap = useMemo(() => {
    try { return { polygons: intersectAreas(result?.participantAreas.map(area => area.regions) ?? [], 0), failed: false }; }
    catch { return { polygons: [], failed: true }; }
  }, [result]);
  const displayed = useMemo(() => (result?.proposals ?? []).filter(proposal => venueTypes.has(proposal.venue.type)), [result, venueTypes]);
  const places = useMemo<RankedPlace[]>(() => displayed.map(proposal => ({ venue: proposal.venue, minutes: [], longest: proposal.longestMinutes, gap: proposal.gapMinutes })), [displayed]);
  const myLat = snapshot?.me.at?.lat;
  const myLon = snapshot?.me.at?.lon;
  const mySource = snapshot?.me.source;
  const confirmedVersion = room?.confirmedPlan?.version;
  const budget = room?.timeBudget;
  useEffect(() => { setPassOpen(false); }, [confirmedVersion, myLat, myLon, budget]);
  const myOrigin = useMemo<Origin | null>(() => myLat !== undefined && myLon !== undefined && mySource ? { at: { lat: myLat, lon: myLon }, source: mySource } : null, [myLat, myLon, mySource]);
  if (!snapshot || !room) return null;
  const { me, members, votes, selections } = snapshot;
  const located = members.filter(member => member.planningStatus === 'Ready').length;
  const allReady = members.length >= 2 && located === members.length;
  const myVote = votes.find(vote => vote.memberId === me.id);
  const selected = displayed.find(proposal => proposal.venue.id === selectedId) ?? null;
  const choose = (point: StartingPoint) => {
    if (meeting.busy) return;
    if (!isInStudyArea(point.at)) { setNotice('Selected point is outside the covered area.'); return; }
    setNotice(null);
    setDraft(point);
  };
  const share = async () => {
    const point = draftRef.current;
    if (!point || meeting.busy) return;
    const saved = await meeting.setMyPoint(point);
    if (saved && draftRef.current === point) setDraft(null);
  };
  const run = async (action: () => Promise<void>, fallback: string) => {
    setActionError(null);
    try { await action(); } catch { setActionError(fallback); }
  };
  const start = () => run(async () => {
    const arrival = inputIso(arrivalInput);
    let departure: string;
    try { departure = meetingPreviewStart(arrival, room.timeBudget); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Choose a valid meeting time.'); return; }
    await meeting.startPlanning(departure, arrival);
    setFrameRequest(value => value + 1);
  }, 'Could not start planning. Check the meeting time and that everyone has shared a starting point.');
  const toggleType = (type: VenueType) => setVenueTypes(current => {
    if (current.has(type) && current.size === 1) return current;
    const next = new Set(current);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  return <div className="fixed inset-x-0 bottom-0 top-16 overflow-hidden bg-[#080f18]">
    <div className="absolute inset-0"><BaseMap origin={draft ?? myOrigin} showOriginPin={false} regions={null} onMapClick={at => choose({ at, source: 'map', label: null })}>
      <SharedMeetingMap members={members} areas={result?.participantAreas ?? []} frameRequest={frameRequest} draft={draft} />
      {!overlap.failed && <OverlapLayer polygons={overlap.polygons} />}
      <RankedPlaceMarkers places={places} selectedId={selectedId} onSelect={setSelectedId} memberPoints={members.flatMap(member => member.at ? [member.at] : [])} />
      <FocusOnPlace place={selected?.venue ?? null} />
    </BaseMap></div>
    <div className="absolute left-1/2 top-4 z-[480] -translate-x-1/2 rounded-xl border border-teal-300/20 bg-[#0e1c29]/95 p-3 text-center text-xs text-slate-200">
      <p>{room.confirmedPlan ? 'Meeting selected by vote' : room.planningStarted ? '2 · Explore and vote' : '1 · Gather your group'}</p>
      <button type="button" onClick={() => setFrameRequest(value => value + 1)} className="mt-2 text-teal-200 underline">Show everyone</button>
      {result && <p className="mt-2">{overlap.failed ? 'Area could not be drawn' : overlap.polygons.length ? 'Shared reachability preview' : 'No overlap in this preview'}</p>}
    </div>
    <aside className="absolute bottom-4 left-4 top-4 z-[510] w-[340px] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-5 text-slate-100 shadow-2xl backdrop-blur-xl">
      <h1 className="mb-3 text-xl font-bold text-white">Plan a group meeting</h1><ShareLink code={room.code} />
      <div className="mt-4"><MyStartingPoint me={members.some(member => member.isSelf && member.planningStatus === 'Ready') ? me : { ...me, at: null }} draft={draft} notice={notice} busy={meeting.busy} onSelect={choose} onShare={() => void share()} onCancel={() => { setDraft(null); setNotice(null); }} onWithdraw={() => { setDraft(null); setNotice(null); void meeting.setMyPoint(null); }} /></div>
      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Members · {located}/{members.length} ready</p>
      <ul className="space-y-2">{members.map(member => <li key={member.id} className="flex items-center justify-between gap-2 rounded-xl bg-[#192a38] p-3">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{member.displayName}{member.isSelf ? ' (you)' : ''}</p><p className="mt-1 truncate text-[11px] text-slate-400">{member.at ? member.label ?? 'Selected map point' : 'Choose a starting point'}</p></div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${member.planningStatus === 'Ready' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>{member.planningStatus === 'Ready' ? '✓ Ready' : 'Not ready'}</span>
      </li>)}</ul>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">Ready means your starting point is shared. Each person gets their own suggested departure after voting.</p>
      {room.isHost && <section className="mt-4 border-t border-[#294456] pt-4">
        <fieldset disabled={meeting.busy || room.planningStarted} className="space-y-3">
          <label className="block text-xs text-slate-300">Meeting time · MYT<input type="datetime-local" value={room.planningStarted && room.votingArrivalTime ? malaysiaInputTime(room.votingArrivalTime) : arrivalInput} onChange={event => setArrivalInput(event.target.value)} className="glass-input mt-1 w-full p-2 text-sm [color-scheme:dark]" /></label>
          <div><p className="mb-2 text-xs text-slate-300">Travel time budget</p><TimeBudgetSelector value={room.timeBudget} onChange={budget => void meeting.changeBudget(budget)} /></div>
        </fieldset>
        {!room.planningStarted && <button type="button" onClick={() => void start()} disabled={!allReady || meeting.busy} className="btn-primary mt-4 w-full">Start group planning</button>}
        {room.planningStarted && <button type="button" onClick={() => void run(meeting.reopenPlanning, 'Could not reopen the room. Try again.')} disabled={meeting.busy} className="btn-secondary mt-4 w-full">Reopen room and reset votes</button>}
      </section>}
      {!room.planningStarted && <p className="mt-3 text-xs text-slate-300">{allReady ? 'The creator can start when everyone has joined.' : 'Invite at least two members and save every starting point.'}</p>}
      {room.votingArrivalTime && room.planningStarted && <p className="mt-3 text-xs text-slate-300">Meet: {formatTime(room.votingArrivalTime)} MYT · Travel budget {room.timeBudget} min</p>}
      {result?.departureTime && <details className="mt-3 text-xs leading-relaxed text-slate-400"><summary className="cursor-pointer">About the map preview</summary><p className="mt-2">A conservative OTP preview starting at {formatTime(result.departureTime)} MYT, one budget before the meeting. Not every possible departure is shown. Listed places also pass individual arrive-by route checks.</p></details>}
      {meeting.error && <p role="alert" className="mt-3 text-sm text-rose-300">{ROOM_ERROR_MESSAGES[meeting.error]}</p>}
      <button type="button" onClick={() => void meeting.leave()} disabled={meeting.busy} className="btn-secondary mt-4 w-full">Leave room</button>
    </aside>
    <aside className="absolute bottom-4 right-4 top-4 z-[510] w-[370px] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-5 text-slate-100 shadow-2xl backdrop-blur-xl">
      {room.confirmedPlan && <section className="mb-4 rounded-xl border border-emerald-300/40 bg-emerald-400/10 p-4" role="status">
        <p className="text-xs font-semibold text-emerald-300">✓ Selected by group vote · v{room.confirmedPlan.version}</p><h2 className="mt-2 text-lg font-bold text-white">{room.confirmedPlan.venue.name}</h2><p className="mt-1 text-sm">{formatTime(room.confirmedPlan.arrivalTime)} MYT</p>
        <p className="mt-2 text-xs text-slate-300">Everyone voted; the unique highest vote count won.</p>
        <button type="button" disabled={!me.at || draft !== null || meeting.busy} className="btn-primary mt-4 w-full" onClick={() => setPassOpen(true)}>Generate my travel pass</button>
        {draft && <p className="mt-2 text-xs text-amber-200">Share or cancel your preview before generating a pass.</p>}
      </section>}
      <h2 className="text-lg font-bold text-white">Common places & votes</h2><p className="mt-1 text-xs text-slate-400">Ranked among checked candidates by longest arrive-by trip, then time gap. Estimated, not guaranteed.</p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Venue types">{VENUE_TYPES.map(option => <button key={option.id} type="button" aria-pressed={venueTypes.has(option.id)} onClick={() => toggleType(option.id)} className={`rounded-lg border px-2 py-1.5 text-xs ${venueTypes.has(option.id) ? 'border-teal-300 text-teal-100' : 'border-[#315163] text-slate-300'}`}>{option.label}</button>)}</div>
      {!room.planningStarted && <p className="mt-4 text-sm text-slate-300">Waiting for the creator to start this round.</p>}
      {room.planningStarted && common.state.status === 'loading' && <p role="status" className="mt-4 text-sm">Calculating everyone’s reachable area…</p>}
      {common.state.status === 'failed' && <div role="alert" className="mt-4 text-sm text-rose-300">{common.state.message ?? 'Common-ground calculation is unavailable.'}<button type="button" onClick={common.retry} className="btn-secondary mt-2 flex items-center gap-2"><RefreshCw size={14} />Retry</button></div>}
      {overlap.failed && <p role="alert" className="mt-4 text-sm text-rose-300">The shared boundary could not be calculated. Retry before voting.</p>}
      {result?.status === 'no_common_ground' && <p className="mt-4 text-sm">No venue in this screened shortlist fits everyone’s arrive-by budget. Reopen to adjust the meeting time or budget.</p>}
      {result?.status === 'waiting_for_origins' && <p role="status" className="mt-4 text-sm">Waiting for {result.missingStartingPoints} saved starting point(s). No partial group result is shown.</p>}
      {result?.status === 'waiting_for_participants' && <p role="status" className="mt-4 text-sm">At least two participants are needed.</p>}
      {result?.status === 'waiting_for_planning' && <p role="status" className="mt-4 text-sm">The round changed. Wait for the creator to restart planning.</p>}
      {room.voteStatus === 'tie' && <p role="status" className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">The vote is tied. Discuss and change a vote; no venue is confirmed.</p>}
      {room.planningStarted && <p role="status" className="mt-3 text-xs text-teal-200">{votes.length}/{members.length} voted{room.votingArrivalTime ? ` · Arrival ${formatTime(room.votingArrivalTime)} MYT` : ''}</p>}
      <div className="mt-4 space-y-3">{displayed.map(proposal => {
        const voters = votes.filter(vote => vote.venue.id === proposal.venue.id && vote.venue.type === proposal.venue.type);
        const proposers = selections.filter(selection => selection.venue.id === proposal.venue.id && selection.venue.type === proposal.venue.type);
        return <section key={`${proposal.venue.type}:${proposal.venue.id}`} className={`rounded-xl border p-3 ${selectedId === proposal.venue.id ? 'border-teal-300 bg-[#213844]' : 'border-[#294456] bg-[#192a38]'}`}>
          <button type="button" className="w-full text-left" onClick={() => setSelectedId(proposal.venue.id)} aria-pressed={selectedId === proposal.venue.id}>
            <span className="flex items-center justify-between gap-2"><strong className="text-sm">{proposal.rank}. {proposal.venue.name}</strong><span className="rounded-full bg-teal-300/10 px-2 py-1 text-xs text-teal-200">{voters.length} {voters.length === 1 ? 'vote' : 'votes'}</span></span>
            <span className="mt-1 block text-xs text-slate-400">{proposal.venue.kindLabel} · longest {proposal.longestMinutes} min · gap {proposal.gapMinutes} min</span><span className="mt-2 flex items-center gap-1 text-xs text-slate-400"><MapPin size={12} />{proposal.venue.hours ?? 'Hours unknown'}</span>
          </button>
          {proposers.length > 0 && <p className="mt-2 text-xs text-slate-300">Proposed by {proposers.map(person => person.displayName).join(', ')}</p>}
          {voters.length > 0 && <p className="mt-1 text-xs text-teal-200">Voted: {voters.map(person => person.displayName).join(', ')}</p>}
          {!room.confirmedPlan && <div className="mt-3 flex gap-2">
            <button type="button" disabled={meeting.busy || overlap.failed} className="btn-secondary flex-1 text-xs" onClick={() => void run(() => meeting.proposeVenue(proposal.venue), 'The proposal was not shared. Reload and try again.')}>Propose</button>
            <button type="button" disabled={meeting.busy || overlap.failed} aria-pressed={myVote?.venue.id === proposal.venue.id} className="btn-primary flex flex-1 items-center justify-center gap-1 text-xs" onClick={() => void run(() => meeting.vote(proposal.venue), 'Your vote was not saved. The round may have changed; reload and try again.')}><Vote size={14} />{myVote?.venue.id === proposal.venue.id ? '✓ Your vote' : myVote ? 'Change vote' : 'Vote'}</button>
          </div>}
        </section>;
      })}</div>
      {votes.length > 0 && <section className="mt-4 border-t border-[#294456] pt-3"><h3 className="text-xs font-bold text-white">All room votes</h3><ul className="mt-2 space-y-1">{votes.map(vote => <li key={vote.memberId} className="text-xs text-slate-300">{vote.displayName} → {vote.venue.name}</li>)}</ul></section>}
      {actionError && <p role="alert" className="mt-3 text-sm text-rose-300">{actionError}</p>}
      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">Viewing a place is not a vote. Each member has one changeable vote. Everyone must vote and the highest count must be unique. Changes to members, origins or budget reset the round.</p>
    </aside>
    {passOpen && room.confirmedPlan && myOrigin && <MeetingTravelPass key={`${room.confirmedPlan.version}:${myOrigin.at.lat}:${myOrigin.at.lon}:${room.timeBudget}`} code={room.code} memberId={me.userId} plan={room.confirmedPlan} origin={{ ...myOrigin, label: me.label }} budget={room.timeBudget} onClose={closePass} />}
  </div>;
}
