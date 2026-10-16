import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Crosshair, Eye, EyeOff, PanelLeftClose, PanelLeftOpen, RefreshCw, Users, Vote } from 'lucide-react';
import { BaseMap, TimeBudgetSelector } from '@/features/reachability';
import { isInStudyArea } from '@/features/reachability/reachabilityService';
import type { Origin } from '@/features/reachability/types';
import { malaysiaInputTime } from '@/features/outing-pass/components/passPresentation';
import { MeetingTravelPass } from '@/features/outing-pass/components/MeetingTravelPass';
import { meetingPreviewStart } from './meetingTime';
import { meetingMapWaypoints, SHARED_MEMBER_COLOURS } from './meetingMapWaypoints';
import { FocusOnPlace, RankedPlaceMarkers } from './components/RankedPlaceMarkers';
import { MyStartingPoint } from './components/MyStartingPoint';
import { RoomLobby } from './components/RoomLobby';
import { ShareLink } from './components/ShareLink';
import { SharedMeetingMap } from './components/SharedMeetingMap';
import { OverlapLayer } from './components/OverlapLayer';
import { MeetingRadarLayer } from './components/MeetingRadarLayer';
import { intersectAreas } from './overlapService';
import type { RankedPlace } from './fairnessRanking';
import { useMeetingRoom } from './hooks/useMeetingRoom';
import { useServerCommonGround } from './hooks/useServerCommonGround';
import { ROOM_ERROR_MESSAGES, type StartingPoint } from './types';
import { VENUE_TYPES, type VenueType } from './venueService';
import './meetingPoint.css';

const ALL_VENUE_TYPES = new Set<VenueType>(VENUE_TYPES.map(option => option.id));
const COLLAPSIBLE_PANEL_QUERY = '(max-width: 1279px)';

function initiallyShowLeftPanel(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !window.matchMedia(COLLAPSIBLE_PANEL_QUERY).matches;
}

function inputIso(input: string): string {
  const date = new Date(`${input}:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid time');
  return date.toISOString();
}
function memberColour(slot: number | undefined): string {
  return SHARED_MEMBER_COLOURS[(slot ?? 0) % SHARED_MEMBER_COLOURS.length];
}
function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}
function shortTime(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
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
      {meeting.view.status === 'checking' && (meeting.error ? <div role="alert" className="glass max-w-xl p-6 text-rose-200"><p>{ROOM_ERROR_MESSAGES[meeting.error]}</p><button type="button" onClick={() => window.location.reload()} className="btn-secondary mt-3">Retry</button></div> : <p role="status" className="glass max-w-xl p-6">Opening room {meeting.view.code}…</p>)}
      {meeting.view.status === 'lobby' && <RoomLobby invitedCode={meeting.view.invitedCode} invitation={meeting.view.invitation} busy={meeting.busy} error={meeting.error} onCreate={nickname => void meeting.create(nickname)} onJoin={(code, nickname) => void meeting.join(code, nickname)} />}
    </div>
  </main>;
}

type PlannerController = Pick<ReturnType<typeof useMeetingRoom>, 'view' | 'busy' | 'error' | 'setMyPoint' | 'changeBudget' | 'changeMeetingTime' | 'leave' | 'reopenPlanning' | 'proposeVenue' | 'vote'>;

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
  const [arrivalInput, setArrivalInput] = useState(() => meeting.view.status === 'ready' && meeting.view.room.meetingTime ? malaysiaInputTime(meeting.view.room.meetingTime) : '');
  const [frameRequest, setFrameRequest] = useState(0);
  const [showSharedArea, setShowSharedArea] = useState(true);
  const [leftPanelOpen, setLeftPanelOpen] = useState(initiallyShowLeftPanel);
  const snapshot = meeting.view.status === 'ready' ? meeting.view : null;
  const room = snapshot?.room;
  useEffect(() => { setSelectedId(null); }, [room?.planningRevision]);
  const allReady = !!snapshot && snapshot.members.length >= 2 && snapshot.members.every(member => member.planningStatus === 'Ready');
  const canCompute = allReady && !!room?.planningStarted;
  useEffect(() => { if (room?.meetingTime) setArrivalInput(malaysiaInputTime(room.meetingTime)); }, [room?.meetingTime]);
  const serverCommon = useServerCommonGround(!commonGround && canCompute && room ? room.code : null, room?.timeBudget ?? 30, ALL_VENUE_TYPES, String(room?.planningRevision ?? 0));
  const common = commonGround ?? serverCommon;
  const categorySearchPending = common.searchTypesKey !== undefined && common.searchTypesKey !== [...venueTypes].sort().join(',');
  const availableResult = 'result' in common.state ? common.state.result : null;
  const result = canCompute && availableResult?.roomRevision === room?.planningRevision && availableResult?.arrivalTime && Date.parse(availableResult.arrivalTime) === Date.parse(room?.votingArrivalTime ?? '') ? availableResult : null;
  const overlap = useMemo(() => {
    try { return { polygons: intersectAreas(result?.participantAreas.map(area => area.regions) ?? [], 0), failed: false }; }
    catch { return { polygons: [], failed: true }; }
  }, [result]);
  const displayed = useMemo(() => (result?.proposals ?? []).filter(proposal => venueTypes.has(proposal.venue.type)), [result, venueTypes]);
  const places = useMemo<RankedPlace[]>(() => (result?.proposals ?? []).filter(proposal => venueTypes.has(proposal.venue.type) || snapshot?.selections.some(selection => selection.venue.id === proposal.venue.id && selection.venue.type === proposal.venue.type))
    .map(proposal => ({ rank: proposal.rank, venue: proposal.venue, minutes: [], longest: proposal.longestMinutes, gap: proposal.gapMinutes })), [result, venueTypes, snapshot?.selections]);
  const cityRegions = useMemo(() => overlap.polygons.map(([outer, ...holes]) => ({ outer, holes })), [overlap.polygons]);
  const confirmedVenue = room?.confirmedPlan?.venue ?? null;
  const cityWaypoints = useMemo(() => meetingMapWaypoints(snapshot?.members ?? [], places, snapshot?.selections ?? [], draft, confirmedVenue), [snapshot?.members, snapshot?.selections, places, draft, confirmedVenue]);
  const myLat = snapshot?.me.at?.lat;
  const myLon = snapshot?.me.at?.lon;
  const mySource = snapshot?.me.source;
  const confirmedVersion = room?.confirmedPlan?.version;
  const budget = room?.timeBudget;
  useEffect(() => { setPassOpen(false); }, [confirmedVersion, myLat, myLon, budget]);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(COLLAPSIBLE_PANEL_QUERY);
    const restoreOnWideScreen = (event: MediaQueryListEvent) => {
      if (!event.matches) setLeftPanelOpen(true);
    };
    query.addEventListener('change', restoreOnWideScreen);
    return () => { query.removeEventListener('change', restoreOnWideScreen); };
  }, []);
  const myOrigin = useMemo<Origin | null>(() => myLat !== undefined && myLon !== undefined && mySource ? { at: { lat: myLat, lon: myLon }, source: mySource } : null, [myLat, myLon, mySource]);
  if (!snapshot || !room) return null;
  const { me, members, votes, selections } = snapshot;
  const individualTimesUnavailable = displayed.some(proposal => members.some(member => !(proposal.participantTrips ?? []).some(trip => trip.memberId === member.id && Number.isFinite(trip.minutes) && trip.minutes >= 0)));
  const located = members.filter(member => member.planningStatus === 'Ready').length;
  const myVote = votes.find(vote => vote.memberId === me.id);
  const selected = result?.proposals.find(proposal => proposal.venue.id === selectedId)
    ?? selections.find(selection => selection.venue.id === selectedId)
    ?? (confirmedVenue?.id === selectedId ? { venue: confirmedVenue } : null);
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
  const saveTime = () => run(async () => {
    const arrival = inputIso(arrivalInput);
    try { meetingPreviewStart(arrival, room.timeBudget); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Choose a valid meeting time.'); return; }
    await meeting.changeMeetingTime(arrival);
  }, 'Could not save the meeting time. Try again.');
  const toggleType = (type: VenueType) => setVenueTypes(current => {
    if (current.has(type) && current.size === 1) return current;
    const next = new Set(current);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  return <div className="meeting-map-page fixed inset-x-0 bottom-0 top-16 overflow-hidden bg-[#080f18]">
    <div className="absolute inset-0"><BaseMap origin={draft ?? myOrigin} showOriginPin={false} regions={null} cityRegions={showSharedArea ? cityRegions : []} sharedArea={showSharedArea} waypoints={cityWaypoints} cityFrameRequest={frameRequest} cityFocus={selected ? { lat: selected.venue.lat, lon: selected.venue.lon, label: selected.venue.name } : null} onMapClick={at => choose({ at, source: 'map', label: null })}>
      <SharedMeetingMap members={members} frameRequest={frameRequest} draft={draft} />
      {showSharedArea && !overlap.failed && <OverlapLayer polygons={overlap.polygons} />}
      <RankedPlaceMarkers places={places} selectedId={selectedId} onSelect={setSelectedId} selections={selections} confirmedId={room.confirmedPlan?.venue.id ?? null} confirmedVenue={confirmedVenue} memberPoints={members.flatMap(member => member.at ? [member.at] : [])} />
      <FocusOnPlace place={selected?.venue ?? null} />
      {canCompute && common.state.status === 'loading' && !result && <MeetingRadarLayer members={members} />}
    </BaseMap></div>
    <div className="meeting-status-pill absolute left-1/2 top-4 z-[480] flex -translate-x-1/2 items-center gap-1 rounded-full border border-teal-300/25 bg-[#0e1c29]/95 py-1.5 pl-4 pr-1.5 text-xs text-slate-200 shadow-xl backdrop-blur">
      <p className="flex items-center gap-1.5 whitespace-nowrap font-semibold">
        {room.confirmedPlan
          ? <><CheckCircle2 size={14} className="text-emerald-300" aria-hidden="true" />{room.confirmedPlan.venue.name} · <span className="tabular-nums">{shortTime(room.confirmedPlan.arrivalTime)}</span></>
          : canCompute ? 'Explore & vote' : `${located}/${members.length} ready`}
      </p>
      {result && !overlap.failed && <button type="button" aria-pressed={showSharedArea} onClick={() => setShowSharedArea(value => !value)} className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-teal-300/10 px-3 py-1.5 font-semibold text-teal-100 hover:bg-teal-300/20">
        {showSharedArea ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}Shared reachability
      </button>}
      <button type="button" onClick={() => setFrameRequest(value => value + 1)} className="btn-icon !h-7 !w-7" aria-label="Fit all members on the map" title="Show everyone"><Crosshair size={14} aria-hidden="true" /></button>
    </div>
    {!leftPanelOpen && <button type="button" onClick={() => setLeftPanelOpen(true)} className="meeting-left-toggle absolute left-4 top-4 z-[520] inline-flex items-center gap-2 rounded-full border border-[#315163] bg-[#0e1c29]/95 px-3 py-2 text-xs font-semibold text-slate-100 shadow-xl backdrop-blur" aria-label="Open members and meeting settings"><PanelLeftOpen size={16} aria-hidden="true" />Meeting details</button>}
    <aside hidden={!leftPanelOpen} className="meeting-left-panel absolute bottom-4 left-4 top-4 z-[510] w-[340px] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-5 text-slate-100 shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-3"><h1 className="text-xl font-bold text-white">Plan a group meeting</h1><button type="button" onClick={() => setLeftPanelOpen(false)} className="meeting-collapse-button btn-icon !h-8 !w-8" aria-label="Collapse meeting details"><PanelLeftClose size={16} aria-hidden="true" /></button></div><ShareLink code={room.code} />
      <div className="mt-4"><MyStartingPoint me={members.some(member => member.isSelf && member.planningStatus === 'Ready') ? me : { ...me, at: null }} draft={draft} notice={notice} busy={meeting.busy} onSelect={choose} onShare={() => void share()} onCancel={() => { setDraft(null); setNotice(null); }} onWithdraw={() => { setDraft(null); setNotice(null); void meeting.setMyPoint(null); }} /></div>
      <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Members · {located}/{members.length} ready</p>
      <ul className="space-y-2">{members.map(member => <li key={member.id} className="flex items-center gap-3 rounded-xl border-l-2 bg-[#192a38] p-3" style={{ borderLeftColor: memberColour(member.colourSlot) }}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white/80 text-xs font-bold text-[#08121d] shadow-md" style={{ background: memberColour(member.colourSlot) }}>{initials(member.displayName)}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{member.displayName}{member.isSelf && <span className="ml-1.5 text-xs font-medium text-slate-400">you</span>}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{member.at ? member.label ?? 'Selected map point' : 'Choose a starting point'}</p></div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${member.planningStatus === 'Ready' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>{member.planningStatus === 'Ready' ? '✓ Ready' : 'Not ready'}</span>
      </li>)}</ul>
      {room.isHost && <section className="mt-4 border-t border-[#294456] pt-4">
        <fieldset disabled={meeting.busy} className="space-y-3">
          <label className="block text-xs text-slate-300">Meeting time · MYT<input type="datetime-local" value={arrivalInput} onChange={event => setArrivalInput(event.target.value)} onBlur={() => { if (malaysiaInputTime(room.meetingTime) !== arrivalInput) void saveTime(); }} className="glass-input mt-1 w-full p-2 text-sm [color-scheme:dark]" /></label>
          <div><p className="mb-2 text-xs text-slate-300">Travel time budget</p><TimeBudgetSelector value={room.timeBudget} onChange={budget => void meeting.changeBudget(budget)} /></div>
        </fieldset>
        {room.planningStarted && <button type="button" onClick={() => void run(meeting.reopenPlanning, 'Could not reset votes. Try again.')} disabled={meeting.busy} className="mt-3 text-xs text-slate-300 underline">Reset votes</button>}
      </section>}
      {!room.planningStarted && <p role="status" className="mt-3 text-xs text-slate-300">{allReady ? Date.parse(room.meetingTime) - room.timeBudget * 60_000 <= Date.now() ? 'Update the meeting time to continue.' : 'Ready · preparing the shared area' : 'Calculates automatically when everyone is Ready.'}</p>}
      {allReady && Date.parse(room.meetingTime) - room.timeBudget * 60_000 <= Date.now() && <p role="alert" className="mt-3 text-xs text-amber-200">Choose a later meeting time to allow the full travel budget.</p>}
      {room.votingArrivalTime && room.planningStarted && <p className="mt-3 text-xs text-slate-300">Meet: {formatTime(room.votingArrivalTime)} MYT · Travel budget {room.timeBudget} min</p>}
      {result?.departureTime && <details className="mt-3 text-xs leading-relaxed text-slate-400"><summary className="cursor-pointer">About the map preview</summary><p className="mt-2">A conservative OTP preview starting at {formatTime(result.departureTime)} MYT, one budget before the meeting. Not every possible departure is shown. Listed places also pass individual arrive-by route checks.</p></details>}
      {meeting.error && <p role="alert" className="mt-3 text-sm text-rose-300">{ROOM_ERROR_MESSAGES[meeting.error]}</p>}
      <button type="button" onClick={() => void meeting.leave()} disabled={meeting.busy} className="btn-secondary mt-4 w-full">Leave room</button>
    </aside>
    <aside className="meeting-places-panel absolute bottom-4 right-4 top-4 z-[510] w-[370px] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-5 text-slate-100 shadow-2xl backdrop-blur-xl">
      {room.confirmedPlan && <section className="mb-4 rounded-xl border border-emerald-300/40 bg-emerald-400/10 p-4" role="status">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300"><CheckCircle2 size={14} aria-hidden="true" />Chosen by group vote</p><h2 className="mt-2 text-xl font-bold text-white">{room.confirmedPlan.venue.name}</h2><p className="mt-1 text-sm text-slate-200"><span className="tabular-nums">{formatTime(room.confirmedPlan.arrivalTime)}</span> MYT</p>
        <button type="button" disabled={!me.at || draft !== null || meeting.busy} className="btn-primary mt-4 w-full" onClick={() => setPassOpen(true)}>Generate my travel pass</button>
        {draft && <p className="mt-2 text-xs text-amber-200">Share or cancel your preview before generating a pass.</p>}
      </section>}
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold text-white">Common places</h2>
        {common.state.status === 'ready' && result && <span aria-label="Verified places in this shortlist" className="shrink-0 text-xs tabular-nums text-teal-200">{displayed.length} verified</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Venue types">{VENUE_TYPES.map(option => <button key={option.id} type="button" aria-pressed={venueTypes.has(option.id)} onClick={() => toggleType(option.id)} className={`rounded-lg border px-2 py-1.5 text-xs ${venueTypes.has(option.id) ? 'border-teal-300 text-teal-100' : 'border-[#315163] text-slate-300'}`}>{option.label}</button>)}</div>
      {!allReady && <p role="status" className="mt-4 text-sm">Waiting for everyone to share a start.</p>}
      {canCompute && common.state.status === 'loading' && <p role="status" className="mt-4 text-sm text-teal-200">{common.loadingMore ? 'Finding more verified places…' : result?.status === 'ready' ? 'Checking selected types…' : result ? overlap.polygons.length ? 'Shared area ready. Still finding places…' : 'Areas calculated. Still checking places…' : 'Finding your shared area and places…'}</p>}
      {common.state.status === 'failed' && <div role="alert" className="mt-4 text-sm text-rose-300">{common.state.message ?? 'Common-ground calculation is unavailable.'}<button type="button" onClick={common.state.restartRequired ? common.restart : common.retry} className="btn-secondary mt-2 flex items-center gap-2"><RefreshCw size={14} />{common.state.restartRequired ? 'Restart search' : 'Retry'}</button></div>}
      {overlap.failed && <p role="alert" className="mt-4 text-sm text-rose-300">The shared boundary could not be calculated. Retry before voting.</p>}
      {result?.status === 'no_common_ground' && <p className="mt-4 text-sm">{result.hasMore ? 'No verified matches yet. Find more places to check another batch.' : 'No venue in this screened shortlist fits everyone’s arrive-by budget. Try another meeting time or budget.'}</p>}
      {common.state.status === 'ready' && result?.status === 'ready' && displayed.length === 0 && <p role="status" className="mt-4 text-sm text-slate-300">No verified places for the selected types in this shortlist. Try another type, meeting time or travel budget.</p>}
      {result?.status === 'waiting_for_origins' && <p role="status" className="mt-4 text-sm">Waiting for {result.missingStartingPoints} saved starting point(s). No partial group result is shown.</p>}
      {result?.status === 'waiting_for_participants' && <p role="status" className="mt-4 text-sm">At least two participants are needed.</p>}
      {result?.status === 'waiting_for_planning' && <p role="status" className="mt-4 text-sm">Updating the room…</p>}
      {room.voteStatus === 'tie' && <p role="status" className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">The vote is tied. Discuss and change a vote; no venue is confirmed.</p>}
      {room.planningStarted && <p role="status" className="mt-3 text-xs text-teal-200">{votes.length}/{members.length} voted{room.votingArrivalTime ? ` · Arrival ${formatTime(room.votingArrivalTime)} MYT` : ''}</p>}
      {individualTimesUnavailable && <p className="mt-2 text-xs text-slate-400">Individual travel times are unavailable; showing the group summary.</p>}
      <div className="mt-4 space-y-3">{displayed.map(proposal => {
        const voters = votes.filter(vote => vote.venue.id === proposal.venue.id && vote.venue.type === proposal.venue.type);
        const proposers = selections.filter(selection => selection.venue.id === proposal.venue.id && selection.venue.type === proposal.venue.type);
        const chosen = room.confirmedPlan?.venue.id === proposal.venue.id;
        const participantTrips = members.map(member => {
          const trip = (proposal.participantTrips ?? []).find(value => value.memberId === member.id);
          return trip && Number.isFinite(trip.minutes) && trip.minutes >= 0 ? { member, minutes: trip.minutes } : null;
        });
        const verifiedTrips = participantTrips.every(Boolean) ? participantTrips as Array<{ member: typeof members[number]; minutes: number }> : null;
        return <section key={`${proposal.venue.type}:${proposal.venue.id}`} className={`rounded-xl border p-3 transition-opacity ${chosen ? 'border-emerald-300/60 bg-emerald-400/10' : selectedId === proposal.venue.id ? 'border-teal-300 bg-[#213844]' : 'border-[#294456] bg-[#192a38]'} ${(room.confirmedPlan && !chosen && selectedId !== proposal.venue.id) || (selectedId && selectedId !== proposal.venue.id) ? 'opacity-55 hover:opacity-100' : ''}`}>
          <button type="button" className="w-full text-left" onClick={() => setSelectedId(proposal.venue.id)} aria-pressed={selectedId === proposal.venue.id}>
            <span className="flex items-center justify-between gap-2"><strong className="text-sm">{proposal.rank}. {proposal.venue.name}</strong>
              {chosen ? <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-1 text-xs font-semibold text-emerald-300">Chosen</span>
                : voters.length > 0 && <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-300"><span className="flex -space-x-1.5">{voters.map(voter => <span key={voter.memberId} title={voter.displayName} aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-[#0e1c29] text-[9px] font-bold text-[#08121d]" style={{ background: memberColour(members.find(member => member.id === voter.memberId)?.colourSlot) }}>{initials(voter.displayName)}</span>)}</span>{voters.length} {voters.length === 1 ? 'vote' : 'votes'}</span>}
            </span>
            <span className="mt-1 block text-xs text-slate-400">{proposal.venue.kindLabel} · farthest traveller <span className="tabular-nums text-slate-200">{proposal.longestMinutes} min</span>{proposal.gapMinutes > 0 && <> · <span className="tabular-nums">{proposal.gapMinutes} min spread</span></>}</span>
            {!verifiedTrips && <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[#0e1c29]" aria-hidden="true"><span className="block h-full rounded-full bg-slate-300/50" style={{ width: `${Math.min(100, (proposal.longestMinutes / Math.max(1, room.timeBudget)) * 100)}%` }} /></span>}
          </button>
          {verifiedTrips && <ul className="mt-3 space-y-2" aria-label="Verified travel time for each member">{verifiedTrips.map(({ member, minutes }) => <li key={member.id} className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-[11px] text-slate-300"><span className="truncate">{member.displayName}</span><span className="h-1.5 overflow-hidden rounded-full bg-[#0e1c29]"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (minutes / Math.max(1, room.timeBudget)) * 100)}%`, background: memberColour(member.colourSlot) }} /></span><span className="tabular-nums">{minutes} min</span></li>)}</ul>}
          {proposers.length > 0 && <p className="mt-2 text-xs text-slate-300">Proposed by {proposers.map(person => person.displayName).join(', ')}</p>}
          {voters.length > 0 && <p className="mt-1 text-xs text-slate-400">Voted: {voters.map(person => person.displayName).join(', ')}</p>}
          {!room.confirmedPlan && <div className="mt-3 flex gap-2">
            <button type="button" disabled={meeting.busy || overlap.failed} className="btn-secondary flex-1 text-xs" onClick={() => void run(async () => { await meeting.proposeVenue(proposal.venue); setSelectedId(proposal.venue.id); }, 'The proposal was not shared. Reload and try again.')}>Propose</button>
            <button type="button" disabled={meeting.busy || overlap.failed} aria-pressed={myVote?.venue.id === proposal.venue.id} className="btn-primary flex flex-1 items-center justify-center gap-1 text-xs" onClick={() => void run(() => meeting.vote(proposal.venue), 'Your vote was not saved. The round may have changed; reload and try again.')}><Vote size={14} />{myVote?.venue.id === proposal.venue.id ? '✓ Your vote' : myVote ? 'Change vote' : 'Vote'}</button>
          </div>}
        </section>;
      })}</div>
      {!room.confirmedPlan && result && common.loadMore && <div className="mt-4">
        {(result.hasMore || categorySearchPending) && <button type="button" disabled={common.state.status !== 'ready'} onClick={() => common.loadMore?.(venueTypes)} className="btn-secondary w-full">{common.loadingMore ? 'Finding more…' : categorySearchPending ? 'Search selected types' : 'Find more places'}</button>}
        {common.state.status === 'ready' && !categorySearchPending && result.hasMore === false && <p role="status" className="text-xs text-slate-400">{result.searchLimitReached ? 'Search limit reached. Narrow the place types to continue.' : 'All candidates in this screened set checked. Try other types or meeting times.'}</p>}
      </div>}
      {actionError && <p role="alert" className="mt-3 text-sm text-rose-300">{actionError}</p>}
      <details className="mt-4 text-xs leading-relaxed text-slate-400"><summary className="cursor-pointer">How it works</summary><p className="mt-2">Propose highlights a place; Vote chooses it. Everyone must vote, with one unique highest count. Changing members, origins, time or budget resets votes. Ranked within the checked shortlist by longest trip, then time gap. This is not a count of all reachable places. Larger budgets also change the map preview’s departure time. Individual colours are shown in 2D; the 3D view shows the shared area. Routes and the shared boundary are estimates; hours are not guaranteed.</p></details>
    </aside>
    {passOpen && room.confirmedPlan && myOrigin && <MeetingTravelPass key={`${room.confirmedPlan.version}:${myOrigin.at.lat}:${myOrigin.at.lon}:${room.timeBudget}`} code={room.code} memberId={me.userId} plan={room.confirmedPlan} origin={{ ...myOrigin, label: me.label }} budget={room.timeBudget} onClose={closePass} />}
  </div>;
}
