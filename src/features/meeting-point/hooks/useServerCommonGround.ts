import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCommonGround, MeetingSearchExpiredError, type CommonGroundResult } from '../commonGroundService';
import { supabase } from '../supabaseClient';
import type { VenueType } from '../venueService';

export type ServerCommonGroundState =
  | { status: 'idle' }
  | { status: 'loading'; result?: CommonGroundResult }
  | { status: 'ready'; result: CommonGroundResult }
  | { status: 'failed'; message?: string; result?: CommonGroundResult; restartRequired?: boolean };

export interface CommonGroundController {
  state: ServerCommonGroundState;
  retry: () => void;
  loadMore?: (types?: ReadonlySet<VenueType>) => void;
  restart?: () => void;
  loadingMore?: boolean;
  searchTypesKey?: string;
}

export function useServerCommonGround(
  code: string | null,
  timeBudget: number,
  venueTypes: ReadonlySet<VenueType>,
  roomRevision: string,
): CommonGroundController {
  const [revision, setRevision] = useState(0);
  const baseTypesKey = [...venueTypes].sort().join(',');
  const contextKey = `${code ?? ''}|${timeBudget}|${roomRevision}`;
  const configurationKey = `${contextKey}|${baseTypesKey}`;
  const [requested, setRequested] = useState({ key: configurationKey, typesKey: baseTypesKey, page: 0 });
  const typesKey = requested.key === configurationKey ? requested.typesKey : baseTypesKey;
  const searchKey = `${contextKey}|${typesKey}`;
  const page = requested.key === configurationKey ? requested.page : 0;
  const requestKey = `${searchKey}|${page}|${revision}`;
  const lastGood = useRef<{ context: string; result: CommonGroundResult } | null>(null);
  const [settled, setSettled] = useState<{ key: string; context: string; value: ServerCommonGroundState }>({
    key: requestKey,
    context: contextKey,
    value: { status: 'idle' },
  });
  const selectedTypes = useMemo(
    () => (typesKey ? typesKey.split(',') as VenueType[] : []),
    [typesKey],
  );

  useEffect(() => {
    if (lastGood.current?.context !== contextKey) lastGood.current = null;
    const client = supabase;
    if (!client || !code || selectedTypes.length === 0) {
      setSettled({ key: requestKey, context: contextKey, value: { status: 'idle' } });
      return;
    }

    const controller = new AbortController();
    let current = true;
    let preview = lastGood.current?.context === contextKey ? lastGood.current.result : undefined;
    setSettled({ key: requestKey, context: contextKey, value: { status: 'loading', result: preview } });
    fetchCommonGround(client, code, timeBudget, selectedTypes, controller.signal, Number(roomRevision), result => {
      if (current && !(preview && ['ready', 'no_common_ground'].includes(preview.status) && result.status === 'finding_places')) {
        preview = result;
        setSettled({ key: requestKey, context: contextKey, value: { status: 'loading', result } });
      }
    }, page)
      .then(result => {
        if (current) {
          lastGood.current = { context: contextKey, result };
          setSettled({ key: requestKey, context: contextKey, value: { status: 'ready', result } });
        }
      })
      .catch(error => {
        if (!current || controller.signal.aborted) return;
        console.error('Could not calculate shared meeting places:', error);
        setSettled({ key: requestKey, context: contextKey, value: { status: 'failed', result: preview,
          restartRequired: error instanceof MeetingSearchExpiredError,
          message: error instanceof Error ? error.message : 'Common-ground calculation is unavailable.' } });
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [code, timeBudget, selectedTypes, roomRevision, revision, requestKey, contextKey, page]);

  const retry = useCallback(() => setRevision(value => value + 1), []);
  // Effects run after paint. Mask a result from the previous room revision immediately so an
  // old proposal cannot be confirmed during that frame.
  const previous = settled.context === contextKey && 'result' in settled.value ? settled.value.result : undefined;
  const state: ServerCommonGroundState = settled.key === requestKey ? settled.value : { status: 'loading', result: previous };
  const loadMore = (types?: ReadonlySet<VenueType>) => {
    if (state.status !== 'ready') return;
    const nextTypes = types ? [...types].sort().join(',') : typesKey;
    if (!nextTypes) return;
    if (nextTypes !== typesKey) setRequested({ key: configurationKey, typesKey: nextTypes, page: 0 });
    else if (state.result.hasMore) setRequested({ key: configurationKey, typesKey, page: (state.result.searchPage ?? 0) + 1 });
  };
  const restart = () => { setRequested({ key: configurationKey, typesKey, page: 0 }); setRevision(value => value + 1); };
  return { state, retry, loadMore, restart, loadingMore: page > 0 && state.status === 'loading', searchTypesKey: typesKey };
}
