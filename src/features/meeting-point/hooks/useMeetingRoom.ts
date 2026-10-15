import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { normaliseRoomCode, roomParam, writeRoomCodeToUrl } from '../roomLink';
import {
  createRoom,
  confirmMeetingPlan,
  ensureSignedIn,
  joinRoom,
  leaveRoom,
  loadMeetingInvitation,
  loadRoom,
  proposeMeetingTime,
  RoomFullError,
  RoomNotFoundError,
  setMyArrivalStatus,
  setMyPoint as saveMyPoint,
  setRoomBudget,
  subscribeToRoom,
  startMeetingPlanning,
  reopenMeetingPlanning,
  proposeMeetingVenue,
  castMeetingVote,
  ensureMeetingPlanning,
  setMeetingTime,
  type MeetingRoomSnapshot,
} from '../roomService';
import type { ArrivalStatus, MeetingInvitation, MeetingRoom, MeetingVenue, RoomError, StartingPoint } from '../types';

export type MeetingRoomView =
  | { status: 'unconfigured' }
  /** Not in a room. `invitedCode` is set when the page was opened from a room link. */
  | { status: 'lobby'; invitedCode: string | null; invitation: MeetingInvitation | null }
  | { status: 'checking'; code: string }
  | ({ status: 'ready' } & MeetingRoomSnapshot);

function initialCode(): string | null {
  return normaliseRoomCode(roomParam() ?? '');
}

function initialView(): MeetingRoomView {
  if (!supabase) return { status: 'unconfigured' };
  const code = initialCode();
  return code ? { status: 'checking', code } : { status: 'lobby', invitedCode: null, invitation: null };
}

function toRoomError(error: unknown): RoomError {
  if (error instanceof RoomNotFoundError) return 'not_found';
  if (error instanceof RoomFullError) return 'full';
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/Meeting (voting|auto-planning) SQL migration is required/.test(message)) return 'schema_required';
  if (message.includes('meeting_planning_started')) return 'planning_started';
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
  const reloadRef = useRef<() => Promise<boolean>>();

  useEffect(() => {
    const client = supabase;
    if (!client || !code) return;

    let cancelled = false;
    // Reloads can overlap when several changes arrive together; only the latest may render.
    let ticket = 0;
    let unsubscribe: (() => void) | undefined;
    let subscribing = false;
    let poll: number | undefined;

    const reload = async (): Promise<boolean> => {
      const mine = ++ticket;
      try {
        let snapshot = await loadRoom(client, code);
        if (cancelled || mine !== ticket) return false;
        // The database starts changed-origin rounds even if the host is offline.
        // This idempotent member RPC also prepares an already-ready, pre-upgrade room.
        if (snapshot && !snapshot.room.planningStarted && snapshot.members.length >= 2 &&
          snapshot.members.every(member => member.planningStatus === 'Ready') &&
          Date.parse(snapshot.room.meetingTime) - snapshot.room.timeBudget * 60_000 > Date.now() &&
          Date.parse(snapshot.room.meetingTime) <= Date.now() + 30 * 24 * 3600_000) {
          await ensureMeetingPlanning(client, code);
          if (cancelled || mine !== ticket) return false;
          snapshot = await loadRoom(client, code);
          if (cancelled || mine !== ticket) return false;
        }
        if (!snapshot) {
          const invitation = await loadMeetingInvitation(client, code);
          if (cancelled || mine !== ticket) return false;
          setView({ status: 'lobby', invitedCode: code, invitation });
          setError(invitation ? null : 'not_found');
          return false;
        }
        setError(null);
        setView({ status: 'ready', ...snapshot });
        if (!unsubscribe && !subscribing) {
          subscribing = true;
          void subscribeToRoom(client, code, () => void reload())
            .then(stop => {
              if (cancelled) stop();
              else unsubscribe = stop;
            })
            .catch(reason => console.error('Meeting room live updates are unavailable:', reason))
            .finally(() => { subscribing = false; });
        }
        return true;
      } catch (reason) {
        if (!cancelled && mine === ticket) setError(toRoomError(reason));
        return false;
      }
    };
    reloadRef.current = reload;

    setView({ status: 'checking', code });
    ensureSignedIn(client)
      .then(async id => {
        if (cancelled) return;
        setMyUserId(id);
        await reload();
        if (cancelled) return;
        // Safe polling keeps invitation and member projections current without subscribing to
        // participant rows. A room member also gets prompt room-level invalidations.
        poll = window.setInterval(() => void reload(), 15_000);
      })
      .catch(() => {
        if (cancelled) return;
        setView({ status: 'lobby', invitedCode: code, invitation: null });
        setError('unavailable');
      });

    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearInterval(poll);
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
      setView({ status: 'lobby', invitedCode: null, invitation: null });
    } catch (reason) {
      setError(toRoomError(reason));
    } finally {
      setBusy(false);
    }
  };

  /** Persists before rendering so the authenticated ranking request sees the same budget. */
  const changeBudget = async (budget: number) => {
    if (!supabase || view.status !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      await setRoomBudget(supabase, view.room.code, budget);
      await reloadRef.current?.();
    } catch (reason) {
      setError(toRoomError(reason));
    } finally {
      setBusy(false);
    }
  };

  /** Only a successfully persisted point can turn the shared Ready status green. */
  const setMyPoint = async (point: StartingPoint | null) => {
    if (!supabase || view.status !== 'ready' || !myUserId || busy) return false;
    setError(null);
    setBusy(true);
    try {
      await saveMyPoint(supabase, view.room.code, myUserId, point);
      return await reloadRef.current?.() ?? false;
    } catch (reason) {
      setError(toRoomError(reason));
      void reloadRef.current?.();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const roomAction = async (action: (client: NonNullable<typeof supabase>, room: MeetingRoom) => Promise<void>) => {
    if (!supabase || view.status !== 'ready') throw new Error('Room is unavailable.');
    setBusy(true);
    setError(null);
    try {
      await action(supabase, view.room);
      await reloadRef.current?.();
    } catch (reason) {
      setError(toRoomError(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  const confirmPlan = async (venue: MeetingVenue, arrivalTime: string) => {
    if (!supabase || view.status !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      await confirmMeetingPlan(supabase, view.room.code, venue, arrivalTime);
      await reloadRef.current?.();
    } catch (reason) {
      setError(toRoomError(reason));
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  const suggestTime = async (arrivalTime: string) => {
    if (!supabase || view.status !== 'ready') return;
    setError(null);
    try {
      await proposeMeetingTime(supabase, view.room.code, arrivalTime);
      await reloadRef.current?.();
    } catch (reason) {
      setError(toRoomError(reason));
      throw reason;
    }
  };

  const publishStatus = async (status: ArrivalStatus, planVersion: number) => {
    if (!supabase || view.status !== 'ready') return;
    setError(null);
    try {
      await setMyArrivalStatus(supabase, view.room.code, status, planVersion);
      await reloadRef.current?.();
    } catch (reason) {
      setError(toRoomError(reason));
      throw reason;
    }
  };

  return {
    view,
    myUserId,
    error,
    busy,
    create,
    join,
    leave,
    changeBudget,
    changeMeetingTime: (arrival: string) => roomAction((client, room) => setMeetingTime(client, room.code, arrival)),
    setMyPoint,
    confirmPlan,
    suggestTime,
    publishStatus,
    startPlanning: (departure: string, arrival: string) => roomAction((client, room) => startMeetingPlanning(client, room.code, departure, arrival)),
    reopenPlanning: () => roomAction((client, room) => reopenMeetingPlanning(client, room.code)),
    proposeVenue: (venue: MeetingVenue) => roomAction((client, room) => proposeMeetingVenue(client, room.code, venue, room.planningRevision)),
    vote: (venue: MeetingVenue) => roomAction((client, room) => {
      if (!room.votingArrivalTime) throw new Error('Choose a shared arrival time first.');
      return castMeetingVote(client, room.code, venue, room.votingArrivalTime, room.planningRevision);
    }),
  };
}
