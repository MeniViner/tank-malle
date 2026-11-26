import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayMonthShort, int } from '../../lib/format';
import type { ScanSampleRow } from '../../lib/scan/sampleStats';

const kinds = { pump: 'משאבה', odometer: 'קילומטראז׳' };
const readers = { local: 'מקומי בלבד', read: 'הצעת Gemini', miss: 'Gemini ללא הצעה' };
const outcomes = { match: 'נקרא נכון', corrected: 'נקרא ותוקן', unreadable: 'לא נקרא', unsaved: 'נקרא ולא נשמר' };
const facets = { platform: 'מכשיר', source: 'מקור התמונה', version: 'גרסת אפליקציה', attempt: 'ניסיון עד לקריאה' };
const facetValue = {
  platform: (r: ScanSampleRow) => ({ android: 'Android', ios: 'iPhone', web: 'Web', other: 'אחר' })[r.platform] ?? r.platform,
  source: (r: ScanSampleRow) => r.source === 'camera' ? 'מצלמה' : 'תמונה מהמכשיר',
  version: (r: ScanSampleRow) => r.appVersion,
  attempt: (r: ScanSampleRow) => r.outcome === 'unreadable' ? 'ללא קריאה' : r.attempt === 1 ? 'ניסיון ראשון' : r.attempt === 2 ? 'ניסיון שני' : 'ניסיון שלישי ומעלה',
};
const sampleOutcome = (r: ScanSampleRow) => r.outcome === 'unreadable' ? 'unreadable' :
  !r.final ? 'unsaved' : r.final === r.guess ? 'match' : 'corrected';

export function ScanInvestigation({ rows, detail }: { rows: ScanSampleRow[]; detail: (row: ScanSampleRow) => ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [copied, setCopied] = useState('');
  const [pageSize, setPageSize] = useState(30);
  const choice = <K extends string>(key: string, options: Record<K, string>) => {
    const value = params.get(key);
    return value && Object.hasOwn(options, value) ? value as K : '';
  };
  const kind = choice('kind', kinds), reader = choice('reader', readers), outcome = choice('outcome', outcomes), facet = choice('facet', facets);
  const slice = facet ? params.get('slice') : null;
  const scoped = rows.filter(r => (!kind || kind === r.kind) && (!reader || reader === (r.fallback ?? 'local')) && (!outcome || outcome === sampleOutcome(r)));
  const counts = new Map<string, number>();
  if (facet) for (const row of scoped) {
    const value = facetValue[facet](row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const matches = facet && slice ? scoped.filter(r => facetValue[facet](r) === slice) : scoped;
  const selected = matches.find(r => r.id === params.get('sample'));
  function update(key?: string, value?: string) {
    const next = new URLSearchParams(params);
    if (!key) for (const name of ['kind','reader','outcome','facet','slice','sample']) next.delete(name);
    else {
      if (key !== 'sample') next.delete('sample');
      if (key === 'facet') next.delete('slice');
      if (value) next.set(key, value); else next.delete(key);
    }
    setCopied(''); setPageSize(30); setParams(next);
  }
  const select = (label: string, key: string, value: string, options: Record<string, string>) =>
    <label>{label}<select aria-label={label} value={value} onChange={e => update(key, e.target.value)}>
      <option value="">הכול</option>{Object.entries(options).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
  return <section className="oc-panel oc-investigation"><header><h2>חקירת ניסיונות סריקה</h2></header>
    <div className="oc-filter-grid">{select('סוג צג', 'kind', kind, kinds)}{select('אופן הקריאה', 'reader', reader, readers)}
      {select('תוצאת הסריקה', 'outcome', outcome, outcomes)}{select('פילוח ניסיונות', 'facet', facet, facets)}</div>
    {facet && <div className="oc-filter-actions" aria-label={facets[facet]}>{[...counts].map(([value, count]) =>
      <button type="button" key={value} aria-pressed={value === slice} onClick={() => update('slice', value === slice ? '' : value)}>{value} · {int(count)}</button>)}</div>}
    <div className="oc-filter-actions"><strong>{matches.length === 1 ? "ניסיון אחד" : int(matches.length) + " ניסיונות"}</strong><button type="button" onClick={() => update()}>איפוס מסננים</button>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied('הקישור הועתק'); } catch { setCopied('אפשר להעתיק את הכתובת משורת הכתובת'); } }}>העתקת קישור לחקירה</button>
      <span role="status">{copied}</span></div>
    {matches.length ? <div className="oc-table-scroll"><table className="oc-table"><thead><tr>{['תאריך','צג','אופן הקריאה','תוצאה','פרטים'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{matches.slice(0, pageSize).map(r => <tr key={r.id}><td>{dayMonthShort(r.createdAt)}</td><td>{kinds[r.kind]}</td><td>{readers[r.fallback ?? 'local']}</td>
        <td>{outcomes[sampleOutcome(r)]}</td><td><button type="button" className="admin-link" aria-expanded={selected?.id === r.id}
          onClick={() => update('sample', selected?.id === r.id ? '' : r.id)}>פרטים</button></td></tr>)}</tbody></table></div> :
      <p>אין ניסיונות שמתאימים למסננים שנבחרו.</p>}
    {matches.length > pageSize && <button type="button" className="admin-link" onClick={() => setPageSize(n => n + 30)}>הצגת ניסיונות נוספים</button>}
    {selected && <div key={selected.id}><h3>פרטי ניסיון · {outcomes[sampleOutcome(selected)]}</h3>{detail(selected)}</div>}
  </section>;
}
