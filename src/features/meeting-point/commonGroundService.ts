import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeetingVenue } from './types';
import type { VenueType } from './venueService';
import type { IsochroneRegion } from '@/shared/data/adapters/routingAdapter';

const API_BASE = (import.meta.env.VITE_RELIABILITY_API_URL ?? '').replace(/\/$/, '');

export interface CommonGroundProposal {
  rank: number;
  venue: MeetingVenue;
  longestMinutes: number;
  gapMinutes: number;
  participantTrips?: Array<{ memberId: string; minutes: number }>;
}

export interface CommonGroundResult {
  status: 'waiting_for_planning' | 'waiting_for_participants' | 'waiting_for_origins' | 'no_common_ground' | 'ready' | 'finding_places';
  participantCount: number;
  missingStartingPoints: number;
  budgetMinutes: number;
  roomRevision: number;
  departureTime: string | null;
  arrivalTime: string | null;
  areaMethod: 'budget-window-preview';
  participantAreas: { memberId?: string | null; regions: IsochroneRegion[] }[];
  proposals: CommonGroundProposal[];
}

/**
 * Calculates the shared result behind the authenticated server boundary. The response contains
 * public venue proposals, aggregate counts and consent-gated isochrone boundaries.
 * Private travel-time rasters remain server-side; membership is validated on every request.
 */
export async function fetchCommonGround(
  client: SupabaseClient,
  code: string,
  timeBudget: number,
  venueTypes: VenueType[],
  signal: AbortSignal,
  roomRevision?: number,
  onProgress?: (result: CommonGroundResult) => void,
): Promise<CommonGroundResult> {
  if (roomRevision !== undefined) return followCommonGround(client, code, timeBudget, venueTypes, roomRevision, signal, onProgress);
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('A room session is required.');

  const response = await fetch(`${API_BASE}/api/meetings/${encodeURIComponent(code)}/common-ground`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ timeBudget, venueTypes }),
    signal,
  });
  if (!response.ok) throw new Error(`Common-ground request failed (${response.status}).`);
  return validateResult(await response.json() as CommonGroundResult);
}

function validateResult(result: CommonGroundResult): CommonGroundResult {
  const participantAreas = Array.isArray(result.participantAreas) ? result.participantAreas : [];
  if (result.areaMethod !== 'budget-window-preview' ||
    !participantAreas.every(area => (area.memberId === undefined || area.memberId === null || typeof area.memberId === 'string') && Array.isArray(area.regions)) ||
    !Array.isArray(result.proposals) ||
    !result.proposals.every(proposal => proposal.participantTrips === undefined || (Array.isArray(proposal.participantTrips) && proposal.participantTrips.every(trip => typeof trip.memberId === 'string' && Number.isFinite(trip.minutes) && trip.minutes >= 0))) ||
    (['ready', 'finding_places'].includes(result.status) && (!result.arrivalTime || !Number.isFinite(Date.parse(result.arrivalTime))))) {
    throw new Error('The meeting service returned an incompatible response.');
  }
  return { ...result, participantAreas };
}

class TemporaryMeetingError extends Error {}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Short authenticated polls share one server job. Never replay a long POST on each screen. */
async function followCommonGround(client: SupabaseClient, code: string, timeBudget: number,
  venueTypes: VenueType[], roomRevision: number, signal: AbortSignal,
  onProgress?: (result: CommonGroundResult) => void): Promise<CommonGroundResult> {
  const operation = new AbortController();
  const abort = () => operation.abort(signal.reason);
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => operation.abort(), 150_000);
  let failures = 0;
  let previewPublished = false;
  try {
    while (true) {
      operation.signal.throwIfAborted();
      const attempt = new AbortController();
      const cancel = () => attempt.abort(operation.signal.reason);
      operation.signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => attempt.abort(), 12_000);
      let delay = 2_000;
      try {
        const { data } = await abortable(client.auth.getSession(), attempt.signal);
        operation.signal.throwIfAborted();
        const token = data.session?.access_token;
        if (!token) throw new Error('A room session is required.');
        const response = await fetch(`${API_BASE}/api/meetings/${encodeURIComponent(code)}/common-ground-job`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeBudget, venueTypes, roomRevision }), signal: attempt.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if ([408, 429, 500, 502, 503, 504].includes(response.status)) throw new TemporaryMeetingError('Meeting service is temporarily unavailable.');
          if (response.status === 409) throw new Error('The room changed. Wait for the current round to update.');
          if (response.status === 401) throw new Error('Your meeting session expired. Reopen the room.');
          throw new Error(`Meeting calculation could not start (HTTP ${response.status}).`);
        }
        const job = await response.json() as { status: string; result?: CommonGroundResult; reason?: string };
        attempt.signal.throwIfAborted();
        if (!['computing', 'ready', 'failed'].includes(job.status)) throw new Error('The meeting service returned an incompatible job.');
        if (job.result) {
          const result = validateResult(job.result);
          if (result.roomRevision !== roomRevision || result.budgetMinutes !== timeBudget) throw new Error('The room changed during calculation.');
          if (result.status === 'finding_places' && (result.participantAreas.length !== result.participantCount || result.missingStartingPoints !== 0)) throw new Error('The shared area is incomplete. Please retry.');
          if (job.status === 'ready') return result;
          if (result.status !== 'finding_places' || result.proposals.length) throw new Error('The meeting service returned an unverified shortlist.');
          if (!previewPublished) { onProgress?.(result); previewPublished = true; }
        } else if (job.status === 'ready') throw new Error('The meeting service returned no result.');
        if (job.status === 'failed') {
          previewPublished = false;
          if (job.reason === 'routing_unavailable') throw new TemporaryMeetingError('Place route checks timed out. The shared area is retained; retry finding places.');
          throw new Error(job.reason === 'room_changed' ? 'The room changed. Wait for the current round to update.' : 'Meeting calculation failed. Please retry.');
        }
      } catch (error) {
        operation.signal.throwIfAborted();
        const temporary = error instanceof TemporaryMeetingError || error instanceof TypeError || attempt.signal.aborted;
        if (!temporary) throw error;
        if (++failures >= 3) throw new Error(error instanceof TemporaryMeetingError ? error.message : 'Could not connect to the meeting service. Please retry.');
        delay = failures * 5_000;
      } finally {
        clearTimeout(timeout);
        operation.signal.removeEventListener('abort', cancel);
      }
      await pause(delay, operation.signal);
    }
  } catch (error) {
    signal.throwIfAborted();
    if (operation.signal.aborted) throw new Error('Finding places took too long. Any completed shared area remains visible; retry the places list.');
    throw error;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
  }
}
