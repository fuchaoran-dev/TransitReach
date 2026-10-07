"""Explicit live MD8-6 SQL acceptance checks; all fixture writes are rolled back.

Run from the repository root with the project's Python environment. This is not
part of ordinary unit-test discovery and never applies migrations automatically.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.database import database_url
from backend.app.services.meeting_service import PrivateOrigin, RoutingUnavailableError, _fetch_surface
from backend.app.services.travel_time_surface import minutes_at


def run_checks(database: psycopg.Connection) -> list[str]:
    checks: list[str] = []

    def require(condition: bool, description: str) -> None:
        if not condition:
            raise AssertionError(description)
        checks.append(description)

    def caller(identity: str | None) -> None:
        database.execute("reset role")
        database.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps({"sub": identity, "role": "authenticated"}) if identity else "{}",),
        )
        database.execute("set local role authenticated" if identity else "set local role anon")

    def admin() -> None:
        database.execute("reset role")

    def rejected(statement: str, parameters: tuple, expected: str) -> None:
        try:
            with database.transaction():
                database.execute(statement, parameters).fetchone()
        except psycopg.Error as error:
            require(expected in (error.diag.message_primary or ""), expected)
        else:
            raise AssertionError(f"Expected rejection: {expected}")

    secured = database.execute("""
        select relname, relrowsecurity from pg_class
        where oid in ('public.meeting_rooms'::regclass,
                      'public.meeting_participants'::regclass,
                      'public.meeting_room_creators'::regclass,
                      'public.meeting_plan_proposals'::regclass)
    """).fetchall()
    require(len(secured) == 4 and all(row[1] for row in secured), "All meeting tables use RLS")
    published = database.execute("""
        select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename like 'meeting_%'
    """).fetchall()
    require(('meeting_rooms',) in published, "Room updates are published for realtime")
    require(('meeting_room_creators',) not in published and ('meeting_plan_proposals',) not in published,
            "Creator and proposal metadata are not published")
    require(database.execute("""
        select count(*) from cron.job where jobname = 'meeting-rooms-cleanup' and active
    """).fetchone()[0] == 1, "One active expiry-cleanup job")

    identities = [str(uuid4()) for _ in range(3)]
    for identity in identities:
        database.execute("""
            insert into auth.users (id, aud, role, is_anonymous)
            values (%s, 'authenticated', 'authenticated', true)
        """, (identity,))
    venue_row = database.execute("""
        select 'station-' || stop_id, name, latitude, longitude
        from public.transit_stops where mode = 'RAIL' order by stop_id limit 1
    """).fetchone()
    require(venue_row is not None, "Canonical public venue data exists")
    venue = {"id": venue_row[0], "type": "station"}
    arrival = datetime.now(timezone.utc) + timedelta(days=2)
    caller(identities[0])
    room = database.execute("select public.create_meeting_room(%s)", ("Acceptance A",)).fetchone()[0]
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(state['room']['plan_version'] == 0 and state['room']['confirmed_venue'] is None,
            "Unconfirmed room stays in planning")
    database.execute("""
        update public.meeting_participants set lat = %s, lon = %s, source = 'map', label = %s
        where room_code = %s
    """, (venue_row[2], venue_row[3], "Private A", room))
    caller(identities[1])
    database.execute("select public.join_meeting_room(%s, %s)", (room, "Acceptance B"))
    database.execute("""
        update public.meeting_participants set lat = %s, lon = %s, source = 'map', label = %s
        where room_code = %s
    """, (venue_row[2] + 0.001, venue_row[3], "Private B", room))
    require(database.execute("select count(*) from public.meeting_participants where room_code = %s",
                             (room,)).fetchone()[0] == 1, "RLS returns only the caller's participant row")
    require(not database.execute("select has_table_privilege('authenticated', 'public.meeting_room_creators', 'SELECT')").fetchone()[0],
            "Browser cannot read room creators")
    require(not database.execute("select has_table_privilege('authenticated', 'public.meeting_plan_proposals', 'INSERT')").fetchone()[0],
            "Browser cannot manufacture ranked proposals")
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(state['self']['label'] == 'Private B' and len(state['members']) == 2,
            "Shared projection retains only the caller's private origin")
    require(all(set(member) == {'id', 'display_name', 'arrival_status', 'is_self'} for member in state['members']),
            "Other members expose no origin, identity or journey")
    rejected("select public.confirm_meeting_plan(%s, %s, %s)",
             (room, Jsonb(venue), arrival), "stale_meeting_proposal")

    admin()
    database.execute("""
        insert into public.meeting_plan_proposals (room_code, room_revision, venue_id, venue_type, venue)
        select code, planning_revision, %s, 'station', public.resolve_public_meeting_venue(%s, 'station')
        from public.meeting_rooms where code = %s
    """, (venue['id'], venue['id'], room))
    caller(identities[0])
    version = database.execute("select public.confirm_meeting_plan(%s, %s, %s)",
                               (room, Jsonb(venue), arrival)).fetchone()[0]
    require(version == 1, "First confirmed agreement creates plan version one")
    require(database.execute("select public.confirm_meeting_plan(%s, %s, %s)",
                             (room, Jsonb(venue), arrival)).fetchone()[0] == version,
            "Confirming the same agreement is idempotent")
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(datetime.fromisoformat(state['room']['expires_at']) >= arrival + timedelta(hours=24),
            "Room remains available through the meeting day")
    database.execute("select public.set_my_arrival_status(%s, 'ready', %s)", (room, version))
    caller(identities[1])
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(any(member['display_name'] == 'Acceptance A' and member['arrival_status'] == 'Ready'
                for member in state['members']), "Members share the same agreement and coarse status")
    proposed = arrival + timedelta(hours=1)
    database.execute("select public.propose_meeting_time(%s, %s)", (room, proposed))
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(state['room']['plan_version'] == version and
            datetime.fromisoformat(state['room']['confirmed_arrival_time']) == arrival,
            "Suggesting another time does not change the agreed meeting")
    version = database.execute("select public.confirm_meeting_plan(%s, %s, %s)",
                               (room, Jsonb(venue), proposed)).fetchone()[0]
    require(version == 2, "Changed agreement increments plan version")
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(all(member['arrival_status'] == 'Not checked' for member in state['members']),
            "Old passes cannot retain current Ready status")
    rejected("select public.set_my_arrival_status(%s, 'ready', %s)",
             (room, version - 1), "outdated_plan_version")
    database.execute("select public.set_my_arrival_status(%s, 'ready', %s)", (room, version))
    database.execute("""
        update public.meeting_participants set lat = lat + 0.001 where room_code = %s
    """, (room,))
    state = database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0]
    require(state['self']['checked_plan_version'] is None and state['self']['arrival_status'] == 'not_checked',
            "Moving an origin invalidates its personal check")
    rejected("select public.confirm_meeting_plan(%s, %s, %s)",
             (room, Jsonb(venue), proposed + timedelta(hours=1)), "stale_meeting_proposal")

    caller(identities[2])
    require(database.execute("select public.get_meeting_room_state(%s)", (room,)).fetchone()[0] is None,
            "Nonmember cannot read shared member state")
    invitation = database.execute("select public.get_meeting_invitation(%s)", (room,)).fetchone()[0]
    require(set(invitation) == {'code', 'confirmed_venue', 'confirmed_arrival_time', 'plan_version'},
            "Invitation on another device contains only the public agreement")
    caller(None)
    rejected("select public.get_meeting_invitation(%s)", (room,), "permission denied")
    admin()
    return checks


async def check_routing(database: psycopg.Connection) -> list[str]:
    """Use public station coordinates, never real members' private starting points."""
    rows = database.execute("""
        select distinct on (station_key) name, latitude, longitude
        from (
          select *, case when name ilike '%%Pasar Seni%%' then 'pasar-seni' else 'kl-sentral' end as station_key
          from public.transit_stops where mode = 'RAIL'
            and (name ilike %s or name ilike %s)
        ) stations
        order by station_key, stop_id
    """, ('%KL Sentral%', '%Pasar Seni%')).fetchall()
    if len(rows) != 2:
        raise AssertionError("Routing acceptance requires both public station records")
    origins = [PrivateOrigin(row[1], row[2]) for row in rows]
    async with httpx.AsyncClient(timeout=30) as client:
        surfaces = await asyncio.gather(*(_fetch_surface(client, origin, 30) for origin in origins))
        if any(minutes_at(surface, origin.latitude, origin.longitude) is None
               for surface, origin in zip(surfaces, origins)):
            raise AssertionError("OTP surfaces must cover their public station origins")
        arrival = (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).replace(
            hour=18, minute=0, second=0, microsecond=0)
        response = await client.get(
            os.environ['OTP_BASE_URL'].rstrip('/') + '/otp/routers/default/plan',
            params={
                'fromPlace': f'{origins[0].latitude},{origins[0].longitude}',
                'toPlace': f'{origins[1].latitude},{origins[1].longitude}',
                'date': arrival.date().isoformat(), 'time': '18:00:00',
                'arriveBy': 'true', 'mode': 'TRANSIT,WALK', 'numItineraries': 3,
            },
        )
        response.raise_for_status()
        itineraries = response.json().get('plan', {}).get('itineraries', [])
        if not itineraries or any(plan['endTime'] > arrival.timestamp() * 1000 for plan in itineraries):
            raise AssertionError('OTP must return journeys arriving by the chosen meeting time')
        if not any(leg.get('transitLeg') for plan in itineraries for leg in plan['legs']):
            raise AssertionError('The real routing check must include a transit journey')
    return ['Live OTP surfaces decode for two public stations', 'Live arrive-by journey includes transit']


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-routing', action='store_true', help='Also query the configured OTP using public stations')
    args = parser.parse_args()
    database = psycopg.connect(database_url(), connect_timeout=10, prepare_threshold=None)
    try:
        database.execute("set local statement_timeout = '20s'")
        checks = run_checks(database)
        if args.check_routing:
            checks.extend(asyncio.run(check_routing(database)))
    finally:
        database.rollback()
        database.close()
    print(json.dumps({"passed": len(checks), "checks": checks, "fixture_writes": "rolled back"}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (psycopg.Error, httpx.HTTPError, AssertionError, RoutingUnavailableError) as error:
        # HTTP exceptions may embed query coordinates; connection errors may
        # include credentials. Print only a safe category and assertion label.
        print(json.dumps({
            'status': 'failed', 'type': type(error).__name__,
            'reason': str(error) if isinstance(error, AssertionError) else 'Live service check failed.',
            'fixture_writes': 'rolled back',
        }))
        sys.exit(1)
