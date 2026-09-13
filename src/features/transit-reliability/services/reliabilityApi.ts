import type { ReliabilityQuery, ReliabilityResponse, ReliabilityService } from '../types';

const API_BASE = import.meta.env.VITE_RELIABILITY_API_URL ?? '';

export async function loadReliabilityServices(signal?: AbortSignal): Promise<ReliabilityService[]> {
  const response = await fetch(`${API_BASE}/api/reliability/services`, { signal });
  if (!response.ok) throw new Error(`Reliability service returned HTTP ${response.status}`);
  return response.json() as Promise<ReliabilityService[]>;
}

export async function requestReliabilityPrediction(
  query: ReliabilityQuery,
  signal?: AbortSignal,
): Promise<ReliabilityResponse> {
  const params = new URLSearchParams({
    mode: query.mode,
    line_id: query.lineId,
    stop_id: query.stopId,
    datetime: new Date(query.datetime).toISOString(),
  });
  const response = await fetch(`${API_BASE}/api/reliability/predict?${params}`, { signal });
  if (!response.ok) throw new Error(`Reliability service returned HTTP ${response.status}`);
  return response.json() as Promise<ReliabilityResponse>;
}
