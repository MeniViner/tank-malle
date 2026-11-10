/**
 * Design v3 §5: "a month with no purchases yet shows the previous month that
 * has data" ("דלק באוק׳"), never a `0 ₪` for a month that merely has not had a
 * fill-up yet.
 *
 * Pure and display-only: it picks WHICH month to show; the caller still sums
 * that month's raw records itself. Nothing here is stored.
 */
import { heMonthName, heMonthShort } from "./format";

export interface MonthDatum {
  /** Epoch ms, ISO date ("2026-10-31") / datetime string, or a Date. Local calendar. */
  date: number | string | Date;
  /**
   * Optional amount. A row counts as data when the amount is omitted or is a
   * finite non-zero number; a row with an unknown (null / NaN) or zero amount
   * is not a purchase to show.
   */
  amount?: number | null;
}

export interface MonthWithData {
  /** "2026-10" */
  key: string;
  year: number;
  /** 1–12 */
  month: number;
  /** Hebrew short month, e.g. "אוק׳". */
  label: string;
  /** Hebrew full month, e.g. "אוקטובר". */
  longLabel: string;
  /** True when the month shown is today's month. */
  isCurrent: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");

function monthOf(value: MonthDatum["date"]): { year: number; month: number } | null {
  if (typeof value === "string") {
    // A civil date ("2026-10-31") is read as written, not shifted through UTC.
    const civil = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:$|T)/);
    if (civil && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
      const year = Number(civil[1]), month = Number(civil[2]);
      return month >= 1 && month <= 12 ? { year, month } : null;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

const counts = (row: MonthDatum) =>
  row.amount === undefined || (typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount !== 0);

/**
 * The latest month, not after today's month, that has at least one counted
 * row. Today's month wins when it has data; otherwise the most recent earlier
 * month with data (across year boundaries). Future-dated rows are ignored.
 * Returns null when nothing qualifies, so the caller shows "—", never 0.
 */
export function latestMonthWithData(rows: readonly MonthDatum[], today: Date | number = Date.now()): MonthWithData | null {
  const now = monthOf(today instanceof Date ? today : new Date(today));
  if (!now) return null;
  const nowIndex = now.year * 12 + (now.month - 1);
  let best = -1;
  for (const row of rows) {
    if (!counts(row)) continue;
    const month = monthOf(row.date);
    if (!month) continue;
    const index = month.year * 12 + (month.month - 1);
    if (index <= nowIndex && index > best) best = index;
  }
  if (best < 0) return null;
  const year = Math.floor(best / 12), month = (best % 12) + 1;
  return {
    key: `${year}-${pad(month)}`,
    year,
    month,
    label: heMonthShort(month),
    longLabel: heMonthName(month),
    isCurrent: best === nowIndex,
  };
}
