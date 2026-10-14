/** Existing SQL stores the preview window opening, not a required group departure. */
export function meetingPreviewStart(arrival: string, budget: number, now = Date.now()): string {
  const deadline = Date.parse(arrival);
  if (!Number.isFinite(deadline) || ![15, 30, 45, 60].includes(budget)) throw new Error('Choose a valid meeting time and travel-time budget.');
  const start = deadline - budget * 60_000;
  if (start <= now) throw new Error(`Choose a meeting at least ${budget} minutes ahead so the whole planning window is in the future.`);
  if (deadline > now + 30 * 24 * 3600_000) throw new Error('Choose a meeting within the next 30 days.');
  return new Date(start).toISOString();
}
