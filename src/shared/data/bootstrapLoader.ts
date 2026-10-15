export interface DatabaseBootstrapData {
  railStops: unknown[];
  busStops: unknown[];
  places: unknown[];
  essentialServices: unknown[];
  railPatterns: unknown[];
  railShapes: Record<string, unknown>;
  railMetadata: unknown;
  placesMetadata: unknown;
  servicesMetadata: unknown;
}

export interface BootstrapProgress {
  attempt: number;
  maxAttempts: number;
  phase: 'requesting' | 'retrying';
}

const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 32_000;
const TOTAL_TIMEOUT_MS = 120_000;
// Even instantly rejected gateway responses must leave time for a sleeping host
// to start. Four fast failures should not exhaust recovery in ten seconds.
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class BootstrapLoadError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAfterMs = 0) {
    super(message);
    this.name = 'BootstrapLoadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBootstrap(value: unknown): value is DatabaseBootstrapData {
  return isRecord(value) &&
    ['railStops', 'busStops', 'places', 'essentialServices', 'railPatterns'].every(key => Array.isArray(value[key])) &&
    ['railShapes', 'railMetadata', 'placesMetadata', 'servicesMetadata'].every(key => isRecord(value[key]));
}

function retryAfter(response: Response): number {
  const value = response.headers.get('Retry-After');
  if (!value) return 0;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function request(url: string, signal: AbortSignal): Promise<DatabaseBootstrapData> {
  signal.throwIfAborted();
  const attempt = new AbortController();
  const abort = () => attempt.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => attempt.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Keep normal HTTP cache/ETag revalidation; retries never add cache-busting queries.
    const response = await fetch(url, { signal: attempt.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new BootstrapLoadError(`City data request failed (HTTP ${response.status}).`,
        TRANSIENT_STATUSES.has(response.status), retryAfter(response));
    }
    const payload: unknown = await response.json();
    attempt.signal.throwIfAborted();
    if (!validBootstrap(payload)) throw new BootstrapLoadError('The data service returned an incompatible dataset.');
    return payload;
  } catch (error) {
    signal.throwIfAborted();
    if (attempt.signal.aborted) throw new BootstrapLoadError('The data service took too long to respond.', true);
    if (error instanceof BootstrapLoadError) throw error;
    if (error instanceof TypeError) throw new BootstrapLoadError('Could not connect to the data service.', true);
    // HTML/invalid JSON must not be accepted as data or endlessly retried.
    throw new BootstrapLoadError('The data service returned an unreadable response.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Bounded recovery for proxy/cold-start failures, exclusively from the PostgreSQL API. */
export async function loadDatabaseBootstrap(url: string, signal: AbortSignal,
  onProgress: (progress: BootstrapProgress) => void = () => {},
): Promise<DatabaseBootstrapData> {
  signal.throwIfAborted();
  const operation = new AbortController();
  const abort = () => operation.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const timer = setTimeout(() => operation.abort(), TOTAL_TIMEOUT_MS);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      operation.signal.throwIfAborted();
      onProgress({ attempt, maxAttempts: MAX_ATTEMPTS, phase: 'requesting' });
      try {
        return await request(url, operation.signal);
      } catch (error) {
        operation.signal.throwIfAborted();
        if (!(error instanceof BootstrapLoadError) || !error.retryable || attempt === MAX_ATTEMPTS) throw error;
        const delay = Math.max(RETRY_DELAYS_MS[attempt - 1], error.retryAfterMs);
        if (delay >= deadline - Date.now()) throw error;
        onProgress({ attempt, maxAttempts: MAX_ATTEMPTS, phase: 'retrying' });
        await wait(delay, operation.signal);
      }
    }
    throw new BootstrapLoadError('City data could not be loaded.');
  } catch (error) {
    signal.throwIfAborted();
    if (operation.signal.aborted) throw new BootstrapLoadError('The data service did not become available within two minutes.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
