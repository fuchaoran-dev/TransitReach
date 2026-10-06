/** Session-only cache. Coordinates are never persisted or shared between users. */
export function createSharedRequestCache<T>(ttlMs: number, maxEntries: number) {
  const ready = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<T>; users: number }>();

  return (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
    const cached = ready.get(key);
    if (cached && cached.expires > Date.now()) {
      ready.delete(key);
      ready.set(key, cached);
      return Promise.resolve(cached.value);
    }
    ready.delete(key);
    let task = pending.get(key);
    if (!task) {
      const controller = new AbortController();
      task = { controller, users: 0, promise: Promise.resolve().then(() => load(controller.signal)) };
      const current = task;
      task.promise = task.promise.then(value => {
        if (!controller.signal.aborted && pending.get(key) === current) {
          ready.set(key, { value, expires: Date.now() + ttlMs });
          while (ready.size > maxEntries) ready.delete(ready.keys().next().value!);
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === current) pending.delete(key);
      });
      pending.set(key, task);
    }
    const current = task;
    current.users++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (--current.users === 0 && pending.get(key) === current) {
          pending.delete(key);
          current.controller.abort();
        }
        return true;
      };
      const abort = () => {
        if (release()) reject(new DOMException('Request cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(
        value => { if (release()) resolve(value); },
        error => { if (release()) reject(error); },
      );
    });
  };
}
