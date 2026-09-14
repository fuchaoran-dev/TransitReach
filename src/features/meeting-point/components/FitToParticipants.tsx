import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { latLngBounds, type Map as LeafletMap } from 'leaflet';
import type { Participant } from '../types';

/** Room for the side panel, which covers the left of the map on a wide screen. */
const PANEL_CLEARANCE_PX = 380;
const WIDE_MAP_PX = 700;
/** Two people at one station should not zoom the map to building level. */
const FIT_MAX_ZOOM = 14;

interface FitToParticipantsProps {
  participants: Participant[];
  /** Incremented by "Show everyone"; each change frames everyone again. */
  request: number;
}

function parsePoints(key: string): [number, number][] {
  return key ? key.split('|').map(point => point.split(',').map(Number) as [number, number]) : [];
}

function frame(map: LeafletMap, points: [number, number][]) {
  if (points.length === 0) return;
  // The map mounts inside a page transition; measure the container as it is now.
  map.invalidateSize();
  const wide = map.getSize().x > WIDE_MAP_PX;
  map.fitBounds(latLngBounds(points), {
    paddingTopLeft: [wide ? PANEL_CLEARANCE_PX : 24, 48],
    paddingBottomRight: [48, 48],
    maxZoom: FIT_MAX_ZOOM,
  });
}

/**
 * Frames every participant's starting point.
 *
 * Automatically once, the first time two or more points are known: someone opening a link
 * otherwise lands on the whole network, or on their own pin, with no idea where the others
 * are. After that only on request. Re-framing whenever someone moves would pull the map away
 * from whoever is reading it.
 */
export function FitToParticipants({ participants, request }: FitToParticipantsProps) {
  const map = useMap();
  const pointsKey = participants
    .flatMap(participant => (participant.at ? [`${participant.at.lat},${participant.at.lon}`] : []))
    .join('|');

  const latestKey = useRef(pointsKey);
  useEffect(() => {
    latestKey.current = pointsKey;
  });

  const autoFramed = useRef(false);
  useEffect(() => {
    const points = parsePoints(pointsKey);
    if (autoFramed.current || points.length < 2) return;
    autoFramed.current = true;
    frame(map, points);
  }, [map, pointsKey]);

  useEffect(() => {
    if (request > 0) frame(map, parsePoints(latestKey.current));
  }, [map, request]);

  return null;
}
