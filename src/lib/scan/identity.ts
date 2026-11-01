/**
 * Field identity from image evidence only. A number is never assigned to a
 * field because of its row position, a remembered price, tank capacity or
 * history. Evidence is: printed labels/units recognised next to the number,
 * the number's displayed precision, and — when all three pump fields are
 * visible — the pump's own arithmetic between them. When more than one
 * assignment survives, the result is an abstention, not the likeliest guess.
 */
export type PumpRole = 'total' | 'liters' | 'unitPrice';
export type IdentityReason = 'no-reading' | 'identity-ambiguous' | 'trip-meter' | 'unit-miles' | 'format';
/** A numeric line found in one frame, in that frame's pixel coordinates.
 * `contested`: the recognisers disagreed on it, or digits may be missing at
 * its edges. It can never be accepted, and it blocks any reading it could be. */
export type NumericLine = { text: string; left: number; right: number; top: number; height: number; contested?: string;
  /** A known label was read in the same detector box directly on this side. */
  beside?: { left: boolean; right: boolean } };
export type LabelClass = PumpRole | 'odometer' | 'trip' | 'tripLetter' | 'km' | 'miles';
/** Printed text recognised near the display (e.g. "LITRES", "ODO", "km"). */
export type LabelToken = { text: string; left: number; right: number; top: number; height: number };
export type PumpIdentity = { status: 'resolved'; values: { total: string; liters: string; unitPrice?: string }; evidence: string[] }
  | { status: 'abstain'; reason: IdentityReason; detail?: string };
export type OdometerIdentity = { status: 'resolved'; values: { odometer: string }; unit: 'km' | 'not-visible'; evidence: string[] }
  | { status: 'abstain'; reason: IdentityReason; detail?: string };

const PUMP_LABELS: [LabelClass, RegExp][] = [
  ['unitPrice', /^(price|unitprice|pricel|price\/l|₪\/l|nis\/l|מחיר|מחירלליטר|לליטר)$/],
  ['liters', /^(l|lit|ltr|ltrs|litre|litres|liter|liters|volume|vol|ליטר|ליטרים|כמות)$/],
  ['total', /^(total|sale|amount|amt|₪|nis|ils|ש"?ח|שח|סכום|לתשלום|סה"?כ|סהכ|tosale|topay)$/],
];
const ODOMETER_LABELS: [LabelClass, RegExp][] = [
  ['trip', /^(trip|trp|trip[ab12])$/],
  ['tripLetter', /^[ab]$/],
  ['miles', /^(mi|mile|miles|mls)$/],
  ['km', /^(km|kms|ק"?מ|קמ)$/],
  ['odometer', /^(odo|odometer|total)$/],
];
export function classifyLabel(text: string, kind: 'pump' | 'odometer'): LabelClass | null {
  const token = text.normalize('NFKC').toLowerCase().replace(/[\s.:׳'_-]/g, '').replace(/״/g, '"');
  for (const [label, pattern] of kind === 'pump' ? PUMP_LABELS : ODOMETER_LABELS) if (pattern.test(token)) return label;
  return null;
}
export function decimals(text: string) { const match = /\.(\d+)$/.exec(text); return match ? match[1].length : 0; }

/** Each label belongs to the single nearest line it shares a band with (or
 * sits directly above/below), never to a line more than a text height away.
 * The attachment records whether the label is beside the number ('band') or
 * above/below it ('stacked'). */
function attachLabels(lines: NumericLine[], labels: LabelToken[], kind: 'pump' | 'odometer') {
  const attached = lines.map(() => new Map<LabelClass, 'band' | 'stacked'>());
  for (const label of labels) {
    const labelClass = classifyLabel(label.text, kind); if (!labelClass) continue;
    let best = -1, bestDistance = Infinity, bestHow: 'band' | 'stacked' = 'band';
    lines.forEach((line, index) => {
      const dy = Math.abs(label.top + label.height / 2 - line.top - line.height / 2);
      const dx = label.left > line.right ? label.left - line.right : line.left > label.right ? line.left - label.right : 0;
      const sameBand = dy < line.height * .6 && dx < line.height * 3;
      const gap = Math.min(Math.abs(label.top + label.height - line.top), Math.abs(line.top + line.height - label.top));
      const stacked = dx < line.height && gap < line.height * .9;
      const distance = sameBand ? dx / line.height : stacked ? 1 + gap / line.height : Infinity;
      if (distance < bestDistance) { best = index; bestDistance = distance; bestHow = sameBand ? 'band' : 'stacked'; }
    });
    if (best >= 0 && attached[best].get(labelClass) !== 'band') attached[best].set(labelClass, bestHow);
  }
  return attached;
}

const PRECISION: Record<PumpRole, (places: number) => boolean> = {
  // Shekel amounts are displayed in agorot. A three-place number is never money.
  total: places => places === 2,
  liters: places => places === 2 || places === 3,
  unitPrice: places => places === 2 || places === 3,
};
/** A pump rounds the amount it computes from its unrounded volume. */
function productHolds(total: string, liters: string, price: string) {
  const t = Number(total), l = Number(liters), p = Number(price);
  const tolerance = .005 + p * .5 * 10 ** -decimals(liters) + l * .5 * 10 ** -decimals(price) + 1e-9;
  return Math.abs(t - l * p) <= tolerance;
}

export function resolvePump(lines: NumericLine[], labels: LabelToken[] = []): PumpIdentity {
  // Integer lines (pump number, clock) are not pump fields. Every decimal line
  // must be explained; an unexplained decimal line is a reason to abstain.
  if (lines.some(line => line.contested && /\d\.\d/.test(line.text))) return { status: 'abstain', reason: 'identity-ambiguous', detail: 'unsure row' };
  const rows = lines.filter(line => /^\d{1,6}\.\d{1,3}$/.test(line.text) && Number(line.text) > 0);
  if (rows.length < 2) return { status: 'abstain', reason: 'no-reading' };
  if (rows.length > 3) return { status: 'abstain', reason: 'identity-ambiguous', detail: 'more than three decimal rows' };
  const attached = attachLabels(rows, labels, 'pump');
  const tagged = rows.map((row, i) => ({ row, labels: [...attached[i].keys()].filter((k): k is PumpRole => k === 'total' || k === 'liters' || k === 'unitPrice') }));
  if (tagged.some(t => t.labels.length > 1)) return { status: 'abstain', reason: 'identity-ambiguous', detail: 'conflicting labels' };
  const roles: PumpRole[] = ['total', 'liters', 'unitPrice'], solutions: { total: string; liters: string; unitPrice?: string; evidence: string[] }[] = [];
  const assign = (index: number, used: Map<PumpRole, number>) => {
    if (index === rows.length) {
      const t = used.get('total'), l = used.get('liters'), p = used.get('unitPrice');
      if (t === undefined || l === undefined) return;
      if (p !== undefined && !productHolds(rows[t].text, rows[l].text, rows[p].text)) return;
      const evidence = [...new Set(tagged.flatMap(x => x.labels.map(k => `label:${k}`)).concat(p !== undefined ? ['product'] : [], 'precision'))];
      solutions.push({ total: rows[t].text, liters: rows[l].text, ...(p !== undefined ? { unitPrice: rows[p].text } : {}), evidence });
      return;
    }
    for (const role of roles) {
      if (used.has(role) || !PRECISION[role](decimals(rows[index].text))) continue;
      if (tagged[index].labels.length && tagged[index].labels[0] !== role) continue;
      if (tagged.some((t, i) => i !== index && t.labels[0] === role)) continue;
      used.set(role, index); assign(index + 1, used); used.delete(role);
    }
  };
  assign(0, new Map());
  if (!solutions.length) return { status: 'abstain', reason: 'format' };
  const key = (s: { total: string; liters: string }) => `${s.total}|${s.liters}`;
  if (new Set(solutions.map(key)).size > 1) return { status: 'abstain', reason: 'identity-ambiguous', detail: `${solutions.length} assignments` };
  const { evidence, ...values } = solutions[0];
  // Price is only reported when it is the same row in every surviving assignment.
  if (solutions.some(s => s.unitPrice !== values.unitPrice)) delete values.unitPrice;
  return { status: 'resolved', values, evidence };
}

/**
 * The lifetime odometer is an integer. A decimal is a trip meter; TRIP/A/B or
 * a miles unit next to it is a different quantity. Without a printed ODO/km
 * label only a long integer (counting the displayed leading zeros of a fixed
 * register) that is the single such reading is accepted: short numbers on a
 * dashboard are often clocks, trips, ranges or speeds.
 */
export function resolveOdometer(lines: NumericLine[], labels: LabelToken[] = [], { minimumUnlabelledDigits = 5 } = {}): OdometerIdentity {
  // Labels attach over every line, so a TRIP label beside a decimal trip meter
  // is not mistaken for a label of the odometer line above it.
  const attached = attachLabels(lines, labels, 'odometer');
  // Round numbers repeated around a dial are a speedometer/rev-counter scale.
  const scale = lines.filter(line => /^\d{2,3}$/.test(line.text) && Number(line.text) % 10 === 0 && Number(line.text) <= 400);
  // A fixed register may pad with zeros beyond seven digits ("00236096"); the
  // reading is the number they pad.
  const all = lines.map((line, i) => ({ line, labels: attached[i], value: line.text.replace(/^0+(?=\d)/, '') }))
    .filter(t => /^0*\d{1,7}$/.test(t.line.text) && !(scale.length >= 3 && scale.includes(t.line)));
  // An unsure long number, or an unsure number with an odometer label, could
  // itself be the odometer: nothing is accepted beside it.
  if (all.some(t => t.line.contested && (t.line.text.length >= minimumUnlabelledDigits || t.labels.get('odometer') === 'band')))
    return { status: 'abstain', reason: 'identity-ambiguous', detail: 'unsure candidate' };
  const tagged = all.filter(t => !t.line.contested);
  if (!tagged.length) return { status: 'abstain', reason: lines.length ? 'format' : 'no-reading' };
  // A single letter (A/B) marks a trip meter only when printed beside it.
  const odometers = tagged.filter(t => !(t.labels.has('trip') || t.labels.get('tripLetter') === 'band'));
  if (!odometers.length) return { status: 'abstain', reason: 'trip-meter' };
  // A long register may take a label above or below it; a short number only
  // counts as the odometer when ODO/km is printed beside it, on its own line.
  // km is printed beside trips, ranges and speeds too, so a short number needs
  // ODO/TOTAL beside it; a long register may take ODO or km above or below.
  const labelled = odometers.filter(t => t.labels.get('odometer') === 'band' || (t.line.text.length >= minimumUnlabelledDigits && (t.labels.has('odometer') || t.labels.has('km'))));
  const pool = labelled.length ? labelled : odometers.filter(t => t.line.text.length >= minimumUnlabelledDigits && !t.labels.has('miles'));
  const texts = [...new Set(pool.map(t => t.value))];
  if (!texts.length) return odometers.some(t => t.labels.has('miles')) ? { status: 'abstain', reason: 'unit-miles' } : { status: 'abstain', reason: 'identity-ambiguous', detail: 'short unlabelled number' };
  if (texts.length > 1) return { status: 'abstain', reason: 'identity-ambiguous', detail: 'competing odometer readings' };
  const chosen = pool.filter(t => t.value === texts[0]);
  if (chosen.some(t => t.labels.has('miles'))) return { status: 'abstain', reason: 'unit-miles' };
  const km = chosen.some(t => t.labels.has('km'));
  const evidence = labelled.length ? [...new Set(chosen.flatMap(t => [...t.labels.keys()].map(k => `label:${k}`)))] : ['long-integer'];
  return { status: 'resolved', values: { odometer: texts[0] }, unit: km ? 'km' : 'not-visible', evidence };
}
