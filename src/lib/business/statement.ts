/**
 * Business monthly statement ("דוח חודשי לעסק"), design v3 §7.2.
 *
 * Pure: built at read time from the vehicle's ledger and mileage evidence.
 * Nothing here is stored. Amounts stay exact integer agorot until display;
 * the CSV export writes exact values, the HTML uses the shared formatters.
 *
 * Grouping: fuel (or "חשמל" for an EV), service, then each expense category in
 * the app's category order. An expense switched out of ownership ("לא בעלות
 * הרכב", see vehicle/ownership.ts) goes to a separate group that is shown but
 * is outside the month total. Refunds keep the ledger's semantics: a refund is
 * a negative amount inside its own "החזר / זיכוי" group and nets the total.
 * A record without a known amount is listed, counted in `unknownCount`, and
 * adds nothing — it is never priced as zero.
 *
 * Kilometres: `periodSummary(...).distance` for the calendar month — the
 * difference between the first and last odometer evidence dated inside the
 * month (fill-ups, odometer readings, tank observations with a reading,
 * services with a reading). It is null when the month has fewer than two
 * readings on different days, when same-day readings disagree without a time,
 * or when readings go backwards. Distance driven between the last reading of
 * the previous month and the first one of this month is not attributed to
 * either month — the statement reports only what was recorded in the month.
 */
import { EXPENSES, type VehicleExpense, type ServiceEvent } from '../maintenance/model';
import { cell } from '../maintenance/export';
import { formatPlate, fullDate, int, monthYear, num, price, shekel, shekelSigned, vehicleShort } from '../format';
import type { Fillup, Vehicle } from '../types';
import { periodSummary, type LedgerRow, type MileageEvidence } from '../vehicle/derived';
import { EXCLUDED_LABEL, isExcludedFromOwnership } from '../vehicle/ownership';
import { isEv, readBiz, type VehicleBiz } from '../vehicle/v3Fields';

export type StatementGroupId = 'fuel' | 'electric' | 'service' | `expense:${keyof typeof EXPENSES}` | 'excluded';

export interface StatementRow {
  key: string;
  day: string;
  /** Exact timestamp for fill-ups; null for day-only records. */
  at: number | null;
  kind: 'fuel' | 'service' | 'expense';
  group: StatementGroupId;
  /** Category label as it appears in the CSV "קטגוריה" column. */
  category: string;
  title: string;
  /** Station (fuel) or garage (service). */
  supplier: string;
  /** Litres for a fill-up, exact. */
  quantity: number | null;
  /** Per-litre price for a fill-up, exact (two-decimal display). */
  unitPrice: number | null;
  odometer: number | null;
  /** Signed exact agorot; a refund is negative; null = amount not recorded. */
  amountAgorot: number | null;
  refund: boolean;
  excluded: boolean;
  notes: string;
}

export interface StatementGroup {
  id: StatementGroupId;
  label: string;
  rows: StatementRow[];
  /** Sum of known amounts, signed agorot. */
  totalAgorot: number;
  /** Rows in this group with no recorded amount. */
  unknown: number;
  /** False only for the "לא בעלות הרכב" group. */
  inTotal: boolean;
}

export interface MonthlyStatement {
  month: string;
  label: string;
  from: string;
  to: string;
  vehicle: { id: string; name: string; make: string; model: string; year: number | null; plate: string | null; ev: boolean };
  biz: VehicleBiz | null;
  /** Groups inside the total, in display order. Empty groups are omitted. */
  groups: StatementGroup[];
  /** "לא בעלות הרכב": listed, never added to `totalAgorot`. */
  excludedGroup: StatementGroup | null;
  /** Month total of known ownership amounts, signed agorot (refunds netted). */
  totalAgorot: number;
  /** Refunds inside the total, as a positive number of agorot. */
  refundsAgorot: number;
  /** Ownership rows without a recorded amount (not included in the total). */
  unknownCount: number;
  /** Rows inside the total (fuel, service and included expenses). */
  recordCount: number;
  /** Kilometres recorded in the month, or null (see module comment). */
  km: number | null;
  kmBasis: { fromDay: string | null; toDay: string | null; ambiguous: boolean; inconsistent: boolean };
  /** total × usagePct / 100, in agorot (rounded to the agora), when a business share is set. */
  businessShareAgorot: number | null;
  /** The account was not fully loaded; the statement may be missing records. */
  incomplete: boolean;
}

export interface StatementRecords {
  ledger: readonly LedgerRow[];
  mileage: readonly MileageEvidence[];
  incomplete?: boolean;
}

const MONTH = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;
const EXPENSE_ORDER = Object.keys(EXPENSES) as (keyof typeof EXPENSES)[];

export function monthBounds(month: string): { from: string; to: string } {
  if (!MONTH.test(month)) throw new TypeError('month must be YYYY-MM');
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Months that have at least one financial record, newest first — the month picker's options. */
export function statementMonths(ledger: readonly LedgerRow[]): string[] {
  return [...new Set(ledger.filter(row => row.financial && ['fuel', 'service', 'expense'].includes(row.kind)).map(row => row.day.slice(0, 7)))]
    .filter(month => MONTH.test(month)).sort().reverse();
}

function toRow(row: LedgerRow, ev: boolean): StatementRow {
  const excluded = isExcludedFromOwnership(row);
  const base = { key: row.key, day: row.day, at: row.at, title: row.title, odometer: row.odometer, amountAgorot: row.amountAgorot, notes: row.notes, excluded };
  if (row.kind === 'fuel') {
    const fill = row.record as Fillup;
    const label = ev ? 'חשמל' : 'דלק';
    return { ...base, kind: 'fuel', group: ev ? 'electric' : 'fuel', category: label, title: ev ? 'טעינה' : 'תדלוק', supplier: fill.station?.name?.trim() ?? '',
      quantity: Number.isFinite(fill.liters) ? fill.liters : null, unitPrice: fill.totalCostUnknown || !Number.isFinite(fill.pricePerLiter) ? null : fill.pricePerLiter, refund: false };
  }
  if (row.kind === 'service') {
    const service = row.record as ServiceEvent;
    return { ...base, kind: 'service', group: 'service', category: 'טיפולים ותיקונים', supplier: service.garage ?? '', quantity: null, unitPrice: null, refund: false };
  }
  const expense = row.record as VehicleExpense;
  const category = Object.hasOwn(EXPENSES, expense.category) ? expense.category : 'other';
  return { ...base, kind: 'expense', group: excluded ? 'excluded' : `expense:${category}`, category: excluded ? EXCLUDED_LABEL : EXPENSES[category],
    supplier: '', quantity: null, unitPrice: null, refund: category === 'refund' || (row.amountAgorot ?? 0) < 0 };
}

function group(id: StatementGroupId, label: string, rows: StatementRow[], inTotal: boolean): StatementGroup {
  return { id, label, rows, inTotal, totalAgorot: rows.reduce((sum, row) => sum + (row.amountAgorot ?? 0), 0), unknown: rows.filter(row => row.amountAgorot === null).length };
}

/**
 * Build the statement for one calendar month (`YYYY-MM`).
 * `records` are the vehicle's derived ledger and mileage evidence
 * (VehicleDataContext: `ledger`, `mileage`, `incomplete`).
 */
export function buildMonthlyStatement(vehicle: Vehicle, records: StatementRecords, month: string): MonthlyStatement {
  const { from, to } = monthBounds(month);
  const ev = isEv(vehicle);
  const rows = records.ledger
    .filter(row => row.financial && row.day >= from && row.day <= to && (row.kind === 'fuel' || row.kind === 'service' || row.kind === 'expense'))
    .map(row => toRow(row, ev))
    .sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? 0) - (b.at ?? 0) || a.key.localeCompare(b.key));
  const owned = rows.filter(row => !row.excluded);
  const groups: StatementGroup[] = [];
  const add = (id: StatementGroupId, label: string) => {
    const selected = owned.filter(row => row.group === id);
    if (selected.length) groups.push(group(id, label, selected, true));
  };
  add(ev ? 'electric' : 'fuel', ev ? 'חשמל' : 'דלק');
  add('service', 'טיפולים ותיקונים');
  for (const category of EXPENSE_ORDER) add(`expense:${category}`, EXPENSES[category]);
  const excludedRows = rows.filter(row => row.excluded);
  const totalAgorot = owned.reduce((sum, row) => sum + (row.amountAgorot ?? 0), 0);
  const summary = periodSummary([...records.ledger], [...records.mileage], from, to, records.incomplete ?? false);
  const biz = readBiz(vehicle.biz);
  return {
    month, label: monthYear(month), from, to,
    vehicle: { id: vehicle.id, name: vehicleShort(vehicle), make: vehicle.make, model: vehicle.model, year: vehicle.year ?? null, plate: vehicle.plateNumber ?? null, ev },
    biz,
    groups,
    excludedGroup: excludedRows.length ? group('excluded', EXCLUDED_LABEL, excludedRows, false) : null,
    totalAgorot,
    refundsAgorot: -owned.filter(row => row.refund).reduce((sum, row) => sum + Math.min(0, row.amountAgorot ?? 0), 0),
    unknownCount: owned.filter(row => row.amountAgorot === null).length,
    recordCount: owned.length,
    km: summary.distance,
    kmBasis: { fromDay: summary.fromDay, toDay: summary.toDay, ambiguous: summary.ambiguous, inconsistent: summary.mileageInconsistent },
    businessShareAgorot: biz?.usagePct === undefined ? null : Math.round(totalAgorot * biz.usagePct / 100),
    incomplete: records.incomplete ?? false,
  };
}

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

const STATEMENT_CSV_HEADERS = ['תאריך', 'קטגוריה', 'פירוט', 'ספק / תחנה', 'כמות', 'יחידה', 'מחיר ליחידה (₪)', 'קילומטראז׳', 'סכום (₪)', 'נכלל בעלות הרכב', 'הערות'];
/** Exact shekels from agorot; never rounded for export. */
const exactShekels = (agorot: number | null) => agorot === null ? '' : agorot / 100;

/**
 * Spreadsheet export. UTF-8 BOM, Hebrew headers, CRLF. Values are exact
 * (AGENTS.md: exports preserve exact monetary values); text is formula-escaped.
 */
export function statementCsv(statement: MonthlyStatement): string {
  const unit = statement.vehicle.ev ? 'kWh' : 'ליטר';
  const line = (row: StatementRow) => [row.day, row.category, row.title, row.supplier, row.quantity ?? '', row.quantity === null ? '' : unit,
    row.unitPrice ?? '', row.odometer ?? '', exactShekels(row.amountAgorot), row.excluded ? 'לא' : 'כן', row.notes];
  const ordered = [...statement.groups.flatMap(g => g.rows), ...(statement.excludedGroup?.rows ?? [])];
  const rows: unknown[][] = [STATEMENT_CSV_HEADERS, ...ordered.map(line), [],
    ['סה״כ לחודש', statement.label, '', '', '', '', '', '', exactShekels(statement.totalAgorot), '', statement.unknownCount ? `${statement.unknownCount} רשומות ללא סכום לא נכללו` : ''],
    ['ק״מ שתועדו בחודש', '', '', '', '', '', '', statement.km ?? '', '', '', ''],
  ];
  if (statement.excludedGroup) rows.push([EXCLUDED_LABEL, 'מחוץ לסה״כ', '', '', '', '', '', '', exactShekels(statement.excludedGroup.totalAgorot), '', '']);
  if (statement.businessShareAgorot !== null) rows.push([`חלק עסקי (${statement.biz!.usagePct}%)`, '', '', '', '', '', '', '', exactShekels(statement.businessShareAgorot), '', '']);
  rows.push(['רכב', [statement.vehicle.make, statement.vehicle.model, statement.vehicle.year].filter(Boolean).join(' '), statement.vehicle.plate ? formatPlate(statement.vehicle.plate) : '',
    statement.biz?.company ?? '', '', '', '', '', '', '', statement.biz?.driver ? `נהג: ${statement.biz.driver}` : '']);
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** LTR island for numbers inside RTL text. */
const n = (text: string) => `<bdi class="n" dir="ltr">${escapeHtml(text)}</bdi>`;
/** Whole shekels via the shared formatters; a negative (refund) amount carries its sign. */
const money = (agorot: number | null) => agorot === null ? '—' : n(agorot < 0 ? shekelSigned(agorot / 100) : shekel(agorot / 100));
const dayFirst = (day: string) => day.split('-').reverse().join('.');

/**
 * Self-contained print-ready HTML (open → print → PDF). RTL, system fonts, no
 * external resources, every user string escaped. Display amounts use the
 * shared formatters: whole shekels for amounts, two decimals per litre.
 */
export function statementHtml(statement: MonthlyStatement, now = new Date()): string {
  const s = statement;
  const unit = s.vehicle.ev ? 'kWh' : 'ל׳';
  const title = `דוח הוצאות רכב · ${s.label}`;
  const subtitle = [s.biz?.company, [s.vehicle.make, s.vehicle.model, s.vehicle.year].filter(Boolean).join(' '),
    s.vehicle.plate ? `לוחית ${formatPlate(s.vehicle.plate)}` : null, s.biz?.driver ? `נהג: ${s.biz.driver}` : null,
    s.biz?.usagePct !== undefined ? `שימוש עסקי ${s.biz!.usagePct}%` : null].filter(Boolean).map(escapeHtml).join(' · ');
  const row = (r: StatementRow) => `<tr><td>${n(dayFirst(r.day))}</td><td>${escapeHtml(r.title)}${r.supplier ? ` · ${escapeHtml(r.supplier)}` : ''}${r.refund ? ' <small>(החזר)</small>' : ''}${r.notes ? `<br><small>${escapeHtml(r.notes)}</small>` : ''}</td>`
    + `<td class="num">${r.quantity === null ? '' : n(`${num(r.quantity, 2)} ${unit}`)}${r.unitPrice === null ? '' : `<br><small>${n(price(r.unitPrice))} ל${s.vehicle.ev ? '־kWh' : 'ליטר'}</small>`}</td>`
    + `<td class="num">${r.odometer === null ? '' : n(int(r.odometer))}</td><td class="num">${money(r.amountAgorot)}</td></tr>`;
  const table = (g: StatementGroup) => `<section class="group${g.inTotal ? '' : ' outside'}"><h3>${escapeHtml(g.label)} <small>· ${money(g.totalAgorot)}${g.unknown ? ` · ${n(String(g.unknown))} ללא סכום` : ''}${g.inTotal ? '' : ' · מחוץ לסה״כ'}</small></h3>`
    + `<table><thead><tr><th>תאריך</th><th>פירוט</th><th class="num">כמות</th><th class="num">ק״מ</th><th class="num">סכום</th></tr></thead><tbody>${g.rows.map(row).join('')}</tbody></table></section>`;
  const share = s.businessShareAgorot !== null
    ? `<div><small>חלק עסקי (${n(`${s.biz!.usagePct}%`)})</small><b>${money(s.businessShareAgorot)}</b></div>`
    : `<div><small>רשומות</small><b>${n(int(s.recordCount))}</b></div>`;
  const notes = [
    s.unknownCount ? `${s.unknownCount} רשומות ללא סכום מופיעות בדוח ואינן בסה״כ.` : null,
    s.excludedGroup ? `הוצאות שסומנו "${EXCLUDED_LABEL}" מופיעות בנפרד ואינן בסה״כ.` : null,
    s.km === null ? 'אין מספיק קריאות קילומטראז׳ בחודש כדי לחשב מרחק.' : `הק״מ מחושבים מהקריאה הראשונה (${dayFirst(s.kmBasis.fromDay!)}) עד האחרונה (${dayFirst(s.kmBasis.toDay!)}) שתועדו בחודש.`,
    s.incomplete ? 'חלק מהנתונים לא נטענו בעת ההפקה; ייתכן שהדוח חלקי.' : null,
  ].filter(Boolean).map(text => `<li>${escapeHtml(text)}</li>`).join('');
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#15130F;background:#fff;margin:32px auto;max-width:860px;padding:0 16px}
h1{font-size:24px;font-weight:600;margin:0}h2{font-size:14px;color:#5F584D;font-weight:500;margin:4px 0 20px}h3{font-size:15px;font-weight:600;margin:20px 0 0}
small{color:#5F584D;font-weight:400}.n{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums;white-space:nowrap}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}.meta div{border:1px solid #E8E3D6;border-radius:10px;padding:10px 12px}.meta b{display:block;font-size:18px;font-weight:600}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{padding:8px 6px;border-bottom:1px solid #E8E3D6;text-align:right;vertical-align:top}th{font-weight:600;font-size:12px;color:#5F584D}
td.num,th.num{text-align:left}.outside{opacity:.8}.outside h3{color:#5F584D}
.total{display:flex;justify-content:space-between;font-weight:600;font-size:16px;border-top:2px solid #15130F;padding-top:8px;margin-top:16px}
ul.notes{padding-inline-start:18px;color:#5F584D;font-size:12px}
.sig{margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.sig div{border-top:1px solid #15130F;padding-top:6px;font-size:12px;color:#5F584D}
footer{margin-top:24px;font-size:11px;color:#5F584D}
@media print{body{margin:12mm auto}section.group{break-inside:avoid}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>${subtitle ? `<h2>${subtitle}</h2>` : ''}
<div class="meta"><div><small>סה״כ הוצאות החודש</small><b>${money(s.totalAgorot)}</b></div><div><small>ק״מ שתועדו בחודש</small><b>${s.km === null ? '—' : n(int(s.km))}</b></div>${share}</div>
${s.groups.length ? s.groups.map(table).join('\n') : '<p>לא תועדו הוצאות בחודש הזה.</p>'}
${s.excludedGroup ? table(s.excludedGroup) : ''}
<div class="total"><span>סה״כ לחודש${s.refundsAgorot ? ` <small>(כולל החזרים של ${money(s.refundsAgorot)})</small>` : ''}</span><span>${money(s.totalAgorot)}</span></div>
${notes ? `<ul class="notes">${notes}</ul>` : ''}
<div class="sig"><div>חתימת הנהג</div><div>אישור הנהלת חשבונות</div></div>
<footer>הופק בטנק מלא ב־${escapeHtml(fullDate(now))}. הסכומים לפי הרשומות שתועדו באפליקציה ומעוגלים לשקל; הקבלות המקוריות נשמרות אצל בעל הרכב. המסמך אינו חשבונית ואינו אישור מס.</footer>
</body></html>
`;
}
