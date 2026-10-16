from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil
from struct import error as StructError
from typing import Annotated, Callable, Literal
from weakref import WeakKeyDictionary
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
MAX_SEARCH_PAGES = 20
MAX_CANDIDATE_CHECKS = 12
TARGET_VERIFIED_PROPOSALS = 12
MAX_TOTAL_CANDIDATE_CHECKS = 24
REPLACEMENT_BATCH_SIZE = 4
MAX_MALL_REPLACEMENT_CHECKS = 6
MALL_REPLACEMENT_BATCH_SIZE = 2
MAX_ROUTING_CONCURRENCY = 6
ROUTING_MODES = "WALK,SUBWAY,TRAM,BUS"
DEPARTURE_TIME = TypeAdapter(AwareDatetime)
_routing_slots: WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = WeakKeyDictionary()


def routing_slots() -> asyncio.Semaphore:
    """A process-wide bound, not six additional OTP requests for every room/browser."""
    loop = asyncio.get_running_loop()
    if loop not in _routing_slots:
        _routing_slots[loop] = asyncio.Semaphore(MAX_ROUTING_CONCURRENCY)
    return _routing_slots[loop]


def check_room_revision(code: str, caller_id: UUID, revision: int, budget: int | None) -> int:
    """Authorize every job poll, including cache hits, without reloading all venues."""
    with connection() as database:
        room = database.execute(
            """select r.planning_revision, r.time_budget from public.meeting_rooms r
               join public.meeting_participants p on p.room_code = r.code and p.user_id = %s
               where r.code = %s and r.expires_at > now()""", (caller_id, code),
        ).fetchone()
    if room is None:
        raise RoomUnavailableError
    if room["planning_revision"] != revision:
        raise MeetingInputsChangedError
    if budget is not None and room["time_budget"] != budget:
        raise BudgetChangedError
    return int(room["time_budget"])


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


RankedCandidate = tuple[int, int, str, PublicVenue]
VerifiedCandidate = tuple[int, int, str, PublicVenue, list[int]]


@dataclass(frozen=True)
class MeetingSearch:
    """Short-lived consent-gated search progress; no origins, tokens or rasters."""

    revision: int
    budget: int
    arrival: datetime
    types: frozenset[VenueType]
    page: int
    ranked: tuple[RankedCandidate, ...]
    tried: frozenset[tuple[VenueType, str]]
    verified: tuple[VerifiedCandidate, ...]
    areas: tuple[ParticipantArea, ...]


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


def _candidate_shortlist(
    ranked: list[tuple[int, int, str, PublicVenue]],
    limit: int = MAX_CANDIDATE_CHECKS,
) -> list[tuple[int, int, str, PublicVenue]]:
    """Share the fixed OTP budget across categories, preserving each category's rank."""
    categories: dict[VenueType, list[tuple[int, int, str, PublicVenue]]] = {}
    for item in ranked:
        categories.setdefault(item[3].type, []).append(item)
    selected: list[tuple[int, int, str, PublicVenue]] = []
    # A sparse category's unused slots go to others; malls cannot be crowded out
    # by many faster stations/restaurants. This is still a screened shortlist.
    for offset in range(limit):
        for items in categories.values():
            if offset < len(items):
                selected.append(items[offset])
                if len(selected) == limit:
                    return selected
        if len(selected) == len(ranked):
            break
    return selected


async def common_ground(
    code: str,
    caller_id: UUID,
    venue_types: list[VenueType],
    requested_budget: int | None,
    *,
    on_areas: Callable[[CommonGroundResponse], None] | None = None,
    verification_timeout: float = ROUTING_TIMEOUT_SECONDS,
    search: MeetingSearch | None = None,
    on_search: Callable[[MeetingSearch], None] | None = None,
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
    semaphore = routing_slots()

    async def fetch_participant(
        client: httpx.AsyncClient, origin: PrivateOrigin,
    ) -> ParticipantArea:
        async with semaphore:
            return await _fetch_isochrone(client, origin, calculation.budget_minutes, departure_time)

    timeout = httpx.Timeout(ROUTING_TIMEOUT_SECONDS)
    if search is not None:
        if (search.revision != calculation.room_revision or search.budget != calculation.budget_minutes
                or search.arrival != arrival_time or search.types != frozenset(venue_types)
                or search.page >= MAX_SEARCH_PAGES - 1):
            raise MeetingInputsChangedError
        participant_areas = list(search.areas)
        ranked = list(search.ranked)
    else:
        async with httpx.AsyncClient(
            timeout=timeout, limits=httpx.Limits(max_connections=MAX_ROUTING_CONCURRENCY),
        ) as client:
            tasks = [asyncio.create_task(fetch_participant(client, origin)) for origin in calculation.origins]
            try:
                results = await asyncio.gather(*tasks)
            except BaseException:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise
        participant_areas = [
            ParticipantArea(memberId=origin.participant_id, regions=area.regions)
            for origin, area in zip(calculation.origins, results, strict=True)
        ]
        if on_areas is not None:
            await asyncio.to_thread(check_room_revision, code, caller_id, calculation.room_revision, calculation.budget_minutes)
            on_areas(CommonGroundResponse(status="finding_places", proposals=[], participantAreas=participant_areas, **base))

        async def fetch_surface(client: httpx.AsyncClient, origin: PrivateOrigin) -> TravelTimeSurface:
            async with semaphore:
                return await _fetch_surface(client, origin, calculation.budget_minutes, departure_time)

        async with httpx.AsyncClient(timeout=timeout) as client:
            tasks = [asyncio.create_task(fetch_surface(client, origin)) for origin in calculation.origins]
            try:
                surfaces = await asyncio.gather(*tasks)
            except BaseException:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise

        ranked: list[RankedCandidate] = []
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
        async def verify_batch(
            items: list[tuple[int, int, str, PublicVenue]],
        ) -> list[tuple[int, int, str, PublicVenue, list[int]] | None]:
            tasks = [asyncio.create_task(verify_candidate(item)) for item in items]
            try:
                return await asyncio.gather(*tasks)
            except BaseException:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise

        async def verify_shortlist() -> list[tuple[int, int, str, PublicVenue, list[int]] | None]:
            prior_tried = search.tried if search else frozenset()
            remaining_ranked = [item for item in ranked if (item[3].type, item[3].id) not in prior_tried]
            shortlist = _candidate_shortlist(remaining_ranked)
            checked = await verify_batch(shortlist)
            tried = {(item[3].type, item[3].id) for item in shortlist}
            mall_check_limit = sum(item[3].type == "mall" for item in shortlist) + MAX_MALL_REPLACEMENT_CHECKS
            if not any(item is not None and item[3].type == "mall" for item in checked):
                replacements = [item for item in remaining_ranked
                                if item[3].type == "mall" and (item[3].type, item[3].id) not in tried]
                # Preserve category coverage before filling the overall list.
                replacements = replacements[:MAX_MALL_REPLACEMENT_CHECKS]
                for offset in range(0, len(replacements), MALL_REPLACEMENT_BATCH_SIZE):
                    batch = replacements[offset:offset + MALL_REPLACEMENT_BATCH_SIZE]
                    extra = await verify_batch(batch)
                    checked.extend(extra)
                    tried.update((item[3].type, item[3].id) for item in batch)
                    if any(item is not None for item in extra):
                        break

            # A larger time budget changes the screening departure and ordering.
            # Rejected first choices must not leave a four-place list just because
            # one mall survived. Refill every category, without unbounded OTP work.
            while sum(item is not None for item in checked) < TARGET_VERIFIED_PROPOSALS:
                remaining = MAX_TOTAL_CANDIDATE_CHECKS - len(tried)
                if remaining <= 0:
                    break
                mall_slots = mall_check_limit - sum(kind == "mall" for kind, _id in tried)
                candidates = []
                for item in remaining_ranked:
                    if (item[3].type, item[3].id) in tried:
                        continue
                    if item[3].type == "mall":
                        if mall_slots <= 0:
                            continue
                        mall_slots -= 1
                    candidates.append(item)
                needed = TARGET_VERIFIED_PROPOSALS - sum(item is not None for item in checked)
                batch = _candidate_shortlist(candidates, min(REPLACEMENT_BATCH_SIZE, remaining, needed))
                if not batch:
                    break
                checked.extend(await verify_batch(batch))
                tried.update((item[3].type, item[3].id) for item in batch)
            checked_keys.update(tried)
            return checked

        checked_keys = set(search.tried) if search else set()
        try:
            verified = await asyncio.wait_for(verify_shortlist(), timeout=verification_timeout)
        except TimeoutError as error:
            raise RoutingUnavailableError from error
    verified_ranked = sorted(
        [*(search.verified if search else ()), *(item for item in verified if item is not None)],
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
    ) for index, (longest, gap, _name, venue, minutes) in enumerate(verified_ranked, 1)]
    # Even an empty venue ranking carries geometry that must pass the same revision guard.
    await asyncio.to_thread(
        _store_proposals, code, caller_id, calculation.room_revision, proposals,
        expected_budget=calculation.budget_minutes,
    )
    page = search.page + 1 if search else 0
    remaining = any((item[3].type, item[3].id) not in checked_keys for item in ranked)
    if on_search is not None:
        on_search(MeetingSearch(calculation.room_revision, calculation.budget_minutes, arrival_time,
                                frozenset(venue_types), page, tuple(ranked), frozenset(checked_keys),
                                tuple(verified_ranked), tuple(participant_areas)))
    return CommonGroundResponse(
        status="ready" if proposals else "no_common_ground",
        proposals=proposals,
        participantAreas=participant_areas,
        searchPage=page, hasMore=remaining and page < MAX_SEARCH_PAGES - 1,
        searchLimitReached=remaining and page == MAX_SEARCH_PAGES - 1,
        checkedPlaces=len(checked_keys),
        **base,
    )
