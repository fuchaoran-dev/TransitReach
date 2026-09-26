-- TransitReach operational and machine-learning data.
-- PostgreSQL is the system of record; JSON/Parquet files are import sources only.
-- Safe to run repeatedly in Supabase's SQL editor.

create table if not exists public.transit_routes (
  route_id text primary key,
  short_name text,
  long_name text not null,
  mode text not null,
  colour text,
  source text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rail_feeds (
  feed_id text primary key,
  feed_name text not null,
  agency text not null,
  source_url text not null,
  licence text,
  licence_status text,
  service_start date,
  service_end date
);

create table if not exists public.rail_service_calendars (
  feed_id text not null references public.rail_feeds(feed_id) on delete cascade,
  service_id text not null,
  monday boolean not null default false,
  tuesday boolean not null default false,
  wednesday boolean not null default false,
  thursday boolean not null default false,
  friday boolean not null default false,
  saturday boolean not null default false,
  sunday boolean not null default false,
  start_date date not null,
  end_date date not null,
  referenced_by_trips boolean not null,
  expired boolean not null,
  primary key (feed_id, service_id)
);

create table if not exists public.rail_frequency_windows (
  route_id text not null references public.transit_routes(route_id) on delete cascade,
  window_sequence integer not null,
  service_id text not null,
  start_time text not null,
  end_time text not null,
  headway_seconds integer not null check (headway_seconds > 0),
  primary key (route_id, window_sequence)
);

create table if not exists public.dataset_metadata (
  dataset_key text primary key,
  generated_at timestamptz,
  source text not null,
  licence text,
  record_count integer,
  min_lat double precision,
  max_lat double precision,
  min_lon double precision,
  max_lon double precision
);

create table if not exists public.transit_stops (
  stop_id text primary key,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  mode text not null,
  source text not null,
  updated_at timestamptz not null default now()
);
create index if not exists transit_stops_location_idx
  on public.transit_stops (latitude, longitude);

create table if not exists public.route_stops (
  route_id text not null references public.transit_routes(route_id) on delete cascade,
  stop_id text not null references public.transit_stops(stop_id) on delete cascade,
  stop_sequence integer not null check (stop_sequence > 0),
  direction_id smallint,
  primary key (route_id, stop_id, stop_sequence, direction_id)
);
create index if not exists route_stops_stop_idx on public.route_stops (stop_id);

create table if not exists public.rail_pattern_stops (
  route_id text not null references public.transit_routes(route_id) on delete cascade,
  direction_id smallint not null,
  trip_headsign text,
  stop_sequence integer not null,
  station_id text not null references public.transit_stops(stop_id),
  platform_stop_id text,
  arrival_offset_seconds integer,
  departure_offset_seconds integer,
  primary key (route_id, direction_id, stop_sequence)
);

create table if not exists public.rail_shape_points (
  route_id text not null references public.transit_routes(route_id) on delete cascade,
  shape_id text not null,
  point_sequence integer not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  primary key (route_id, shape_id, point_sequence)
);

create table if not exists public.places (
  place_id text primary key,
  name text not null,
  kind text not null,
  kind_label text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  source text not null default 'OpenStreetMap'
);
create index if not exists places_kind_idx on public.places (kind);
create index if not exists places_location_idx on public.places (latitude, longitude);

create table if not exists public.essential_services (
  service_id text primary key,
  name text not null,
  source_category text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text,
  hours text,
  accessible boolean,
  source text not null default 'OpenStreetMap'
);
alter table public.essential_services add column if not exists address text;
alter table public.essential_services add column if not exists hours text;
alter table public.essential_services add column if not exists accessible boolean;
create index if not exists essential_services_category_idx
  on public.essential_services (source_category);
create index if not exists essential_services_location_idx
  on public.essential_services (latitude, longitude);

create table if not exists public.model_versions (
  model_version text primary key,
  model_type text not null,
  artifact_uri text,
  training_start date not null,
  training_end date not null,
  validation_start date,
  validation_end date,
  test_start date,
  test_end date,
  baseline_mae double precision,
  baseline_rmse double precision,
  model_mae double precision,
  model_rmse double precision,
  arrival_validation_passed boolean not null,
  candidate_for_promotion boolean not null,
  prediction_enabled boolean not null,
  label_method text,
  validation_status text,
  release_basis text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_features (
  model_version text not null references public.model_versions(model_version) on delete cascade,
  feature_sequence integer not null,
  feature_name text not null,
  primary key (model_version, feature_sequence)
);

create table if not exists public.model_scope_routes (
  model_version text not null references public.model_versions(model_version) on delete cascade,
  route_id text not null,
  primary key (model_version, route_id)
);

create table if not exists public.model_data_sources (
  model_version text not null references public.model_versions(model_version) on delete cascade,
  source_name text not null,
  primary key (model_version, source_name)
);

create table if not exists public.reliability_profiles (
  model_version text not null references public.model_versions(model_version) on delete cascade,
  profile_level text not null check (profile_level in ('stop_time', 'stop', 'route', 'network')),
  route_id text,
  stop_id text,
  hour smallint,
  is_weekend boolean,
  sample_count integer not null check (sample_count >= 0),
  stop_sequence integer not null,
  historical_mean_delay double precision not null,
  historical_median_delay double precision not null,
  p25 double precision not null,
  p50 double precision not null,
  p75 double precision not null,
  residual_scale double precision,
  profile_key text not null,
  primary key (model_version, profile_level, profile_key)
);
create index if not exists reliability_profile_lookup_idx
  on public.reliability_profiles
  (model_version, profile_level, route_id, stop_id, hour, is_weekend);

-- Monthly children are created by migrate_to_postgres.py before COPY starts.
create table if not exists public.vehicle_observations (
  service_date date not null,
  observed_at timestamp not null,
  trip_id text not null,
  route_id text not null,
  vehicle_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  speed double precision,
  start_time text,
  primary key (service_date, trip_id, vehicle_id, observed_at)
) partition by range (service_date);

create table if not exists public.stop_arrivals (
  service_date date not null,
  route_id text not null,
  trip_id text not null,
  vehicle_id text not null,
  start_time text,
  stop_id text not null,
  stop_sequence integer not null,
  scheduled_arrival timestamptz,
  actual_arrival timestamptz,
  delay_seconds integer,
  arrival_match_quality text,
  quality_reason text,
  match_confidence double precision,
  training_eligible boolean not null,
  primary key (service_date, route_id, trip_id, vehicle_id, stop_id, stop_sequence)
) partition by range (service_date);

create table if not exists public.reliability_features (
  model_version text not null,
  route_id text not null,
  stop_id text not null,
  stop_sequence integer not null,
  service_date date not null,
  scheduled_arrival timestamptz,
  hour smallint not null,
  day_of_week smallint not null,
  is_weekend boolean not null,
  scheduled_headway double precision,
  previous_stop_delay double precision,
  historical_median_delay double precision,
  historical_mean_delay double precision,
  target_delay_minutes double precision not null
);
create index if not exists reliability_features_lookup_idx
  on public.reliability_features (model_version, route_id, stop_id, service_date);

-- Reference data is public-read for the website. Large operational/training tables and
-- model internals remain server-only and are accessed with DATABASE_URL from FastAPI.
alter table public.transit_routes enable row level security;
alter table public.rail_feeds enable row level security;
alter table public.rail_service_calendars enable row level security;
alter table public.rail_frequency_windows enable row level security;
alter table public.dataset_metadata enable row level security;
alter table public.transit_stops enable row level security;
alter table public.route_stops enable row level security;
alter table public.rail_pattern_stops enable row level security;
alter table public.rail_shape_points enable row level security;
alter table public.places enable row level security;
alter table public.essential_services enable row level security;
alter table public.model_versions enable row level security;
alter table public.model_features enable row level security;
alter table public.model_scope_routes enable row level security;
alter table public.model_data_sources enable row level security;
alter table public.reliability_profiles enable row level security;
alter table public.vehicle_observations enable row level security;
alter table public.stop_arrivals enable row level security;
alter table public.reliability_features enable row level security;

grant select on public.transit_routes, public.transit_stops, public.route_stops,
  public.rail_pattern_stops, public.rail_shape_points, public.places,
  public.essential_services, public.rail_feeds, public.rail_service_calendars,
  public.rail_frequency_windows, public.dataset_metadata to anon, authenticated;

drop policy if exists "public reads transit routes" on public.transit_routes;
create policy "public reads transit routes" on public.transit_routes for select using (true);
drop policy if exists "public reads rail feeds" on public.rail_feeds;
create policy "public reads rail feeds" on public.rail_feeds for select using (true);
drop policy if exists "public reads rail calendars" on public.rail_service_calendars;
create policy "public reads rail calendars" on public.rail_service_calendars for select using (true);
drop policy if exists "public reads rail frequencies" on public.rail_frequency_windows;
create policy "public reads rail frequencies" on public.rail_frequency_windows for select using (true);
drop policy if exists "public reads dataset metadata" on public.dataset_metadata;
create policy "public reads dataset metadata" on public.dataset_metadata for select using (true);
drop policy if exists "public reads transit stops" on public.transit_stops;
create policy "public reads transit stops" on public.transit_stops for select using (true);
drop policy if exists "public reads route stops" on public.route_stops;
create policy "public reads route stops" on public.route_stops for select using (true);
drop policy if exists "public reads rail patterns" on public.rail_pattern_stops;
create policy "public reads rail patterns" on public.rail_pattern_stops for select using (true);
drop policy if exists "public reads rail shapes" on public.rail_shape_points;
create policy "public reads rail shapes" on public.rail_shape_points for select using (true);
drop policy if exists "public reads places" on public.places;
create policy "public reads places" on public.places for select using (true);
drop policy if exists "public reads essential services" on public.essential_services;
create policy "public reads essential services" on public.essential_services for select using (true);
