from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, field_validator


VenueType = Literal["station", "cafe", "restaurant", "mall"]

Longitude = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-180, le=180)]
Latitude = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=-90, le=90)]
Coordinate = tuple[Longitude, Latitude]


def _validate_ring(ring: list[Coordinate]) -> list[Coordinate]:
    if ring[0] != ring[-1] or len(set(ring[:-1])) < 3:
        raise ValueError("A ring must be closed and contain at least three distinct vertices")
    # Translate to the first vertex to avoid cancellation at longitude ~101 degrees.
    lon, lat = ring[0]
    area = sum(
        (a[0] - lon) * (b[1] - lat) - (b[0] - lon) * (a[1] - lat)
        for a, b in zip(ring, ring[1:])
    )
    if area == 0:
        raise ValueError("A ring must enclose a nonzero area")
    return ring


Ring = Annotated[list[Coordinate], Field(min_length=4), AfterValidator(_validate_ring)]


class IsochroneRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outer: Ring
    holes: list[Ring] = Field(default_factory=list)


class ParticipantArea(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regions: list[IsochroneRegion] = Field(min_length=1)


class CommonGroundRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    time_budget: Literal[15, 30, 45, 60] | None = Field(default=None, alias="timeBudget")
    venue_types: list[VenueType] = Field(alias="venueTypes", min_length=1, max_length=4)

    @field_validator("venue_types")
    @classmethod
    def unique_venue_types(cls, value: list[VenueType]) -> list[VenueType]:
        if len(set(value)) != len(value):
            raise ValueError("venueTypes must not contain duplicates")
        return value


class PublicVenue(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: VenueType
    name: str
    kind_label: str = Field(alias="kindLabel")
    lat: float
    lon: float
    address: str | None = None
    hours: str | None = None


class VenueProposal(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rank: int = Field(ge=1)
    venue: PublicVenue
    longest_minutes: int = Field(alias="longestMinutes", ge=0)
    gap_minutes: int = Field(alias="gapMinutes", ge=0)


class CommonGroundResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    # no_common_ground describes eligible venues, not whether the areas intersect.
    status: Literal[
        "waiting_for_planning", "waiting_for_participants", "waiting_for_origins",
        "no_common_ground", "ready",
    ]
    participant_count: int = Field(alias="participantCount", ge=1, le=6)
    missing_starting_points: int = Field(alias="missingStartingPoints", ge=0, le=6)
    budget_minutes: int = Field(alias="budgetMinutes")
    room_revision: int = Field(alias="roomRevision", ge=0)
    departure_time: AwareDatetime | None = Field(alias="departureTime")
    arrival_time: AwareDatetime | None = Field(default=None, alias="arrivalTime")
    area_method: Literal["budget-window-preview"] = Field(default="budget-window-preview", alias="areaMethod")
    participant_areas: list[ParticipantArea] = Field(default_factory=list, alias="participantAreas", max_length=6)
    proposals: list[VenueProposal]
