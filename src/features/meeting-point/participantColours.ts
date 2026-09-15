import type { Participant } from './types';

/**
 * Participant colours.
 *
 * Validated with the dataviz palette checks (validate_palette.js, light mode, `--pairs all` —
 * on a map any two people's markers and areas can sit side by side, so every pair counts, not
 * only neighbours in a list).
 *
 * Teal is always the viewer: AC 1.3.4 reserves it for "you and your route". The other five
 * avoid the greens, orange and magenta already carried by service categories, and graphite,
 * which means "reachable area".
 *
 * Worst pair across all six: normal vision ΔE 19.8 (pink ↔ red); colour-blind ΔE 7.0
 * (pink ↔ teal, protan). That colour-blind figure is inside the 6–8 band, which is acceptable
 * only with a second cue — here the name label on every marker and the swatch beside every
 * name — so colour is never the only way to tell two people apart. Six hues cannot clear the
 * ≥8 target on every pair whichever they are; brown, sky, purple, deep pink and cyan were each
 * tried as the sixth and failed outright.
 */
export const YOU_COLOUR = '#0d9488';
const OTHER_COLOURS = ['#1d4ed8', '#dc2626', '#d4a017', '#f472b6', '#818cf8'] as const;

/**
 * A participant's colour as this viewer sees it.
 *
 * Keyed to the participant's stored colour slot, never to their position in the list: the
 * slot is fixed while they stay in the room, so someone else leaving does not repaint
 * everyone after them. Slots are counted on from the viewer's own, which gives the other five
 * slots the other five colours whichever slot the viewer holds.
 */
export function participantColour(participant: Participant, mySlot: number | null): string {
  if (mySlot === null) return OTHER_COLOURS[participant.colourSlot % OTHER_COLOURS.length];
  if (participant.colourSlot === mySlot) return YOU_COLOUR;
  return OTHER_COLOURS[(participant.colourSlot - mySlot + 5) % 6];
}
