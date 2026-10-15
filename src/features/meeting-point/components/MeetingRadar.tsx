import { Radar } from 'lucide-react';

/** Decorative progress indicator, not a fabricated route or completion percentage. */
export function MeetingRadar() {
  return <div className="meeting-radar-overlay" role="status" aria-label="Calculating common reachable area">
    <div className="meeting-radar" aria-hidden="true">
      <div className="meeting-radar-sweep" />
      <Radar size={30} />
    </div>
    <p className="mt-3 rounded-full border border-cyan-300/30 bg-[#0e1c29]/95 px-4 py-2 text-sm font-semibold text-cyan-100">Finding common ground…</p>
  </div>;
}
