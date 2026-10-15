import { useEffect, useState, type ComponentType } from 'react';
import { subscribeDatabaseProgress, type BootstrapProgress } from '@/shared/data/databaseData';
import { BootstrapLoadError } from '@/shared/data/bootstrapLoader';
import { loadApplication } from '../bootstrapService';

export type StartupState =
  | { status: 'loading'; progress: BootstrapProgress | null; slow: boolean }
  | { status: 'failed'; message: string }
  | { status: 'ready'; Application: ComponentType };

export function useApplicationStartup() {
  const [cycle, setCycle] = useState(0);
  const [state, setState] = useState<StartupState>({ status: 'loading', progress: null, slow: false });
  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = subscribeDatabaseProgress(progress => {
      if (!controller.signal.aborted) setState(previous => previous.status === 'loading' ? { ...previous, progress } : previous);
    });
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) setState(previous => previous.status === 'loading' ? { ...previous, slow: true } : previous);
    }, 8_000);
    void loadApplication(controller.signal).then(Application => {
      if (!controller.signal.aborted) setState({ status: 'ready', Application });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ status: 'failed', message: error instanceof BootstrapLoadError
        ? error.message : 'The application files could not be loaded. Please try again.' });
    }).finally(() => { unsubscribe(); clearTimeout(timer); });
    return () => { controller.abort(); unsubscribe(); clearTimeout(timer); };
  }, [cycle]);

  const retry = () => {
    if (state.status !== 'failed') return;
    setState({ status: 'loading', progress: null, slow: false });
    setCycle(value => value + 1);
  };
  return { state, retry };
}
