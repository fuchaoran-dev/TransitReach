import { useEffect, useState } from 'react';
import { fetchLoadedFeeds } from '@/shared/services/transitRoutingClient';

/** The bus feeds' ids in routing/otp/build-config.json. */
const BUS_FEEDS = ['prasarana-rapid-bus-kl', 'prasarana-mrt-feeder'];

/**
 * Whether the routing engine behind this build can put a bus in a journey or a reachable
 * area. The app lists bus stops and routes from committed data whether or not the engine
 * has them, so without this a rider could be shown a bus to their destination and then a
 * journey that walks.
 *
 * False until the engine confirms a bus feed. Not knowing — the engine unreachable, or not
 * yet answered — is treated as no buses, so the interface never claims buses it cannot
 * show.
 */
export function useEngineRoutesBuses(): boolean {
  const [routesBuses, setRoutesBuses] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLoadedFeeds()
      .then(feeds => {
        if (!cancelled) setRoutesBuses(feeds.some(feed => BUS_FEEDS.includes(feed)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return routesBuses;
}
