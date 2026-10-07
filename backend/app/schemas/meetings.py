from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


VenueType = Literal["station", "cafe", "restaurant", "mall"]


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

    status: Literal["waiting_for_participants", "waiting_for_origins", "no_common_ground", "ready"]
    participant_count: int = Field(alias="participantCount", ge=1, le=6)
    missing_starting_points: int = Field(alias="missingStartingPoints", ge=0, le=6)
    budget_minutes: int = Field(alias="budgetMinutes")
    proposals: list[VenueProposal]
