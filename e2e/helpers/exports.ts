import { expect } from '@playwright/test';

/** Decode the filename independently of the production formatter. */
export function exportedFileTime(filename: string, base: string): number {
  const extension = base.lastIndexOf('.');
  const prefix = `${base.slice(0, extension)}-`;
  const suffix = base.slice(extension);
  expect(filename.startsWith(prefix)).toBe(true);
  expect(filename.endsWith(suffix)).toBe(true);
  const stamp = filename.slice(prefix.length, -suffix.length);
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})_UTC([+-]\d{2})(\d{2})$/.exec(stamp);
  expect(match, `timestamp in ${filename}`).not.toBeNull();
  const [, day, hour, minute, second, millis, offsetHour, offsetMinute] = match!;
  const instant = Date.parse(`${day}T${hour}:${minute}:${second}.${millis}${offsetHour}:${offsetMinute}`);
  expect(Number.isFinite(instant)).toBe(true);
  return instant;
}
