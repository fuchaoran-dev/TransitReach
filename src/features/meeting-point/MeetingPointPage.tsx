import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { BaseMap, DEFAULT_TIME_BUDGET, TimeBudgetSelector } from '@/features/reachability';
import { isInStudyArea, MODES_NOT_LOADED, WALK_SPEED_KMH } from '@/features/reachability/reachabilityService';
import type { Origin } from '@/features/reachability/types';
import { DEPARTURE_TIME_IS_PROVISIONAL, DEPARTURE_TIME_LABEL } from '@/shared/data/adapters/routingAdapter';
import { FitToParticipants } from './components/FitToParticipants';
import { MyStartingPoint } from './components/MyStartingPoint';
import { ParticipantAreasLayer } from './components/ParticipantAreasLayer';
import { ParticipantList } from './components/ParticipantList';
import { ParticipantMarkers } from './components/ParticipantMarkers';
import { RoomLobby } from './components/RoomLobby';
import { ShareLink } from './components/ShareLink';
import { useMeetingRoom } from './hooks/useMeetingRoom';
import { useParticipantAreas } from './hooks/useParticipantAreas';
import { ROOM_ERROR_MESSAGES, type Participant, type StartingPoint } from './types';

/** AC 1.1.2's wording, as on the reachability map. */
const OUTSIDE_AREA = 'Selected point is outside the covered area';
const PLACE_OUTSIDE_AREA = 'That place is outside the covered area';

const NO_PARTICIPANTS: Participant[] = [];

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
  const { view, myUserId } = meeting;
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);

  const participants = view.status === 'ready' ? view.participants : NO_PARTICIPANTS;
  const budgetMinutes = view.status === 'ready' ? view.room.timeBudget : DEFAULT_TIME_BUDGET;

  // The viewer's own area is queued first: it is the one they are waiting on.
  const queueOrder = useMemo(
    () => [...participants].sort((a, b) => Number(b.userId === myUserId) - Number(a.userId === myUserId)),
    [participants, myUserId],
  );
  const areas = useParticipantAreas(queueOrder, budgetMinutes);

  const me = participants.find(participant => participant.userId === myUserId) ?? null;

  // Keyed on the coordinate, not the participant object: every realtime reload builds new
  // objects, and a fresh origin would make the map re-centre each time someone else moves.
  const lat = me?.at?.lat;
  const lon = me?.at?.lon;
  const source = me?.source;
  const myOrigin = useMemo<Origin | null>(
    () => (lat !== undefined && lon !== undefined && source ? { at: { lat, lon }, source } : null),
    [lat, lon, source],
  );

  // A focused person who leaves or clears their point stops being focused, rather than
  // leaving every area faded around a gap.
  const activeFocus = participants.some(participant => participant.id === focusedId && participant.at)
    ? focusedId
    : null;

  if (view.status === 'ready') {
    /** AC 1.1.2 — out of area, the previous point is kept rather than cleared. */
    const choose = (point: StartingPoint) => {
      if (!isInStudyArea(point.at)) {
        setNotice(point.source === 'map' ? OUTSIDE_AREA : PLACE_OUTSIDE_AREA);
        return;
      }
      setNotice(null);
      void meeting.setMyPoint(point);
    };

    return (
      // Same frame as the reachability map: top-16 rather than pt-16, so the map cannot slide
      // under the navbar.
      <div className="fixed left-0 right-0 bottom-0 top-16 overflow-hidden">
        <div className="absolute inset-0">
          <BaseMap origin={myOrigin} regions={null} onMapClick={at => choose({ at, source: 'map', label: null })}>
            <ParticipantAreasLayer
              participants={participants}
              myUserId={myUserId}
              areaFor={areas.areaFor}
              focusedId={activeFocus}
            />
            <ParticipantMarkers participants={participants} myUserId={myUserId} />
            <FitToParticipants participants={participants} request={fitRequest} />
          </BaseMap>
        </div>

        <div className="absolute top-4 left-4 sm:left-6 z-[500] w-[340px] max-w-[calc(100vw-2rem)] max-h-[calc(100%-2rem)]">
          <div className="glass p-4 space-y-5 max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden scrollbar-thin">
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <Users size={16} />
              Meet up
            </div>

            <ShareLink code={view.room.code} />

            <MyStartingPoint
              me={me}
              notice={notice}
              onSearchSelect={choose}
              onClear={() => {
                setNotice(null);
                void meeting.setMyPoint(null);
              }}
            />

            <div>
              <div className="text-sm font-bold text-slate-900 mb-2">Travel time budget</div>
              <TimeBudgetSelector value={budgetMinutes} onChange={budget => void meeting.changeBudget(budget)} />
              <p className="text-xs text-slate-500 mt-2">Shared by everyone in the room, and anyone can change it.</p>
            </div>

            <ParticipantList
              participants={participants}
              myUserId={myUserId}
              budgetMinutes={budgetMinutes}
              areaFor={areas.areaFor}
              focusedId={activeFocus}
              onFocus={setFocusedId}
              onRetry={areas.retry}
              onShowEveryone={() => setFitRequest(count => count + 1)}
            />

            {/* What the shapes rest on, stated beside them rather than behind a control. */}
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Areas are modelled, not exact boundaries: leaving {DEPARTURE_TIME_LABEL}, walking at{' '}
              {WALK_SPEED_KMH} km/h, on rail and BRT timetables.{' '}
              {DEPARTURE_TIME_IS_PROVISIONAL && 'Reach differs at other times of day. '}
              {MODES_NOT_LOADED}
            </p>

            {meeting.error && (
              <p role="alert" className="text-sm text-rose-600">
                {ROOM_ERROR_MESSAGES[meeting.error]}
              </p>
            )}

            <button className="btn-secondary" disabled={meeting.busy} onClick={() => void meeting.leave()}>
              Leave room
            </button>
          </div>
        </div>
      </div>
    );
  }

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
    </main>
  );
}
