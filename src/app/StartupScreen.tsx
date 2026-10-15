import { Database, RefreshCw, WifiOff } from 'lucide-react';
import type { StartupState } from './hooks/useApplicationStartup';

export function StartupScreen({ state, onRetry }: {
  state: Exclude<StartupState, { status: 'ready' }>;
  onRetry: () => void;
}) {
  const waiting = state.status === 'loading' && (state.slow || state.progress?.phase === 'retrying' || (state.progress?.attempt ?? 1) > 1);
  return <main className="transit-shell grid min-h-screen place-items-center p-6">
    <section className="glass w-full max-w-lg rounded-3xl border border-teal-300/20 p-8 text-slate-100 shadow-2xl" aria-busy={state.status === 'loading'}>
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-300/10 text-teal-200" aria-hidden="true">
        {state.status === 'failed' ? <WifiOff size={24} /> : <Database size={24} />}
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200">TransitReach</p>
      {state.status === 'loading' ? <div role="status" aria-live="polite" aria-atomic="true">
        <h1 className="mt-3 text-2xl font-bold">{waiting ? 'Connecting to your city…' : 'Loading your city explorer…'}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{waiting
          ? 'The server may be waking up. We’ll retry automatically — keep this page open.'
          : 'Connecting to the live data service.'}</p>
        <p className="mt-4 text-xs text-slate-400">Attempt {state.progress?.attempt ?? 1} of {state.progress?.maxAttempts ?? 4} · up to 2 minutes</p>
      </div> : <>
        <div role="alert"><h1 className="mt-3 text-2xl font-bold">Unable to open TransitReach</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{state.message}</p></div>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">Check your connection, then try again here. You don’t need to refresh the page.</p>
        <button type="button" onClick={onRetry} className="btn-primary mt-6 inline-flex items-center gap-2"><RefreshCw size={16} aria-hidden="true" />Retry connection</button>
        <p className="mt-4 text-xs text-slate-400">Live PostgreSQL data only. No offline or sample data has been substituted.</p>
      </>}
    </section>
  </main>;
}
