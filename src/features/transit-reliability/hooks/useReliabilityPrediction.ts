import { useEffect, useState } from 'react';
import { requestReliabilityPrediction } from '../services/reliabilityApi';
import type { ReliabilityQuery, ReliabilityResponse } from '../types';

export function useReliabilityPrediction() {
  const [result, setResult] = useState<ReliabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);

  useEffect(() => () => controller?.abort(), [controller]);

  const predict = async (query: ReliabilityQuery) => {
    controller?.abort();
    const next = new AbortController();
    setController(next);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await requestReliabilityPrediction(query, next.signal));
    } catch (reason) {
      if (!next.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Reliability service unavailable');
      }
    } finally {
      if (!next.signal.aborted) setLoading(false);
    }
  };
  return { result, loading, error, predict };
}

