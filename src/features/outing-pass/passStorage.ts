import type { PersonalPass, StoredPassSummary } from './types';
import { PASS_SCHEMA_VERSION } from './types';

const STORAGE_PREFIX = 'transitreach:personal-passes:v1:';
const MAX_STORED_PASSES = 20;

interface StoredEnvelope {
  schemaVersion: typeof PASS_SCHEMA_VERSION;
  memberId: string;
  passes: PersonalPass[];
}

function storageKey(memberId: string): string {
  if (!memberId.trim()) throw new Error('A member identity is required to access saved passes.');
  return `${STORAGE_PREFIX}${encodeURIComponent(memberId)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isPoint(value: unknown): boolean {
  return isObject(value) && typeof value.name === 'string' &&
    (value.stopId === null || typeof value.stopId === 'string') &&
    isFiniteNumber(value.lat) && isFiniteNumber(value.lon);
}

function isStep(value: unknown): boolean {
  return isObject(value) && typeof value.relativeDirection === 'string' &&
    typeof value.streetName === 'string' && typeof value.bogusName === 'boolean' &&
    isFiniteNumber(value.distanceMeters) && isFiniteNumber(value.lat) && isFiniteNumber(value.lon);
}

function isDelay(value: unknown): boolean {
  if (value === null) return true;
  if (!isObject(value)) return false;
  if (value.status === 'not-checked') return typeof value.reason === 'string' && value.label === 'Not checked';
  return value.status === 'checked' && isFiniteNumber(value.seconds) &&
    typeof value.confidence === 'string' && isFiniteNumber(value.sampleCount) &&
    typeof value.source === 'string' && typeof value.modelVersion === 'string' &&
    typeof value.disclaimer === 'string';
}

function isLeg(value: unknown): boolean {
  return isObject(value) && typeof value.id === 'string' && typeof value.mode === 'string' &&
    isFiniteNumber(value.durationSeconds) && isFiniteNumber(value.distanceMeters) &&
    typeof value.transitLeg === 'boolean' && isPoint(value.from) && isPoint(value.to) &&
    Array.isArray(value.geometry) && value.geometry.length <= 20_000 &&
    value.geometry.every(point => isObject(point) && isFiniteNumber(point.lat) && isFiniteNumber(point.lon)) &&
    Array.isArray(value.steps) && value.steps.length <= 500 && value.steps.every(isStep) &&
    (value.estimatedStartTime === null || isIsoDate(value.estimatedStartTime)) &&
    (value.estimatedEndTime === null || isIsoDate(value.estimatedEndTime)) &&
    isFiniteNumber(value.cumulativeDelaySeconds) && isDelay(value.delay);
}

function isConnection(value: unknown): boolean {
  return isObject(value) && typeof value.id === 'string' && typeof value.atName === 'string' &&
    Number.isInteger(value.fromLegIndex) && Number.isInteger(value.toLegIndex) &&
    (value.estimatedArrivalTime === null || isIsoDate(value.estimatedArrivalTime)) &&
    (value.estimatedDepartureTime === null || isIsoDate(value.estimatedDepartureTime)) &&
    (value.spareSeconds === null || isFiniteNumber(value.spareSeconds)) &&
    (value.status === 'checked' || value.status === 'not-checked');
}

function isWeather(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === 'not-checked') return typeof value.reason === 'string' && value.label === 'Weather unknown';
  return value.status === 'checked' && ['Morning', 'Afternoon', 'Night'].includes(String(value.period)) &&
    typeof value.summary === 'string' && value.source === 'MET Malaysia via data.gov.my' &&
    typeof value.sourceUrl === 'string' && typeof value.location === 'string' &&
    isIsoDate(value.retrievedAt) && isFiniteNumber(value.walkingSecondsInPeriod);
}

function isClosingMargin(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === 'always-open') {
    return value.label === 'Open 24 hours' && typeof value.source === 'string';
  }
  if (value.status === 'not-checked') return typeof value.reason === 'string' && value.label === 'Hours unknown';
  return value.status === 'checked' && isFiniteNumber(value.marginSeconds) &&
    isIsoDate(value.closesAt) && typeof value.source === 'string';
}

function isPass(value: unknown, memberId: string): value is PersonalPass {
  if (!isObject(value) || value.schemaVersion !== PASS_SCHEMA_VERSION || value.kind !== 'group-outing') return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.roomCode !== 'string' ||
    !/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(value.roomCode) ||
    value.memberId !== memberId ||
    !Number.isInteger(value.planVersion) ||
    (value.planVersion as number) < 1 ||
    !isIsoDate(value.checkedAt) ||
    !isIsoDate(value.routeTargetTime) ||
    !isIsoDate(value.leaveTime) ||
    !isIsoDate(value.estimatedArrivalTime) ||
    !isFiniteNumber(value.arrivalMarginSeconds) ||
    !['Ready', 'Check needed', 'Not checked'].includes(String(value.status)) ||
    !Array.isArray(value.legs) || value.legs.length === 0 || value.legs.length > 50 ||
    !value.legs.every(isLeg) ||
    !Array.isArray(value.connections) || value.connections.length > 20 ||
    !value.connections.every(isConnection) ||
    !Array.isArray(value.weather) || value.weather.length === 0 || value.weather.length > 8 ||
    !value.weather.every(isWeather) ||
    !isObject(value.meeting) ||
    !isObject(value.meeting.venue) ||
    !isIsoDate(value.meeting.arrivalTime) ||
    value.meeting.version !== value.planVersion ||
    typeof value.meeting.venue.name !== 'string' ||
    !isFiniteNumber(value.meeting.venue.lat) ||
    !isFiniteNumber(value.meeting.venue.lon) ||
    !isObject(value.walking) ||
    !isFiniteNumber(value.walking.totalSeconds) ||
    !isFiniteNumber(value.walking.totalDistanceMeters) ||
    !Array.isArray(value.walking.directions) || value.walking.directions.length > 1_000 ||
    !value.walking.directions.every(step => isStep(step) && isObject(step) && typeof step.legId === 'string') ||
    !isClosingMargin(value.closingMargin) ||
    !isObject(value.weakPoint) || typeof value.weakPoint.kind !== 'string' ||
    typeof value.weakPoint.label !== 'string' ||
    (value.weakPoint.marginSeconds !== null && !isFiniteNumber(value.weakPoint.marginSeconds))
  ) return false;
  return true;
}

function readEnvelope(memberId: string): StoredEnvelope {
  const empty: StoredEnvelope = { schemaVersion: PASS_SCHEMA_VERSION, memberId, passes: [] };
  const raw = localStorage.getItem(storageKey(memberId));
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || parsed.schemaVersion !== PASS_SCHEMA_VERSION || parsed.memberId !== memberId || !Array.isArray(parsed.passes)) {
      return empty;
    }
    return {
      ...empty,
      passes: parsed.passes.filter(pass => isPass(pass, memberId)).slice(0, MAX_STORED_PASSES),
    };
  } catch {
    return empty;
  }
}

export function savePersonalPass(pass: PersonalPass): void {
  if (!isPass(pass, pass.memberId)) throw new Error('The personal pass is invalid and was not saved.');
  const envelope = readEnvelope(pass.memberId);
  const passes = [
    pass,
    ...envelope.passes.filter(candidate => candidate.id !== pass.id && candidate.roomCode !== pass.roomCode),
  ]
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, MAX_STORED_PASSES);
  localStorage.setItem(storageKey(pass.memberId), JSON.stringify({ ...envelope, passes }));
}

export function loadStoredPass(
  roomCode: string,
  memberId: string,
  planVersion?: number,
): PersonalPass | null {
  const pass = readEnvelope(memberId).passes.find(candidate => candidate.roomCode === roomCode) ?? null;
  return pass && (planVersion === undefined || pass.planVersion === planVersion) ? pass : null;
}

export function listStoredPasses(
  memberId: string,
  currentPlanVersions: Readonly<Record<string, number>> = {},
  now = Date.now(),
): StoredPassSummary[] {
  return readEnvelope(memberId).passes
    .filter(pass => Date.parse(pass.meeting.arrivalTime) >= now)
    .map(pass => ({
      id: pass.id,
      roomCode: pass.roomCode,
      planVersion: pass.planVersion,
      meetingName: pass.meeting.venue.name,
      meetingTime: pass.meeting.arrivalTime,
      leaveTime: pass.leaveTime,
      checkedAt: pass.checkedAt,
      status: pass.status,
      outdated: currentPlanVersions[pass.roomCode] !== undefined &&
        currentPlanVersions[pass.roomCode] !== pass.planVersion,
    }))
    .sort((a, b) => Date.parse(a.meetingTime) - Date.parse(b.meetingTime));
}

export function removeStoredPass(memberId: string, passId: string): void {
  const envelope = readEnvelope(memberId);
  const passes = envelope.passes.filter(pass => pass.id !== passId);
  localStorage.setItem(storageKey(memberId), JSON.stringify({ ...envelope, passes }));
}
