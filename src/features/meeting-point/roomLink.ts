/**
 * The share link is `?meet=<code>` on the app's own address.
 *
 * There is no router: the app switches screens on state, so the query string is read once to
 * decide which screen to open, and written back when a room is created, joined or left.
 */
const PARAM = 'meet';

/**
 * No I, L, O, 0 or 1, so a code read aloud or copied by hand cannot be misread.
 * Must match the check constraint on meeting_rooms.code in supabase/meeting-rooms.sql.
 */
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;

export function normaliseRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** The raw `meet` value, or null when the page was not opened from a room link. */
export function roomParam(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

/** True for any room link, even a malformed one, so the app opens the meeting screen to say so. */
export function hasRoomLink(): boolean {
  return roomParam() !== null;
}

export function writeRoomCodeToUrl(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set(PARAM, code);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(null, '', url);
}

export function shareLinkFor(code: string): string {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(PARAM, code);
  return url.toString();
}
