from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import monotonic
from uuid import UUID

from backend.app.schemas.meetings import CommonGroundJobRequest, CommonGroundJobResponse, CommonGroundResponse
from backend.app.services.meeting_service import (
    BudgetChangedError, MeetingInputsChangedError, RoomUnavailableError,
    RoutingUnavailableError, check_room_revision, common_ground,
)


JOB_DEADLINE_SECONDS = 90
MAX_JOBS = 16
RESULT_TTL_SECONDS = 60
FAILURE_COOLDOWN_SECONDS = 5


class MeetingQueueFullError(Exception):
    pass


@dataclass
class _Job:
    code: str
    revision: int
    response: CommonGroundJobResponse
    expires: float
    task: asyncio.Task[None] | None = None
    expiry_handle: asyncio.TimerHandle | None = None


class MeetingJobs:
    """Short-lived, member-only single-flight jobs for the existing one-worker service.

    Not a durable queue: restart loses jobs and the next poll restarts safely. Scaling
    to multiple workers requires a shared coordinator, not a per-worker cache claim.
    No tokens or travel-time rasters are retained; failed previews never enable voting.
    """

    def __init__(self) -> None:
        self.jobs: dict[tuple[str, int, int, tuple[str, ...]], _Job] = {}

    async def poll(self, code: str, caller: UUID, request: CommonGroundJobRequest) -> CommonGroundJobResponse:
        budget = await asyncio.to_thread(check_room_revision, code, caller, request.room_revision, request.time_budget)
        now = monotonic()
        for key, job in list(self.jobs.items()):
            if job.expires <= now or (job.code == code and job.revision < request.room_revision):
                if job.task is not None:
                    job.task.cancel()
                if job.expiry_handle is not None:
                    job.expiry_handle.cancel()
                del self.jobs[key]
        key = (code, request.room_revision, budget, tuple(sorted(request.venue_types)))
        job = self.jobs.get(key)
        if job is None:
            if len(self.jobs) >= MAX_JOBS:
                raise MeetingQueueFullError
            job = _Job(code, request.room_revision, CommonGroundJobResponse(status="computing"), now + JOB_DEADLINE_SECONDS + 5)
            self.jobs[key] = job
            job.task = asyncio.create_task(self._run(job, caller, request))
            self._schedule_expiry(key, job)
        # Membership/revision can change during the first authorization query.
        await asyncio.to_thread(check_room_revision, code, caller, request.room_revision, budget)
        return job.response.model_copy(deep=True)

    def _schedule_expiry(self, key: tuple[str, int, int, tuple[str, ...]], job: _Job) -> None:
        if job.expiry_handle is not None:
            job.expiry_handle.cancel()
        def expire() -> None:
            if self.jobs.get(key) is job:
                if job.task is not None and not job.task.done():
                    job.task.cancel()
                del self.jobs[key]
        job.expiry_handle = asyncio.get_running_loop().call_later(max(0, job.expires - monotonic()), expire)

    async def _run(self, job: _Job, caller: UUID, request: CommonGroundJobRequest) -> None:
        def publish_areas(result: CommonGroundResponse) -> None:
            job.response = CommonGroundJobResponse(status="computing", result=result)

        try:
            result = await asyncio.wait_for(common_ground(
                job.code, caller, request.venue_types, request.time_budget,
                on_areas=publish_areas, verification_timeout=45,
            ), timeout=JOB_DEADLINE_SECONDS)
            if result.room_revision != job.revision:
                raise MeetingInputsChangedError
            job.response = CommonGroundJobResponse(status="ready", result=result)
            job.expires = monotonic() + RESULT_TTL_SECONDS
        except asyncio.CancelledError:
            raise
        except (MeetingInputsChangedError, BudgetChangedError, RoomUnavailableError):
            job.response = CommonGroundJobResponse(status="failed", reason="room_changed")
            job.expires = monotonic() + FAILURE_COOLDOWN_SECONDS
        except Exception as error:
            reason = "routing_unavailable" if isinstance(error, (RoutingUnavailableError, TimeoutError)) else "calculation_failed"
            logging.getLogger(__name__).warning("Meeting job failed phase=%s error_type=%s",
                                                "places" if job.response.result else "areas", type(error).__name__)
            job.response = CommonGroundJobResponse(status="failed", reason=reason, result=job.response.result, retryAfterSeconds=FAILURE_COOLDOWN_SECONDS)
            job.expires = monotonic() + FAILURE_COOLDOWN_SECONDS
        finally:
            current = asyncio.current_task()
            if current is not None and not current.cancelling():
                for owned_key, owned_job in self.jobs.items():
                    if owned_job is job:
                        self._schedule_expiry(owned_key, job)
                        break

    async def close(self) -> None:
        tasks = [job.task for job in self.jobs.values() if job.task is not None]
        for task in tasks:
            task.cancel()
        for job in self.jobs.values():
            if job.expiry_handle is not None:
                job.expiry_handle.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.jobs.clear()


meeting_jobs = MeetingJobs()
