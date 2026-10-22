import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { shekel } from '../../lib/format';
import { Num } from '../Num';
import type { aggregateLedgerSummaries } from '../../lib/summary';

type Data = ReturnType<typeof aggregateLedgerSummaries>;
const label = (month: string) => new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(`${month}-15T12:00:00`));

export function AdminSpendChart({ data }: { data: Data }) {
  const rows = data.months.map(m => ({ ...m, label: label(m.month), cost: m.published ? m.totalAgorot / 100 : null }));
  return <section aria-label="הוצאה מתועדת בששת החודשים האחרונים">
    <div className="admin-group-head"><h2>הוצאה מתועדת</h2><span>שישה חודשים</span></div>
    {rows.some(r => r.published) ? <>
      <div className="h-[180px] min-w-0" role="img" aria-label="הוצאות חודשיות מהסיכומים שפורסמו, כולל החזרים">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--hairline)" />
          <XAxis dataKey="label" reversed tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis width={46} orientation="right" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={n => Math.abs(n) >= 1000 ? `${n / 1000}k` : String(n)} domain={[dataMin => Math.min(0, dataMin), dataMax => Math.max(0, dataMax)]} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => active && payload?.[0] ? <div className="rounded-control bg-surface p-3 text-right shadow-raised"><strong>{String(payload[0].payload.label)}</strong><Num className="block text-right">{shekel(Number(payload[0].value))}</Num>{payload[0].payload.unknownCosts ? <small>סכומים ידועים בלבד</small> : null}</div> : null} />
          <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>{rows.map((r, i) => <Cell key={r.month} fill={i === rows.length - 1 ? 'var(--accent)' : 'var(--muted)'} fillOpacity={i === rows.length - 1 ? 1 : 0.35} />)}</Bar>
        </BarChart></ResponsiveContainer>
      </div>
      <ul className="sr-only">{rows.map(r => <li key={r.month}>{r.label}: {r.published ? shekel(r.totalAgorot / 100) : 'טרם פורסם סיכום'}</li>)}</ul>
    </> : <p className="admin-empty">טרם פורסמו סיכומי הוצאות חודשיים. הם יופיעו לאחר פתיחת הרכב בגרסה העדכנית.</p>}
    <p className="helper">סיכומי יומן מפורטים מ־{data.ledgerVehicles} רכבים. החזרים מופחתים; סכומים חסרים אינם נספרים כאפס.</p>
  </section>;
}
