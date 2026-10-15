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
  status: 'waiting_for_planning' | 'waiting_for_participants' | 'waiting_for_origins' | 'no_common_ground' | 'ready';
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
): Promise<CommonGroundResult> {
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
  const result = await response.json() as CommonGroundResult;
  const participantAreas = Array.isArray(result.participantAreas) ? result.participantAreas : [];
  if (result.areaMethod !== 'budget-window-preview' ||
    !participantAreas.every(area => (area.memberId === undefined || area.memberId === null || typeof area.memberId === 'string') && Array.isArray(area.regions)) ||
    !Array.isArray(result.proposals) ||
    !result.proposals.every(proposal => proposal.participantTrips === undefined || (Array.isArray(proposal.participantTrips) && proposal.participantTrips.every(trip => typeof trip.memberId === 'string' && Number.isFinite(trip.minutes) && trip.minutes >= 0))) ||
    (result.status === 'ready' && (!result.arrivalTime || !Number.isFinite(Date.parse(result.arrivalTime))))) {
    throw new Error('The meeting service returned an incompatible response.');
  }
  return { ...result, participantAreas };
}
