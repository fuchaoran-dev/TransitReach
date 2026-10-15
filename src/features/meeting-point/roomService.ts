import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArrivalStatus,
  MeetingRoom,
  MeetingInvitation,
  MeetingVenue,
  Participant,
  SharedMemberStatus,
  StartingPoint,
  MeetingSelection,
  MeetingVote,
} from './types';

export class RoomNotFoundError extends Error {
  constructor() {
    super('The room does not exist or has expired.');
    this.name = 'RoomNotFoundError';
  }
}

export class RoomFullError extends Error {
  constructor() {
    super('The room is full.');
    this.name = 'RoomFullError';
  }
}

interface RoomRow {
  code: string;
  time_budget: number;
  expires_at: string;
  updated_at: string;
  planning_revision: number;
  confirmed_venue: MeetingVenue | null;
  confirmed_arrival_time: string | null;
  plan_version: number;
  proposed_arrival_time: string | null;
  meeting_time: string;
  planning_started?: boolean;
  departure_time?: string | null;
  voting_arrival_time?: string | null;
  is_host?: boolean;
  vote_status?: MeetingRoom['voteStatus'];
}

interface ParticipantRow {
  id: string;
  user_id?: string;
  nickname: string | null;
  lat: number | null;
  lon: number | null;
  source: Participant['source'];
  label: string | null;
  colour_slot: number;
  arrival_status: string;
  checked_plan_version: number | null;
}

interface MemberRow {
  id: string;
  display_name: string;
  arrival_status: string;
  is_self: boolean;
  lat?: number | null;
  lon?: number | null;
  label?: string | null;
  colour_slot?: number;
  planning_status?: 'Ready' | 'Not ready';
}

interface RoomStateRow {
  room: RoomRow;
  self: ParticipantRow | null;
  members: MemberRow[];
  selections?: { member_id: string; display_name: string; venue: MeetingVenue }[];
  votes?: { member_id: string; display_name: string; venue: MeetingVenue; arrival_time: string }[];
}

interface InvitationRow {
  code: string;
  confirmed_venue: MeetingVenue | null;
  confirmed_arrival_time: string | null;
  plan_version: number;
}

export interface MeetingRoomSnapshot {
  room: MeetingRoom;
  me: Participant;
  members: SharedMemberStatus[];
  selections: MeetingSelection[];
  votes: MeetingVote[];
}

function toArrivalStatus(value: string): ArrivalStatus {
  if (value === 'ready' || value === 'Ready') return 'Ready';
  if (value === 'check_needed' || value === 'Check needed') return 'Check needed';
  return 'Not checked';
}

const toRoom = (row: RoomRow): MeetingRoom => ({
  code: row.code,
  timeBudget: row.time_budget,
  expiresAt: row.expires_at,
  updatedAt: row.updated_at,
  planningRevision: row.planning_revision,
  confirmedPlan: row.confirmed_venue && row.confirmed_arrival_time
    ? { venue: row.confirmed_venue, arrivalTime: row.confirmed_arrival_time, version: row.plan_version }
    : null,
  proposedArrivalTime: row.proposed_arrival_time,
  meetingTime: row.meeting_time,
  planningStarted: row.planning_started ?? false,
  departureTime: row.departure_time ?? null,
  votingArrivalTime: row.voting_arrival_time ?? null,
  isHost: row.is_host ?? false,
  voteStatus: row.vote_status ?? 'waiting',
});

const toParticipant = (row: ParticipantRow, userId: string): Participant => ({
  id: row.id,
  userId,
  nickname: row.nickname,
  at: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
  source: row.source,
  label: row.label,
  colourSlot: row.colour_slot,
  arrivalStatus: toArrivalStatus(row.arrival_status),
  checkedPlanVersion: row.checked_plan_version,
});

const toMember = (row: MemberRow): SharedMemberStatus => ({
  id: row.id,
  displayName: row.display_name,
  arrivalStatus: toArrivalStatus(row.arrival_status),
  isSelf: row.is_self,
  at: row.lat == null || row.lon == null ? null : { lat: row.lat, lon: row.lon },
  label: row.label ?? null,
  colourSlot: row.colour_slot ?? 0,
  planningStatus: row.planning_status ?? 'Not ready',
});

async function signIn(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: signedIn, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  if (!signedIn.user) throw new Error('Anonymous sign-in returned no user.');
  return signedIn.user.id;
}

let signingIn: Promise<string> | null = null;

/**
 * Returns this device's anonymous user id, signing in first if there is no session.
 *
 * Calls made while a sign-in is under way share it. Opening a room link starts a sign-in (to
 * check membership), and a quick tap on Join used to start a second before the first had stored
 * its session — two anonymous users on one device. The room row belonged to one and the page's
 * identity was the other, so every later write matched no row and silently changed nothing: a
 * starting point that reached nobody, not even the person who set it. Seen in a browser test on
 * 14 September as two `auth/signup` calls in the same instant, then a starting-point update that
 * returned 204 and saved nothing.
 */
export function ensureSignedIn(client: SupabaseClient): Promise<string> {
  signingIn ??= signIn(client).finally(() => {
    signingIn = null;
  });
  return signingIn;
}

/** Creates a room with the caller as its first participant, and returns its code. */
export async function createRoom(client: SupabaseClient, nickname: string): Promise<string> {
  const { data, error } = await client.rpc('create_meeting_room', { p_nickname: nickname });
  if (error) throw error;
  return data as string;
}

export async function joinRoom(client: SupabaseClient, code: string, nickname: string): Promise<void> {
  const { error } = await client.rpc('join_meeting_room', { p_code: code, p_nickname: nickname });
  if (!error) return;
  if (error.message === 'room_not_found') throw new RoomNotFoundError();
  if (error.message === 'room_full') throw new RoomFullError();
  throw error;
}

/**
 * Own full point plus the consent-gated member projection and public venue ballots.
 *
 * Null covers a room that does not exist, one that has expired, and one this device is not
 * in. Row-level security makes those indistinguishable on purpose: telling them apart would
 * let anyone probe which codes are live.
 */
export async function loadRoom(
  client: SupabaseClient,
  code: string,
): Promise<MeetingRoomSnapshot | null> {
  const { data, error } = await client.rpc('get_meeting_room_state', { p_code: code });
  if (error) throw error;
  if (!data) return null;

  const state = data as unknown as RoomStateRow;
  // The RPC deliberately returns no state for a non-member, expired room or unknown code.
  if (!state.room || !state.self) return null;
  if (typeof state.room.planning_started !== 'boolean') {
    throw new Error('Meeting voting SQL migration is required.');
  }
  if (typeof state.room.meeting_time !== 'string' || !Number.isFinite(Date.parse(state.room.meeting_time))) {
    throw new Error('Meeting auto-planning SQL migration is required.');
  }
  const { data: session } = await client.auth.getSession();
  if (!session.session) throw new Error('A room session is required.');
  return {
    room: toRoom(state.room), me: toParticipant(state.self, session.session.user.id), members: state.members.map(toMember),
    selections: (state.selections ?? []).map(row => ({ memberId: row.member_id, displayName: row.display_name, venue: row.venue })),
    votes: (state.votes ?? []).map(row => ({ memberId: row.member_id, displayName: row.display_name, venue: row.venue, arrivalTime: row.arrival_time })),
  };
}

export async function startMeetingPlanning(client: SupabaseClient, code: string, departure: string, arrival: string): Promise<void> {
  const { error } = await client.rpc('start_meeting_planning', { p_code: code, p_departure_time: departure, p_arrival_time: arrival });
  if (error) throw error;
}

export async function reopenMeetingPlanning(client: SupabaseClient, code: string): Promise<void> {
  const { error } = await client.rpc('reopen_meeting_planning', { p_code: code });
  if (error) throw error;
}

export async function ensureMeetingPlanning(client: SupabaseClient, code: string): Promise<void> {
  const { error } = await client.rpc('ensure_meeting_planning', { p_code: code });
  if (error) throw error;
}

export async function setMeetingTime(client: SupabaseClient, code: string, arrival: string): Promise<void> {
  const { error } = await client.rpc('set_meeting_time', { p_code: code, p_arrival_time: arrival });
  if (error) throw error;
}

export async function proposeMeetingVenue(client: SupabaseClient, code: string, venue: MeetingVenue, revision: number): Promise<void> {
  const { error } = await client.rpc('propose_meeting_venue', { p_code: code, p_venue: venue, p_revision: revision });
  if (error) throw error;
}

export async function castMeetingVote(client: SupabaseClient, code: string, venue: MeetingVenue, arrival: string, revision: number): Promise<void> {
  const { error } = await client.rpc('cast_meeting_vote', { p_code: code, p_venue: venue, p_arrival_time: arrival, p_revision: revision });
  if (error) throw error;
}

/** Reads only the shared agreement carried by an opaque invitation code. */
export async function loadMeetingInvitation(
  client: SupabaseClient,
  code: string,
): Promise<MeetingInvitation | null> {
  const { data, error } = await client.rpc('get_meeting_invitation', { p_code: code });
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as InvitationRow;
  return {
    code: row.code,
    confirmedPlan: row.confirmed_venue && row.confirmed_arrival_time
      ? { venue: row.confirmed_venue, arrivalTime: row.confirmed_arrival_time, version: row.plan_version }
      : null,
  };
}

export async function setRoomBudget(client: SupabaseClient, code: string, budget: number): Promise<void> {
  const { error } = await client.rpc('set_meeting_budget', { p_code: code, p_budget: budget });
  if (error) throw error;
}

export async function confirmMeetingPlan(
  client: SupabaseClient,
  code: string,
  venue: MeetingVenue,
  arrivalTime: string,
): Promise<number> {
  const { data, error } = await client.rpc('confirm_meeting_plan', {
    p_code: code,
    p_venue: venue,
    p_arrival_time: arrivalTime,
  });
  if (error) throw error;
  return data as number;
}

export async function proposeMeetingTime(
  client: SupabaseClient,
  code: string,
  arrivalTime: string,
): Promise<void> {
  const { error } = await client.rpc('propose_meeting_time', { p_code: code, p_arrival_time: arrivalTime });
  if (error) throw error;
}

export async function setMyArrivalStatus(
  client: SupabaseClient,
  code: string,
  status: ArrivalStatus,
  planVersion: number,
): Promise<void> {
  const values: Record<ArrivalStatus, string> = {
    Ready: 'ready',
    'Check needed': 'check_needed',
    'Not checked': 'not_checked',
  };
  const { error } = await client.rpc('set_my_arrival_status', {
    p_code: code,
    p_status: values[status],
    p_plan_version: planVersion,
  });
  if (error) throw error;
}

/** Explicitly shares this caller's selected point, or withdraws sharing and clears it with null. */
export async function setMyPoint(
  client: SupabaseClient,
  code: string,
  userId: string,
  point: StartingPoint | null,
): Promise<void> {
  if (!userId) throw new Error('A member identity is required.');
  const { error } = await client.rpc('share_meeting_origin', {
    p_code: code, p_lat: point?.at.lat ?? null, p_lon: point?.at.lon ?? null,
    p_source: point?.source ?? null, p_label: point?.label ?? null,
  });
  if (error) throw error;
}

export async function leaveRoom(client: SupabaseClient, code: string, userId: string): Promise<void> {
  if (!userId) throw new Error('A member identity is required.');
  const { error } = await client.rpc('leave_meeting_room', { p_code: code });
  if (error) throw error;
}

/**
 * Calls `onChange` when the non-sensitive room row changes.
 *
 * That confirmation is the `system` message rather than the `SUBSCRIBED` status, which only
 * means the channel joined; the database stream is set up after it.
 *
 * The realtime connection is handed the user's access token before the channel joins. Supabase
 * passes it over asynchronously after sign-in, and a channel that joins first is evaluated as
 * the `anon` role, which may read nothing here: its filters are rejected with "invalid column
 * for filter", and any event that does arrive has its row withheld. Measured against the
 * project — the first subscription after a sign-in failed, later ones on the same client did
 * not, whichever column the filter named.
 *
 * Participant change payloads are never subscribed to because they contain private origins.
 * A database trigger touches the room after a participant changes. The hook separately polls
 * the safe projection to cover missed realtime events and invitation viewers who are not members.
 *
 * @returns an unsubscribe function.
 */
export async function subscribeToRoom(
  client: SupabaseClient,
  code: string,
  onChange: () => void,
): Promise<() => void> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Subscribing to a room requires a signed-in session.');
  await client.realtime.setAuth(data.session.access_token);

  const changed = () => onChange();
  const channel = client
    .channel(`meeting-room:${code}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meeting_rooms', filter: `code=eq.${code}` }, changed)
    .on('system', {}, message => {
      if (message.extension !== 'postgres_changes') return;
      if (message.status === 'ok') onChange();
      else console.error('Meeting room live updates are unavailable:', message.message);
    })
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
