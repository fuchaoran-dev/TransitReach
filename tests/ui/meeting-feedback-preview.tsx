/* eslint-disable react-refresh/only-export-components -- Standalone local QA entry, not a Fast Refresh module. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeDatabaseData } from '@/shared/data/databaseData';
import type { MeetingRoomSnapshot } from '@/features/meeting-point/roomService';
import type { CommonGroundResult } from '@/features/meeting-point/commonGroundService';
import type { StartingPoint } from '@/features/meeting-point/types';
import '@/index.css';

let MeetingPlanner: typeof import('@/features/meeting-point/MeetingPointPage').MeetingPlanner;

// Deliberate local-only room fixture, NOT evidence of live sharing, geometry or voting.
const meetingDay = new Date(Date.now() + 24 * 3600_000);
meetingDay.setUTCHours(10, 30, 0, 0);
const arrival = meetingDay.toISOString();
const previewStart = new Date(Date.parse(arrival) - 30 * 60_000).toISOString();
const start: StartingPoint = { at: { lat: 3.13442, lon: 101.68625 }, source: 'stop', label: 'KL Sentral' };
const venue = { id: 'fixture-station', type: 'station' as const, name: 'Pasar Seni', kindLabel: 'Rail station', lat: 3.14221, lon: 101.69527 };
function snapshot(confirmed = false): MeetingRoomSnapshot {
  return { room: { code: 'DEMN2345', timeBudget: 30, meetingTime: arrival, planningRevision: 1, planningStarted: true, isHost: true,
    departureTime: previewStart, votingArrivalTime: arrival, expiresAt: new Date(Date.parse(arrival) + 24 * 3600_000).toISOString(), updatedAt: new Date().toISOString(), voteStatus: confirmed ? 'confirmed' : 'waiting', proposedArrivalTime: null,
    confirmedPlan: confirmed ? { version: 1, venue, arrivalTime: arrival } : null },
    me: { id: 'self-fixture', userId: 'local-ui-fixture-only', nickname: 'Aina', ...start, source: start.source, colourSlot: 0, arrivalStatus: 'Not checked', checkedPlanVersion: null },
    members: [{ id: 'self-fixture', displayName: 'Aina', isSelf: true, at: start.at, label: start.label, colourSlot: 0, planningStatus: 'Ready', arrivalStatus: 'Not checked' },
      { id: 'peer-fixture', displayName: 'Ming', isSelf: false, at: venue, label: venue.name, colourSlot: 1, planningStatus: 'Ready', arrivalStatus: 'Not checked' }],
    selections: [], votes: confirmed ? [{ memberId: 'self-fixture', displayName: 'Aina', venue, arrivalTime: arrival }, { memberId: 'peer-fixture', displayName: 'Ming', venue, arrivalTime: arrival }] : [] };
}
const result: CommonGroundResult = { status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, roomRevision: 1,
  departureTime: previewStart, arrivalTime: arrival, areaMethod: 'budget-window-preview', participantAreas: [
    { memberId: 'self-fixture', regions: [{ outer: [[101.68,3.13],[101.70,3.13],[101.70,3.15],[101.68,3.15],[101.68,3.13]], holes: [] }] },
    { memberId: 'peer-fixture', regions: [{ outer: [[101.69,3.135],[101.71,3.135],[101.71,3.155],[101.69,3.155],[101.69,3.135]], holes: [] }] },
  ],
  proposals: [{ rank: 1, venue, longestMinutes: 15, gapMinutes: 5, participantTrips: [{ memberId: 'self-fixture', minutes: 10 }, { memberId: 'peer-fixture', minutes: 15 }] }] };
function Preview() {
  const [state, setState] = useState(() => snapshot());
  const [mode, setMode] = useState(0);
  const [loading, setLoading] = useState(false);
  const selectMode = (confirmed: boolean, pending = false) => { setState(snapshot(confirmed)); setLoading(pending); setMode(value => value + 1); };
  const meeting = { view: { status: 'ready' as const, ...state }, busy: false, error: null,
    setMyPoint: async (point: StartingPoint | null) => {
      setState(current => ({ ...current, me: { ...current.me!, at: point?.at ?? null, source: point?.source ?? null, label: point?.label ?? null },
        members: current.members.map(member => member.isSelf ? { ...member, at: point?.at ?? null, label: point?.label ?? null, planningStatus: point ? 'Ready' : 'Not ready' } : member) }));
      return true;
    }, changeBudget: async () => {}, changeMeetingTime: async () => {}, leave: async () => {}, startPlanning: async () => {}, reopenPlanning: async () => {},
    proposeVenue: async () => { setState(current => ({ ...current, selections: [{ memberId: 'self-fixture', displayName: 'Aina', venue }] })); }, vote: async () => {},
  };
  return <div className="transit-shell"><header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between bg-[#080f18] px-6 text-xs text-amber-200">
    <span>UI FIXTURE ONLY · No cloud writes · No real votes/areas · Pass button may query actual OTP using public stations</span>
    <div className="flex gap-3"><button onClick={() => selectMode(false)}>Shared starts</button><button onClick={() => selectMode(false,true)}>Calculating</button><button onClick={() => selectMode(true)}>Confirmed meeting</button></div>
  </header><MeetingPlanner key={mode} meeting={meeting} commonGround={{ state: loading ? { status: 'loading' } : { status: 'ready', result }, retry() {} }} /></div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<p className="p-6" role="status">UI fixture · Loading actual PostgreSQL search/reference data…</p>);
void initializeDatabaseData().then(async () => {
  ({ MeetingPlanner } = await import('@/features/meeting-point/MeetingPointPage'));
  root.render(<Preview />);
}).catch(() => root.render(<p role="alert">Actual PostgreSQL bootstrap is unavailable. No JSON fallback is used.</p>));
