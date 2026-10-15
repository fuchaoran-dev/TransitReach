import { useEffect } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { usePrefersReducedMotion } from '@/shared/hooks';
import type { RankedPlace } from '../fairnessRanking';
import { panelPadding } from '../mapFraming';
import type { MeetingSelection } from '../types';

/** Close enough to read the streets around a place, without losing the stations nearby. */
const FOCUS_ZOOM = 15;

/**
 * A rank badge. Graphite with a white ring, like the white place dots inverted, so it reads
 * over the graphite shared area and over the street map; the selected place swaps to white on
 * graphite and grows, so it stands out from its neighbours by shape and contrast, not a new hue.
 */
function rankIcon(rank: number, selected: boolean, besideStart: boolean, proposed: boolean) {
  const size = selected || proposed ? 34 : 24;
  const html =
    `<div style="width:${size}px;height:${size}px;border-radius:9999px;display:flex;align-items:center;` +
    `justify-content:center;font:600 ${selected ? 13 : 11}px system-ui,sans-serif;` +
    `background:${proposed ? '#fbbf24' : selected ? '#ffffff' : '#1e293b'};color:${selected || proposed ? '#1e293b' : '#ffffff'};` +
    `border:${selected ? 3 : 2}px solid ${selected ? '#1e293b' : '#ffffff'};` +
    `box-shadow:0 1px 4px rgba(15,23,42,.45)">${rank}</div>`;
  // Move only the badge's screen anchor when it shares a point with a member.
  // The venue/member coordinates remain exact; the member's coloured circle stays visible.
  return divIcon({ className: `ranked-place-marker${proposed ? ' meeting-proposed-pin' : ''}`, html, iconSize: [size, size], iconAnchor: [besideStart ? -12 : size / 2, size / 2] });
}

interface RankedPlaceMarkersProps {
  /** The places currently listed, in rank order. */
  places: RankedPlace[];
  selectedId: string | null;
  onSelect: (venueId: string) => void;
  memberPoints?: Array<{ lat: number; lon: number }>;
  selections?: MeetingSelection[];
}

/** Numbers on the map for the places the list is showing, so the two can be read against each other. */
export function RankedPlaceMarkers({ places, selectedId, onSelect, memberPoints = [], selections = [] }: RankedPlaceMarkersProps) {
  return (
    <>
      {places.map((place, index) => {
        const selected = place.venue.id === selectedId;
        const rank = place.rank ?? index + 1;
        const proposers = selections.filter(selection => selection.venue.id === place.venue.id && selection.venue.type === place.venue.type);
        const besideStart = memberPoints.some(point => Math.abs(point.lat - place.venue.lat) < 0.00001 && Math.abs(point.lon - place.venue.lon) < 0.00001);
        return (
          <Marker
            key={place.venue.id}
            position={[place.venue.lat, place.venue.lon]}
            icon={rankIcon(rank, selected, besideStart, proposers.length > 0)}
            // Above the place dots and other ranks. The selected place also rises above the viewer's
            // own pin (1000): a café inside the station someone starts from was otherwise hidden
            // under their pin at the moment they asked to see it.
            zIndexOffset={selected || proposers.length ? 1100 : 500}
            title={`${rank}. ${place.venue.name}`}
            bubblingMouseEvents={false}
            eventHandlers={{ click: () => onSelect(place.venue.id) }}
          >{proposers.length > 0 && <Tooltip permanent direction="bottom" offset={[0, 16]}><span className="block max-w-44 text-center"><strong>Proposed</strong><br />{proposers.map(person => person.displayName).join(' · ')}</span></Tooltip>}</Marker>
        );
      })}
    </>
  );
}

/** AC 6.2.2 — brings the selected place into view, clear of both panels. */
export function FocusOnPlace({ place }: { place: { lat: number; lon: number } | null }) {
  const map = useMap();
  const reduced = usePrefersReducedMotion();
  const lat = place?.lat;
  const lon = place?.lon;

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const bounds = latLngBounds([lat, lon], [lat, lon]);
    const options = { ...panelPadding(map), maxZoom: FOCUS_ZOOM };
    if (reduced) map.fitBounds(bounds, options);
    else map.flyToBounds(bounds, { ...options, duration: 0.6 });
  }, [map, lat, lon, reduced]);

  return null;
}
