"""Thread-safe process-local caching for exchange-rate responses."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Condition, RLock
from typing import Callable, Mapping
import time


@dataclass(frozen=True)
class CachedExchangeRate:
    value: dict
    fetched_at: float


class ExchangeRateCache:
    """Cache successful responses and coalesce refreshes for each base currency."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._entries: dict[str, CachedExchangeRate] = {}
        self._refreshing: set[str] = set()
        self._refresh_generations: dict[str, int] = {}
        self._refresh_failures: dict[tuple[str, int], Exception] = {}
        self._waiters: dict[tuple[str, int], int] = {}
        self._condition = Condition(RLock())

    def clear(self) -> None:
        with self._condition:
            self._entries.clear()

    def get_or_fetch(
        self,
        base_currency: str,
        fetch: Callable[[], Mapping],
        ttl_seconds: float,
    ) -> dict:
        """Return a fresh, cached, or stale last-known-good response.

        A single refresh is active for each base currency. Waiting callers reuse the
        completed response rather than issuing a second upstream request.
        """
        key = base_currency.upper()
        with self._condition:
            entry = self._entries.get(key)
            if self._is_fresh(entry, ttl_seconds):
                return self._with_status(entry.value, "cached")

            if key in self._refreshing:
                had_cached_entry = entry is not None
                generation = self._refresh_generations[key]
                refresh_key = (key, generation)
                self._waiters[refresh_key] = self._waiters.get(refresh_key, 0) + 1
                while (
                    self._refresh_generations.get(key) == generation
                    and key in self._refreshing
                ):
                    self._condition.wait()
                try:
                    if had_cached_entry:
                        entry = self._entries.get(key)
                        if entry is not None:
                            status = "cached" if self._is_fresh(entry, ttl_seconds) else "stale"
                            return self._with_status(entry.value, status)
                    failure = self._refresh_failures.get(refresh_key)
                    if failure is not None:
                        raise failure
                    entry = self._entries.get(key)
                    if entry is not None:
                        status = "cached" if self._is_fresh(entry, ttl_seconds) else "stale"
                        return self._with_status(entry.value, status)
                finally:
                    remaining_waiters = self._waiters[refresh_key] - 1
                    if remaining_waiters:
                        self._waiters[refresh_key] = remaining_waiters
                    else:
                        self._waiters.pop(refresh_key)
                        self._refresh_failures.pop(refresh_key, None)

            generation = self._refresh_generations.get(key, 0) + 1
            self._refresh_generations[key] = generation
            self._refreshing.add(key)

        try:
            fresh_value = dict(fetch())
        except Exception as error:
            with self._condition:
                entry = self._entries.get(key)
                refresh_key = (key, generation)
                if self._waiters.get(refresh_key):
                    self._refresh_failures[refresh_key] = error
                self._refreshing.remove(key)
                self._condition.notify_all()
                if entry is not None:
                    return self._with_status(entry.value, "stale")
            raise

        with self._condition:
            entry = CachedExchangeRate(value=fresh_value, fetched_at=self._clock())
            self._entries[key] = entry
            self._refreshing.remove(key)
            self._condition.notify_all()
            return self._with_status(entry.value, "fresh")

    def _is_fresh(self, entry: CachedExchangeRate | None, ttl_seconds: float) -> bool:
        return entry is not None and self._clock() - entry.fetched_at < ttl_seconds

    @staticmethod
    def _with_status(value: Mapping, cache_status: str) -> dict:
        response = dict(value)
        rates = response.get("rates")
        if isinstance(rates, dict):
            response["rates"] = dict(rates)
        response["cache_status"] = cache_status
        return response
