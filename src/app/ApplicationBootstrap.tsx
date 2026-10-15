import { useApplicationStartup } from './hooks/useApplicationStartup';
import { StartupScreen } from './StartupScreen';

export function ApplicationBootstrap() {
  const { state, retry } = useApplicationStartup();
  if (state.status === 'ready') return <state.Application />;
  return <StartupScreen state={state} onRetry={retry} />;
}
