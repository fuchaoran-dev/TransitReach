import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCommonGround, type CommonGroundResult } from '../commonGroundService';
import { supabase } from '../supabaseClient';
import type { VenueType } from '../venueService';

export type ServerCommonGroundState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: CommonGroundResult }
  | { status: 'failed' };

export function useServerCommonGround(
  code: string | null,
  timeBudget: number,
  venueTypes: ReadonlySet<VenueType>,
  roomRevision: string,
) {
  const [revision, setRevision] = useState(0);
  const typesKey = [...venueTypes].sort().join(',');
  const requestKey = `${code ?? ''}|${timeBudget}|${typesKey}|${roomRevision}|${revision}`;
  const [settled, setSettled] = useState<{ key: string; value: ServerCommonGroundState }>({
    key: requestKey,
    value: { status: 'idle' },
  });
  const selectedTypes = useMemo(
    () => (typesKey ? typesKey.split(',') as VenueType[] : []),
    [typesKey],
  );

  useEffect(() => {
    const client = supabase;
    if (!client || !code || selectedTypes.length === 0) {
      setSettled({ key: requestKey, value: { status: 'idle' } });
      return;
    }

    const controller = new AbortController();
    let current = true;
    setSettled({ key: requestKey, value: { status: 'loading' } });
    fetchCommonGround(client, code, timeBudget, selectedTypes, controller.signal)
      .then(result => {
        if (current) setSettled({ key: requestKey, value: { status: 'ready', result } });
      })
      .catch(error => {
        if (!current || controller.signal.aborted) return;
        console.error('Could not calculate shared meeting places:', error);
        setSettled({ key: requestKey, value: { status: 'failed' } });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [code, timeBudget, selectedTypes, roomRevision, revision, requestKey]);

  const retry = useCallback(() => setRevision(value => value + 1), []);
  // Effects run after paint. Mask a result from the previous room revision immediately so an
  // old proposal cannot be confirmed during that frame.
  const state: ServerCommonGroundState = settled.key === requestKey ? settled.value : { status: 'loading' };
  return { state, retry };
}
