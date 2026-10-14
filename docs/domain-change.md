# Production domain change — 14 October 2026

Current website: https://transitreach-kl-team8.netlify.app/.

The user requested removing their personal name from the public address.
`transitreach-kl.netlify.app` already served a site and Netlify rejected that
name. Only the existing project's name was changed to `transitreach-kl-team8`.
No new site, paid domain, DNS subscription or redirect site was created.

- Netlify site ID remains `83c1819f-715a-4ff8-9016-004d17cd72ac`.
- Production deploy remains `6acf43a0d912a1b7d2fd911c` (runtime `eec52b2`).
- No build, backend release, database migration or credential change was needed.
- Render/Supabase/OTP URLs, access policies and data are unchanged.
- App API paths are same-origin Netlify proxies. New room links and new QR
  payloads use the current browser URL rather than a hardcoded old hostname.

## Link and session impact

Previously shared URLs and downloaded QR images still contain the old hostname;
update links and regenerate images. Do not assume the old address redirects.
The old address returned HTTP 404 after renaming; it did not redirect to the new one.
Existing room records are preserved, but the domain change does not transfer
browser local storage or anonymous Auth sessions. My Passes and a previous
host/member identity are not automatically restored on the new origin. No
session tokens or private location data were copied between origins.

Historical deployment/acceptance documents keep their original URLs as evidence
of the address tested at that time. Use the current website above for new tests.
The older `check-meeting-online.py` exercises the superseded direct-confirmation
flow; do not use it to validate the current voting release.

## Verification

- New homepage: HTTP 200 with the unchanged `index-B9fPMro2.js` release asset.
- New `/api/data/bootstrap`: HTTP 200 and valid JSON on retry. The first probe
  did not return JSON; the cause was not established.
- Meeting common-ground POST without authentication: expected HTTP 401, valid JSON.
- Weather forecast and OTP loaded-feed proxies: HTTP 200, valid JSON.
- Render `/health`: HTTP 200, valid JSON.
- `git diff --check` passed. No runtime code changed and no rebuild was needed.
- Native browser inspection was not completed because the user was actively
  using Chrome; these HTTP checks are not claimed as full browser acceptance.
