import { useState } from 'react';
import { ROOM_ERROR_MESSAGES, type RoomError } from '../types';

interface RoomLobbyProps {
  /** Set when the page was opened from a room link this device has not joined. */
  invitedCode: string | null;
  busy: boolean;
  error: RoomError | null;
  onCreate: (nickname: string) => void;
  onJoin: (code: string, nickname: string) => void;
}

export function RoomLobby({ invitedCode, busy, error, onCreate, onJoin }: RoomLobbyProps) {
  const [nickname, setNickname] = useState('');
  const [codeInput, setCodeInput] = useState('');

  return (
    <section className="glass p-6 space-y-5 max-w-xl">
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
            You have been invited to room{' '}
            <strong className="font-mono tracking-wider text-slate-900">{invitedCode}</strong>.
          </p>
          <button className="btn-primary w-full" disabled={busy} onClick={() => onJoin(invitedCode, nickname)}>
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
