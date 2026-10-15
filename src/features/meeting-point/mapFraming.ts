import type { Map as LeafletMap } from 'leaflet';

const HORIZONTAL_GUTTER_PX = 24;
const TOP_GUTTER_PX = 48;
const PANEL_GAP_PX = 16;

interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function paddingForPanelRects(page: RectLike, panels: RectLike[]): {
  paddingTopLeft: [number, number];
  paddingBottomRight: [number, number];
} {
  let left = HORIZONTAL_GUTTER_PX;
  let right = HORIZONTAL_GUTTER_PX;
  let bottom = TOP_GUTTER_PX;

  for (const panel of panels) {
    const overlapWidth = Math.max(0, Math.min(page.right, panel.right) - Math.max(page.left, panel.left));
    const overlapHeight = Math.max(0, Math.min(page.bottom, panel.bottom) - Math.max(page.top, panel.top));
    if (!overlapWidth || !overlapHeight) continue;

    if (overlapWidth >= page.width * 0.65) {
      bottom = Math.max(bottom, page.bottom - panel.top + PANEL_GAP_PX);
    } else if (panel.left < page.left + page.width / 2) {
      left = Math.max(left, panel.right - page.left + PANEL_GAP_PX);
    } else {
      right = Math.max(right, page.right - panel.left + PANEL_GAP_PX);
    }
  }

  return { paddingTopLeft: [left, TOP_GUTTER_PX], paddingBottomRight: [right, bottom] };
}

/**
 * Padding that keeps a framed point or area clear of whichever panels cover the map, so
 * "Show everyone" and selecting a ranked place never land what they frame under a panel.
 */
export function panelPadding(map: LeafletMap): {
  paddingTopLeft: [number, number];
  paddingBottomRight: [number, number];
} {
  const container = map.getContainer();
  const page = container.closest<HTMLElement>('.meeting-map-page');
  if (!page) return { paddingTopLeft: [HORIZONTAL_GUTTER_PX, TOP_GUTTER_PX], paddingBottomRight: [HORIZONTAL_GUTTER_PX, TOP_GUTTER_PX] };
  const pageRect = page.getBoundingClientRect();
  const panels = [...page.querySelectorAll<HTMLElement>('.meeting-left-panel:not([hidden]), .meeting-places-panel:not([hidden])')]
    .filter(panel => panel.getClientRects().length > 0)
    .map(panel => panel.getBoundingClientRect());
  return paddingForPanelRects(pageRect, panels);
}
