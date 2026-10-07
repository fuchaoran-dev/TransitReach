"""Opt-in live meeting smoke test. Creates and removes its own temporary records.

Uses two anonymous Auth sessions and public station origins. Never prints tokens,
keys or connection strings. Does not change deployment or project configuration.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import subprocess
from urllib.parse import urlparse

from dotenv import dotenv_values
import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.database import database_url


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--run-live", action="store_true",
                        help="Allow temporary anonymous Auth users and meeting writes")
    args = parser.parse_args()
    if not args.run_live:
        parser.error("Explicit --run-live is required; this test creates temporary records")
    values = dotenv_values(Path(__file__).resolve().parents[1] / ".env.local")
    supabase = values["SUPABASE_URL"].rstrip("/")
    key = values["SUPABASE_ANON_KEY"]
    auth_host = urlparse(supabase).hostname or ""
    if not auth_host.endswith(".supabase.co") or urlparse(supabase).scheme != "https":
        raise RuntimeError("Auth URL must be an HTTPS Supabase project URL")
    project = auth_host.removesuffix(".supabase.co")
    database_address = urlparse(database_url())
    if (database_address.hostname != f"db.{project}.supabase.co" and
            database_address.username != f"postgres.{project}"):
        raise RuntimeError("Auth and cleanup database must use the same Supabase project")
    api = args.api_base.rstrip("/")
    users: list[dict] = []
    room = None
    checks: list[str] = []

    def require(condition: bool, label: str) -> None:
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    with psycopg.connect(database_url(), connect_timeout=15) as database, httpx.Client(timeout=55) as client:
        def post(path: str, headers: dict, payload: dict):
            response = client.post(supabase + path, headers=headers, json=payload)
            if not response.is_success:
                raise AssertionError(f"Supabase HTTP {response.status_code} at {path}")
            return response.json() if response.content else None

        def rpc(name: str, user: dict, payload: dict):
            return post("/rest/v1/rpc/" + name, user["headers"], payload)

        try:
            for _ in range(2):
                identity = post("/auth/v1/signup", {"apikey": key}, {})
                users.append({"id": identity["user"]["id"], "headers": {
                    "apikey": key, "Authorization": "Bearer " + identity["access_token"],
                }})
            require(len(users) == 2, "Two anonymous Auth sessions")
            room = rpc("create_meeting_room", users[0], {"p_nickname": "MD8-6 API QA A (temporary)"})
            rpc("join_meeting_room", users[1], {"p_code": room, "p_nickname": "MD8-6 API QA B (temporary)"})
            for user, point in zip(users, [(3.13442, 101.68625, "KL Sentral"), (3.14237, 101.69544, "Pasar Seni")]):
                response = client.patch(supabase + "/rest/v1/meeting_participants", params={
                    "room_code": "eq." + room, "user_id": "eq." + user["id"], "select": "id",
                }, headers={**user["headers"], "Prefer": "return=representation"}, json={
                    "lat": point[0], "lon": point[1], "source": "stop", "label": point[2],
                })
                require(response.status_code == 200 and len(response.json()) == 1, "Own public-station origin saved")
            states = [rpc("get_meeting_room_state", user, {"p_code": room}) for user in users]
            require(all(len(state["members"]) == 2 and all(
                set(member) == {"id", "display_name", "arrival_status", "is_self"}
                for member in state["members"]) for state in states), "Shared projection excludes other origins and Auth identities")
            response = client.get(supabase + "/rest/v1/meeting_participants",
                                  params={"room_code": "eq." + room}, headers=users[0]["headers"])
            require(response.status_code == 200 and len(response.json()) == 1, "RLS returns only own participant")
            response = client.post(api + "/api/meetings/" + room + "/common-ground", headers={
                "Authorization": users[0]["headers"]["Authorization"],
            }, json={"timeBudget": 30, "venueTypes": ["station", "cafe", "restaurant", "mall"]})
            require(response.status_code == 200, "Online API accepts same-project Auth token")
            result = response.json()
            require(result["status"] == "ready" and bool(result["proposals"]), "PostgreSQL and OTP return real ranked venues")
            require(all(set(proposal) == {"rank", "venue", "longestMinutes", "gapMinutes"}
                        for proposal in result["proposals"]), "Ranking exposes only public venues and aggregate times")
            # Do not choose an origin station as the destination: OTP legitimately
            # rejects a zero-length journey. Prefer the known public restaurant used
            # in browser QA, otherwise a distinct cafe/restaurant from the ranking.
            candidates = [proposal["venue"] for proposal in result["proposals"]
                          if proposal["venue"]["type"] in {"cafe", "restaurant"}]
            require(bool(candidates), "Non-origin public meeting venue available")
            venue = next((candidate for candidate in candidates if candidate["name"] == "Bombay Talkies"), candidates[0])
            arrival = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=45, second=0, microsecond=0)
            version = rpc("confirm_meeting_plan", users[0], {
                "p_code": room, "p_venue": venue, "p_arrival_time": arrival.isoformat(),
            })
            require(version == 1, "Online proposal confirmed as plan v1")
            states = [rpc("get_meeting_room_state", user, {"p_code": room}) for user in users]
            require(all(state["room"]["plan_version"] == 1 and state["room"]["confirmed_venue"]["id"] == venue["id"]
                        for state in states), "Both sessions read the same agreement")
            invitation = rpc("get_meeting_invitation", users[1], {"p_code": room})
            require(set(invitation) == {"code", "confirmed_venue", "confirmed_arrival_time", "plan_version"},
                    "Invitation contains public agreement only")
            wall = arrival.astimezone(timezone(timedelta(hours=8)))
            for latitude, longitude in [(3.13442, 101.68625), (3.14237, 101.69544)]:
                itineraries = []
                for mode in ["WALK", "TRANSIT,WALK"]:
                    parameters = {
                        "fromPlace": f"{latitude},{longitude}", "toPlace": f"{venue['lat']},{venue['lon']}",
                        "mode": mode, "date": wall.strftime("%Y-%m-%d"), "time": wall.strftime("%H:%M:%S"),
                        "arriveBy": "true", "numItineraries": 1 if mode == "WALK" else 6, "locale": "en",
                    }
                    if mode != "WALK":
                        parameters["walkReluctance"] = 4
                    response = client.get(api + "/otp/routers/default/plan", params=parameters)
                    require(response.status_code == 200, "OTP proxy accepts frontend routing parameters")
                    itineraries.extend(response.json().get("plan", {}).get("itineraries", []))
                require(bool(itineraries), "Online arrive-by journey through OTP proxy")
                require(all(itinerary["endTime"] <= arrival.timestamp() * 1000 for itinerary in itineraries),
                        "Arrive-by journeys reach venue no later than agreed time")
            rpc("set_my_arrival_status", users[0], {"p_code": room, "p_status": "ready", "p_plan_version": 1})
            proposed = arrival + timedelta(minutes=15)
            rpc("propose_meeting_time", users[1], {"p_code": room, "p_arrival_time": proposed.isoformat()})
            state = rpc("get_meeting_room_state", users[0], {"p_code": room})
            require(state["room"]["plan_version"] == 1 and
                    datetime.fromisoformat(state["room"]["confirmed_arrival_time"]) == arrival,
                    "Suggested time leaves agreed time and version unchanged")
            realtime = subprocess.run([
                "node", str(Path(__file__).with_name("check-meeting-realtime.mjs")),
            ], input=json.dumps({
                "url": supabase, "key": key, "room": room,
                "viewerToken": users[0]["headers"]["Authorization"].removeprefix("Bearer "),
                "writerToken": users[1]["headers"]["Authorization"].removeprefix("Bearer "),
                "proposedTime": proposed.isoformat(),
            }), text=True, capture_output=True, timeout=35)
            require(realtime.returncode == 0, "Cross-session realtime delivers room changes without private fields")
            version = rpc("confirm_meeting_plan", users[1], {
                "p_code": room, "p_venue": venue, "p_arrival_time": proposed.isoformat(),
            })
            state = rpc("get_meeting_room_state", users[0], {"p_code": room})
            require(version == 2 and all(member["arrival_status"] == "Not checked" for member in state["members"]),
                    "Changed agreement invalidates old readiness")
            print(f"Live online checks passed: {len(checks)}")
            for label in checks:
                print("PASS", label)
        finally:
            if room:
                matched = database.execute("""
                    select count(*) from public.meeting_participants
                    where room_code=%s and user_id=any(%s::uuid[])
                      and nickname like 'MD8-6 API QA %% (temporary)'
                """, (room, [user["id"] for user in users])).fetchone()[0]
                total = database.execute("select count(*) from public.meeting_participants where room_code=%s",
                                         (room,)).fetchone()[0]
                if matched != len(users) or total != matched:
                    raise RuntimeError("Cleanup target verification failed; records retained for inspection")
                database.execute("delete from public.meeting_rooms where code=%s", (room,))
            for user in users:
                database.execute("delete from auth.users where id=%s and is_anonymous=true", (user["id"],))
            database.commit()
            print("Removed only this smoke test's room and temporary anonymous identities")


if __name__ == "__main__":
    main()
