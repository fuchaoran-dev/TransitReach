from __future__ import annotations

import asyncio
import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, patch
from uuid import UUID

from backend.app.schemas.meetings import CommonGroundJobRequest
from backend.app.services.meeting_jobs import MeetingJobs, MeetingQueueFullError, MeetingSearchExpiredError, MeetingPageOrderError
from backend.app.services.meeting_service import (
    MeetingInputsChangedError, MeetingSearch, RoomUnavailableError, RoutingUnavailableError, common_ground,
)
from backend.tests.test_meeting_common_ground import AREA, CALCULATION, SURFACE
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.api.meetings import authenticated_user
from backend.app.schemas.meetings import CommonGroundJobResponse


REQUEST = CommonGroundJobRequest(timeBudget=60, roomRevision=7, venueTypes=["station"])


def response(status="ready"):
    from backend.app.schemas.meetings import CommonGroundResponse
    return CommonGroundResponse(
        status=status, participantCount=5, missingStartingPoints=0, budgetMinutes=60,
        roomRevision=7, departureTime=CALCULATION.departure_time, arrivalTime=CALCULATION.arrival_time,
        participantAreas=[AREA] * 5, proposals=[],
    )


class MeetingJobsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.jobs = MeetingJobs()
        self.auth = patch("backend.app.services.meeting_jobs.check_room_revision", return_value=60)
        self.check = self.auth.start()
        self.addCleanup(self.auth.stop)

    async def asyncTearDown(self):
        await self.jobs.close()

    async def test_five_members_share_one_job_and_get_area_before_places(self):
        release = asyncio.Event()
        areas_ready = asyncio.Event()
        async def calculate(*_args, on_areas, **_kwargs):
            on_areas(response("finding_places"))
            areas_ready.set()
            await release.wait()
            return response()
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(side_effect=calculate)) as calculate:
            initial = await asyncio.gather(*(self.jobs.poll("ABCDEFGH", UUID(int=i), REQUEST) for i in range(1, 6)))
            await areas_ready.wait()
            self.assertTrue(all(item.status == "computing" for item in initial))
            progress = await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)
            self.assertEqual(len(progress.result.participant_areas), 5)
            self.assertEqual(progress.result.status, "finding_places")
            self.assertEqual(progress.result.proposals, [])
            release.set()
            await next(iter(self.jobs.jobs.values())).task
            result = await self.jobs.poll("ABCDEFGH", UUID(int=3), REQUEST)
            self.assertEqual(result.status, "ready")
            self.assertEqual(calculate.await_count, 1)
            result.result.participant_areas.clear()
            self.assertEqual(len((await self.jobs.poll("ABCDEFGH", UUID(int=4), REQUEST)).result.participant_areas), 5)

    async def test_nonmember_cannot_start_or_read_existing_job(self):
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            self.check.side_effect = RoomUnavailableError
            with self.assertRaises(RoomUnavailableError):
                await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)

    async def test_changed_revision_cannot_read_previous_geometry(self):
        self.check.side_effect = MeetingInputsChangedError
        with self.assertRaises(MeetingInputsChangedError):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
        self.assertEqual(self.jobs.jobs, {})

    async def test_route_failure_keeps_only_preview_not_partial_places(self):
        async def calculate(*_args, on_areas, **_kwargs):
            on_areas(response("finding_places"))
            raise RoutingUnavailableError
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(side_effect=calculate)):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            await next(iter(self.jobs.jobs.values())).task
            result = await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)
            self.assertEqual((result.status, result.reason), ("failed", "routing_unavailable"))
            self.assertEqual(result.result.status, "finding_places")
            self.assertEqual(result.result.proposals, [])

    async def test_job_deadline_is_bounded_and_shutdown_cancels_work(self):
        cancelled = asyncio.Event()
        async def calculate(*_args, **_kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(side_effect=calculate)), patch("backend.app.services.meeting_jobs.JOB_DEADLINE_SECONDS", .01):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            await next(iter(self.jobs.jobs.values())).task
            self.assertTrue(cancelled.is_set())
            self.assertEqual((await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)).reason, "routing_unavailable")

    async def test_capacity_bound_does_not_evict_active_job(self):
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())), patch("backend.app.services.meeting_jobs.MAX_JOBS", 1):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            with self.assertRaises(MeetingQueueFullError):
                await self.jobs.poll("BCDEFGHJ", UUID(int=2), REQUEST)

    async def test_expired_result_starts_fresh_job(self):
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())) as calculate:
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            old = next(iter(self.jobs.jobs.values()))
            await old.task
            old.expires = 0
            await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)
            new = next(iter(self.jobs.jobs.values()))
            await new.task
            self.assertIsNot(old, new)
            self.assertEqual(calculate.await_count, 2)

    async def test_five_members_share_one_continuation_and_keep_first_page_visible(self):
        search = MeetingSearch(7, 60, CALCULATION.arrival_time, frozenset({"station"}), 0, (), frozenset(), (), (AREA,) * 5)
        first = response().model_copy(update={"has_more": True})
        release = asyncio.Event()
        continuing = asyncio.Event()

        async def calculate(*_args, search=None, on_search, **_kwargs):
            if search is None:
                on_search(initial_search)
                return first
            self.assertIs(search, initial_search)
            continuing.set()
            await release.wait()
            on_search(replace(search, page=1))
            return response().model_copy(update={"search_page": 1})

        initial_search = search
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(side_effect=calculate)) as calculate:
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            job = next(iter(self.jobs.jobs.values()))
            await job.task
            more = REQUEST.model_copy(update={"page": 1})
            await asyncio.gather(*(self.jobs.poll("ABCDEFGH", UUID(int=i), more) for i in range(1, 6)))
            await continuing.wait()
            cached = await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)
            self.assertEqual((cached.status, cached.result.search_page), ("ready", 0))
            pending = await self.jobs.poll("ABCDEFGH", UUID(int=2), more)
            self.assertEqual((pending.status, pending.result.search_page), ("computing", 0))
            release.set()
            await job.task
            complete = await self.jobs.poll("ABCDEFGH", UUID(int=3), more)
            self.assertEqual((complete.status, complete.result.search_page), ("ready", 1))
            self.assertEqual(calculate.await_count, 2)

    async def test_failed_more_retries_old_cursor_and_retains_verified_page(self):
        initial_search = MeetingSearch(7, 60, CALCULATION.arrival_time, frozenset({"station"}), 0, (), frozenset(), (), (AREA,) * 5)
        calls = 0

        async def calculate(*_args, search=None, on_search, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                on_search(initial_search)
                return response().model_copy(update={"has_more": True})
            self.assertIs(search, initial_search)
            if calls == 2:
                raise RoutingUnavailableError
            on_search(replace(search, page=1))
            return response().model_copy(update={"search_page": 1})

        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(side_effect=calculate)):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            job = next(iter(self.jobs.jobs.values()))
            await job.task
            more = REQUEST.model_copy(update={"page": 1})
            await self.jobs.poll("ABCDEFGH", UUID(int=1), more)
            await job.task
            self.assertIs(job.search, initial_search)
            failed = await self.jobs.poll("ABCDEFGH", UUID(int=1), more)
            self.assertEqual((failed.status, failed.result.search_page), ("failed", 0))
            cached = await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST)
            self.assertEqual(cached.status, "ready")
            job.retry_after = 0
            await self.jobs.poll("ABCDEFGH", UUID(int=1), more)
            await job.task
            self.assertEqual(job.completed_page, 1)
            self.assertEqual(calls, 3)

    async def test_missing_or_expired_more_never_silently_restarts_first_page(self):
        more = REQUEST.model_copy(update={"page": 1})
        with self.assertRaises(MeetingSearchExpiredError):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), more)
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())) as calculate:
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            job = next(iter(self.jobs.jobs.values()))
            await job.task
            job.expires = 0
            with self.assertRaises(MeetingSearchExpiredError):
                await self.jobs.poll("ABCDEFGH", UUID(int=1), more)
            self.assertEqual(calculate.await_count, 1)

    async def test_page_cannot_skip_pending_work_or_read_without_membership(self):
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())):
            await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST)
            await next(iter(self.jobs.jobs.values())).task
            with self.assertRaises(MeetingPageOrderError):
                await self.jobs.poll("ABCDEFGH", UUID(int=1), REQUEST.model_copy(update={"page": 2}))
            self.check.side_effect = RoomUnavailableError
            with self.assertRaises(RoomUnavailableError):
                await self.jobs.poll("ABCDEFGH", UUID(int=2), REQUEST.model_copy(update={"page": 1}))

    async def test_category_searches_have_separate_cached_progress(self):
        with patch("backend.app.services.meeting_jobs.common_ground", new=AsyncMock(return_value=response())) as calculate:
            for types in (["station"], ["mall"], ["station"]):
                request = REQUEST.model_copy(update={"venue_types": types})
                await self.jobs.poll("ABCDEFGH", UUID(int=1), request)
                await asyncio.gather(*(job.task for job in self.jobs.jobs.values()))
            self.assertEqual(calculate.await_count, 2)
            self.assertEqual(len(self.jobs.jobs), 2)

    async def test_real_service_publishes_all_five_areas_before_surface_or_routes(self):
        calculation = replace(CALCULATION, budget_minutes=60, participant_count=5, origins=CALCULATION.origins[:1] * 5)
        progress = []
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service.check_room_revision", return_value=60),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)) as surfaces,
            patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(return_value=10)) as routes,
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            def publish(result):
                self.assertEqual((surfaces.await_count, routes.await_count), (0, 0))
                progress.append(result)
            result = await common_ground("ABCDEFGH", UUID(int=1), ["station"], 60, on_areas=publish)
        self.assertEqual(len(progress[0].participant_areas), 5)
        self.assertEqual(result.status, "ready")
        self.assertEqual(routes.await_count, 5)


class MeetingJobApiTests(unittest.TestCase):
    def test_page_has_a_strict_finite_bound(self):
        from pydantic import ValidationError
        for page in (-1, 20, True, 1.5, "1"):
            with self.subTest(page=page), self.assertRaises(ValidationError):
                CommonGroundJobRequest(timeBudget=60, roomRevision=7, venueTypes=["mall"], page=page)

    def test_expired_search_is_explicit(self):
        app.dependency_overrides[authenticated_user] = lambda: UUID(int=1)
        try:
            with patch("backend.app.api.meetings.meeting_jobs.poll", new=AsyncMock(side_effect=MeetingSearchExpiredError)):
                result = TestClient(app).post("/api/meetings/ABCDEFGH/common-ground-job", json={**REQUEST.model_dump(by_alias=True), "page": 1})
            self.assertEqual(result.status_code, 410)
            self.assertIn("Restart", result.json()["detail"])
        finally:
            app.dependency_overrides.clear()
    def test_job_requires_authentication(self):
        result = TestClient(app).post("/api/meetings/ABCDEFGH/common-ground-job", json=REQUEST.model_dump(by_alias=True))
        self.assertEqual(result.status_code, 401)

    def test_poll_contract_and_private_cache_headers(self):
        app.dependency_overrides[authenticated_user] = lambda: UUID(int=1)
        try:
            with patch("backend.app.api.meetings.meeting_jobs.poll", new=AsyncMock(return_value=CommonGroundJobResponse(status="computing"))):
                result = TestClient(app).post("/api/meetings/ABCDEFGH/common-ground-job", json=REQUEST.model_dump(by_alias=True))
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["status"], "computing")
            self.assertIn("no-store", result.headers["cache-control"])
        finally:
            app.dependency_overrides.clear()

    def test_stale_round_and_nonmember_cannot_read_job(self):
        app.dependency_overrides[authenticated_user] = lambda: UUID(int=1)
        try:
            for error, status in ((MeetingInputsChangedError, 409), (RoomUnavailableError, 404), (MeetingQueueFullError, 503)):
                with self.subTest(status=status), patch("backend.app.api.meetings.meeting_jobs.poll", new=AsyncMock(side_effect=error)):
                    result = TestClient(app).post("/api/meetings/ABCDEFGH/common-ground-job", json=REQUEST.model_dump(by_alias=True))
                self.assertEqual(result.status_code, status)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
