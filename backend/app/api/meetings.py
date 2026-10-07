from __future__ import annotations

import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException

from backend.app.schemas.meetings import CommonGroundRequest, CommonGroundResponse
from backend.app.services.meeting_auth_service import validate_supabase_token
from backend.app.services.meeting_service import (
    BudgetChangedError, MeetingInputsChangedError, RoomUnavailableError,
    RoutingUnavailableError, common_ground,
)


router = APIRouter(prefix="/api/meetings", tags=["meetings"])
ROOM_CODE = re.compile(r"^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$")


def authenticated_user(authorization: Annotated[str | None, Header()] = None) -> UUID:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A meeting session is required.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="A meeting session is required.")
    return validate_supabase_token(token)


@router.post("/{code}/common-ground", response_model=CommonGroundResponse, response_model_by_alias=True)
async def calculate_common_ground(
    code: str,
    request: CommonGroundRequest,
    caller_id: Annotated[UUID, Depends(authenticated_user)],
) -> CommonGroundResponse:
    code = code.upper()
    if ROOM_CODE.fullmatch(code) is None:
        raise HTTPException(status_code=404, detail="Meeting room not found.")
    try:
        return await common_ground(
            code, caller_id, request.venue_types, request.time_budget,
        )
    except RoomUnavailableError as error:
        # Absent, expired and unauthorized are deliberately indistinguishable.
        raise HTTPException(status_code=404, detail="Meeting room not found.") from error
    except BudgetChangedError as error:
        raise HTTPException(status_code=409, detail="The room budget changed. Reload and try again.") from error
    except MeetingInputsChangedError as error:
        raise HTTPException(status_code=409, detail="The room changed during calculation. Try again.") from error
    except RoutingUnavailableError as error:
        raise HTTPException(status_code=503, detail="Meeting-place calculation is temporarily unavailable.") from error
