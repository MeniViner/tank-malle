import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { price } from '../../lib/format';
import type { PriceChange } from '../../lib/prices/priceChange';
import type { RegulatedPriceConfig } from '../../lib/prices/regulated';
import type { FuelType } from '../../lib/stats';

const fuelLabels: Record<FuelType, string> = { '95': 'בנזין 95', '98': 'בנזין 98', diesel: 'סולר', other: 'אחר' };
const sourceLabels = { manual: 'ידני', scheduled: 'רשמי', import: 'ייבוא' };
const date = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' });

export function PriceJournal({ config }: { config: RegulatedPriceConfig | null }) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<PriceChange[] | 'error' | null>(null);
  useEffect(() => {
    if (!open) return;
    return onSnapshot(query(collection(db, 'priceChanges'), orderBy('recordedAt', 'desc'), limit(50)),
      snap => setChanges(snap.docs.map(d => d.data() as PriceChange)), () => setChanges('error'));
  }, [open]);
  const months = Object.entries(config?.byFuelType ?? {}).flatMap(([fuel, modes]) =>
    Object.entries(modes?.self?.history ?? {}).map(([month, value]) => ({ month, fuel: fuel as FuelType, value })))
    .sort((a, b) => b.month.localeCompare(a.month) || a.fuel.localeCompare(b.fuel));
  return <details className="oc-panel oc-journal" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>היסטוריית שינויי מחיר</summary>
    {open && <>{changes === 'error' ? <p role="alert">טעינת יומן שינויי המחירים נכשלה.</p> :
      !changes ? <p role="status">טוענים…</p> : !changes.length ? <p>עדיין אין עריכות ביומן. שינוי המחיר או המקור הבא יופיע כאן.</p> :
      <div className="oc-table-scroll"><table className="oc-table"><caption>עד 50 שינויי המחיר האחרונים</caption><thead><tr>
        {['מועד העדכון', 'סוג דלק', 'מחיר קודם', 'מחיר חדש', 'מקור'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{changes.map((c, i) => <tr key={i}><td>{date.format(c.at)}</td><th scope="row">{fuelLabels[c.fuel]}</th>
          <td><bdi>{c.before == null ? '—' : price(c.before)}</bdi></td><td><bdi>{price(c.after)}</bdi></td>
          <td>{c.oldSource && c.oldSource !== c.newSource ? sourceLabels[c.oldSource] + ' ← ' : ''}{sourceLabels[c.newSource]}</td></tr>)}</tbody></table></div>}
      {months.length > 0 && <table className="oc-table"><caption>מחירים שנשמרו לפי חודש</caption>
        <thead><tr><th>חודש</th><th>סוג דלק</th><th>מחיר לליטר</th></tr></thead><tbody>
        {months.map(m => <tr key={m.month+m.fuel}><th scope="row"><bdi>{m.month}</bdi></th><td>{fuelLabels[m.fuel]}</td><td><bdi>{price(m.value)}</bdi></td></tr>)}</tbody></table>}
    </>}
  </details>;
}
