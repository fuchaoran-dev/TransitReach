import type { Map as LeafletMap } from 'leaflet';

/** On a wide screen, people and settings cover the map's left edge and ranked places its right. */
const LEFT_PANEL_CLEARANCE_PX = 380;
const RIGHT_PANEL_CLEARANCE_PX = 400;
/** The `lg` breakpoint, from which both panels sit over the sides of the map. */
const WIDE_MAP_PX = 1024;
/** Below it the ranked list is a sheet along the bottom; leave room for its collapsed bar. */
const SHEET_CLEARANCE_PX = 96;

/**
 * Padding that keeps a framed point or area clear of whichever panels cover the map, so
 * "Show everyone" and selecting a ranked place never land what they frame under a panel.
 */
export function panelPadding(map: LeafletMap): {
  paddingTopLeft: [number, number];
  paddingBottomRight: [number, number];
} {
  return map.getSize().x >= WIDE_MAP_PX
    ? { paddingTopLeft: [LEFT_PANEL_CLEARANCE_PX, 48], paddingBottomRight: [RIGHT_PANEL_CLEARANCE_PX, 48] }
    : { paddingTopLeft: [24, 48], paddingBottomRight: [24, SHEET_CLEARANCE_PX] };
}
