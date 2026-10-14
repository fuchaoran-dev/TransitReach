from __future__ import annotations

import asyncio
import unittest
from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import psycopg
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.api.meetings import authenticated_user
from backend.app.main import app
from backend.app.schemas.meetings import CommonGroundResponse, ParticipantArea, PublicVenue
from backend.app.services.meeting_service import (
    BudgetChangedError, MeetingCalculation, PrivateOrigin,
    RoomUnavailableError, RoutingUnavailableError, _fetch_isochrone, _fetch_surface,
    _load_calculation, _store_proposals, common_ground,
)
from backend.app.services.travel_time_surface import TravelTimeSurface


CALLER = UUID("33ddefe5-e814-4420-9fd0-42bf9a522d39")
DEPARTURE = datetime.fromisoformat("2026-10-14T08:12:34+08:00")
OUTER = [[101.0, 3.0], [101.5, 3.0], [101.5, 3.5], [101.0, 3.5], [101.0, 3.0]]
HOLE = [[101.1, 3.1], [101.2, 3.1], [101.2, 3.2], [101.1, 3.1]]
AREA = ParticipantArea(regions=[{"outer": OUTER, "holes": [HOLE]}])
SURFACE = TravelTimeSurface(1, 1, 101, 4, 1, -1, (600,), -2147483648)
VENUE = PublicVenue(
    id="station-a", type="station", name="Alpha", kindLabel="Rail station", lat=3.8, lon=101.2,
)
CALCULATION = MeetingCalculation(
    budget_minutes=30, participant_count=2,
    origins=(PrivateOrigin(3.1, 101.1), PrivateOrigin(3.2, 101.2)), venues=(VENUE,),
    room_revision=7, planning_started=True, departure_time=DEPARTURE,
)


def collection(geometry: object) -> dict[str, object]:
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": geometry}]}


class MeetingCalculationLoadingTests(unittest.TestCase):
    @patch("backend.app.services.meeting_service.connection")
    def test_shared_planning_fields_are_read_after_membership_check(self, connect) -> None:
        database = MagicMock(spec=psycopg.Connection)
        connect.return_value.__enter__.return_value = database
        for started, departure in ((False, None), (True, DEPARTURE)):
            with self.subTest(started=started):
                database.execute.return_value.fetchone.return_value = {
                    "code": "ABCDEFGH", "time_budget": 30, "planning_revision": 7,
                    "planning_started": started, "departure_time": departure,
                }
                database.execute.return_value.fetchall.side_effect = [
                    [{"latitude": 3.1, "longitude": 101.1}, {"latitude": None, "longitude": None}],
                    [],
                ]
                result = _load_calculation("ABCDEFGH", CALLER, ["station"])
                self.assertEqual(result.planning_started, started)
                self.assertEqual(result.departure_time, departure)
                self.assertEqual(result.room_revision, 7)
                self.assertEqual(result.participant_count, 2)
                self.assertEqual(len(result.origins), 1)
        query, params = database.execute.call_args_list[0].args
        self.assertIn("r.planning_started, r.departure_time", query)
        self.assertIn("caller.user_id = %s", query)
        self.assertEqual(params, (CALLER, "ABCDEFGH"))

    @patch("backend.app.services.meeting_service.connection")
    def test_nonmember_never_reads_private_origins(self, connect) -> None:
        database = MagicMock(spec=psycopg.Connection)
        connect.return_value.__enter__.return_value = database
        database.execute.return_value.fetchone.return_value = None
        with self.assertRaises(RoomUnavailableError):
            _load_calculation("ABCDEFGH", CALLER, ["station"])
        self.assertEqual(database.execute.call_count, 1)
        database.execute.return_value.fetchall.assert_not_called()

    @patch("backend.app.services.meeting_service.connection")
    def test_empty_proposals_still_lock_and_guard_revision_and_budget(self, connect) -> None:
        database = MagicMock(spec=psycopg.Connection)
        connect.return_value.__enter__.return_value = database
        database.execute.return_value.fetchone.return_value = {"exists": 1}
        _store_proposals("ABCDEFGH", CALLER, 7, [], expected_budget=30)
        query, params = database.execute.call_args_list[0].args
        self.assertIn("r.planning_revision = %s", query)
        self.assertIn("r.time_budget = %s", query)
        self.assertIn("for share of r", query)
        self.assertEqual(params, (CALLER, "ABCDEFGH", 7, 30, 30))
        database.cursor.assert_not_called()
        self.assertEqual(database.execute.call_count, 2)


class MeetingGeometryContractTests(unittest.TestCase):
    def test_waiting_defaults_to_no_private_geometry_and_serializes_aliases(self) -> None:
        result = CommonGroundResponse(
            status="waiting_for_planning", participantCount=2, missingStartingPoints=1,
            budgetMinutes=30, roomRevision=7, departureTime=None, proposals=[],
        )
        body = result.model_dump(mode="json", by_alias=True)
        self.assertEqual(body["participantAreas"], [])
        self.assertEqual(body["roomRevision"], 7)
        self.assertIsNone(body["departureTime"])

    def test_geometry_rejects_invalid_coordinates_and_rings_in_outer_and_holes(self) -> None:
        invalid = [
            [], OUTER[:3], OUTER[:-1],
            [[101, 3], [101, 3], [101, 3], [101, 3]],
            [[101, 3], [102, 4], [103, 5], [101, 3]],
        ]
        for coordinate in (
            [float("nan"), 3], [101, float("inf")], [181, 3], [101, -91],
            [101, 3, 0], [True, 3], ["101", 3],
        ):
            ring = deepcopy(OUTER)
            ring[1] = coordinate
            invalid.append(ring)
        for ring in invalid:
            for field in ("outer", "holes"):
                with self.subTest(ring=ring, field=field), self.assertRaises(ValidationError):
                    ParticipantArea.model_validate({"regions": [{
                        "outer": ring if field == "outer" else OUTER,
                        "holes": [ring] if field == "holes" else [],
                    }]})

    def test_geometry_is_not_an_arbitrary_object(self) -> None:
        for body in ({"regions": []}, {"regions": [{"outer": OUTER, "user_id": str(CALLER)}]}):
            with self.subTest(body=body), self.assertRaises(ValidationError):
                ParticipantArea.model_validate(body)


class MeetingOtpGeometryTests(unittest.IsolatedAsyncioTestCase):
    async def test_polygon_and_multipolygon_keep_disjoint_regions_and_holes(self) -> None:
        for geometry in (
            {"type": "Polygon", "coordinates": [OUTER, HOLE]},
            {"type": "MultiPolygon", "coordinates": [[OUTER, HOLE], [OUTER]]},
        ):
            with self.subTest(kind=geometry["type"]):
                body = collection(geometry)
                async with httpx.AsyncClient(transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json=body),
                )) as client:
                    area = await _fetch_isochrone(client, CALCULATION.origins[0], 30, DEPARTURE)
                self.assertEqual(area.regions[0], AREA.regions[0])
                self.assertEqual(len(area.regions), 1 if geometry["type"] == "Polygon" else 2)

    @patch.dict("os.environ", {"MEETING_ROUTING_TIME": "2026-09-01T08:00:00+08:00"})
    async def test_surface_and_isochrone_share_actual_departure_budget_and_modes(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=collection({"type": "Polygon", "coordinates": [OUTER]}))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            with patch("backend.app.services.meeting_service.decode_travel_time_surface", return_value=SURFACE):
                await _fetch_surface(client, CALCULATION.origins[0], 30, DEPARTURE)
            await _fetch_isochrone(client, CALCULATION.origins[0], 30, DEPARTURE)
        self.assertEqual([request.url.path for request in requests], [
            "/otp/traveltime/surface", "/otp/traveltime/isochrone",
        ])
        for request in requests:
            self.assertEqual(request.url.params["time"], DEPARTURE.isoformat())
            self.assertEqual(request.url.params["cutoff"], "30M")
            self.assertEqual(request.url.params["modes"], "WALK,SUBWAY,TRAM,BUS")
            self.assertEqual(request.url.params["location"], "3.1,101.1")
            self.assertEqual(request.url.params["arriveBy"], "false")
        self.assertEqual(requests[1].url.params["batch"], "true")


class MeetingCommonGroundTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_waiting_states_stop_both_otp_requests(self) -> None:
        cases = [
            (replace(CALCULATION, planning_started=False, departure_time=None), "waiting_for_planning"),
            (replace(CALCULATION, participant_count=1, origins=CALCULATION.origins[:1]), "waiting_for_participants"),
            (replace(CALCULATION, origins=CALCULATION.origins[:1]), "waiting_for_origins"),
        ]
        for calculation, status in cases:
            with (
                self.subTest(status=status),
                patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock()) as surface,
                patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock()) as area,
                patch("backend.app.services.meeting_service._store_proposals") as store,
            ):
                requested_budget = 45 if status == "waiting_for_planning" else None
                result = await common_ground("ABCDEFGH", CALLER, ["station"], requested_budget)
                self.assertEqual(result.status, status)
                self.assertEqual(result.participant_areas, [])
                self.assertEqual(result.room_revision, 7)
                surface.assert_not_awaited()
                area.assert_not_awaited()
                store.assert_not_called()

    async def test_requested_budget_mismatch_stops_both_otp_requests(self) -> None:
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock()) as surface,
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock()) as area,
        ):
            with self.assertRaises(BudgetChangedError):
                await common_ground("ABCDEFGH", CALLER, ["station"], 45)
            surface.assert_not_awaited()
            area.assert_not_awaited()

    async def test_missing_or_naive_departure_cannot_use_a_default(self) -> None:
        for departure in (None, DEPARTURE.replace(tzinfo=None)):
            with (
                self.subTest(departure=departure),
                patch("backend.app.services.meeting_service._load_calculation", return_value=replace(
                    CALCULATION, departure_time=departure,
                )),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock()) as surface,
            ):
                with self.assertRaises(RoutingUnavailableError):
                    await common_ground("ABCDEFGH", CALLER, ["station"], 30)
                surface.assert_not_awaited()

    async def test_no_eligible_venue_keeps_geometry_and_guards_empty_proposals(self) -> None:
        unreachable = replace(SURFACE, seconds=(-2147483648,))
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=unreachable)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station"], 30)
        self.assertEqual(result.status, "no_common_ground")
        self.assertEqual(result.proposals, [])
        self.assertEqual(result.participant_areas, [AREA, AREA])
        self.assertEqual(result.departure_time, DEPARTURE)
        store.assert_called_once_with("ABCDEFGH", CALLER, 7, [], expected_budget=30)

    async def test_concurrency_is_at_most_six_and_private_geometry_is_not_cached(self) -> None:
        active = peak = 0

        async def fetch(_client, origin, budget, departure, result):
            nonlocal active, peak
            self.assertEqual(budget, 30)
            self.assertEqual(departure, DEPARTURE)
            active += 1
            peak = max(peak, active)
            try:
                await asyncio.sleep(0.001)
                return result
            finally:
                active -= 1

        async def surface(*args):
            return await fetch(*args, SURFACE)

        async def area(*args):
            return await fetch(*args, AREA)

        calculation = replace(CALCULATION, participant_count=6, origins=CALCULATION.origins * 3)
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(side_effect=surface)) as surfaces,
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(side_effect=area)) as areas,
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            for _ in range(2):
                result = await common_ground("ABCDEFGH", CALLER, ["station"], 30)
                self.assertEqual(len(result.participant_areas), 6)
        self.assertEqual(peak, 6)
        self.assertEqual(active, 0)
        self.assertEqual(surfaces.await_count, 12)
        self.assertEqual(areas.await_count, 12)

    async def test_failed_member_cancels_unfinished_private_routing(self) -> None:
        waiting = asyncio.Event()
        cancelled = asyncio.Event()

        async def area(_client, origin, _budget, _departure):
            if origin == CALCULATION.origins[0]:
                await waiting.wait()
                raise RoutingUnavailableError
            waiting.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(side_effect=area)),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            with self.assertRaises(RoutingUnavailableError):
                await asyncio.wait_for(common_ground("ABCDEFGH", CALLER, ["station"], 30), timeout=1)
        self.assertTrue(cancelled.is_set())
        store.assert_not_called()


class MeetingCommonGroundApiFailureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        app.dependency_overrides[authenticated_user] = lambda: CALLER

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def request(self):
        return self.client.post("/api/meetings/ABCDEFGH/common-ground", json={"venueTypes": ["station"]})

    def test_invalid_missing_and_timed_out_isochrones_return_503_without_partial_results(self) -> None:
        invalid_bodies = [
            {}, {"type": "FeatureCollection", "features": []}, collection(None),
            collection({"type": "Polygon", "coordinates": []}),
            collection({"type": "MultiPolygon", "coordinates": [[]]}),
            collection({"type": "Point", "coordinates": [101, 3]}),
            collection({"type": "Polygon", "coordinates": [OUTER[:-1]]}),
            collection({"type": "Polygon", "coordinates": [OUTER, HOLE[:-1]]}),
        ]
        responses = [httpx.Response(200, json=body) for body in invalid_bodies]
        responses += [httpx.Response(200, content=b"not-json"), httpx.Response(503)]
        failures = responses + [httpx.ReadTimeout("isochrone timeout")]
        for failure in failures:
            if isinstance(failure, httpx.Response):
                failure.request = httpx.Request("GET", "http://otp.test/otp/traveltime/isochrone")
            valid_response = httpx.Response(
                200, json=collection({"type": "Polygon", "coordinates": [OUTER]}),
                request=httpx.Request("GET", "http://otp.test/otp/traveltime/isochrone"),
            )
            with (
                self.subTest(failure=failure),
                patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
                patch("backend.app.services.meeting_service.httpx.AsyncClient.get", new=AsyncMock(
                    side_effect=[valid_response, failure],
                )),
                patch("backend.app.services.meeting_service._store_proposals") as store,
            ):
                response = self.request()
            self.assertEqual(response.status_code, 503)
            self.assertEqual(set(response.json()), {"detail"})
            store.assert_not_called()

    def test_revision_or_budget_change_discards_geometry_and_even_empty_proposals(self) -> None:
        for venues in ((VENUE,), ()):
            with (
                self.subTest(empty=not venues),
                patch("backend.app.services.meeting_service._load_calculation", return_value=replace(
                    CALCULATION, venues=venues,
                )),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
                patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
                patch("backend.app.services.meeting_service.connection") as connect,
            ):
                database = MagicMock(spec=psycopg.Connection)
                connect.return_value.__enter__.return_value = database
                database.execute.return_value.fetchone.return_value = None
                response = self.request()
            self.assertEqual(response.status_code, 409)
            self.assertEqual(set(response.json()), {"detail"})
            self.assertEqual(database.execute.call_count, 1)
            database.cursor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
