import type { TankEstimate } from './index';
import { DAY_MS, MAX_ANCHOR_AGE_DAYS } from './config';

/** Never replace an exhausted projection with an old, fuller gauge reading. */
export function displayTankLevel(estimate: Pick<TankEstimate, 'current' | 'lastLevelReport'>): number | null {
  if (estimate.current.level !== null) return estimate.current.level;
  if (estimate.current.rawLevel !== null) return null;
  const report = estimate.lastLevelReport;
  return report && estimate.current.asOf - report.at <= MAX_ANCHOR_AGE_DAYS * DAY_MS ? report.level : null;
}
