import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { normaliseRoomCode, roomParam, writeRoomCodeToUrl } from '../roomLink';
import {
  createRoom,
  ensureSignedIn,
  joinRoom,
  leaveRoom,
  loadRoom,
  RoomFullError,
  RoomNotFoundError,
  setRoomBudget,
  subscribeToRoom,
} from '../roomService';
import type { MeetingRoom, Participant, RoomError } from '../types';

export type MeetingRoomView =
  | { status: 'unconfigured' }
  /** Not in a room. `invitedCode` is set when the page was opened from a room link. */
  | { status: 'lobby'; invitedCode: string | null }
  | { status: 'checking'; code: string }
  | { status: 'ready'; room: MeetingRoom; participants: Participant[] };

function initialCode(): string | null {
  return normaliseRoomCode(roomParam() ?? '');
}

function initialView(): MeetingRoomView {
  if (!supabase) return { status: 'unconfigured' };
  const code = initialCode();
  return code ? { status: 'checking', code } : { status: 'lobby', invitedCode: null };
}

function toRoomError(error: unknown): RoomError {
  if (error instanceof RoomNotFoundError) return 'not_found';
  if (error instanceof RoomFullError) return 'full';
  return 'unavailable';
}

/**
 * The room this device is in, kept live.
 *
 * Opening a room link does not join it. The page first checks whether this device is
 * already a member — a reload, or a return from another screen — and otherwise shows an
 * invitation, so a link opened out of curiosity does not take one of the room's places.
 */
export function useMeetingRoom() {
  const [code, setCode] = useState<string | null>(initialCode);
  const [view, setView] = useState<MeetingRoomView>(initialView);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [error, setError] = useState<RoomError | null>(() => {
    const raw = roomParam();
    return raw && !normaliseRoomCode(raw) ? 'invalid_code' : null;
  });
  const [busy, setBusy] = useState(false);
  const reloadRef = useRef<() => Promise<void>>();

  useEffect(() => {
    const client = supabase;
    if (!client || !code) return;

    let cancelled = false;
    // Reloads can overlap when several changes arrive together; only the latest may render.
    let ticket = 0;
    let knownIds = new Set<string>();
    let unsubscribe: (() => void) | undefined;

    const reload = async () => {
      const mine = ++ticket;
      try {
        const snapshot = await loadRoom(client, code);
        if (cancelled || mine !== ticket) return;
        if (!snapshot) {
          knownIds = new Set();
          setView({ status: 'lobby', invitedCode: code });
          return;
        }
        knownIds = new Set(snapshot.participants.map(p => p.id));
        setView({ status: 'ready', ...snapshot });
      } catch {
        if (!cancelled && mine === ticket) setError('unavailable');
      }
    };
    reloadRef.current = reload;

    setView({ status: 'checking', code });
    ensureSignedIn(client)
      .then(id => {
        if (cancelled) return;
        setMyUserId(id);
        unsubscribe = subscribeToRoom(client, code, deletedId => {
          if (deletedId === undefined || knownIds.has(deletedId)) void reload();
        });
        // Not left to the subscription alone: if realtime cannot connect, the room still loads.
        void reload();
      })
      .catch(() => {
        if (cancelled) return;
        setView({ status: 'lobby', invitedCode: code });
        setError('unavailable');
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [code]);

  const create = async (nickname: string) => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      await ensureSignedIn(supabase);
      const newCode = await createRoom(supabase, nickname);
      writeRoomCodeToUrl(newCode);
      setCode(newCode);
    } catch (reason) {
      setError(toRoomError(reason));
    } finally {
      setBusy(false);
    }
  };

  const join = async (input: string, nickname: string) => {
    if (!supabase) return;
    const target = normaliseRoomCode(input);
    if (!target) {
      setError('invalid_code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureSignedIn(supabase);
      await joinRoom(supabase, target, nickname);
      writeRoomCodeToUrl(target);
      if (target === code) await reloadRef.current?.();
      else setCode(target);
    } catch (reason) {
      setError(toRoomError(reason));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!supabase || !code || !myUserId) return;
    setBusy(true);
    setError(null);
    try {
      await leaveRoom(supabase, code, myUserId);
      writeRoomCodeToUrl(null);
      setCode(null);
      setView({ status: 'lobby', invitedCode: null });
    } catch (reason) {
      setError(toRoomError(reason));
    } finally {
      setBusy(false);
    }
  };

  /** Applied locally at once; the realtime reload that follows confirms or corrects it. */
  const changeBudget = async (budget: number) => {
    if (!supabase || view.status !== 'ready') return;
    setError(null);
    setView({ ...view, room: { ...view.room, timeBudget: budget } });
    try {
      await setRoomBudget(supabase, view.room.code, budget);
    } catch (reason) {
      setError(toRoomError(reason));
      void reloadRef.current?.();
    }
  };

  return { view, myUserId, error, busy, create, join, leave, changeBudget };
}
