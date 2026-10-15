import { initializeDatabaseData } from '@/shared/data/databaseData';

export async function loadApplication(signal: AbortSignal) {
  await initializeDatabaseData(signal);
  signal.throwIfAborted();
  const { default: Application } = await import('./App');
  signal.throwIfAborted();
  return Application;
}
