/**
 * Timezone-aware calendar arithmetic.
 *
 * Physical duration is elapsed milliseconds and needs none of this. Calendar
 * behaviour — which weekday a stretch of driving fell on, how many days a
 * forecast walks forward — does, and getting it from `elapsed / 86400000` is
 * wrong twice a year: a spring-forward day is 23 hours long and an autumn day
 * is 25, so that division silently invents or destroys travel.
 *
 * Everything here takes an explicit IANA zone. Nothing reads the clock.
 */

import { DAY_MS } from "./config";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of `ms` as read in `timeZone`. */
export function localParts(ms: number, timeZone: string): Parts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` at the instant `ms`, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const parts = localParts(ms, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // `ms` may carry sub-second precision the formatter dropped.
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the local calendar day containing `ms` began.
 *
 * Solved by iteration rather than by subtracting a fixed offset: the offset on
 * the transition day differs before and after the change, so one pass can land
 * an hour off. Two passes converge for every real-world zone rule.
 */
export function startOfLocalDay(ms: number, timeZone: string): number {
  const parts = localParts(ms, timeZone);
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let guess = midnightUtc - offsetAt(ms, timeZone);
  for (let i = 0; i < 2; i += 1) {
    const refined = midnightUtc - offsetAt(guess, timeZone);
    if (refined === guess) break;
    guess = refined;
  }
  return guess;
}

/**
 * The instant `days` local calendar days after the local midnight containing
 * `ms`. Length-of-day varies across a DST change, so this walks the calendar
 * rather than adding a constant.
 */
export function addLocalDays(ms: number, days: number, timeZone: string): number {
  const start = startOfLocalDay(ms, timeZone);
  // Adding 12h before re-normalising keeps a 23-hour day from landing back on
  // the same date.
  return startOfLocalDay(start + days * DAY_MS + DAY_MS / 2, timeZone);
}

/** 0 = Sunday … 6 = Saturday, in the given zone. */
export function localWeekday(ms: number, timeZone: string): number {
  const parts = localParts(ms, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** "2026-09-06" in the given zone. Used as a stable day key. */
export function localDayKey(ms: number, timeZone: string): string {
  const parts = localParts(ms, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Guard so a corrupt pair of timestamps cannot spin the day walker. */
const MAX_EXPOSURE_DAYS = 400;

/**
 * How much of each weekday an interval covers, as fractions of a calendar day.
 *
 * A partial day contributes its share of that day's ACTUAL length, so the
 * 23-hour spring day counts as one full day of exposure when it is fully
 * spanned rather than as 23/24 of one.
 *
 * Returns seven numbers indexed by `localWeekday`.
 */
export function dayExposures(
  from: number,
  to: number,
  timeZone: string,
): number[] {
  const exposures = [0, 0, 0, 0, 0, 0, 0];
  if (!(to > from)) return exposures;

  let dayStart = startOfLocalDay(from, timeZone);
  for (let guard = 0; guard < MAX_EXPOSURE_DAYS && dayStart < to; guard += 1) {
    const dayEnd = addLocalDays(dayStart, 1, timeZone);
    const length = dayEnd - dayStart;
    if (length <= 0) break;

    const overlapStart = Math.max(from, dayStart);
    const overlapEnd = Math.min(to, dayEnd);
    if (overlapEnd > overlapStart) {
      exposures[localWeekday(dayStart, timeZone)] += (overlapEnd - overlapStart) / length;
    }
    dayStart = dayEnd;
  }

  return exposures;
}

/** Elapsed days. Physical duration, so no calendar involved. */
export function elapsedDays(from: number, to: number): number {
  return (to - from) / DAY_MS;
}
