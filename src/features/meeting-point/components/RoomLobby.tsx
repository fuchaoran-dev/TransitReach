import { useState } from 'react';
import { CalendarClock, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import { ROOM_ERROR_MESSAGES, type MeetingInvitation, type RoomError } from '../types';

interface RoomLobbyProps {
  /** Set when the page was opened from a room link this device has not joined. */
  invitedCode: string | null;
  invitation: MeetingInvitation | null;
  busy: boolean;
  error: RoomError | null;
  onCreate: (nickname: string) => void;
  onJoin: (code: string, nickname: string) => void;
}

function invitationDate(value: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function RoomLobby({ invitedCode, invitation, busy, error, onCreate, onJoin }: RoomLobbyProps) {
  const [nickname, setNickname] = useState('');
  const [codeInput, setCodeInput] = useState('');

  return (
    <section className="glass p-6 space-y-5 max-w-xl">
      {invitation?.confirmedPlan && (
        <div className="space-y-5 border-b border-[#294456] pb-6" aria-labelledby="room-invitation-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-200">
              <Ticket size={18} aria-hidden="true" /> You're invited
            </span>
            <span className="rounded-full bg-[#27333e] px-2.5 py-1 text-[11px] font-bold text-slate-300">
              Group outing · Plan v{invitation.confirmedPlan.version}
            </span>
          </div>
          <div>
            <h2 id="room-invitation-title" className="text-2xl font-bold text-white">
              Meet at {invitation.confirmedPlan.venue.name}
            </h2>
            <p className="mt-2 text-sm text-slate-300">Join this room to create a private journey from your own starting point.</p>
          </div>
          <div className="space-y-3 rounded-xl bg-[#192a38] p-4">
            <p className="flex gap-3 text-sm text-slate-200">
              <CalendarClock size={18} className="shrink-0 text-teal-200" aria-hidden="true" />
              <span><span className="block text-xs text-slate-400">Agreed arrival</span>{invitationDate(invitation.confirmedPlan.arrivalTime)} MYT</span>
            </p>
            <p className="flex gap-3 border-t border-[#294456] pt-3 text-sm text-slate-200">
              <MapPin size={18} className="shrink-0 text-teal-200" aria-hidden="true" />
              <span><span className="block text-xs text-slate-400">Meeting place</span>{invitation.confirmedPlan.venue.address ?? invitation.confirmedPlan.venue.kindLabel}</span>
            </p>
          </div>
          <p className="flex gap-2 rounded-xl border border-teal-300/15 bg-[#132637] p-3 text-xs leading-relaxed text-slate-300">
            <ShieldCheck size={17} className="shrink-0 text-teal-200" aria-hidden="true" />
            The invitation contains no member identity, starting point, route or personal check result.
          </p>
        </div>
      )}

      <label className="block text-sm font-semibold">
        Your name in the room <span className="font-normal text-slate-500">(optional)</span>
        <input
          className="glass-input block w-full mt-2 p-3"
          maxLength={30}
          value={nickname}
          onChange={event => setNickname(event.target.value)}
        />
      </label>

      {invitedCode ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {invitation?.confirmedPlan ? 'Join' : 'You have been invited to'} room{' '}
            <strong className="font-mono tracking-wider text-slate-900">{invitedCode}</strong>.
            {!invitation?.confirmedPlan && ' The group plan is still being arranged.'}
          </p>
          <button className="btn-primary w-full" disabled={busy || error === 'not_found'} onClick={() => onJoin(invitedCode, nickname)}>
            {busy ? 'Joining…' : 'Join room'}
          </button>
          <button className="btn-secondary w-full" disabled={busy} onClick={() => onCreate(nickname)}>
            Create a new room instead
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button className="btn-primary w-full" disabled={busy} onClick={() => onCreate(nickname)}>
            {busy ? 'Working…' : 'Create a room'}
          </button>
          <form
            className="flex gap-2"
            onSubmit={event => {
              event.preventDefault();
              onJoin(codeInput, nickname);
            }}
          >
            <input
              aria-label="Room code"
              placeholder="Room code"
              className="glass-input flex-1 min-w-0 p-3 font-mono uppercase tracking-wider"
              maxLength={8}
              value={codeInput}
              onChange={event => setCodeInput(event.target.value)}
            />
            <button className="btn-secondary" disabled={busy || codeInput.trim() === ''}>
              Join
            </button>
          </form>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {ROOM_ERROR_MESSAGES[error]}
        </p>
      )}
    </section>
  );
}
