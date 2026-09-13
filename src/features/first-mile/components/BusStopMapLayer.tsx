import { Marker, Popup } from 'react-leaflet';

import L from 'leaflet';

import type { BusStop } from '../busStopService';
import { BusStopReliabilityPopup } from '@/features/transit-reliability';
import type { ReliabilityService } from '@/features/transit-reliability';

interface Props {
  stops: BusStop[];
  selectedStopId: string | null;
  onSelect: (stop: BusStop) => void;
  reliabilityServices: ReliabilityService[];
  reliabilityLoading: boolean;
  reliabilityError: string | null;
}

const busStopIcon =
  L.divIcon({
    className:
      'bus-stop-marker',

    html: `
      <div
        style="
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid #2563eb;
          box-shadow:
            0 1px 5px rgba(0,0,0,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
        "
      >
        🚏
      </div>
    `,

    iconSize: [
      22,
      22,
    ],

    iconAnchor: [
      11,
      11,
    ],

    popupAnchor: [
      0,
      -12,
    ],
  });

export function BusStopMapLayer({
  stops,
  selectedStopId,
  onSelect,
  reliabilityServices,
  reliabilityLoading,
  reliabilityError,
}: Props) {
  return (
    <>
      {stops.map(
        stop => (
          <Marker
            key={stop.stopId}
            position={[
              stop.lat,
              stop.lon,
            ]}
            icon={busStopIcon}
            zIndexOffset={stop.stopId === selectedStopId ? 900 : 0}
            eventHandlers={{ click: () => onSelect(stop) }}
          >
            <Popup>
              {stop.stopId === selectedStopId ? (
                <BusStopReliabilityPopup
                  stop={stop}
                  services={reliabilityServices}
                  catalogLoading={reliabilityLoading}
                  catalogError={reliabilityError}
                />
              ) : <div
                className="
                  min-w-[170px]
                "
              >
                <div
                  className="
                    text-[10px]
                    font-bold
                    uppercase
                    tracking-wide
                    text-blue-500
                  "
                >
                  Rapid KL Bus Stop
                </div>

                <div
                  className="
                    mt-1
                    font-semibold
                    text-slate-800
                  "
                >
                  {stop.name}
                </div>

                <div
                  className="
                    mt-2
                    text-xs
                    text-slate-500
                  "
                >
                  Stop ID:{' '}
                  {stop.stopId}
                </div>

                {stop
                  .distanceToAccessibleStationMeters !==
                  null && (
                  <div
                    className="
                      mt-1
                      text-xs
                      text-slate-500
                    "
                  >
                    {Math.round(
                      stop
                        .distanceToAccessibleStationMeters,
                    )}{' '}
                    m from an accessible
                    station
                  </div>
                )}

                <div
                  className="
                    mt-2
                    text-[10px]
                    text-slate-400
                  "
                >
                  Source:
                  Prasarana
                  GTFS Static
                  via
                  data.gov.my
                </div>
              </div>}
            </Popup>
          </Marker>
        ),
      )}
    </>
  );
}
