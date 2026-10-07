import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, LockKeyhole, MapPin, RefreshCw, Users } from 'lucide-react';
import { BaseMap, TimeBudgetSelector } from '@/features/reachability';
import { isInStudyArea } from '@/features/reachability/reachabilityService';
import type { Origin } from '@/features/reachability/types';
import { GroupOutingView } from '@/features/outing-pass/components/GroupOutingView';
import { malaysiaInputTime } from '@/features/outing-pass/components/passPresentation';
import { FocusOnPlace, RankedPlaceMarkers } from './components/RankedPlaceMarkers';
import { MyStartingPoint } from './components/MyStartingPoint';
import { RoomLobby } from './components/RoomLobby';
import { ShareLink } from './components/ShareLink';
import type { RankedPlace } from './fairnessRanking';
import { useMeetingRoom } from './hooks/useMeetingRoom';
import { useServerCommonGround } from './hooks/useServerCommonGround';
import {
  ROOM_ERROR_MESSAGES,
  type MeetingRoom,
  type Participant,
  type SharedMemberStatus,
  type StartingPoint,
} from './types';
import { VENUE_TYPES, type VenueType } from './venueService';

const OUTSIDE_AREA = 'Selected point is outside the covered area';
const PLACE_OUTSIDE_AREA = 'That place is outside the covered area';
const ALL_VENUE_TYPES = new Set<VenueType>(VENUE_TYPES.map(option => option.id));

function defaultArrivalTime(): string {
  const date = new Date(Date.now() + (2 + 8) * 60 * 60 * 1000);
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 15) * 15, 0, 0);
  return date.toISOString().slice(0, 16);
}

function asLocalInput(iso: string): string {
  return malaysiaInputTime(iso);
}

function formatArrival(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function statusClasses(status: SharedMemberStatus['arrivalStatus']): string {
  if (status === 'Ready') return 'bg-teal-400/10 text-teal-200';
  if (status === 'Check needed') return 'bg-amber-400/10 text-amber-200';
  return 'bg-slate-500/15 text-slate-300';
}

/** Shared room planning and the confirmed group invitation for MD8-6. */
export function MeetingPointPage() {
  const meeting = useMeetingRoom();
  const [planningMode, setPlanningMode] = useState(false);

  if (meeting.view.status === 'ready' && meeting.view.room.confirmedPlan && !planningMode) {
    return (
      <GroupOutingView
        room={meeting.view.room}
        me={meeting.view.me}
        members={meeting.view.members}
        onBack={() => setPlanningMode(true)}
        onSuggestTime={async (arrivalTime: string) => {
          await meeting.suggestTime(arrivalTime);
          setPlanningMode(true);
        }}
        onPublishStatus={meeting.publishStatus}
      />
    );
  }

  if (meeting.view.status === 'ready') {
    return (
      <MeetingPlanner
        meeting={meeting}
        room={meeting.view.room}
        me={meeting.view.me}
        members={meeting.view.members}
        onConfirmed={() => setPlanningMode(false)}
        onOpenConfirmed={() => setPlanningMode(false)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#080f18] px-4 pb-24 pt-24 text-slate-100 md:px-6 md:pb-8">
      <header className="mx-auto mb-8 max-w-5xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
          <Users size={18} aria-hidden="true" />
          Meet up
        </div>
        <h1 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl">Find somewhere everyone can reach.</h1>
        <p className="mt-3 max-w-3xl text-slate-300">
          Share a room link. Each person adds their own starting point, while private coordinates stay hidden from the group.
        </p>
      </header>

      <div className="mx-auto max-w-5xl">
        {meeting.view.status === 'unconfigured' && (
          <section className="glass max-w-xl p-6 text-sm text-slate-300">Shared rooms are not set up on this deployment.</section>
        )}
        {meeting.view.status === 'checking' && (
          <section role="status" className="glass max-w-xl p-6 text-sm text-slate-300">
            Opening room <span className="font-mono tracking-wider">{meeting.view.code}</span>…
          </section>
        )}
        {meeting.view.status === 'lobby' && (
          <RoomLobby
            invitedCode={meeting.view.invitedCode}
            invitation={meeting.view.invitation}
            busy={meeting.busy}
            error={meeting.error}
            onCreate={nickname => void meeting.create(nickname)}
            onJoin={(code, nickname) => void meeting.join(code, nickname)}
          />
        )}
      </div>
    </main>
  );
}

type MeetingHook = ReturnType<typeof useMeetingRoom>;

function MeetingPlanner({
  meeting,
  room,
  me,
  members,
  onConfirmed,
  onOpenConfirmed,
}: {
  meeting: MeetingHook;
  room: MeetingRoom;
  me: Participant;
  members: SharedMemberStatus[];
  onConfirmed: () => void;
  onOpenConfirmed: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [venueTypes, setVenueTypes] = useState<ReadonlySet<VenueType>>(ALL_VENUE_TYPES);
  const [selectedId, setSelectedId] = useState<string | null>(room.confirmedPlan?.venue.id ?? null);
  const [arrivalInput, setArrivalInput] = useState(() => {
    const value = room.proposedArrivalTime ?? room.confirmedPlan?.arrivalTime;
    return value ? asLocalInput(value) : defaultArrivalTime();
  });
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const common = useServerCommonGround(room.code, room.timeBudget, venueTypes, String(room.planningRevision));

  const proposals = useMemo(
    () => common.state.status === 'ready' ? common.state.result.proposals : [],
    [common.state],
  );
  const rankedPlaces = useMemo<RankedPlace[]>(
    () => proposals.map(proposal => ({
      venue: proposal.venue,
      minutes: [],
      longest: proposal.longestMinutes,
      gap: proposal.gapMinutes,
    })),
    [proposals],
  );
  const selected = proposals.find(proposal => proposal.venue.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && proposals.some(proposal => proposal.venue.id === selectedId)) return;
    setSelectedId(proposals[0]?.venue.id ?? null);
  }, [proposals, selectedId]);

  useEffect(() => {
    if (room.proposedArrivalTime) setArrivalInput(asLocalInput(room.proposedArrivalTime));
  }, [room.proposedArrivalTime]);

  const myOrigin = useMemo<Origin | null>(() => {
    if (!me.at || !me.source) return null;
    return { at: me.at, source: me.source };
  }, [me.at, me.source]);

  const choose = (point: StartingPoint) => {
    if (!isInStudyArea(point.at)) {
      setNotice(point.source === 'map' ? OUTSIDE_AREA : PLACE_OUTSIDE_AREA);
      return;
    }
    setNotice(null);
    void meeting.setMyPoint(point);
  };

  const toggleVenueType = (type: VenueType) => {
    setVenueTypes(current => {
      if (current.has(type) && current.size === 1) return current;
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const confirm = async () => {
    if (!selected || !arrivalInput) return;
    const arrival = new Date(`${arrivalInput}:00+08:00`);
    if (Number.isNaN(arrival.getTime()) || arrival.getTime() <= Date.now()) {
      setConfirmError('Choose an arrival time in the future.');
      return;
    }
    setConfirmError(null);
    try {
      await meeting.confirmPlan(selected.venue, arrival.toISOString());
      onConfirmed();
    } catch {
      setConfirmError('The plan could not be confirmed. Refresh the room and try again.');
    }
  };

  const readyResult = common.state.status === 'ready' ? common.state.result : null;
  const locatedCount = readyResult ? readyResult.participantCount - readyResult.missingStartingPoints : null;

  return (
    <div className="fixed left-0 right-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] overflow-hidden bg-[#080f18] md:bottom-0">
      <div className="absolute inset-0">
        <BaseMap origin={myOrigin} regions={null} onMapClick={at => choose({ at, source: 'map', label: null })}>
          <RankedPlaceMarkers places={rankedPlaces} selectedId={selectedId} onSelect={setSelectedId} />
          <FocusOnPlace place={selected?.venue ?? null} />
        </BaseMap>
      </div>

      {selected && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[480] hidden -translate-x-1/2 rounded-xl border border-teal-300/20 bg-[#0e1c29]/95 px-4 py-3 shadow-2xl backdrop-blur lg:block">
          <p className="font-semibold text-white">{selected.venue.name}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-teal-200">
            <Clock3 size={13} aria-hidden="true" /> {arrivalInput ? formatArrival(`${arrivalInput}:00+08:00`) : 'Choose an arrival time'}
          </p>
        </div>
      )}

      <aside className="absolute left-2 right-2 top-2 z-[500] max-h-[38%] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-4 shadow-2xl backdrop-blur-xl sm:left-4 sm:right-auto sm:w-[340px] lg:bottom-4 lg:max-h-none">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded bg-teal-300 px-2 py-1 font-mono text-[10px] font-bold tracking-wider text-[#062c2b]">ROOM {room.code}</span>
          {room.confirmedPlan && (
            <button type="button" onClick={onOpenConfirmed} className="text-xs font-semibold text-teal-200 hover:text-white">
              Open plan v{room.confirmedPlan.version}
            </button>
          )}
        </div>
        <h1 className="mt-3 text-xl font-bold text-white">Plan a group meeting</h1>
        <ShareLink code={room.code} />

        <div className="mt-4">
          <MyStartingPoint
            me={me}
            notice={notice}
            onSearchSelect={choose}
            onClear={() => {
              setNotice(null);
              void meeting.setMyPoint(null);
            }}
          />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{members.length} group members</p>
          <div className="space-y-2">
            {members.map(member => (
              <div key={member.id} className="flex items-center justify-between gap-2 rounded-xl bg-[#192a38] p-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-300/10 text-xs font-bold text-teal-200">
                    {initials(member.displayName)}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-100">{member.displayName}{member.isSelf ? ' (you)' : ''}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses(member.arrivalStatus)}`}>
                  {member.arrivalStatus}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-[#192a38] p-3 text-xs leading-relaxed text-slate-300">
          {locatedCount === null ? 'Checking shared readiness…' : `${locatedCount} of ${readyResult?.participantCount} starting points are ready.`}
        </div>
        <div className="mt-3 flex gap-2 rounded-xl border border-teal-300/15 bg-[#132637] p-3 text-xs leading-relaxed text-slate-300">
          <LockKeyhole size={17} className="mt-0.5 shrink-0 text-teal-200" aria-hidden="true" />
          <span>Only you can retrieve your starting point. The room receives names and coarse arrival status; group ranking runs behind the authenticated server boundary.</span>
        </div>

        {meeting.error && <p role="alert" className="mt-3 text-sm text-rose-300">{ROOM_ERROR_MESSAGES[meeting.error]}</p>}
        <button type="button" className="btn-secondary mt-4 w-full" disabled={meeting.busy} onClick={() => void meeting.leave()}>Leave room</button>
      </aside>

      <aside className="absolute bottom-2 left-2 right-2 z-[510] max-h-[55%] overflow-y-auto rounded-2xl border border-[#294456] bg-[#0e1c29]/95 p-4 shadow-2xl backdrop-blur-xl sm:left-4 sm:right-4 lg:bottom-4 lg:left-auto lg:top-4 lg:max-h-none lg:w-[400px] lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Fairest places to meet</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Ranked on the server by the longest trip, then the smallest travel-time gap.</p>
          </div>
          {common.state.status === 'failed' && (
            <button type="button" onClick={common.retry} className="btn-icon" aria-label="Retry meeting-place ranking"><RefreshCw size={17} /></button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Venue types">
          {VENUE_TYPES.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={venueTypes.has(option.id)}
              onClick={() => toggleVenueType(option.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${venueTypes.has(option.id) ? 'border-teal-300 bg-teal-300/15 text-teal-100' : 'border-[#315163] bg-[#132637] text-slate-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {common.state.status === 'loading' && <p role="status" className="text-sm text-slate-300">Calculating common ground securely…</p>}
          {common.state.status === 'failed' && <p role="alert" className="text-sm text-rose-300">Shared ranking is unavailable. No result has been guessed.</p>}
          {readyResult?.status === 'waiting_for_origins' && (
            <p className="rounded-xl bg-[#192a38] p-3 text-sm text-slate-300">Waiting for {readyResult.missingStartingPoints} member{readyResult.missingStartingPoints === 1 ? '' : 's'} to add a starting point.</p>
          )}
          {readyResult?.status === 'waiting_for_participants' && (
            <p className="rounded-xl bg-[#192a38] p-3 text-sm text-slate-300">Invite at least one more person before calculating fair meeting places.</p>
          )}
          {readyResult?.status === 'no_common_ground' && (
            <p className="rounded-xl bg-[#192a38] p-3 text-sm text-slate-300">No shared place fits the current {room.timeBudget}-minute budget.</p>
          )}
          {proposals.map(proposal => {
            const active = proposal.venue.id === selectedId;
            return (
              <button
                key={proposal.venue.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(proposal.venue.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${active ? 'border-teal-300 bg-[#213844] shadow-lg shadow-teal-500/5' : 'border-transparent bg-[#192a38] hover:border-[#3c5b6c]'}`}
              >
                <span className="flex items-start gap-3">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${active ? 'bg-teal-300 text-[#062c2b]' : 'bg-[#2e3d49] text-slate-200'}`}>{proposal.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm text-white">{proposal.venue.name}</strong>
                      {active && <Check size={16} className="shrink-0 text-teal-200" aria-hidden="true" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{proposal.venue.kindLabel}</span>
                    <span className="mt-2 grid grid-cols-2 gap-2">
                      <span className="rounded-lg bg-[#101f2b] p-2"><span className="block text-[10px] text-slate-400">Longest trip</span><strong className="text-sm text-teal-200">{proposal.longestMinutes} min</strong></span>
                      <span className="rounded-lg bg-[#101f2b] p-2"><span className="block text-[10px] text-slate-400">Time difference</span><strong className="text-sm text-slate-200">{proposal.gapMinutes} min</strong></span>
                    </span>
                    <span className="mt-2 flex items-center gap-1 text-[11px] text-slate-400"><MapPin size={12} />{proposal.venue.hours ? proposal.venue.hours : 'Hours unknown'}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t border-[#294456] pt-4">
          <label htmlFor="meeting-arrival" className="text-xs font-bold uppercase tracking-wider text-slate-400">Agreed arrival target</label>
          {room.proposedArrivalTime && (
            <p className="mt-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100">Suggested: {formatArrival(room.proposedArrivalTime)}. It changes the plan only after someone confirms it.</p>
          )}
          <input
            id="meeting-arrival"
            type="datetime-local"
            value={arrivalInput}
            onChange={event => setArrivalInput(event.target.value)}
            className="glass-input mt-2 w-full px-3 py-2.5 text-sm text-slate-100 [color-scheme:dark]"
          />
          <div className="mt-3">
            <p className="mb-2 text-xs font-bold text-slate-300">Travel time budget</p>
            <TimeBudgetSelector value={room.timeBudget} onChange={budget => void meeting.changeBudget(budget)} />
          </div>
          {(confirmError || meeting.error) && <p role="alert" className="mt-3 text-sm text-rose-300">{confirmError ?? ROOM_ERROR_MESSAGES[meeting.error!]}</p>}
          <button type="button" className="btn-primary mt-4 flex w-full items-center justify-center gap-2" disabled={!selected || !arrivalInput || meeting.busy} onClick={() => void confirm()}>
            <Check size={18} aria-hidden="true" />
            {meeting.busy ? 'Confirming…' : 'Confirm for everyone'}
          </button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-400">
            This creates plan v{(room.confirmedPlan?.version ?? 0) + 1}. Earlier personal passes become outdated.
          </p>
        </div>
      </aside>
    </div>
  );
}
