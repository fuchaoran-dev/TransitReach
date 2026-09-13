from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable


class NoOperationalDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResolvedTrainingSource:
    path: Path
    origin: str
    warning: str | None = None


def resolve_training_source(
    cached_path: Path,
    refresh: Callable[[], Path] | None = None,
) -> ResolvedTrainingSource:
    """Try a refresh, then use a non-empty local artifact if the server is unavailable.

    The fallback is deliberately data-only: it never creates observations, labels, or a
    model. A missing/empty cache stops training instead of fabricating ground truth.
    """
    refresh_error: Exception | None = None
    if refresh is not None:
        try:
            refreshed = refresh()
            if refreshed.is_file() and refreshed.stat().st_size > 0:
                return ResolvedTrainingSource(refreshed, "refreshed")
            refresh_error = ValueError("refresh returned an empty or missing file")
        except Exception as exc:
            refresh_error = exc

    if cached_path.is_file() and cached_path.stat().st_size > 0:
        warning = None
        if refresh_error is not None:
            warning = f"Server refresh unavailable; using cached data: {refresh_error}"
        return ResolvedTrainingSource(cached_path, "cache", warning)

    detail = f": {refresh_error}" if refresh_error is not None else ""
    raise NoOperationalDataError(
        "No real historical operational data are available for training" + detail
    )
