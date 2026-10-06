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

let data: DatabaseBootstrapData | null = null;
let initializing: Promise<void> | null = null;

const API_ORIGIN = (import.meta.env.VITE_RELIABILITY_API_URL ?? '').replace(/\/$/, '');

export function initializeDatabaseData(): Promise<void> {
  if (data) return Promise.resolve();
  if (!initializing) initializing = loadDatabaseData().finally(() => { initializing = null; });
  return initializing;
}

async function loadDatabaseData(): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/api/data/bootstrap`, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) {
    throw new Error(`PostgreSQL bootstrap failed (${response.status})`);
  }
  data = await response.json() as DatabaseBootstrapData;
}

export function databaseData(): DatabaseBootstrapData {
  if (!data) {
    throw new Error('PostgreSQL application data has not been initialized');
  }
  return data;
}
