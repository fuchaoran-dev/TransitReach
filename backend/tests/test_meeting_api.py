from __future__ import annotations

import unittest
from pathlib import Path
from struct import pack
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import psycopg
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.api.meetings import authenticated_user
from backend.app.main import app
from backend.app.schemas.meetings import CommonGroundRequest, CommonGroundResponse, PublicVenue, VenueProposal
from backend.app.services.meeting_auth_service import validate_supabase_token
from backend.app.services.meeting_service import (
    MeetingCalculation, MeetingInputsChangedError, PrivateOrigin, _store_proposals, common_ground,
)
from backend.app.services.travel_time_surface import (
    TravelTimeSurface, decode_travel_time_surface, minutes_at,
)


CALLER_ID = UUID("33ddefe5-e814-4420-9fd0-42bf9a522d39")
ROOT = Path(__file__).resolve().parents[2]


class MeetingDatabaseContractTests(unittest.TestCase):
    def test_confirmation_variable_cannot_shadow_proposal_venue_column(self) -> None:
        schema = (ROOT / "supabase" / "meeting-rooms.sql").read_text()
        confirmation = schema.split("create or replace function public.confirm_meeting_plan", 1)[1]
        confirmation = confirmation.split("$$;", 1)[0]
        self.assertIn("resolved_venue jsonb;", confirmation)
        self.assertIn("proposal.venue_id = resolved_venue ->> 'id'", confirmation)
        self.assertIn("proposal.venue_type = resolved_venue ->> 'type'", confirmation)
        self.assertNotIn("\n  venue jsonb;", confirmation)

    def test_schema_enforces_private_rows_and_versioned_shared_status(self) -> None:
        schema = (ROOT / "supabase" / "meeting-rooms.sql").read_text()
        self.assertIn('create policy "participants read themselves"', schema)
        self.assertIn("using (user_id = (select auth.uid()))", schema)
        self.assertNotIn('create policy "members read each other"', schema)
        self.assertIn("p.checked_plan_version = r.plan_version", schema)
        self.assertIn("next_version := room.plan_version + 1", schema)
        self.assertIn("p_arrival_time + interval '24 hours'", schema)
        self.assertIn("create trigger meeting_participants_invalidate_check", schema)
        self.assertIn("raise exception 'stale_meeting_proposal'", schema)
        self.assertIn("revoke all on public.meeting_plan_proposals from anon, authenticated", schema)
        invitation = schema.split("create or replace function public.get_meeting_invitation", 1)[1]
        invitation = invitation.split("$$;", 1)[0]
        for private_field in ("user_id", "nickname", "lat", "lon", "arrival_status", "created_by"):
            self.assertNotIn(private_field, invitation)

    def test_room_column_grant_does_not_expose_creator_identity(self) -> None:
        schema = (ROOT / "supabase" / "meeting-rooms.sql").read_text()
        room_table = schema.split("create table if not exists public.meeting_rooms", 1)[1]
        room_table = room_table.split(");", 1)[0]
        self.assertNotIn("created_by", room_table)
        self.assertIn("create table if not exists public.meeting_room_creators", schema)
        self.assertIn("revoke all on public.meeting_room_creators from anon, authenticated", schema)
        grant = schema.split("grant select (", 1)[1].split(") on public.meeting_rooms", 1)[0]
        self.assertNotIn("created_by", grant)


class MeetingProposalPersistenceTests(unittest.TestCase):
    @patch("backend.app.services.meeting_service.connection")
    def test_current_proposals_use_the_real_psycopg_cursor_interface(self, connect) -> None:
        database = MagicMock(spec=psycopg.Connection)
        cursor = MagicMock(spec=psycopg.Cursor)
        connect.return_value.__enter__.return_value = database
        database.execute.return_value.fetchone.return_value = {"exists": 1}
        database.cursor.return_value.__enter__.return_value = cursor
        proposal = VenueProposal(
            rank=1, longestMinutes=20, gapMinutes=2,
            venue=PublicVenue(
                id="station-a", type="station", name="Public Alpha",
                kindLabel="Rail station", lat=3.1, lon=101.6,
            ),
        )
        _store_proposals("ABCDEFGH", CALLER_ID, 4, [proposal])
        cursor.executemany.assert_called_once()
        row = cursor.executemany.call_args.args[1][0]
        self.assertEqual(row[:4], ("ABCDEFGH", 4, "station-a", "station"))
        self.assertNotIn("user_id", row[4].obj)
        self.assertNotIn("origin", row[4].obj)
        self.assertIn("for share of r", database.execute.call_args_list[0].args[0])

    @patch("backend.app.services.meeting_service.connection")
    def test_changed_or_unauthorized_room_writes_no_proposals(self, connect) -> None:
        database = MagicMock(spec=psycopg.Connection)
        connect.return_value.__enter__.return_value = database
        database.execute.return_value.fetchone.return_value = None
        with self.assertRaises(MeetingInputsChangedError):
            _store_proposals("ABCDEFGH", CALLER_ID, 3, [])
        database.cursor.assert_not_called()
        self.assertEqual(database.execute.call_count, 1)


class MeetingApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_common_ground_requires_a_bearer_token(self) -> None:
        response = self.client.post(
            "/api/meetings/ABCDEFGH/common-ground",
            json={"venueTypes": ["station"]},
        )
        self.assertEqual(response.status_code, 401)

    def test_common_ground_returns_only_public_aggregate_data(self) -> None:
        app.dependency_overrides[authenticated_user] = lambda: CALLER_ID
        result = CommonGroundResponse(
            status="ready", participantCount=2, missingStartingPoints=0, budgetMinutes=30,
            proposals=[{
                "rank": 1,
                "venue": {
                    "id": "station-KJ10", "type": "station", "name": "KLCC",
                    "kindLabel": "Rail station", "lat": 3.1579, "lon": 101.7123,
                },
                "longestMinutes": 24, "gapMinutes": 3,
            }],
        )
        with patch("backend.app.api.meetings.common_ground", new=AsyncMock(return_value=result)) as calculate:
            response = self.client.post(
                "/api/meetings/ABCDEFGH/common-ground",
                json={"timeBudget": 30, "venueTypes": ["station"]},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        serialized = response.text
        self.assertNotIn("origin", serialized)
        self.assertNotIn("surface", serialized)
        self.assertNotIn("user_id", serialized)
        self.assertNotIn("minutes\": [", serialized)
        self.assertEqual(body["proposals"][0]["venue"]["name"], "KLCC")
        self.assertEqual(calculate.await_args.args[1], CALLER_ID)

    def test_request_rejects_client_supplied_identity_and_duplicate_types(self) -> None:
        with self.assertRaises(ValidationError):
            CommonGroundRequest.model_validate({
                "venueTypes": ["station"], "userId": str(CALLER_ID),
            })
        with self.assertRaises(ValidationError):
            CommonGroundRequest.model_validate({"venueTypes": ["station", "station"]})


class MeetingAuthTests(unittest.TestCase):
    @patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_ANON_KEY": "publishable-test-key",
    }, clear=False)
    @patch("backend.app.services.meeting_auth_service.httpx.get")
    def test_token_identity_comes_from_supabase_auth(self, request_user) -> None:
        request_user.return_value = httpx.Response(
            200,
            json={"id": str(CALLER_ID)},
            request=httpx.Request("GET", "https://example.supabase.co/auth/v1/user"),
        )
        self.assertEqual(validate_supabase_token("signed-token"), CALLER_ID)
        headers = request_user.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], "Bearer signed-token")

    @patch.dict("os.environ", {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_ANON_KEY": "publishable-test-key",
    }, clear=False)
    @patch("backend.app.services.meeting_auth_service.httpx.get")
    def test_rejected_token_is_unauthorized(self, request_user) -> None:
        request_user.return_value = httpx.Response(
            401,
            request=httpx.Request("GET", "https://example.supabase.co/auth/v1/user"),
        )
        with self.assertRaisesRegex(Exception, "401"):
            validate_supabase_token("expired-token")


class MeetingRankingTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_surfaces_are_reduced_to_ranked_public_venues(self) -> None:
        venues = (
            PublicVenue(
                id="station-a", type="station", name="Alpha", kindLabel="Rail station",
                lat=3.8, lon=100.2,
            ),
            PublicVenue(
                id="station-b", type="station", name="Beta", kindLabel="Rail station",
                lat=3.8, lon=101.2,
            ),
        )
        calculation = MeetingCalculation(
            budget_minutes=30,
            participant_count=2,
            origins=(PrivateOrigin(3.1, 101.1), PrivateOrigin(3.2, 101.2)),
            venues=venues,
            room_revision=4,
        )
        first = TravelTimeSurface(2, 1, 100, 4, 1, -1, (600, 900), -2147483648)
        second = TravelTimeSurface(2, 1, 100, 4, 1, -1, (1200, -2147483648), -2147483648)
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock(side_effect=[first, second])),
            patch("backend.app.services.meeting_service._store_proposals") as store,
        ):
            result = await common_ground("ABCDEFGH", CALLER_ID, ["station"], 30)

        self.assertEqual(result.status, "ready")
        self.assertEqual([proposal.venue.id for proposal in result.proposals], ["station-a"])
        self.assertEqual(result.proposals[0].longest_minutes, 20)
        self.assertEqual(result.proposals[0].gap_minutes, 10)
        store.assert_called_once()
        self.assertEqual(store.call_args.args[:3], ("ABCDEFGH", CALLER_ID, 4))
        self.assertEqual(store.call_args.args[3][0].venue.id, "station-a")

    async def test_missing_origin_stops_before_private_routing(self) -> None:
        calculation = MeetingCalculation(
            budget_minutes=30,
            participant_count=2,
            origins=(PrivateOrigin(3.1, 101.1),),
            venues=(),
            room_revision=4,
        )
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock()) as fetch,
        ):
            result = await common_ground("ABCDEFGH", CALLER_ID, ["station"], None)

        self.assertEqual(result.status, "waiting_for_origins")
        self.assertEqual(result.missing_starting_points, 1)
        fetch.assert_not_awaited()

    async def test_single_member_does_not_receive_a_fake_group_ranking(self) -> None:
        calculation = MeetingCalculation(
            budget_minutes=30,
            participant_count=1,
            origins=(PrivateOrigin(3.1, 101.1),),
            venues=(),
            room_revision=4,
        )
        with (
            patch("backend.app.services.meeting_service._load_calculation", return_value=calculation),
            patch("backend.app.services.meeting_service._fetch_surface", new=AsyncMock()) as fetch,
        ):
            result = await common_ground("ABCDEFGH", CALLER_ID, ["station"], None)

        self.assertEqual(result.status, "waiting_for_participants")
        fetch.assert_not_awaited()

    def test_surface_lookup_never_interpolates_or_uses_no_data(self) -> None:
        surface = TravelTimeSurface(2, 1, 100, 4, 1, -1, (90, -2147483648), -2147483648)
        self.assertEqual(minutes_at(surface, 3.5, 100.5), 1.5)
        self.assertIsNone(minutes_at(surface, 3.5, 101.5))
        self.assertIsNone(minutes_at(surface, 3.5, 102.5))

    @staticmethod
    def surface_fixture(no_data: bytes = b"-2147483648\0") -> bytes:
        entries = 10
        directory_size = 2 + entries * 12 + 4
        matrix_offset = 8 + directory_size
        no_data_offset = matrix_offset + 16 * 8
        pixel_offset = no_data_offset + len(no_data)
        tags = [
            (256, 4, 1, 1), (257, 4, 1, 1), (258, 3, 1, 32),
            (259, 3, 1, 1), (273, 4, 1, pixel_offset), (277, 3, 1, 1),
            (279, 4, 1, 4), (339, 3, 1, 2),
            (34264, 12, 16, matrix_offset), (42113, 2, len(no_data), no_data_offset),
        ]
        header = b"II" + pack("<HIH", 42, 8, entries)
        directory = b"".join(
            pack("<HHI", tag, kind, count) +
            (pack("<H", value) + b"\0\0" if kind == 3 and count == 1 else pack("<I", value))
            for tag, kind, count, value in tags
        ) + pack("<I", 0)
        matrix = pack(
            "<16d",
            0.5, 0, 0, 100, 0, -0.5, 0, 4,
            0, 0, 0, 0, 0, 0, 0, 1,
        )
        return header + directory + matrix + no_data + pack("<i", 90)

    def test_decodes_the_uncompressed_otp_geotiff_shape(self) -> None:
        surface = decode_travel_time_surface(self.surface_fixture())
        self.assertEqual(surface.seconds, (90,))
        self.assertEqual(minutes_at(surface, 3.75, 100.25), 1.5)

    def test_real_otp_scientific_notation_no_data(self) -> None:
        surface = decode_travel_time_surface(self.surface_fixture(b"-2.147483648E9\0"))
        self.assertEqual(surface.no_data, -2147483648)
        self.assertEqual(minutes_at(surface, 3.75, 100.25), 1.5)

    def test_no_data_rejects_noninteger_or_out_of_range_values(self) -> None:
        for value in (b"NaN\0", b"Inf\0", b"0.5\0", b"2147483648\0", b"invalid\0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                decode_travel_time_surface(self.surface_fixture(value))


if __name__ == "__main__":
    unittest.main()
