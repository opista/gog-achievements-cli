import { requireValue } from './errors.mjs';
export function id(value: unknown, label = 'ID') {
  requireValue(
    typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)),
    'INVALID_ID',
    `${label} must be a decimal string.`,
  );
  const result = String(value);
  requireValue(
    /^[1-9]\d{0,29}$/.test(result),
    'INVALID_ID',
    `${label} must be a positive decimal string.`,
  );
  return result;
}
export function timestamp(value: unknown, now: number) {
  requireValue(typeof value === 'string', 'INVALID_DATE', 'Use an RFC 3339 date with a time zone.');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  requireValue(
    match,
    'INVALID_DATE',
    'Use an RFC 3339 date with a time zone, such as 2026-10-01T18:30:00+01:00.',
  );
  const y = match[1]!;
  const m = match[2]!;
  const d = match[3]!;
  const h = match[4]!;
  const minute = match[5]!;
  const s = match[6]!;
  const zone = match[7]!;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +minute, +s));
  const valid =
    +y >= 1970 &&
    +y <= 9999 &&
    date.getUTCFullYear() === +y &&
    date.getUTCMonth() === +m - 1 &&
    date.getUTCDate() === +d &&
    +h < 24 &&
    +minute < 60 &&
    +s < 60 &&
    (zone === 'Z' || (+zone.slice(1, 3) < 24 && +zone.slice(4) < 60));
  const parsed = Date.parse(value);
  requireValue(
    valid && Number.isFinite(parsed) && parsed >= 0,
    'INVALID_DATE',
    'The unlock date is not valid.',
  );
  requireValue(parsed <= now, 'FUTURE_DATE', 'The unlock date cannot be in the future.');
  return new Date(Math.floor(parsed / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}
export function defaultTimestamp(now: number) {
  return timestamp(new Date(now - 10_000).toISOString(), now);
}
