from __future__ import annotations

import os
from uuid import UUID

import httpx
from fastapi import HTTPException


AUTH_TIMEOUT_SECONDS = 8.0


def validate_supabase_token(token: str) -> UUID:
    """Resolve a bearer token through Supabase Auth; never accept a client-supplied user id."""
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    api_key = os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not api_key:
        raise HTTPException(status_code=503, detail="Meeting authentication is not configured.")

    try:
        response = httpx.get(
            f"{url}/auth/v1/user",
            headers={"apikey": api_key, "Authorization": f"Bearer {token}"},
            timeout=AUTH_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Meeting authentication is temporarily unavailable.") from error

    if response.status_code in {401, 403}:
        raise HTTPException(status_code=401, detail="Invalid or expired meeting session.")
    if response.status_code != 200:
        raise HTTPException(status_code=503, detail="Meeting authentication is temporarily unavailable.")
    try:
        return UUID(response.json()["id"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Invalid meeting session.") from error
