from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil
from struct import error as StructError
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from psycopg.types.json import Jsonb
from pydantic import AwareDatetime, BaseModel, Field, TypeAdapter, ValidationError

from backend.app.database import connection
from backend.app.schemas.meetings import (
    CommonGroundResponse, IsochroneRegion, ParticipantArea, ParticipantTrip,
    PublicVenue, Ring, VenueProposal, VenueType,
)
from backend.app.services.travel_time_surface import (
    TravelTimeSurface, decode_travel_time_surface, minutes_at,
)


ROUTING_TIMEOUT_SECONDS = 25.0
MAX_PROPOSALS = 20
MAX_CANDIDATE_CHECKS = 30
MAX_ROUTING_CONCURRENCY = 6
ROUTING_MODES = "WALK,SUBWAY,TRAM,BUS"
DEPARTURE_TIME = TypeAdapter(AwareDatetime)


class _Polygon(BaseModel):
    type: Literal["Polygon"]
    coordinates: list[Ring] = Field(min_length=1)


class _MultiPolygon(BaseModel):
    type: Literal["MultiPolygon"]
    coordinates: list[Annotated[list[Ring], Field(min_length=1)]] = Field(min_length=1)


class _IsochroneFeature(BaseModel):
    type: Literal["Feature"]
    geometry: Annotated[_Polygon | _MultiPolygon, Field(discriminator="type")]


class _IsochroneCollection(BaseModel):
    type: Literal["FeatureCollection"]
    features: list[_IsochroneFeature] = Field(min_length=1)


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
    participant_id: UUID | None = None


@dataclass(frozen=True)
class MeetingCalculation:
    budget_minutes: int
    participant_count: int
    origins: tuple[PrivateOrigin, ...]
    venues: tuple[PublicVenue, ...]
    room_revision: int
    planning_started: bool
    departure_time: datetime | None
    arrival_time: datetime | None = None


def _load_calculation(
    code: str,
    caller_id: UUID,
    venue_types: list[VenueType],
) -> MeetingCalculation:
    """Read private origins only after proving that the token owner belongs to the room."""
    with connection() as database:
        room = database.execute(
            """
            select r.code, r.time_budget, r.planning_revision,
                   r.planning_started, r.departure_time, r.voting_arrival_time
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
            select id, latitude, longitude
            from (
              select case when origin_shared then lat end as latitude,
                     case when origin_shared then lon end as longitude, joined_at, id
              from public.meeting_participants where room_code = %s
            ) participants
            order by joined_at, id
            """,
            (code,),
        ).fetchall()
        origins = tuple(
            PrivateOrigin(
                float(row["latitude"]), float(row["longitude"]),
                participant_id=row["id"],
            )
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
        bool(room["planning_started"]), room["departure_time"],
        room["voting_arrival_time"],
    )


def _store_proposals(
    code: str,
    caller_id: UUID,
    room_revision: int,
    proposals: list[VenueProposal],
    expected_budget: int | None = None,
) -> None:
    with connection() as database:
        current = database.execute(
            """
            select 1
            from public.meeting_rooms r
            join public.meeting_participants caller
              on caller.room_code = r.code and caller.user_id = %s
            where r.code = %s and r.expires_at > now() and r.planning_revision = %s
              and (%s::integer is null or r.time_budget = %s)
            for share of r
            """,
            (caller_id, code, room_revision, expected_budget, expected_budget),
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
        if not proposals:
            return
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


def _routing_params(origin: PrivateOrigin, budget: int, departure_time: datetime) -> dict[str, str]:
    return {
        "location": f"{origin.latitude},{origin.longitude}",
        "time": departure_time.isoformat(),
        "modes": ROUTING_MODES,
        "arriveBy": "false",
        "cutoff": f"{budget}M",
    }


async def _fetch_surface(
    client: httpx.AsyncClient, origin: PrivateOrigin, budget: int, departure_time: datetime,
) -> TravelTimeSurface:
    base_url = os.getenv("OTP_BASE_URL", "http://localhost:8080").rstrip("/")
    try:
        response = await client.get(
            f"{base_url}/otp/traveltime/surface",
            params=_routing_params(origin, budget, departure_time),
        )
        response.raise_for_status()
        return decode_travel_time_surface(response.content)
    except (httpx.HTTPError, ValueError, IndexError, StructError) as error:
        raise RoutingUnavailableError from error


async def _fetch_isochrone(
    client: httpx.AsyncClient, origin: PrivateOrigin, budget: int, departure_time: datetime,
) -> ParticipantArea:
    base_url = os.getenv("OTP_BASE_URL", "http://localhost:8080").rstrip("/")
    try:
        response = await client.get(
            f"{base_url}/otp/traveltime/isochrone",
            params={**_routing_params(origin, budget, departure_time), "batch": "true"},
        )
        response.raise_for_status()
        collection = _IsochroneCollection.model_validate(response.json())
        regions: list[IsochroneRegion] = []
        for feature in collection.features:
            geometry = feature.geometry
            polygons = [geometry.coordinates] if isinstance(geometry, _Polygon) else geometry.coordinates
            regions.extend(IsochroneRegion(outer=rings[0], holes=rings[1:]) for rings in polygons)
        return ParticipantArea(regions=regions)
    except (httpx.HTTPError, ValueError) as error:
        raise RoutingUnavailableError from error


class _RouteLeg(BaseModel):
    startTime: int = Field(ge=0)
    endTime: int = Field(ge=0)


class _RouteItinerary(BaseModel):
    startTime: int = Field(ge=0)
    endTime: int = Field(ge=0)
    legs: list[_RouteLeg] = Field(min_length=1)


class _RoutePlan(BaseModel):
    itineraries: list[_RouteItinerary]


async def _fetch_arrive_by_minutes(
    client: httpx.AsyncClient, origin: PrivateOrigin, venue: PublicVenue,
    budget: int, arrival: datetime,
) -> float | None:
    """Validate each screened candidate toward the venue, never reverse toward the origin."""
    if origin.latitude == venue.lat and origin.longitude == venue.lon:
        return 0.0
    wall_time = arrival.astimezone(ZoneInfo("Asia/Kuala_Lumpur"))
    try:
        response = await client.get(
            f"{os.getenv('OTP_BASE_URL', 'http://localhost:8080').rstrip('/')}/otp/routers/default/plan",
            params={
                "fromPlace": f"{origin.latitude},{origin.longitude}",
                "toPlace": f"{venue.lat},{venue.lon}", "mode": "TRANSIT,WALK",
                "date": wall_time.strftime("%Y-%m-%d"), "time": wall_time.strftime("%H:%M:%S"),
                "arriveBy": "true", "numItineraries": "6", "walkReluctance": "4", "locale": "en",
            },
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("Malformed plan")
        if body.get("error"):
            if isinstance(body["error"], dict) and body["error"].get("id") in (404, 409):
                return None
            raise ValueError("Routing error")
        plan = _RoutePlan.model_validate(body.get("plan"))
        deadline = arrival.timestamp() * 1000
        eligible = [
            trip for trip in plan.itineraries
            if 0 <= trip.endTime - trip.startTime <= budget * 60_000
            and trip.endTime <= deadline
            and all(trip.startTime <= leg.startTime <= leg.endTime <= trip.endTime for leg in trip.legs)
            and all(a.endTime <= b.startTime for a, b in zip(trip.legs, trip.legs[1:]))
        ]
        if not eligible:
            return None
        trip = min(eligible, key=lambda value: (-value.startTime, value.endTime - value.startTime))
        return (trip.endTime - trip.startTime) / 60_000
    except (httpx.HTTPError, ValueError) as error:
        raise RoutingUnavailableError from error


async def common_ground(
    code: str,
    caller_id: UUID,
    venue_types: list[VenueType],
    requested_budget: int | None,
) -> CommonGroundResponse:
    calculation = await asyncio.to_thread(_load_calculation, code, caller_id, venue_types)
    missing = calculation.participant_count - len(calculation.origins)
    base = {
        "participantCount": calculation.participant_count,
        "missingStartingPoints": missing,
        "budgetMinutes": calculation.budget_minutes,
        "roomRevision": calculation.room_revision,
        "departureTime": None,
        "arrivalTime": calculation.arrival_time,
        "areaMethod": "budget-window-preview",
    }
    if not calculation.planning_started:
        return CommonGroundResponse(status="waiting_for_planning", proposals=[], **base)
    if requested_budget is not None and requested_budget != calculation.budget_minutes:
        raise BudgetChangedError
    if calculation.participant_count < 2:
        return CommonGroundResponse(status="waiting_for_participants", proposals=[], **base)
    if missing:
        return CommonGroundResponse(status="waiting_for_origins", proposals=[], **base)

    try:
        arrival_time = DEPARTURE_TIME.validate_python(calculation.arrival_time)
    except ValidationError as error:
        raise RoutingUnavailableError from error

    # A forward preview from the budget-window opening, not every possible departure.
    # arriveBy=true at the participant would find origins reaching them, the wrong direction.
    departure_time = arrival_time - timedelta(minutes=calculation.budget_minutes)
    base["departureTime"] = departure_time
    # Limit both endpoint requests together; private geometry exists only in this request.
    semaphore = asyncio.Semaphore(MAX_ROUTING_CONCURRENCY)

    async def fetch_participant(
        client: httpx.AsyncClient, origin: PrivateOrigin,
    ) -> tuple[TravelTimeSurface, ParticipantArea]:
        async with semaphore:
            surface = await _fetch_surface(client, origin, calculation.budget_minutes, departure_time)
            area = await _fetch_isochrone(client, origin, calculation.budget_minutes, departure_time)
            return surface, area

    timeout = httpx.Timeout(ROUTING_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(
        timeout=timeout, limits=httpx.Limits(max_connections=MAX_ROUTING_CONCURRENCY),
    ) as client:
        tasks = [
            asyncio.create_task(fetch_participant(client, origin))
            for origin in calculation.origins
        ]
        try:
            results = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
    surfaces = [surface for surface, _area in results]

    ranked: list[tuple[int, int, str, PublicVenue]] = []
    for venue in calculation.venues:
        exact = [minutes_at(surface, venue.lat, venue.lon) for surface in surfaces]
        if any(value is None or value > calculation.budget_minutes for value in exact):
            continue
        rounded = [ceil(value) for value in exact if value is not None]
        longest = max(rounded)
        ranked.append((longest, longest - min(rounded), venue.name, venue))

    ranked.sort(key=lambda item: (item[0], item[1], item[2].casefold(), item[3].id))
    # Bound OTP work. Ranking covers a screened shortlist, not all POIs globally.
    async def verify_candidate(
        item: tuple[int, int, str, PublicVenue],
    ) -> tuple[int, int, str, PublicVenue, list[int]] | None:
        venue = item[3]
        async def verify_member(origin: PrivateOrigin) -> float | None:
            async with semaphore:
                return await _fetch_arrive_by_minutes(client, origin, venue, calculation.budget_minutes, arrival_time)
        member_tasks = [asyncio.create_task(verify_member(origin)) for origin in calculation.origins]
        try:
            durations = await asyncio.gather(*member_tasks)
        except BaseException:
            for task in member_tasks:
                task.cancel()
            await asyncio.gather(*member_tasks, return_exceptions=True)
            raise
        if any(value is None for value in durations):
            return None
        rounded = [ceil(value) for value in durations if value is not None]
        return max(rounded), max(rounded) - min(rounded), venue.name, venue, rounded

    async with httpx.AsyncClient(timeout=timeout, limits=httpx.Limits(max_connections=MAX_ROUTING_CONCURRENCY)) as client:
        tasks = [asyncio.create_task(verify_candidate(item)) for item in ranked[:MAX_CANDIDATE_CHECKS]]
        try:
            verified = await asyncio.wait_for(asyncio.gather(*tasks), timeout=ROUTING_TIMEOUT_SECONDS)
        except TimeoutError as error:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise RoutingUnavailableError from error
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
    verified_ranked = sorted(
        (item for item in verified if item is not None),
        key=lambda item: (item[0], item[1], item[2].casefold(), item[3].id),
    )

    def participant_trips(minutes: list[int]) -> list[ParticipantTrip]:
        if any(origin.participant_id is None for origin in calculation.origins):
            return []
        return [
            ParticipantTrip(memberId=origin.participant_id, minutes=duration)
            for origin, duration in zip(calculation.origins, minutes, strict=True)
            if origin.participant_id is not None
        ]

    proposals = [VenueProposal(
        rank=index,
        venue=venue,
        longestMinutes=longest,
        gapMinutes=gap,
        participantTrips=participant_trips(minutes),
    ) for index, (longest, gap, _name, venue, minutes) in enumerate(verified_ranked[:MAX_PROPOSALS], 1)]
    # Even an empty venue ranking carries geometry that must pass the same revision guard.
    await asyncio.to_thread(
        _store_proposals, code, caller_id, calculation.room_revision, proposals,
        expected_budget=calculation.budget_minutes,
    )
    return CommonGroundResponse(
        status="ready" if proposals else "no_common_ground",
        proposals=proposals,
        participantAreas=[
            ParticipantArea(memberId=origin.participant_id, regions=area.regions)
            for origin, (_surface, area) in zip(calculation.origins, results, strict=True)
        ],
        **base,
    )
