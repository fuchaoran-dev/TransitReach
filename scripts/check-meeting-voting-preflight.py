"""Explicit rollback-only migration preview; never commits or deploys anything."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

import psycopg
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]
PROJECT = "tritrrkakzechbvlvbcj"


def snapshot(database: psycopg.Connection) -> dict:
    counts = database.execute("""
        select (select count(*) from public.meeting_rooms),
               (select count(*) from public.meeting_participants),
               (select count(*) from public.meeting_rooms where confirmed_venue is not null),
               (select count(*) from public.meeting_plan_proposals),
               (select count(*) from public.transit_stops),
               (select count(*) from public.essential_services)
    """).fetchone()
    # Only a server-computed fingerprint leaves PostgreSQL, never coordinates or names.
    fingerprint = database.execute("""
        select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by id), ''))
        from public.meeting_participants p
    """).fetchone()[0]
    marker = database.execute("""
        select exists(select 1 from pg_constraint
          where conrelid = 'public.meeting_rooms'::regclass
            and conname = 'meeting_rooms_voting_workflow_check')
    """).fetchone()[0]
    return {"counts": counts, "participant_fingerprint": fingerprint, "migration_applied": marker}


def preview(database: psycopg.Connection, migration: str) -> dict:
    # Remove ONLY the checked outer transaction: this helper controls rollback.
    lines = migration.splitlines()
    wrappers = [i for i, line in enumerate(lines) if line.strip().lower() in ("begin;", "commit;")]
    if len(wrappers) != 2 or lines[wrappers[0]].strip().lower() != "begin;" or lines[wrappers[1]].strip().lower() != "commit;":
        raise ValueError("Unexpected migration transaction wrapper")
    body = "\n".join(line for i, line in enumerate(lines) if i not in wrappers)
    before = snapshot(database)
    database.execute("begin")
    try:
        database.execute("set local lock_timeout = '2s'")
        database.execute("set local statement_timeout = '20s'")
        database.execute(body, prepare=False)
        assert database.execute("""
            select count(*) from pg_class where oid in (
              'public.meeting_votes'::regclass, 'public.meeting_venue_selections'::regclass)
              and relrowsecurity
        """).fetchone()[0] == 2, "Ballot tables must use RLS"
        for signature in (
            "public.share_meeting_origin(text,double precision,double precision,text,text)",
            "public.start_meeting_planning(text,timestamp with time zone,timestamp with time zone)",
            "public.cast_meeting_vote(text,jsonb,timestamp with time zone,bigint)",
            "public.set_meeting_budget(text,integer)",
        ):
            assert database.execute("select has_function_privilege('authenticated', %s, 'EXECUTE')", (signature,)).fetchone()[0]
            assert not database.execute("select has_function_privilege('anon', %s, 'EXECUTE')", (signature,)).fetchone()[0]
        assert not database.execute("select has_table_privilege('authenticated','public.meeting_participants','UPDATE')").fetchone()[0]
        assert not database.execute("select has_column_privilege('authenticated','public.meeting_rooms','time_budget','UPDATE')").fetchone()[0]
        after_preview = snapshot(database)
        assert after_preview["migration_applied"]
        assert before["counts"][:2] == after_preview["counts"][:2], "Room/member counts must be preserved"
        assert before["counts"][4:] == after_preview["counts"][4:], "Core datasets must be preserved"
        if not before["migration_applied"]:
            assert database.execute("select count(*) from public.meeting_participants where origin_shared").fetchone()[0] == 0
            assert after_preview["counts"][2] == 0, "Legacy agreements must be cleared on first upgrade"
        # Rerunning must not fail with the current live schema.
        database.execute(body, prepare=False)
        assert snapshot(database) == after_preview
    finally:
        database.execute("rollback")
    # The rollout marker is exact; concurrent live users can legitimately change counts.
    restored = snapshot(database)
    assert restored["migration_applied"] == before["migration_applied"], "Migration marker changed after rollback"
    return {
        "project": PROJECT,
        "migration_sha256": hashlib.sha256(migration.encode()).hexdigest(),
        "migration_already_applied": before["migration_applied"],
        "baseline_counts": dict(zip(("rooms", "members", "confirmed_plans", "server_proposals", "transit_stops", "essential_services"), before["counts"])),
        "preview": "migration, RLS, grants, legacy conversion and rerun passed",
        "transaction": "rolled back; no migration committed",
        "baseline_unchanged_after_rollback": before == restored,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-rollback-preview", action="store_true", required=True)
    parser.parse_args()
    values = dotenv_values(ROOT / ".env.local")
    dsn = values.get("DATABASE_URL", "")
    parts = urlsplit(dsn)
    if values.get("SUPABASE_URL", "").rstrip("/") != f"https://{PROJECT}.supabase.co" or PROJECT not in (parts.username or ""):
        raise ValueError("Local configuration is not the authorized Supabase project")
    migration = (ROOT / "supabase/meeting-voting.sql").read_text()
    try:
        with psycopg.connect(dsn, connect_timeout=12, autocommit=True) as database:
            result = preview(database, migration)
        print(json.dumps(result, indent=2))
        return 0
    except (psycopg.Error, AssertionError) as error:
        # Do not print a DSN, connection exception text, SQL context or row content.
        print(json.dumps({"status": "failed", "error_type": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None), "migration_committed": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
