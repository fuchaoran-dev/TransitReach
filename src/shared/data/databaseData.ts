import { loadDatabaseBootstrap, type BootstrapProgress, type DatabaseBootstrapData } from './bootstrapLoader';
import { createSharedRequestCache } from './sharedRequestCache';

export type { BootstrapProgress, DatabaseBootstrapData } from './bootstrapLoader';

let data: DatabaseBootstrapData | null = null;
const initializing = createSharedRequestCache<void>(0, 0);
const listeners = new Set<(progress: BootstrapProgress) => void>();
let progress: BootstrapProgress | null = null;

const API_ORIGIN = (import.meta.env.VITE_RELIABILITY_API_URL ?? '').replace(/\/$/, '');

export function subscribeDatabaseProgress(listener: (value: BootstrapProgress) => void): () => void {
  listeners.add(listener);
  if (progress) listener(progress);
  return () => { listeners.delete(listener); };
}

export function initializeDatabaseData(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (data) return Promise.resolve();
  return initializing('public-bootstrap', async sharedSignal => {
    const payload = await loadDatabaseBootstrap(`${API_ORIGIN}/api/data/bootstrap`, sharedSignal, value => {
      if (sharedSignal.aborted) return;
      progress = value;
      listeners.forEach(listener => listener(value));
    });
    sharedSignal.throwIfAborted();
    data = payload;
  }, signal);
}

export function databaseData(): DatabaseBootstrapData {
  if (!data) {
    throw new Error('PostgreSQL application data has not been initialized');
  }
  return data;
}
