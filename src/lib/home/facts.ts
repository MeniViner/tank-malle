/**
 * Design v3 Home: the facts strip rows and the status line, derived at read
 * time from the same ledger, TCO and tank estimate the cards use. Nothing here
 * is stored, rounded for storage or fed back into a calculation.
 */
import { validDay } from "../maintenance/model";
import { latestMonthWithData, type MonthWithData } from "../monthWithData";
import { ledgerAmount, type TcoResult } from "../tco";
import type { LedgerRow } from "../vehicle/derived";
import { readVehicleDocument } from "../vehicle/documents";

/** The local calendar day "YYYY-MM-DD" as a local Date at noon (no UTC shift). */
function civilDate(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12);
}

export interface FuelMonthFact {
  /** The month shown: today's month when it has a fill-up, else the latest earlier month that has one (§5). */
  month: MonthWithData | null;
  /** Fuel spend in that month; null when there is none, the history is incomplete, or any cost in it is unknown. */
  value: number | null;
}

/**
 * "דלק ב<month with data>": never `0 ₪` for a month that simply has no fill-up
 * yet. A month that has a fill-up of unknown cost still is "the month with
 * data", and shows "—" rather than a partial sum.
 */
export function fuelMonthFact(ledger: readonly LedgerRow[], today: string, incomplete = false): FuelMonthFact {
  if (!validDay(today)) return { month: null, value: null };
  const fuel = ledger.filter(row => row.kind === "fuel" && validDay(row.day) && row.day <= today);
  const month = latestMonthWithData(fuel.map(row => ({ date: row.day })), civilDate(today));
  if (!month || incomplete) return { month, value: null };
  const rows = fuel.filter(row => row.day.slice(0, 7) === month.key);
  const amounts = rows.map(ledgerAmount);
  if (!rows.length || amounts.some(amount => amount === null)) return { month, value: null };
  return { month, value: amounts.reduce<number>((sum, amount) => sum + amount!, 0) };
}

/**
 * EV "חשמל ל-100 ק״מ": the monthly energy part of the TCO over the monthly
 * distance (same 30.4-day month as `perKm`). Null unless both are known.
 */
export function energyPer100Km(tco: TcoResult, kmPerDay: number | null): number | null {
  const energy = tco.parts.find(part => part.id === "fuel")?.value ?? null;
  if (energy === null || kmPerDay === null || !Number.isFinite(kmPerDay) || kmPerDay < .5) return null;
  return energy / (kmPerDay * 30.4) * 100;
}

export type HomeStatus =
  | { kind: "low" }
  | { kind: "refuel"; level: number }
  | { kind: "ok"; testDue: string | null };

export interface HomeStatusInput {
  hasFillups: boolean;
  /** Displayed tank level 0–1, or null when unknown / not a tank vehicle. */
  level: number | null;
  /** Level at or below the reserve (the same rule the next-refuel card uses). */
  low: boolean;
  /** How many spotlight cards are visible. */
  spotlightCount: number;
  docs: unknown;
  today: string;
}

/**
 * §2.2: only what the cards below don't say. Low fuel → urgent line; cards
 * present → the refuel line (needs a known level); nothing to show → "all
 * fine", with the test date only while it is still valid.
 */
export function homeStatus({ hasFillups, level, low, spotlightCount, docs, today }: HomeStatusInput): HomeStatus | null {
  if (!hasFillups) return null;
  if (low && level !== null) return { kind: "low" };
  if (spotlightCount > 0) return level === null ? null : { kind: "refuel", level };
  const test = readVehicleDocument(docs, "test", today);
  const testDue = test.state === "ready" && test.due !== null && test.daysLeft !== null && test.daysLeft >= 0 ? test.due : null;
  return { kind: "ok", testDue };
}
