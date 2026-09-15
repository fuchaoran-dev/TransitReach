import { CircleMarker, Popup } from 'react-leaflet';
import type { Venue } from '../venueService';

/**
 * Places inside the shared area.
 *
 * Small, white, with a dark ring. They sit on the graphite shared area, where a dark or
 * category-coloured dot would sink, and they must not read as another person — whose markers
 * are larger, coloured and named. One style for every kind of place: the participant colours
 * already use up what colour can reliably distinguish on this map, and the filter says which
 * kinds are showing.
 *
 * A tap opens the place's details and does not reach the map, so it cannot move the viewer's
 * starting point by accident.
 *
 * Opening hours are shown as OpenStreetMap records them, and labelled so: they are entered by
 * volunteers and can be out of date. Whether a place is open when the group arrives is Epic 7's
 * question, and is not implied here.
 */
export function VenueMarkers({ venues }: { venues: Venue[] }) {
  return (
    <>
      {venues.map(venue => (
        <CircleMarker
          key={venue.id}
          center={[venue.lat, venue.lon]}
          radius={5}
          pane="markerPane"
          bubblingMouseEvents={false}
          pathOptions={{
            className: 'meeting-venue',
            color: '#1e293b',
            weight: 2,
            fillColor: '#ffffff',
            fillOpacity: 1,
          }}
        >
          <Popup>
            <div className="text-sm font-semibold text-slate-900">{venue.name}</div>
            <div className="text-xs text-slate-600">{venue.kindLabel}</div>
            {venue.type !== 'station' && (
              <>
                <div className="text-xs text-slate-600 mt-1">{venue.address ?? 'Address not recorded'}</div>
                <div className="text-xs text-slate-600">
                  {venue.hours ? `Opening hours (OpenStreetMap): ${venue.hours}` : 'Opening hours not recorded'}
                </div>
              </>
            )}
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}
