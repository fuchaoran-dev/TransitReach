"""Small process-local TTL/LRU caches; no disk fallback or private user data."""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from threading import RLock
from time import monotonic
from typing import Callable, Hashable, TypeVar, cast

T = TypeVar("T")


class TTLCache:
    def __init__(self, ttl_seconds: float, max_entries: int = 1, clock=monotonic):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._clock = clock
        self._entries: OrderedDict[Hashable, tuple[float, object]] = OrderedDict()
        self._pending: dict[Hashable, Future] = {}
        self._generation = 0
        self._lock = RLock()

    def get(self, key: Hashable, load: Callable[[], T]) -> T:
        # Same-key misses share both the result and any failure. Never hold the lock
        # during network work: unrelated keys and cache hits must remain responsive.
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry[0] > self._clock():
                self._entries.move_to_end(key)
                return cast(T, entry[1])
            self._entries.pop(key, None)
            future = self._pending.get(key)
            owner = future is None
            if owner:
                future = Future()
                self._pending[key] = future
            generation = self._generation
        if not owner:
            return cast(T, future.result())
        try:
            value = load()  # Exceptions must not become cached failures.
        except BaseException as error:
            with self._lock:
                if self._pending.get(key) is future:
                    self._pending.pop(key)
                future.set_exception(error)
            raise
        with self._lock:
            if generation == self._generation and self.ttl_seconds > 0 and self.max_entries > 0:
                self._entries[key] = (self._clock() + self.ttl_seconds, value)
                while len(self._entries) > self.max_entries:
                    self._entries.popitem(last=False)
            if self._pending.get(key) is future:
                self._pending.pop(key)
            future.set_result(value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._pending.clear()
            self._generation += 1
