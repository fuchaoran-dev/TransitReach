import type { SupabaseClient } from '@supabase/supabase-js';
import type { MeetingVenue } from './types';
import type { VenueType } from './venueService';

const API_BASE = (import.meta.env.VITE_RELIABILITY_API_URL ?? '').replace(/\/$/, '');

export interface CommonGroundProposal {
  rank: number;
  venue: MeetingVenue;
  longestMinutes: number;
  gapMinutes: number;
}

export type CommonGroundResult =
  | {
      status: 'waiting_for_participants';
      participantCount: 1;
      missingStartingPoints: 0;
      budgetMinutes: number;
      proposals: [];
    }
  | {
      status: 'waiting_for_origins';
      participantCount: number;
      missingStartingPoints: number;
      budgetMinutes: number;
      proposals: [];
    }
  | {
      status: 'no_common_ground' | 'ready';
      participantCount: number;
      missingStartingPoints: 0;
      budgetMinutes: number;
      proposals: CommonGroundProposal[];
    };

/**
 * Calculates the shared result behind the authenticated server boundary. The response contains
 * public venue proposals and aggregate counts only; participant origins, areas and travel-time
 * surfaces never enter the browser.
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
  return response.json() as Promise<CommonGroundResult>;
}
