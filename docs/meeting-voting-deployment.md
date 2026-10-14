# Meeting voting deployment readiness

14 October 2026 (Malaysia time). User decision: rollback preflight and preparation
only; no Git push, cloud migration commit or production deployment yet.

## Checked targets

- Supabase project: `tritrrkakzechbvlvbcj`; local frontend/backend project settings
  point to this project. Credentials are not included in this record.
- Netlify linked project ID: `83c1819f-715a-4ff8-9016-004d17cd72ac`.
  Existing public site returned HTTP 200.
- Render endpoint: `https://transitreach-reliability-api.onrender.com`.
  Initial health request timed out; a later request returned `{"status":"ok"}`.
  This observation alone does not prove the cause of the initial timeout.
- Render OpenAPI still exposes only `status`, `participantCount`,
  `missingStartingPoints`, `budgetMinutes`, `proposals` for common ground.
  The local API also requires `roomRevision`, `departureTime`, `participantAreas`.
- Working branch: `deploy/md8-6-20261008`, baseline `148ce49`. The Render configured
  Git branch has not been re-inspected or changed in this preparation.
- Terminal GitHub authentication check did not pass. Revalidate authorization
  when publishing is approved; do not replace credentials or push automatically.

## Real-project rollback preflight

Explicitly authorized command:

```bash
.venv/bin/python scripts/check-meeting-voting-preflight.py --allow-rollback-preview
```

The script removes only the migration's checked outer BEGIN/COMMIT and owns the
transaction itself. It executes the migration and a rerun with a 2-second lock
timeout and 20-second statement timeout, verifies RLS/grants/legacy privacy and
core counts, then always rolls back. It is not an apply/deploy command.

Result: **passed and rolled back**. Pre/post snapshots were identical; the voting
workflow marker was absent before and after. No room/member names, coordinates,
tokens or connection strings were printed.

| Existing records before preview | Count |
| --- | ---: |
| Rooms | 11 |
| Members | 18 |
| Confirmed agreements | 6 |
| Server venue proposals | 30 |
| Transit stops | 4,215 |
| Essential services | 19,406 |

Previewed migration SHA-256:
`aa2324442f101ea9100ed1f527d6e4e20cb8ddcdf1ddde7dda8e4af57744aa41`.
Recheck the migration if that hash changes. Formal first application will cancel
legacy confirmed agreements/checks and server proposals while keeping old origins
private until members explicitly share again. Counts above are observations at
preflight time, not guaranteed counts at a future release.

Local frontend typecheck and 45 meeting regression checks passed again; production
build succeeded. Earlier backend and isolated SQL evidence remains documented in
[meeting-voting.md](meeting-voting.md). Build-size and existing lint warnings remain.

## Release steps after separate approval

1. Obtain approval to publish the backend code to a dedicated deployment branch.
   Do not alter upstream `main` or include unrelated report JSON/Word/artifact files.
2. Resolve GitHub authentication and inspect Render's actual repo/branch and Netlify
   linked project. Verify Supabase/OTP environment values without exposing secrets.
3. Schedule a meeting-feature maintenance window. New SQL revokes old direct writes;
   applying it without new clients prevents old pages saving points or confirming.
   Export a restricted backup of cancelled agreement metadata if recovery is required.
4. Apply only `supabase/meeting-voting.sql` to the existing project after verifying
   its old/core schemas. Never rerun old `meeting-rooms.sql` alone afterwards.
   Request PostgREST schema refresh with `NOTIFY pgrst, 'reload schema';` and verify
   the new RPC signatures and grants. Do not broaden private participant-table RLS.
5. Deploy the matching backend from the approved dedicated branch. Check health,
   OpenAPI new fields, authenticated common ground and OTP failure responses.
6. Build/publish the matching local frontend to the existing Netlify project without
   changing its domain or Supabase project. Keep service credentials server-only.
7. Use two separately signed-in browsers and public station coordinates to check
   Ready updates, name markers, actual map overlap, proposals, votes, ties, unique
   plurality, stale revisions and host departure. Do not use the superseded direct-
   confirmation smoke scripts as release acceptance.
8. Record live evidence and any limitations before announcing completion. Preview
   rollback and fixture tests do not establish native concurrency/realtime success.

The current preparation did not commit SQL, push Git, change environment variables,
change Render/Netlify settings, or deploy a production build.
