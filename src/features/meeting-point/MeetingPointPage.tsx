import { Users } from 'lucide-react';
import { TimeBudgetSelector } from '@/features/reachability';
import { ParticipantList } from './components/ParticipantList';
import { RoomLobby } from './components/RoomLobby';
import { ShareLink } from './components/ShareLink';
import { useMeetingRoom } from './hooks/useMeetingRoom';
import { ROOM_ERROR_MESSAGES } from './types';

/**
 * Epic 6 — Multi-person Meeting Point Optimizer.
 *
 * The group shares one room by link, and each person sets their own starting point on their
 * own device. Mentors rejected the alternative, where one person enters everyone's location:
 * it asks that person to know where everyone else is.
 *
 * The nav entry stays hidden until the meeting-point result is built (AC 1.4.3); until then
 * the page is reached through a room link, `?meet=<code>`, or `?meet` for the lobby.
 */
export function MeetingPointPage() {
  const meeting = useMeetingRoom();
  const { view } = meeting;

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

      {view.status === 'unconfigured' && (
        <section className="glass p-6 text-sm text-slate-600 max-w-xl">
          Shared rooms are not set up on this deployment.
        </section>
      )}

      {view.status === 'checking' && (
        <section role="status" className="glass p-6 text-sm text-slate-600 max-w-xl">
          Opening room <span className="font-mono tracking-wider">{view.code}</span>…
        </section>
      )}

      {view.status === 'lobby' && (
        <RoomLobby
          invitedCode={view.invitedCode}
          busy={meeting.busy}
          error={meeting.error}
          onCreate={nickname => void meeting.create(nickname)}
          onJoin={(code, nickname) => void meeting.join(code, nickname)}
        />
      )}

      {view.status === 'ready' && (
        <section className="glass p-6 space-y-6 max-w-xl">
          <ShareLink code={view.room.code} />

          <div>
            <div className="text-sm font-bold text-slate-900 mb-2">Travel time budget</div>
            <TimeBudgetSelector value={view.room.timeBudget} onChange={budget => void meeting.changeBudget(budget)} />
            <p className="text-xs text-slate-500 mt-2">Shared by everyone in the room, and anyone can change it.</p>
          </div>

          <ParticipantList participants={view.participants} myUserId={meeting.myUserId} />

          {meeting.error && (
            <p role="alert" className="text-sm text-rose-600">
              {ROOM_ERROR_MESSAGES[meeting.error]}
            </p>
          )}

          <button className="btn-secondary" disabled={meeting.busy} onClick={() => void meeting.leave()}>
            Leave room
          </button>
        </section>
      )}
    </main>
  );
}
