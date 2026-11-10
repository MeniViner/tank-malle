/**
 * Constraint-based candidate selection over the recogniser's top-3 per field.
 * Pure: no pixels, no I/O. The result is a SUGGESTION for the verification
 * screen; nothing here writes a record.
 */
export type FieldCandidate = {
  text: string;
  value: number;
  /** 0..1, from the recogniser. */
  confidence: number;
  /** Per-character confidence, for highlighting the least certain digit. */
  digits?: { char: string; confidence: number }[];
};
export type PumpFields = { total: FieldCandidate[]; liters: FieldCandidate[]; price?: FieldCandidate[] };
export type ScanContext = {
  /** Last known odometer reading before this fill, km. */
  lastOdometer?: number | null;
  /** Usable tank capacity, litres. */
  tankCapacity?: number | null;
};
export type CheckName = 'total≈liters×price' | 'price-range' | 'liters≤tank' | 'odometer>last' | 'odometer<last+3000';
export type Check = { name: CheckName; status: 'ok' | 'failed' | 'unknown' };

export const PRICE_RANGE = { min: 5, max: 12 } as const;
export const ODOMETER_WINDOW_KM = 3000;
/** A full tank may read a little over the nominal capacity (filler neck). */
export const TANK_SLACK = 1.05;

/** Pump totals are rounded to the agora; liters × price is rounded too. */
export function totalTolerance(total: number): number {
  return Math.max(.06, total * .003);
}

const log = (p: number) => Math.log(Math.max(1e-6, Math.min(1, p)));

export type PumpSelection = {
  total: FieldCandidate | null;
  liters: FieldCandidate | null;
  price: FieldCandidate | null;
  /** Price per litre implied by the chosen total and liters (exact, unrounded). */
  impliedPrice: number | null;
  checks: Check[];
  /** Every hard check that could be evaluated passed. */
  consistent: boolean;
  /** Sum of log-confidences of the chosen candidates. */
  score: number;
  /** True when the choice differs from the recogniser's top-1 somewhere. */
  changedByConstraints: boolean;
};

export function pumpChecks(total: number, liters: number, price: number | null, context: ScanContext): Check[] {
  const implied = liters > 0 ? total / liters : NaN;
  const checks: Check[] = [];
  if (price != null) {
    checks.push({ name: 'total≈liters×price', status: Math.abs(liters * price - total) <= totalTolerance(total) ? 'ok' : 'failed' });
  } else checks.push({ name: 'total≈liters×price', status: 'unknown' });
  const priceValue = price ?? implied;
  checks.push({ name: 'price-range', status: Number.isFinite(priceValue) && priceValue >= PRICE_RANGE.min && priceValue <= PRICE_RANGE.max ? 'ok' : 'failed' });
  const tank = context.tankCapacity;
  checks.push({ name: 'liters≤tank', status: tank && tank > 0 ? liters > 0 && liters <= tank * TANK_SLACK ? 'ok' : 'failed' : liters > 0 ? 'unknown' : 'failed' });
  return checks;
}

/**
 * Chooses total, liters and (optional) price from up to three candidates each.
 * Among combinations that pass every evaluable hard check, the most confident
 * wins. When none does, the top-1 of each field is returned with
 * `consistent: false` so the screen can say which check failed.
 */
export function selectPump(fields: PumpFields, context: ScanContext = {}): PumpSelection {
  const totals = fields.total.slice(0, 3), liters = fields.liters.slice(0, 3);
  const prices: (FieldCandidate | null)[] = fields.price?.length ? fields.price.slice(0, 3) : [null];
  if (!totals.length || !liters.length) {
    return { total: totals[0] ?? null, liters: liters[0] ?? null, price: prices[0], impliedPrice: null, checks: [], consistent: false, score: -Infinity, changedByConstraints: false };
  }
  type Combo = { t: FieldCandidate; l: FieldCandidate; p: FieldCandidate | null; checks: Check[]; score: number; rank: number };
  const combos: Combo[] = [];
  totals.forEach((t, ti) => liters.forEach((l, li) => prices.forEach((p, pi) => {
    const checks = pumpChecks(t.value, l.value, p?.value ?? null, context);
    combos.push({ t, l, p, checks, score: log(t.confidence) + log(l.confidence) + (p ? log(p.confidence) : 0), rank: ti + li + pi });
  })));
  const ok = combos.filter(c => c.checks.every(x => x.status !== 'failed'));
  // Deterministic: higher score, then fewer departures from top-1.
  const order = (a: Combo, b: Combo) => b.score - a.score || a.rank - b.rank;
  const best = (ok.length ? ok : combos).sort(order)[0];
  const top1 = combos.find(c => c.rank === 0)!;
  const chosen = ok.length ? best : top1;
  return {
    total: chosen.t, liters: chosen.l, price: chosen.p,
    impliedPrice: chosen.l.value > 0 ? chosen.t.value / chosen.l.value : null,
    checks: chosen.checks, consistent: ok.length > 0, score: chosen.score,
    changedByConstraints: chosen.rank > 0,
  };
}

export type OdometerSelection = {
  odometer: FieldCandidate | null;
  checks: Check[];
  consistent: boolean;
  changedByConstraints: boolean;
};

export function odometerChecks(value: number, context: ScanContext): Check[] {
  const last = context.lastOdometer;
  if (last == null || !Number.isFinite(last) || last <= 0) {
    return [{ name: 'odometer>last', status: 'unknown' }, { name: 'odometer<last+3000', status: 'unknown' }];
  }
  return [
    { name: 'odometer>last', status: value > last ? 'ok' : 'failed' },
    { name: 'odometer<last+3000', status: value < last + ODOMETER_WINDOW_KM ? 'ok' : 'failed' },
  ];
}

/** Picks the most confident odometer candidate inside (last, last + 3,000). */
export function selectOdometer(candidates: FieldCandidate[], context: ScanContext = {}): OdometerSelection {
  const list = candidates.filter(c => Number.isInteger(c.value) && c.value > 0);
  if (!list.length) return { odometer: null, checks: [], consistent: false, changedByConstraints: false };
  const scored = list.map((c, i) => ({ c, i, checks: odometerChecks(c.value, context) }));
  const ok = scored.filter(s => s.checks.every(x => x.status !== 'failed'));
  const chosen = ok.length ? ok.sort((a, b) => b.c.confidence - a.c.confidence || a.i - b.i)[0] : scored[0];
  return { odometer: chosen.c, checks: chosen.checks, consistent: ok.length > 0, changedByConstraints: chosen.i > 0 };
}

/** Index of the least confident character, or -1. An inserted (not seen)
 * decimal point carries low confidence and can be the one highlighted. */
export function leastConfidentDigit(candidate: FieldCandidate | null): number {
  if (!candidate?.digits?.length) return -1;
  let index = -1, min = Infinity;
  candidate.digits.forEach((d, i) => { if (d.confidence < min) { min = d.confidence; index = i; } });
  return index;
}
