export function passTime(value: string | number | null): string {
  if (value === null) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function passDate(value: string): string {
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
}

export function marginLabel(seconds: number | null): string {
  if (seconds === null) return 'Not checked';
  return seconds < 0 ? `${Math.ceil(Math.abs(seconds) / 60)} min short` : `${Math.floor(seconds / 60)} min spare`;
}

/** datetime-local controls show Malaysia's clock, independent of the device timezone. */
export function malaysiaInputTime(value: string): string {
  const date = new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
}
