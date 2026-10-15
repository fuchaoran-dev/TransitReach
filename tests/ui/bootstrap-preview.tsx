import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StartupScreen } from '../../src/app/StartupScreen';
import type { StartupState } from '../../src/app/hooks/useApplicationStartup';
import '../../src/index.css';

const LOADING = { status: 'loading', progress: null, slow: false } as const;
const WAITING = { status: 'loading', progress: { attempt: 2, maxAttempts: 4, phase: 'requesting' }, slow: true } as const;
const FAILED = { status: 'failed', message: 'City data request failed (HTTP 504).' } as const;

export function BootstrapPreview() {
  const [state, setState] = useState<Exclude<StartupState, { status: 'ready' }>>(WAITING);
  return <>
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-[#0e1c29] p-3 text-xs text-slate-100">
      <span>Synthetic startup states · no API requests or database writes</span>
      <button type="button" className="btn-secondary" onClick={() => setState(LOADING)}>Loading</button>
      <button type="button" className="btn-secondary" onClick={() => setState(WAITING)}>Server may be waking</button>
      <button type="button" className="btn-secondary" onClick={() => setState(FAILED)}>HTTP 504 exhausted</button>
    </div>
    <StartupScreen state={state} onRetry={() => setState(LOADING)} />
  </>;
}
createRoot(document.getElementById('root')!).render(<BootstrapPreview />);
