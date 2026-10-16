from __future__ import annotations

import asyncio
import unittest
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta
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
    BudgetChangedError, MeetingInputsChangedError, MeetingCalculation, PrivateOrigin,
    RoomUnavailableError, RoutingUnavailableError, _fetch_isochrone, _fetch_surface,
    _load_calculation, _store_proposals, common_ground,
    _fetch_arrive_by_minutes, _candidate_shortlist, MAX_CANDIDATE_CHECKS,
    MAX_MALL_REPLACEMENT_CHECKS, MALL_REPLACEMENT_BATCH_SIZE,
    MAX_TOTAL_CANDIDATE_CHECKS, TARGET_VERIFIED_PROPOSALS,
)
from backend.app.services.travel_time_surface import TravelTimeSurface


CALLER = UUID("33ddefe5-e814-4420-9fd0-42bf9a522d39")
MEMBER_A = UUID("2b0f9c17-b1e1-4c36-ae47-304c92f64ac1")
MEMBER_B = UUID("9075fa49-eb4f-44a0-b8c9-55beb1d42cb6")
DEPARTURE = datetime.fromisoformat("2026-10-14T08:12:34+08:00")
ARRIVAL = DEPARTURE + timedelta(minutes=30)
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
    arrival_time=ARRIVAL,
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
                    "planning_started": started, "departure_time": departure, "voting_arrival_time": ARRIVAL if started else None,
                }
                database.execute.return_value.fetchall.side_effect = [
                    [
                        {"id": MEMBER_A, "latitude": 3.1, "longitude": 101.1},
                        {"id": MEMBER_B, "latitude": None, "longitude": None},
                    ],
                    [],
                ]
                result = _load_calculation("ABCDEFGH", CALLER, ["station"])
                self.assertEqual(result.planning_started, started)
                self.assertEqual(result.departure_time, departure)
                self.assertEqual(result.room_revision, 7)
                self.assertEqual(result.participant_count, 2)
                self.assertEqual(len(result.origins), 1)
                self.assertEqual(result.origins[0].participant_id, MEMBER_A)
        query, params = database.execute.call_args_list[0].args
        self.assertIn("r.planning_started, r.departure_time", query)
        self.assertIn("caller.user_id = %s", query)
        self.assertEqual(params, (CALLER, "ABCDEFGH"))
        participant_query = database.execute.call_args_list[1].args[0]
        self.assertIn("select id, latitude, longitude", participant_query)

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


class MeetingCandidateShortlistTests(unittest.TestCase):
    def ranked(self, counts):
        return [
            (index + 1, 0, f"{kind}-{index:02}", VENUE.model_copy(update={
                "id": f"{kind}-{index}", "type": kind, "name": f"{kind}-{index:02}",
            }))
            for kind, count in counts for index in range(count)
        ]

    def test_dense_categories_cannot_exclude_malls(self) -> None:
        ranked = self.ranked([(kind, 20) for kind in ("station", "cafe", "restaurant", "mall")])
        result = _candidate_shortlist(ranked)
        self.assertEqual(len(result), MAX_CANDIDATE_CHECKS)
        for kind in ("station", "cafe", "restaurant", "mall"):
            self.assertEqual([item[3].id for item in result if item[3].type == kind],
                             [f"{kind}-{index}" for index in range(3)])

    def test_sparse_mall_category_releases_unused_slots(self) -> None:
        result = _candidate_shortlist(self.ranked([("station", 20), ("mall", 1)]))
        self.assertEqual(len(result), MAX_CANDIDATE_CHECKS)
        self.assertEqual(sum(item[3].type == "mall" for item in result), 1)
        self.assertEqual(len({item[3].id for item in result}), len(result))

    def test_empty_small_and_single_category_lists(self) -> None:
        self.assertEqual(_candidate_shortlist([]), [])
        for count in (2, 20):
            ranked = self.ranked([("mall", count)])
            self.assertEqual(_candidate_shortlist(ranked), ranked[:MAX_CANDIDATE_CHECKS])
        ranked = self.ranked([("station", 2), ("mall", 2)])
        self.assertCountEqual(_candidate_shortlist(ranked), ranked)


class MeetingCommonGroundTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.arrive_by_patch = patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(return_value=10))
        self.arrive_by = self.arrive_by_patch.start()
        self.addCleanup(self.arrive_by_patch.stop)

    async def test_preview_uses_meeting_minus_budget_not_legacy_shared_departure(self) -> None:
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, departure_time=DEPARTURE - timedelta(hours=2))),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)) as surface,
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station"], 30)
        self.assertEqual(result.arrival_time, ARRIVAL)
        self.assertEqual(result.departure_time, DEPARTURE)
        self.assertEqual(result.area_method, "budget-window-preview")
        self.assertEqual(result.proposals[0].participant_trips, [])
        self.assertTrue(all(area.member_id is None for area in result.participant_areas))
        self.assertTrue(all(call.args[3] == DEPARTURE for call in surface.await_args_list))
        self.assertTrue(all(call.args[-1] == ARRIVAL for call in self.arrive_by.await_args_list))

    async def test_candidate_fails_if_one_member_has_no_arrive_by_route(self) -> None:
        self.arrive_by.side_effect = [10, None]
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station"], 30)
        self.assertEqual(result.proposals, [])
        self.assertEqual(result.status, "no_common_ground")

    async def test_mall_survives_dense_station_shortlist_but_still_needs_every_route(self) -> None:
        stations = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"})
                         for index in range(20))
        mall = VENUE.model_copy(update={"id": "mall-1", "name": "Z Mall", "type": "mall"})
        calculation = replace(CALCULATION, venues=stations + (mall,))
        for mall_reachable in (True, False):
            async def route(_client, origin, venue, _budget, _arrival):
                if venue.type == "mall" and origin == calculation.origins[1] and not mall_reachable:
                    return None
                return 10

            with (
                self.subTest(mall_reachable=mall_reachable),
                patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
                patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
                patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)) as routes,
                patch("backend.app.services.meeting_service._store_proposals") as store,
            ):
                result = await common_ground("ABCDEFGH", CALLER, ["station", "mall"], 30)
            self.assertEqual(any(proposal.venue.type == "mall" for proposal in result.proposals), mall_reachable)
            self.assertEqual(routes.await_count, (MAX_CANDIDATE_CHECKS + (not mall_reachable)) * len(calculation.origins))
            self.assertEqual(sum(call.args[2].type == "mall" for call in routes.await_args_list), 2)
            self.assertEqual([proposal.rank for proposal in result.proposals], list(range(1, len(result.proposals) + 1)))
            self.assertEqual(store.call_args.args[3], result.proposals)

    async def test_mall_outside_any_members_surface_is_not_proposed(self) -> None:
        mall = VENUE.model_copy(update={"id": "mall-outside", "type": "mall", "lat": 5.0})
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=(mall,))),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["mall"], 30)
        self.assertEqual(result.proposals, [])
        self.arrive_by.assert_not_awaited()

    async def check_mall_reserve(
        self, accepted: set[int], *, outage: bool = False, stall: bool = False,
    ) -> tuple[CommonGroundResponse | None, AsyncMock]:
        venues = tuple(VENUE.model_copy(update={
            "id": f"{kind}-{index}", "type": kind, "name": f"{kind}-{index:02}",
        }) for kind in ("station", "cafe", "restaurant", "mall") for index in range(20))
        origins = tuple(PrivateOrigin(3.1 + index / 100, 101.1 + index / 100) for index in range(5))
        calculation = replace(CALCULATION, participant_count=5, origins=origins, venues=venues)
        cancelled = []

        async def route(_client, origin, venue, _budget, _arrival):
            if venue.type != "mall":
                return 10
            index = int(venue.id.split("-")[1])
            if index >= 3:
                if outage:
                    raise RoutingUnavailableError
                if stall:
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cancelled.append(venue.id)
            return 10 if index in accepted or origin != origins[-1] else None

        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)) as routes,
            patch("backend.app.services.meeting_service._store_proposals") as store,
            # Isolate the existing mall reserve from the new overall-list refill.
            patch("backend.app.services.meeting_service.TARGET_VERIFIED_PROPOSALS", 9),
        ):
            if outage or stall:
                with self.assertRaises(RoutingUnavailableError):
                    await common_ground("ABCDEFGH", CALLER, ["station", "cafe", "restaurant", "mall"], 30,
                                        verification_timeout=0.05 if stall else 25)
                store.assert_not_called()
                if stall:
                    self.assertTrue(cancelled)
                return None, routes
            result = await common_ground("ABCDEFGH", CALLER, ["station", "cafe", "restaurant", "mall"], 30)
            self.assertEqual(store.call_args.args[3], result.proposals)
            return result, routes

    async def test_five_members_find_later_mall_after_first_three_fail(self) -> None:
        result, routes = await self.check_mall_reserve({3, 8})
        self.assertEqual([proposal.venue.id for proposal in result.proposals if proposal.venue.type == "mall"], ["mall-3"])
        self.assertEqual(routes.await_count, (MAX_CANDIDATE_CHECKS + MALL_REPLACEMENT_BATCH_SIZE) * 5)
        calls = [call.args[2].id for call in routes.await_args_list]
        self.assertNotIn("mall-5", calls)  # Stop once this batch has a verified mall.
        self.assertEqual([proposal.rank for proposal in result.proposals], list(range(1, len(result.proposals) + 1)))

    async def test_verified_initial_mall_does_not_trigger_reserve(self) -> None:
        result, routes = await self.check_mall_reserve({1, 3})
        self.assertEqual([proposal.venue.id for proposal in result.proposals if proposal.venue.type == "mall"], ["mall-1"])
        self.assertEqual(routes.await_count, MAX_CANDIDATE_CHECKS * 5)

    async def test_unreachable_malls_exhaust_only_the_bounded_reserve(self) -> None:
        result, routes = await self.check_mall_reserve(set())
        self.assertFalse(any(proposal.venue.type == "mall" for proposal in result.proposals))
        self.assertEqual(routes.await_count, (MAX_CANDIDATE_CHECKS + MAX_MALL_REPLACEMENT_CHECKS) * 5)
        self.assertNotIn("mall-9", [call.args[2].id for call in routes.await_args_list])

    async def test_reserve_outage_does_not_store_partial_results(self) -> None:
        await self.check_mall_reserve(set(), outage=True)

    async def test_reserve_shares_deadline_and_cancels_pending_routes(self) -> None:
        with patch("backend.app.services.meeting_service.asyncio.wait_for", wraps=asyncio.wait_for) as deadline:
            await self.check_mall_reserve(set(), stall=True)
        deadline.assert_called_once()
        self.assertEqual(deadline.call_args.kwargs["timeout"], 0.05)

    async def test_larger_budget_refills_displaced_feasible_places(self) -> None:
        known = tuple(VENUE.model_copy(update={"id": f"known-{index}", "name": f"Z{index}", "lat": 3.01})
                      for index in range(5))
        newcomers = tuple(VENUE.model_copy(update={"id": f"new-{index}", "name": f"A{index}", "lat": 3.11})
                          for index in range(8))

        async def surface(_client, _origin, budget, _departure):
            return replace(SURFACE, seconds=(budget,))

        def minutes(surface, lat, _lon):
            if lat == 3.11:
                return 99 if surface.seconds[0] == 30 else 1
            return 10

        async def route(_client, _origin, venue, _budget, _arrival):
            return None if venue.id.startswith("new-") else 10

        results = []
        for budget in (30, 60):
            calculation = replace(CALCULATION, budget_minutes=budget, venues=known + newcomers)
            with (
                patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
                patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(side_effect=surface)),
                patch("backend.app.services.meeting_service.minutes_at", side_effect=minutes),
                patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
                patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)) as routes,
                patch("backend.app.services.meeting_service._store_proposals"),
            ):
                result = await common_ground("ABCDEFGH", CALLER, ["station"], budget)
                results.append({proposal.venue.id for proposal in result.proposals})
                if budget == 60:
                    self.assertEqual(routes.await_count, 13 * 2)  # The thirteenth candidate was previously lost.
        self.assertEqual(results[0], {venue.id for venue in known})
        self.assertEqual(results[1], results[0])

    async def test_general_refill_restores_all_categories_even_with_initial_mall(self) -> None:
        venues = tuple(VENUE.model_copy(update={
            "id": f"{kind}-{index}", "type": kind, "name": f"{kind}-{index:02}",
        }) for kind in ("station", "cafe", "restaurant", "mall") for index in range(20))

        async def route(_client, _origin, venue, _budget, _arrival):
            return 10 if int(venue.id.split("-")[1]) in (0, 3, 4) else None

        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)) as routes,
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station", "cafe", "restaurant", "mall"], 30)
        self.assertEqual(len(result.proposals), TARGET_VERIFIED_PROPOSALS)
        for kind in ("station", "cafe", "restaurant", "mall"):
            self.assertEqual(sum(proposal.venue.type == kind for proposal in result.proposals), 3)
        checked = [call.args[2].id for call in routes.await_args_list]
        self.assertEqual(len(checked), 20 * 2)
        self.assertEqual(len(set(checked)), 20)
        self.assertFalse(any(venue.endswith("-5") for venue in checked))
        self.assertEqual([proposal.rank for proposal in result.proposals], list(range(1, 13)))

    async def test_refill_stops_at_total_cap_and_never_relaxes_member_checks(self) -> None:
        venues = tuple(VENUE.model_copy(update={
            "id": f"{kind}-{index}", "type": kind, "name": f"{kind}-{index:02}",
        }) for kind in ("station", "cafe", "restaurant", "mall") for index in range(40))
        origins = tuple(PrivateOrigin(3.1 + index / 100, 101.1 + index / 100) for index in range(5))

        async def route(_client, origin, _venue, _budget, _arrival):
            return None if origin == origins[-1] else 10

        calculation = replace(CALCULATION, participant_count=5, origins=origins, venues=venues)
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)) as routes,
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station", "cafe", "restaurant", "mall"], 30)
        self.assertEqual(result.proposals, [])
        checked = [call.args[2] for call in routes.await_args_list]
        self.assertEqual(len(checked), MAX_TOTAL_CANDIDATE_CHECKS * 5)
        self.assertEqual(len({(venue.type, venue.id) for venue in checked}), MAX_TOTAL_CANDIDATE_CHECKS)
        self.assertEqual(sum(venue.type == "mall" for venue in checked), (3 + MAX_MALL_REPLACEMENT_CHECKS) * 5)

    async def test_full_initial_list_does_not_run_general_refill(self) -> None:
        venues = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"})
                       for index in range(40))
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            result = await common_ground("ABCDEFGH", CALLER, ["station"], 30)
        self.assertEqual(len(result.proposals), MAX_CANDIDATE_CHECKS)
        self.assertEqual(self.arrive_by.await_count, MAX_CANDIDATE_CHECKS * 2)

    async def test_general_refill_timeout_cancels_pending_routes_without_partial_store(self) -> None:
        venues = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"})
                       for index in range(20))
        cancelled = []

        async def route(_client, _origin, venue, _budget, _arrival):
            index = int(venue.id.split("-")[1])
            if index < MAX_CANDIDATE_CHECKS:
                return 10 if index < 4 else None
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(venue.id)

        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(side_effect=route)),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            with self.assertRaises(RoutingUnavailableError):
                await common_ground("ABCDEFGH", CALLER, ["station"], 30, verification_timeout=0.05)
        self.assertTrue(cancelled)
        store.assert_not_called()

    async def test_more_reuses_screening_and_never_rechecks_old_candidates(self) -> None:
        venues = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"}) for index in range(20))
        searches = []
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)) as surfaces,
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)) as areas,
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            first = await common_ground("ABCDEFGH", CALLER, ["station"], 30, on_search=searches.append)
            second = await common_ground("ABCDEFGH", CALLER, ["station"], 30, search=searches[-1], on_search=searches.append)
        self.assertEqual((len(first.proposals), first.search_page, first.has_more, first.checked_places), (12, 0, True, 12))
        self.assertEqual((len(second.proposals), second.search_page, second.has_more, second.checked_places), (20, 1, False, 20))
        self.assertEqual((surfaces.await_count, areas.await_count), (2, 2))
        self.assertEqual(self.arrive_by.await_count, 20 * 2)
        self.assertEqual(store.call_args.args[3], second.proposals)
        self.assertEqual(len(searches[0].tried), 12)
        self.assertEqual(len(searches[1].tried), 20)

    async def test_failed_more_keeps_original_search_progress_unmodified(self) -> None:
        venues = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"}) for index in range(30))
        searches = []
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            await common_ground("ABCDEFGH", CALLER, ["station"], 30, on_search=searches.append)
            self.arrive_by.side_effect = RoutingUnavailableError
            with self.assertRaises(RoutingUnavailableError):
                await common_ground("ABCDEFGH", CALLER, ["station"], 30, search=searches[0], on_search=searches.append)
        self.assertEqual(len(searches), 1)
        self.assertEqual(len(searches[0].tried), 12)
        self.assertEqual(len(searches[0].verified), 12)
        store.assert_called_once()

    async def test_continuation_rejects_changed_budget_arrival_types_or_revision(self) -> None:
        searches = []
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            await common_ground("ABCDEFGH", CALLER, ["station"], 30, on_search=searches.append)
        for changes in ({"budget": 60}, {"revision": 8}, {"arrival": ARRIVAL + timedelta(hours=1)}, {"types": frozenset({"mall"})}, {"page": 19}):
            with (
                self.subTest(changes=changes),
                patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
                patch("backend.app.services.meeting_service._store_proposals") as store,
            ):
                with self.assertRaises(MeetingInputsChangedError):
                    await common_ground("ABCDEFGH", CALLER, ["station"], 30, search=replace(searches[0], **changes))
                store.assert_not_called()

    async def test_last_allowed_page_reports_limit_not_full_coverage(self) -> None:
        venues = tuple(VENUE.model_copy(update={"id": f"station-{index}", "name": f"A{index:02}"}) for index in range(50))
        searches = []
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=replace(CALCULATION, venues=venues)),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals"),
        ):
            await common_ground("ABCDEFGH", CALLER, ["station"], 30, on_search=searches.append)
            result = await common_ground("ABCDEFGH", CALLER, ["station"], 30, search=replace(searches[0], page=18))
        self.assertEqual(result.search_page, 19)
        self.assertFalse(result.has_more)
        self.assertTrue(result.search_limit_reached)

    async def test_arrive_by_outage_does_not_store_partially_checked_candidates(self) -> None:
        self.arrive_by.side_effect = RoutingUnavailableError
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=CALCULATION),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(return_value=SURFACE)),
            patch("backend.app.services.meeting_service._fetch_isochrone", new=AsyncMock(return_value=AREA)),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            with self.assertRaises(RoutingUnavailableError):
                await common_ground("ABCDEFGH", CALLER, ["station"], 30)
        store.assert_not_called()

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

    async def test_missing_or_naive_meeting_time_cannot_use_a_default(self) -> None:
        for departure in (None, DEPARTURE.replace(tzinfo=None)):
            with (
                self.subTest(departure=departure),
                patch("backend.app.services.meeting_service._load_calculation", return_value=replace(
                    CALCULATION, arrival_time=departure,
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


class MeetingArriveByTests(unittest.IsolatedAsyncioTestCase):
    async def test_identical_origin_venue_is_zero_not_an_otp_outage(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: self.fail("No routing needed for identical coordinates"))) as client:
            value = await _fetch_arrive_by_minutes(client, PrivateOrigin(VENUE.lat, VENUE.lon), VENUE, 30, ARRIVAL)
        self.assertEqual(value, 0)

    async def request(self, body, status=200):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(status, json=body)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            value = await _fetch_arrive_by_minutes(client, CALCULATION.origins[0], VENUE, 30, ARRIVAL)
        return value, requests[0]

    def plan(self, minutes=20, late_seconds=0):
        end = int(ARRIVAL.timestamp() * 1000) + late_seconds * 1000
        start = end - minutes * 60_000
        return {"plan": {"itineraries": [{"startTime": start, "endTime": end, "legs": [{"startTime": start, "endTime": end}]}]}}

    async def test_arrive_by_targets_venue_in_malaysia_time(self):
        value, request = await self.request(self.plan())
        self.assertEqual(value, 20)
        self.assertEqual(request.url.params["arriveBy"], "true")
        self.assertEqual(request.url.params["fromPlace"], "3.1,101.1")
        self.assertEqual(request.url.params["toPlace"], "3.8,101.2")
        self.assertEqual(request.url.params["date"], "2026-10-14")
        self.assertEqual(request.url.params["time"], "08:42:34")

    async def test_late_or_over_budget_routes_are_not_eligible(self):
        for body in (self.plan(late_seconds=1), self.plan(minutes=31), {"plan": {"itineraries": []}}):
            with self.subTest(body=body):
                value, _request = await self.request(body)
                self.assertIsNone(value)

    async def test_ranking_uses_the_same_latest_departure_preference_as_the_pass(self):
        earlier = self.plan(minutes=10, late_seconds=-1200)["plan"]["itineraries"][0]
        later = self.plan(minutes=20)["plan"]["itineraries"][0]
        value, _request = await self.request({"plan": {"itineraries": [earlier, later]}})
        self.assertEqual(value, 20)

    async def test_no_path_and_outage_are_distinct(self):
        value, _request = await self.request({"error": {"id": 404, "message": "Path not found"}})
        self.assertIsNone(value)
        value, _request = await self.request({"error": {"id": 409, "message": "Trivial distance"}})
        self.assertIsNone(value)
        for body, status in (({}, 200), ({"error": {"id": 500}}, 200), ({}, 503)):
            with self.subTest(status=status, body=body):
                with self.assertRaises(RoutingUnavailableError):
                    await self.request(body, status)

    async def test_malformed_or_reversed_legs_are_not_success(self):
        body = self.plan()
        body["plan"]["itineraries"][0]["legs"][0]["endTime"] += 1
        value, _request = await self.request(body)
        self.assertIsNone(value)
        with self.assertRaises(RoutingUnavailableError):
            await self.request({"plan": {"itineraries": [{"startTime": "bad"}]}})


class MeetingCommonGroundApiFailureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        app.dependency_overrides[authenticated_user] = lambda: CALLER
        self.arrive_by_patch = patch("backend.app.services.meeting_service._fetch_arrive_by_minutes", new=AsyncMock(return_value=10))
        self.arrive_by_patch.start()
        self.addCleanup(self.arrive_by_patch.stop)

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
