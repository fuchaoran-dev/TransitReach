from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from math import ceil
from struct import error as StructError
from uuid import UUID

import httpx
from psycopg.types.json import Jsonb

from backend.app.database import connection
from backend.app.schemas.meetings import CommonGroundResponse, PublicVenue, VenueProposal, VenueType
from backend.app.services.travel_time_surface import (
    TravelTimeSurface, decode_travel_time_surface, minutes_at,
)


ROUTING_TIMEOUT_SECONDS = 25.0
MAX_PROPOSALS = 20
DEFAULT_ROUTING_TIME = "2026-09-01T08:00:00+08:00"


class RoomUnavailableError(Exception):
    """The room is absent, expired, or does not belong to the authenticated caller."""


class BudgetChangedError(Exception):
    """The browser calculated against a stale room budget."""


class RoutingUnavailableError(Exception):
    """OTP could not provide a complete result for every private origin."""


class MeetingInputsChangedError(Exception):
    """The room changed while OTP was calculating, so its proposals are not confirmable."""


@dataclass(frozen=True)
class PrivateOrigin:
    latitude: float
    longitude: float


@dataclass(frozen=True)
class MeetingCalculation:
    budget_minutes: int
    participant_count: int
    origins: tuple[PrivateOrigin, ...]
    venues: tuple[PublicVenue, ...]
    room_revision: int


def _load_calculation(
    code: str,
    caller_id: UUID,
    venue_types: list[VenueType],
) -> MeetingCalculation:
    """Read private origins only after proving that the token owner belongs to the room."""
    with connection() as database:
        room = database.execute(
            """
            select r.code, r.time_budget, r.planning_revision
            from public.meeting_rooms r
            join public.meeting_participants caller
              on caller.room_code = r.code and caller.user_id = %s
            where r.code = %s and r.expires_at > now()
            """,
            (caller_id, code),
        ).fetchone()
        if room is None:
            raise RoomUnavailableError

        participants = database.execute(
            """
            select latitude, longitude
            from (
              select lat as latitude, lon as longitude, joined_at, id
              from public.meeting_participants where room_code = %s
            ) participants
            order by joined_at, id
            """,
            (code,),
        ).fetchall()
        origins = tuple(
            PrivateOrigin(float(row["latitude"]), float(row["longitude"]))
            for row in participants
            if row["latitude"] is not None and row["longitude"] is not None
        )

        rows = database.execute(
            """
            with candidates as (
              select 'station-' || stop_id as id, 'station' as type, name,
                     'Rail station' as kind_label, latitude, longitude,
                     null::text as address, null::text as hours
              from public.transit_stops
              where mode = 'RAIL' and 'station' = any(%s)
              union all
              select service_id, case
                       when source_category = 'amenity=cafe' then 'cafe'
                       when source_category in ('amenity=restaurant', 'amenity=fast_food') then 'restaurant'
                       when source_category = 'shop=mall' then 'mall'
                     end,
                     name, case
                       when source_category = 'amenity=cafe' then 'Café'
                       when source_category = 'amenity=restaurant' then 'Restaurant'
                       when source_category = 'amenity=fast_food' then 'Fast food'
                       when source_category = 'shop=mall' then 'Mall'
                     end,
                     latitude, longitude, address, hours
              from public.essential_services
              where (case
                       when source_category = 'amenity=cafe' then 'cafe'
                       when source_category in ('amenity=restaurant', 'amenity=fast_food') then 'restaurant'
                       when source_category = 'shop=mall' then 'mall'
                     end) = any(%s)
            )
            select * from candidates order by name, id
            """,
            (venue_types, venue_types),
        ).fetchall()

    venues = tuple(PublicVenue(
        id=row["id"], type=row["type"], name=row["name"],
        kindLabel=row["kind_label"], lat=row["latitude"], lon=row["longitude"],
        address=row["address"], hours=row["hours"],
    ) for row in rows)
    return MeetingCalculation(
        int(room["time_budget"]), len(participants), origins, venues,
        int(room["planning_revision"]),
    )


def _store_proposals(
    code: str,
    caller_id: UUID,
    room_revision: int,
    proposals: list[VenueProposal],
) -> None:
    with connection() as database:
        current = database.execute(
            """
            select 1
            from public.meeting_rooms r
            join public.meeting_participants caller
              on caller.room_code = r.code and caller.user_id = %s
            where r.code = %s and r.expires_at > now() and r.planning_revision = %s
            for share of r
            """,
            (caller_id, code, room_revision),
        ).fetchone()
        if current is None:
            raise MeetingInputsChangedError
        database.execute(
            """
            delete from public.meeting_plan_proposals
            where expires_at <= now() or (room_code = %s and room_revision <> %s)
            """,
            (code, room_revision),
        )
        with database.cursor() as cursor:
            cursor.executemany(
                """
                insert into public.meeting_plan_proposals
                  (room_code, room_revision, venue_id, venue_type, venue)
                values (%s, %s, %s, %s, %s)
                on conflict (room_code, room_revision, venue_id, venue_type)
                do update set venue = excluded.venue, generated_at = now(),
                              expires_at = now() + interval '1 hour'
                """,
                [(
                    code, room_revision, proposal.venue.id, proposal.venue.type,
                    Jsonb(proposal.venue.model_dump(by_alias=True, exclude_none=True)),
                ) for proposal in proposals],
            )


async def _fetch_surface(client: httpx.AsyncClient, origin: PrivateOrigin, budget: int) -> TravelTimeSurface:
    base_url = os.getenv("OTP_BASE_URL", "http://localhost:8080").rstrip("/")
    try:
        response = await client.get(
            f"{base_url}/otp/traveltime/surface",
            params={
                "location": f"{origin.latitude},{origin.longitude}",
                "time": os.getenv("MEETING_ROUTING_TIME", DEFAULT_ROUTING_TIME),
                "modes": "WALK,SUBWAY,TRAM,BUS",
                "arriveBy": "false",
                "cutoff": f"{budget}M",
            },
        )
        response.raise_for_status()
        return decode_travel_time_surface(response.content)
    except (httpx.HTTPError, ValueError, IndexError, StructError) as error:
        raise RoutingUnavailableError from error


async def common_ground(
    code: str,
    caller_id: UUID,
    venue_types: list[VenueType],
    requested_budget: int | None,
) -> CommonGroundResponse:
    calculation = await asyncio.to_thread(_load_calculation, code, caller_id, venue_types)
    if requested_budget is not None and requested_budget != calculation.budget_minutes:
        raise BudgetChangedError

    missing = calculation.participant_count - len(calculation.origins)
    base = {
        "participantCount": calculation.participant_count,
        "missingStartingPoints": missing,
        "budgetMinutes": calculation.budget_minutes,
    }
    if calculation.participant_count < 2:
        return CommonGroundResponse(status="waiting_for_participants", proposals=[], **base)
    if missing:
        return CommonGroundResponse(status="waiting_for_origins", proposals=[], **base)

    timeout = httpx.Timeout(ROUTING_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        surfaces = await asyncio.gather(*(
            _fetch_surface(client, origin, calculation.budget_minutes)
            for origin in calculation.origins
        ))

    ranked: list[tuple[int, int, str, PublicVenue]] = []
    for venue in calculation.venues:
        exact = [minutes_at(surface, venue.lat, venue.lon) for surface in surfaces]
        if any(value is None or value > calculation.budget_minutes for value in exact):
            continue
        rounded = [ceil(value) for value in exact if value is not None]
        longest = max(rounded)
        ranked.append((longest, longest - min(rounded), venue.name, venue))

    ranked.sort(key=lambda item: (item[0], item[1], item[2].casefold(), item[3].id))
    proposals = [VenueProposal(
        rank=index,
        venue=venue,
        longestMinutes=longest,
        gapMinutes=gap,
    ) for index, (longest, gap, _name, venue) in enumerate(ranked[:MAX_PROPOSALS], 1)]
    if proposals:
        await asyncio.to_thread(
            _store_proposals, code, caller_id, calculation.room_revision, proposals,
        )
    return CommonGroundResponse(
        status="ready" if proposals else "no_common_ground",
        proposals=proposals,
        **base,
    )
