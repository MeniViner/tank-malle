import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { int, shekel } from '../../lib/format';
import { Num } from '../Num';
import { NumericText } from '../Fmt';
import { InfoTip } from '../InfoTip';
import type { aggregateLedgerSummaries } from '../../lib/summary';

type Data = ReturnType<typeof aggregateLedgerSummaries>;
const label = (month: string) => new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(`${month}-15T12:00:00`));
const fullLabel = (month: string) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`));

export function AdminSpendChart({ data }: { data: Data }) {
  const rows = data.months.map(m => ({ ...m, label: label(m.month), cost: m.published ? m.totalAgorot / 100 : null }));
  const total = rows.reduce((sum, row) => sum + row.totalAgorot, 0);
  const unknown = rows.reduce((sum, row) => sum + row.unknownCosts, 0);
  return <section className="admin-spend-card" aria-label="הוצאה מתועדת בששת החודשים האחרונים">
    <div className="admin-group-head"><h2>הוצאה מתועדת</h2><InfoTip label="על סיכום ההוצאות"><p>סיכומים שפורסמו עבור <Num>{int(data.ledgerVehicles)}</Num> רכבים בחשבונות שנטענו. החזרים מופחתים מהסכום. עלויות חסרות אינן נספרות כאפס, וחודש ללא סיכום נשאר ללא נתון.</p><p>הסיכומים הקיימים כוללים סכום חודשי כולל, ללא פירוט לפי סוג הוצאה.</p></InfoTip></div>
    <span className="admin-spend-period">ששת החודשים האחרונים</span>
    {rows.some(r => r.published) ? <>
      <Num block className="admin-spend-total">{shekel(total / 100)}</Num>
      <div className="admin-spend-plot" role="img" aria-label="הוצאות חודשיות מהסיכומים שפורסמו, כולל החזרים">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" reversed interval={0} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-sans)' }} />
          <YAxis width={68} orientation="right" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-mono)', direction: 'ltr' }} allowDecimals={false} tickFormatter={n => int(Number(n))} domain={[dataMin => Math.min(0, dataMin), dataMax => Math.max(0, dataMax)]} />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => active && payload?.[0] ? <div className="admin-spend-tooltip"><strong><NumericText>{fullLabel(String(payload[0].payload.month))}</NumericText></strong><Num block>{shekel(Number(payload[0].payload.totalAgorot) / 100)}</Num>{payload[0].payload.unknownCosts ? <small>סכומים ידועים בלבד</small> : null}<small>ללא פירוט לפי סוג</small></div> : null} />
          <Bar dataKey="cost" maxBarSize={28} isAnimationActive={false}>{rows.map((r, i) => <Cell key={r.month} fill={i === rows.length - 1 ? 'var(--accent)' : 'var(--ink-2)'} fillOpacity={i === rows.length - 1 ? 1 : 0.65} stroke="var(--ink)" strokeWidth={1} />)}</Bar>
        </BarChart></ResponsiveContainer>
      </div>
      <p className="admin-spend-legend"><span aria-hidden="true" />סך הכול · ללא פירוט לפי סוג</p>
      <ul className="sr-only">{rows.map(r => <li key={r.month}><NumericText>{`${fullLabel(r.month)}: ${r.published ? shekel(r.totalAgorot / 100) : 'טרם פורסם סיכום'}${r.unknownCosts ? ' · סכומים ידועים בלבד' : ''}`}</NumericText></li>)}</ul>
      {unknown ? <p className="helper"><Num>{int(unknown)}</Num> רשומות ללא עלות בסיכומים שפורסמו.</p> : null}
    </> : <p className="admin-empty">טרם פורסמו סיכומי הוצאות חודשיים. הם יופיעו לאחר פתיחת הרכב בגרסה העדכנית.</p>}
    <p className="helper">סכומים שפורסמו בלבד · כולל החזרים</p>
  </section>;
}
