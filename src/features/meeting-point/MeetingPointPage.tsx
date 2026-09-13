import { Users } from 'lucide-react';

/**
 * Epic 6 — Multi-person Meeting Point Optimizer.
 *
 * The group shares one room by link, and each person sets their own starting point on their
 * own device. Mentors rejected the alternative, where one person enters everyone's location:
 * it asks that person to know where everyone else is.
 *
 * Placeholder until the room is built; the nav entry stays hidden until then (AC 1.4.3).
 */
export function MeetingPointPage() {
  return (
    <main className="pt-24 pb-16 px-4 sm:px-6 max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
          <Users size={18} />
          Meet up
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold mt-2">Find somewhere everyone can reach.</h1>
        <p className="text-slate-600 mt-3 max-w-3xl">
          Share a link with your group. Each person sets their own starting point, and the map
          shows where your reachable areas overlap.
        </p>
      </header>
      <section className="glass p-6 text-sm text-slate-600">Shared rooms are not available yet.</section>
    </main>
  );
}
