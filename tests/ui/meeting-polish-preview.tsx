import { createRoot } from 'react-dom/client';
import type { CommonGroundResult } from '@/features/meeting-point/commonGroundService';
import type { MeetingRoomSnapshot } from '@/features/meeting-point/roomService';
import { initializeDatabaseData } from '@/shared/data/databaseData';
import '@/index.css';

const meetingDate = new Date(Date.now() + 24 * 3600_000);
meetingDate.setMinutes(28, 0, 0);
const arrival = meetingDate.toISOString();
const departure = new Date(meetingDate.getTime() - 30 * 60_000).toISOString();
const members = [
  { id: 'fixture-a', displayName: 'Aina', isSelf: true, at: { lat: 3.0738, lon: 101.5898 }, label: 'USJ 7', colourSlot: 0, planningStatus: 'Ready' as const, arrivalStatus: 'Not checked' as const },
  { id: 'fixture-b', displayName: 'Ming', isSelf: false, at: { lat: 3.0572, lon: 101.5851 }, label: 'Subang Mewah', colourSlot: 1, planningStatus: 'Ready' as const, arrivalStatus: 'Not checked' as const },
];
const venues = [
  ['bayu', 'cafe', 'Bayu Cafe', 'Café', 3.0650, 101.5930, 10, 0],
  ['mcd', 'restaurant', "McDonald's", 'Fast food', 3.0654, 101.5934, 10, 2],
  ['mewah', 'cafe', "D'Mewah Café", 'Café', 3.0657, 101.5931, 11, 3],
  ['mall', 'mall', 'The Summit', 'Mall', 3.0662, 101.5928, 12, 4],
  ['station', 'station', 'USJ 7', 'Rail station', 3.0647, 101.5925, 12, 5],
  ['food', 'restaurant', 'Subang Kitchen', 'Restaurant', 3.0660, 101.5937, 13, 5],
] as const;

const snapshot: MeetingRoomSnapshot = {
  room: { code: 'DEMN2345', timeBudget: 30, meetingTime: arrival, planningRevision: 1, planningStarted: true, isHost: true, departureTime: departure, votingArrivalTime: arrival, expiresAt: new Date(meetingDate.getTime() + 24 * 3600_000).toISOString(), updatedAt: new Date().toISOString(), voteStatus: 'waiting', proposedArrivalTime: null, confirmedPlan: null },
  me: { id: members[0].id, userId: 'fixture-user', nickname: 'Aina', at: members[0].at, source: 'stop', label: members[0].label, colourSlot: 0, arrivalStatus: 'Not checked', checkedPlanVersion: null },
  members,
  selections: [],
  votes: [],
};
const result: CommonGroundResult = {
  status: 'ready', participantCount: 2, missingStartingPoints: 0, budgetMinutes: 30, roomRevision: 1,
  departureTime: departure, arrivalTime: arrival, areaMethod: 'budget-window-preview',
  participantAreas: [
    { memberId: members[0].id, regions: [{ outer: [[101.575,3.05],[101.61,3.05],[101.61,3.085],[101.575,3.085],[101.575,3.05]], holes: [] }] },
    { memberId: members[1].id, regions: [{ outer: [[101.58,3.045],[101.615,3.045],[101.615,3.08],[101.58,3.08],[101.58,3.045]], holes: [] }] },
  ],
  proposals: venues.map(([id, type, name, kindLabel, lat, lon, longestMinutes, gapMinutes], index) => ({ rank: index + 1, venue: { id, type, name, kindLabel, lat, lon }, longestMinutes, gapMinutes, participantTrips: [{ memberId: members[1].id, minutes: longestMinutes }, { memberId: members[0].id, minutes: longestMinutes - gapMinutes }] })),
};
const meeting = {
  view: { status: 'ready' as const, ...snapshot }, busy: false, error: null,
  setMyPoint: async () => true, changeBudget: async () => {}, changeMeetingTime: async () => {}, leave: async () => {}, reopenPlanning: async () => {}, proposeVenue: async () => {}, vote: async () => {},
};

async function start() {
  const root = createRoot(document.getElementById('root')!);
  const originalFetch = window.fetch;
  window.fetch = async input => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.endsWith('/api/data/bootstrap')) return originalFetch(input);
    return new Response(JSON.stringify({
      railStops: [], busStops: [], places: [], essentialServices: [], railPatterns: [], railShapes: {},
      railMetadata: { feeds: [], epicLineCoverage: [], modesNotLoaded: [], studyAreaFeedExtent: { minLat: 3, maxLat: 3.2, minLon: 101.5, maxLon: 101.8 }, notes: [], warnings: [] },
      placesMetadata: { generatedAt: 'fixture', source: 'Synthetic UI fixture', licence: 'Not applicable', placeCount: 0 },
      servicesMetadata: { generatedAt: 'fixture', source: 'Synthetic UI fixture', licence: 'Not applicable', bbox: { minLat: 3, maxLat: 3.2, minLon: 101.5, maxLon: 101.8 }, recordCount: 0 },
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await initializeDatabaseData();
    const { MeetingPlanner } = await import('@/features/meeting-point/MeetingPointPage');
    root.render(<div className="transit-shell">
      <header className="fixed inset-x-0 top-0 z-[1500] flex h-16 items-center bg-[#080f18] px-5 text-xs font-semibold text-amber-200">SYNTHETIC UI FIXTURE · No database, room, vote or route writes</header>
      <MeetingPlanner meeting={meeting} commonGround={{ state: { status: 'ready', result }, retry() {} }} />
    </div>);
  } catch (error) {
    root.render(<p role="alert">Synthetic meeting fixture failed: {error instanceof Error ? error.message : 'Unknown error'}</p>);
  } finally {
    window.fetch = originalFetch;
  }
}

void start();
