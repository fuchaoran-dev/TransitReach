# Reliability data preparation

This directory is the data-integrity foundation for Epic 7. It does **not** enable a
prediction by itself. A line remains prediction-unavailable until real actual-arrival
labels exist and a chronologically evaluated model has been registered.

## Large-data cleaning

Keep source files as Parquet. The cleaner uses DuckDB projection and predicate pushdown,
so it does not load the full dataset into pandas. A small pilot can start with 3–5 routes;
the network build processes one route at a time so memory usage remains bounded:

```bash
python -m pip install -r backend/requirements.txt
python -m backend.data_pipeline.clean_observations \
  --input 'data/raw/gtfs_rt/**/*.parquet' \
  --output data/processed/selected_rt.parquet \
  --start 2026-06-01 --end 2026-08-01 \
  --routes T780 T801 T815 --sample-seconds 30
```

The operation keeps only required columns, valid coordinates and complete trip identity,
then retains one observation per vehicle/trip/time bucket. It does not randomly sample
rows. Compare arrival-detection accuracy at 15 and 30 seconds on a small validation slice
before adopting 30 seconds for production processing.

The next pipeline stage must join scheduled GTFS stop times, group complete trips, and call
`detect_stop_arrival`. Only `HIGH` matches may receive `delay_seconds` and enter training.
Write stop arrivals partitioned by `year/month/route_id`, then build the compact feature
table from those events. GTFS Static times are schedules, never ground truth.

## Offline fallback

Use `resolve_training_source` before training. It tries the supplied server refresh and,
on connection failure, returns an existing non-empty local Parquet artifact with an explicit
warning. If neither source exists, it raises `NoOperationalDataError` and training stops.
The fallback never manufactures observations or delay labels.

`load_gtfs_static` reads `stops.txt`, `trips.txt`, and `stop_times.txt` into stable domain
records and supports GTFS times beyond 24:00. `build_stop_arrivals` requires exact trip and
route agreement, processes stops in sequence, and records rejected matches with a reason.
Its returned `training_eligible` flag is true only for confirmed arrivals with a real delay
label. The included end-to-end fixture is explicitly test-only.

For a bounded proof-of-pipeline slice, derive stop events with:

```bash
.venv/bin/python -m backend.data_pipeline.build_stop_arrivals \
  --observations data/processed/U1510_20260401_02.parquet \
  --gtfs data/gtfs/static-bus-kl \
  --output data/processed/stop_arrivals_U1510_20260401_02.parquet
```

This entry point intentionally targets a small route/date slice. For the network build,
`build_network_arrivals` isolates and writes each route separately rather than loading the
network into memory at once.

## Real-data proof run

The first bounded run uses KRI's April 2026 Rapid KL Bus Positions Parquet and the official
Rapid KL bus GTFS Static endpoint from data.gov.my. Route `U1510` on 1–2 April produced
5,554 cleaned observations, 2,784 candidate stop events, and 203 confirmed events (7.29%).
See `data_pipeline/reports/U1510_2026-04-01_02.json` for hashes and distribution statistics.

This result is **not approved for training**. The available GTFS download is the current
schedule rather than a known April 2026 snapshot, the confirmed match rate is low, and the
arrival algorithm has not yet been checked against independently labelled arrivals. The
files are useful for pipeline and quality-control testing only; no prediction capability
may be enabled from them.

Run the dependency-free integrity tests with:

```bash
python -m unittest discover -s backend/tests -v
```

## Run the API and frontend

```bash
.venv/bin/uvicorn backend.app.main:app --reload --port 8000
npm run dev
```

Vite proxies `/api/reliability` to port 8000. For a separately deployed API, set
`VITE_RELIABILITY_API_URL`. Useful endpoints are `/health`,
`/api/reliability/services`, and `/api/reliability/predict`.

## Build features and train

Build the leakage-safe table from confirmed arrivals:

```bash
.venv/bin/python -c "from pathlib import Path; from backend.features.reliability_features import build_feature_table; print(build_feature_table(Path('data/processed/stop_arrivals.parquet'), Path('data/features/reliability.parquet')))"
```

Train and evaluate chronologically (70/15/15):

```bash
.venv/bin/python -m backend.models.train_historical \
  --features data/features/reliability.parquet
```

Training requires at least 5,000 confirmed events across 120 service days. The production
dataset should span at least six calendar months; this prevents a short operational period
from being presented as representative of longer-term service patterns. It persists the
model version, feature list, train/validation/test periods and baseline/model MAE and RMSE.
The raw trainer marks a model as a promotion candidate when it beats the baseline. Release
status is decided in the versioned registry with its scope and validation disclosure.

## Current capabilities

The revised AI MVP exposes all 136 routes and all 4,053 unique stops in the current Rapid
KL surface-transit GTFS (6,123 route-stop choices). Bus stops are searchable with the shared map
search, and selecting a bus-stop marker automatically requests the current historical
delay estimate. The map popup shows the expected delay, risk band, likely range,
explanation factors, model type, training period, prediction level and confidence. Stops
with enough direct evidence use stop/time or stop-level profiles; sparse and newly
published stops use an explicitly labelled low-confidence route or network AI fallback.
The former standalone Reliability
page and navigation entry have been removed so this information stays in the user's map
workflow. An unavailable result is retained only when no trained network profile exists.

## Acceptance criteria status

- AC 7.1.1: revised MVP implemented — Rapid KL bus line, stop and datetime selection.
- AC 7.1.2: implemented for 114 quality-gated Rapid KL bus routes using versioned CatBoost inference.
- AC 7.1.3: comparable-distribution quartiles implemented and tested.
- AC 7.1.4: implemented in API and UI; no delay or risk is returned for unsupported services.
- AC 7.2.1: exact trip/route matching plus ordered stop geofencing implemented.
- AC 7.2.2–7.2.3: deferred from the scoped bus MVP; results are explicitly historical, never live.
- AC 7.2.4: realtime freshness rule is implemented and tested at a two-minute threshold.
- AC 7.3.1–7.3.3: explanation, uncertainty, provenance and model metadata fields are in the UI/API contract.
- AC 7.3.4: chronological evaluation, median baseline, MAE/RMSE and metadata persistence are implemented.

Known limitations: the revised MVP covers bus rather than MRT/LRT/BRT, its labels are
GPS-derived rather than independently observed arrivals, manual audit is pending,
scheduled headway is unavailable in the KRI snapshot, and there is no live-adjusted model.
The UI/API disclose these limits and never label a historical output as realtime.

## Network execution result

To avoid pairing April 2026 telemetry with a later schedule, the reproducible experiment
uses KRI's internally paired April–May 2025 static and realtime material. The source audit
found 148 observed routes; 138 met the initial 28-day/5,000-observation gate. Route-by-route
arrival detection retained 115 routes with at least 500 confidence-eligible arrivals. The
model was trained from 114 routes with sufficient evidence, covering 315,734 training
events across 37 service
days. `shape_matcher.py` provides polyline projection,
distance-to-shape and monotonic-progress checks when `shapes.txt` is available; the KRI
archive instead supplies ordered stop lanes and therefore uses the conservative geofence
fallback.

The six-month chronological CatBoost uses January–April 2025 for training, May for
validation, and June for its independent time holdout. It scored MAE 5.47 / RMSE 8.80
minutes versus the June global-median baseline MAE 10.20 / RMSE 15.63. This improves on
the former two-month model's MAE 5.82 / RMSE 9.23 while using 1,468,539 eligible events
from 111 quality-gated routes. Under the revised scope it powers the quality-gated
bus-network AI MVP while disclosing that manual arrival audit is pending. See:

- `data_pipeline/reports/gtfs_kri2025_vs_current.json`
- `data_pipeline/reports/three_route_quality_2025_04_05.json`
- `data_pipeline/reports/network_arrival_coverage_2025_04_05.json`
- `data_pipeline/reports/experimental_model_historical-2026-09-13.json`
- `data_pipeline/reports/model_historical_2025_h1.json`
- `data_pipeline/reports/manual_validation_sample_2025_04.json`
- `data_pipeline/reports/arrival_validation_2025_04.json`

The ignored `data/validation/manual_arrivals_2025_04.csv` contains 450 tasks awaiting human
annotation. Follow `data_pipeline/VALIDATION_PROTOCOL.md`; software must not fill those
ground-truth cells automatically. Until at least 300 are reviewed and the documented error
and false-match thresholds pass, the model must not be described as independently
arrival-validated.
