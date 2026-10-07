import type { DelayEvidence, UnsupportedEvidenceReason } from './types';

const API_ORIGIN = (import.meta.env.VITE_RELIABILITY_API_URL ?? '').replace(/\/$/, '');

interface PredictionResponse {
  supported?: unknown;
  reason?: unknown;
  expected_delay_min?: unknown;
  confidence?: unknown;
  sample_count?: unknown;
  model_version?: unknown;
  data_sources?: unknown;
  disclaimer?: unknown;
}

function endpointId(value: string): string {
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
}

function malaysiaIso(value: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}+08:00`;
}

function unsupported(reason: UnsupportedEvidenceReason): DelayEvidence {
  return { status: 'not-checked', reason, label: 'Not checked' };
}

function unsupportedReason(value: unknown): UnsupportedEvidenceReason {
  if (value === 'unknown_service') return 'unknown-service';
  if (value === 'model_not_available' || value === 'insufficient_historical_operational_data') {
    return 'model-not-available';
  }
  return 'insufficient-comparable-historical-data';
}

/** Fetches the evidence for one bus leg. Failures stay explicit and never become zero delay. */
export async function fetchBusDelay(
  routeId: string | null,
  stopId: string | null,
  travelAt: string,
  signal?: AbortSignal,
): Promise<DelayEvidence> {
  if (!routeId || !stopId) return unsupported('missing-route-or-stop');

  const params = new URLSearchParams({
    mode: 'BUS',
    line_id: endpointId(routeId),
    stop_id: endpointId(stopId),
    // The historical model groups observations by local hour. Sending UTC here would
    // silently ask for the wrong time-of-day profile eight hours away.
    datetime: malaysiaIso(travelAt),
  });

  try {
    const response = await fetch(`${API_ORIGIN}/api/reliability/predict?${params}`, { signal });
    if (!response.ok) return unsupported('service-unavailable');
    const body = await response.json() as PredictionResponse;
    if (body.supported !== true) return unsupported(unsupportedReason(body.reason));
    if (
      typeof body.expected_delay_min !== 'number' ||
      !Number.isFinite(body.expected_delay_min) ||
      typeof body.confidence !== 'string' ||
      typeof body.sample_count !== 'number' ||
      typeof body.model_version !== 'string' ||
      !Array.isArray(body.data_sources) ||
      !body.data_sources.every(source => typeof source === 'string') ||
      typeof body.disclaimer !== 'string'
    ) {
      return unsupported('service-unavailable');
    }
    return {
      status: 'checked',
      // An early-running historical prediction is not used as a promise of extra margin.
      seconds: Math.max(0, Math.round(body.expected_delay_min * 60)),
      confidence: body.confidence,
      sampleCount: Math.max(0, Math.round(body.sample_count)),
      source: body.data_sources.join(', '),
      modelVersion: body.model_version,
      disclaimer: body.disclaimer,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return unsupported('service-unavailable');
  }
}
