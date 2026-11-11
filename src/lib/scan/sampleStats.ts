/** Accuracy figures from scan samples (see `samples.ts`); pure, shared by the Admin screen and scripts/scan-learn. */

export type ScanSampleRow = {
  id: string; uid: string; createdAt: number; day: string; appVersion: string; engine: number;
  kind: 'pump' | 'odometer'; source: 'camera' | 'file'; session: string; attempt: number;
  outcome: 'read' | 'unreadable'; guess: string | null; confidence: number | null;
  ms: number; frames: number; seconds: number; journal: boolean; platform: string;
  final: string | null; result: 'match' | 'corrected' | 'manual' | null;
};

/** Reads a stored document defensively; anything malformed is dropped. */
export function toSampleRow(id: string, d: Record<string, unknown>): ScanSampleRow | null {
  const text = (v: unknown, max = 64) => typeof v === 'string' ? v.slice(0, max) : '', number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  if ((d.kind !== 'pump' && d.kind !== 'odometer') || (d.outcome !== 'read' && d.outcome !== 'unreadable') || !number(d.createdAt)) return null;
  return {
    id, uid: text(d.uid, 128), createdAt: number(d.createdAt), day: text(d.day, 10) || new Date(number(d.createdAt)).toISOString().slice(0, 10),
    appVersion: text(d.appVersion, 20) || '?', engine: number(d.engine), kind: d.kind, source: d.source === 'file' ? 'file' : 'camera',
    session: text(d.session) || id, attempt: Math.max(1, number(d.attempt)), outcome: d.outcome, guess: text(d.guess, 40) || null,
    confidence: typeof d.confidence === 'number' && Number.isFinite(d.confidence) ? d.confidence : null,
    ms: number(d.ms), frames: number(d.frames), seconds: number(d.seconds), journal: d.journal === true, platform: text(d.platform, 12) || 'other',
    final: text(d.final, 40) || null, result: d.result === 'match' || d.result === 'corrected' || d.result === 'manual' ? d.result : null,
  };
}

export type ScanTally = {
  attempts: number; read: number; unreadable: number;
  /** Attempts whose fill-up was saved, so the true numbers are known. */
  labeled: number;
  /** Shown and equal to what was saved / shown and then changed by the person. */
  right: number; wrong: number;
  /** Not shown, and the engine's best guess was in fact right (a threshold cost, not a reading error). */
  missedRight: number; typed: number;
};
const empty = (): ScanTally => ({ attempts: 0, read: 0, unreadable: 0, labeled: 0, right: 0, wrong: 0, missedRight: 0, typed: 0 });

export function tally(rows: readonly ScanSampleRow[]): ScanTally {
  const t = empty();
  for (const r of rows) {
    t.attempts++; if (r.outcome === 'read') t.read++; else t.unreadable++;
    if (!r.final) continue;
    t.labeled++;
    if (r.outcome === 'read') { if (r.guess === r.final) t.right++; else t.wrong++; }
    else { t.typed++; if (r.guess && r.guess === r.final) t.missedRight++; }
  }
  return t;
}

/** Share of a count, or null when there is nothing to divide by (shown as "—", never as 0%). */
export const share = (part: number, whole: number): number | null => whole > 0 ? part / whole : null;
export const readRate = (t: ScanTally) => share(t.read, t.attempts);
/** Of the attempts whose truth is known: shown and right. */
export const rightRate = (t: ScanTally) => share(t.right, t.labeled);
/** Of the readings shown whose truth is known: wrong. The number to keep near zero. */
export const wrongRate = (t: ScanTally) => share(t.wrong, t.right + t.wrong);

export function groupBy<K extends string>(rows: readonly ScanSampleRow[], key: (row: ScanSampleRow) => K): { key: K; tally: ScanTally }[] {
  const groups = new Map<K, ScanSampleRow[]>();
  for (const r of rows) { const k = key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  return [...groups].map(([k, list]) => ({ key: k, tally: tally(list) })).sort((a, b) => b.tally.attempts - a.tally.attempts);
}

/** One bar per calendar day (UTC, as stored), oldest first, days without scans included. */
export function byDay(rows: readonly ScanSampleRow[], days: number, now: number): { day: string; right: number; wrong: number; unreadable: number; unknown: number }[] {
  const out = new Map<string, { day: string; right: number; wrong: number; unreadable: number; unknown: number }>();
  for (let i = days - 1; i >= 0; i--) { const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10); out.set(day, { day, right: 0, wrong: 0, unreadable: 0, unknown: 0 }); }
  for (const r of rows) {
    const bar = out.get(r.day); if (!bar) continue;
    if (r.outcome === 'unreadable') bar.unreadable++; else if (!r.final) bar.unknown++; else if (r.guess === r.final) bar.right++; else bar.wrong++;
  }
  return [...out.values()];
}

/**
 * How many tries a person needed. A "task" is one display in one scan session (pump or odometer);
 * it succeeds at the first attempt that showed a reading.
 */
export function triesToRead(rows: readonly ScanSampleRow[]): { tasks: number; first: number; second: number; later: number; never: number } {
  const tasks = new Map<string, ScanSampleRow[]>();
  for (const r of rows) { const k = `${r.session}|${r.kind}`; if (!tasks.has(k)) tasks.set(k, []); tasks.get(k)!.push(r); }
  const out = { tasks: tasks.size, first: 0, second: 0, later: 0, never: 0 };
  for (const list of tasks.values()) {
    const hit = list.filter(r => r.outcome === 'read').map(r => r.attempt).sort((a, b) => a - b)[0];
    if (hit == null) out.never++; else if (hit <= 1) out.first++; else if (hit === 2) out.second++; else out.later++;
  }
  return out;
}

export const median = (values: number[]): number | null => values.length ? values.slice().sort((a, b) => a - b)[values.length >> 1] : null;

export type AcceptKey = 'odometer' | 'odometerFirst' | 'pump';
export const acceptKeyOf = (row: Pick<ScanSampleRow, 'kind' | 'journal'>): AcceptKey => row.kind === 'pump' ? 'pump' : row.journal ? 'odometer' : 'odometerFirst';

/**
 * The lowest threshold that would have kept wrong readings at or under `maxWrong` of those shown,
 * on labelled attempts (each carries the engine's best guess and its confidence, shown or not).
 * Returns null without enough evidence; never moves more than `maxStep` from `current`, inside `range`.
 */
export function tuneThreshold(rows: readonly ScanSampleRow[], current: number, range: readonly [number, number], options: { maxWrong?: number; minLabeled?: number; maxStep?: number } = {}):
  { value: number; labeled: number; right: number; wrong: number } | null {
  const { maxWrong = .01, minLabeled = 200, maxStep = .05 } = options;
  const known = rows.filter(r => r.final && r.guess && r.confidence != null);
  if (known.length < minLabeled) return null;
  const lo = Math.max(range[0], current - maxStep), hi = Math.min(range[1], current + maxStep);
  let best: { value: number; labeled: number; right: number; wrong: number } | null = null;
  for (let t = hi; t >= lo - 1e-9; t -= .01) {
    const value = Math.round(t * 100) / 100, shown = known.filter(r => r.confidence! >= value), wrong = shown.filter(r => r.guess !== r.final).length;
    // Walking down from the strictest allowed value: stop at the first one that lets too many wrong readings through.
    if (shown.length && wrong / shown.length > maxWrong) break;
    best = { value, labeled: known.length, right: shown.length - wrong, wrong };
  }
  return best ?? { value: Math.round(hi * 100) / 100, labeled: known.length, right: 0, wrong: 0 };
}

export type ScanFinal = { total: string; liters: string; odometer: string };
/** One comparable string per reading: "123456" for an odometer, "287.60|40.000" for a pump. */
export function readingKey(kind: 'pump' | 'odometer', values: Partial<ScanFinal> | null): string | null {
  if (!values) return null;
  const v = values as Partial<ScanFinal>;
  if (kind === 'odometer') { const n = Number(v.odometer); return v.odometer && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null; }
  const total = Number(v.total), liters = Number(v.liters);
  return v.total && v.liters && Number.isFinite(total) && Number.isFinite(liters) && total > 0 && liters > 0 ? `${total.toFixed(2)}|${liters.toFixed(3)}` : null;
}


export type ScanLabel = 'match' | 'corrected' | 'manual';
/** What a saved value says about an attempt: the shown reading was right, was corrected, or had to be typed. */
export function labelOf(outcome: 'read' | 'unreadable', guess: string | null, final: string): ScanLabel {
  return outcome === 'unreadable' ? 'manual' : guess === final ? 'match' : 'corrected';
}

