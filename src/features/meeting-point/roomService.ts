import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeetingRoom, Participant, StartingPoint } from './types';

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
}

interface ParticipantRow {
  id: string;
  user_id: string;
  nickname: string | null;
  lat: number | null;
  lon: number | null;
  source: Participant['source'];
  label: string | null;
  colour_slot: number;
}

const toRoom = (row: RoomRow): MeetingRoom => ({
  code: row.code,
  timeBudget: row.time_budget,
  expiresAt: row.expires_at,
});

const toParticipant = (row: ParticipantRow): Participant => ({
  id: row.id,
  userId: row.user_id,
  nickname: row.nickname,
  at: row.lat === null || row.lon === null ? null : { lat: row.lat, lon: row.lon },
  source: row.source,
  label: row.label,
  colourSlot: row.colour_slot,
});

/** Returns this device's anonymous user id, signing in first if there is no session. */
export async function ensureSignedIn(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: signedIn, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  if (!signedIn.user) throw new Error('Anonymous sign-in returned no user.');
  return signedIn.user.id;
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
 * The room and its participants in join order, or null.
 *
 * Null covers a room that does not exist, one that has expired, and one this device is not
 * in. Row-level security makes those indistinguishable on purpose: telling them apart would
 * let anyone probe which codes are live.
 */
export async function loadRoom(
  client: SupabaseClient,
  code: string,
): Promise<{ room: MeetingRoom; participants: Participant[] } | null> {
  const [roomResult, participantsResult] = await Promise.all([
    client.from('meeting_rooms').select('code, time_budget, expires_at').eq('code', code).maybeSingle(),
    client
      .from('meeting_participants')
      .select('id, user_id, nickname, lat, lon, source, label, colour_slot')
      .eq('room_code', code)
      .order('joined_at'),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (participantsResult.error) throw participantsResult.error;
  if (!roomResult.data) return null;

  return {
    room: toRoom(roomResult.data as RoomRow),
    participants: (participantsResult.data as ParticipantRow[]).map(toParticipant),
  };
}

export async function setRoomBudget(client: SupabaseClient, code: string, budget: number): Promise<void> {
  const { error } = await client.from('meeting_rooms').update({ time_budget: budget }).eq('code', code);
  if (error) throw error;
}

/** Sets this device's starting point, or clears it with null. RLS confines the write to the caller's own row. */
export async function setMyPoint(
  client: SupabaseClient,
  code: string,
  userId: string,
  point: StartingPoint | null,
): Promise<void> {
  const { error } = await client
    .from('meeting_participants')
    .update({
      lat: point?.at.lat ?? null,
      lon: point?.at.lon ?? null,
      source: point?.source ?? null,
      label: point?.label ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('room_code', code)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function leaveRoom(client: SupabaseClient, code: string, userId: string): Promise<void> {
  const { error } = await client
    .from('meeting_participants')
    .delete()
    .eq('room_code', code)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Calls `onChange` whenever the room or its participants change, and once more each time the
 * server confirms it is streaming database changes, so nothing missed while disconnected stays
 * stale.
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
 * The caller reloads rather than patching state from event payloads: a room holds a handful of
 * rows. DELETE events cannot be filtered and carry only the primary key, so they are passed
 * through as `deletedId` for the caller to ignore deletions from other rooms.
 *
 * @returns an unsubscribe function.
 */
export async function subscribeToRoom(
  client: SupabaseClient,
  code: string,
  onChange: (deletedId?: string) => void,
): Promise<() => void> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Subscribing to a room requires a signed-in session.');
  await client.realtime.setAuth(data.session.access_token);

  const changed = () => onChange();
  const channel = client
    .channel(`meeting-room:${code}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meeting_rooms', filter: `code=eq.${code}` }, changed)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_participants', filter: `room_code=eq.${code}` }, changed)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meeting_participants', filter: `room_code=eq.${code}` }, changed)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'meeting_participants' }, payload =>
      onChange((payload.old as { id?: string }).id),
    )
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
