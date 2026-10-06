import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeDatabaseData } from './shared/data/databaseData.ts';
import './index.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  root.render(<main className="transit-shell min-h-screen grid place-items-center p-6"><section className="glass p-8 text-center"><h1 className="text-2xl font-bold">TransitReach</h1><p className="mt-3 text-slate-500" role="status">Loading your city explorer…</p></section></main>);
  try {
    await initializeDatabaseData();
    const { default: App } = await import('./app/App.tsx');
    root.render(<StrictMode><App /></StrictMode>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    root.render(
      <main className="transit-shell min-h-screen grid place-items-center p-6">
        <section className="max-w-lg glass p-6">
          <h1 className="text-xl font-bold text-slate-900">TransitReach data unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <p className="mt-2 text-sm text-slate-500">The application requires its PostgreSQL API and does not fall back to bundled JSON data.</p>
          <button className="btn-primary mt-5" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </main>,
    );
  }
}

void start();
