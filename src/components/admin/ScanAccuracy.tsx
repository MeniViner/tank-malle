import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../../lib/firebase';
import { dayMonthShort, int, num, percentPlain } from '../../lib/format';
import { ACCEPT, ENGINE_VERSION, tunedAccept } from '../../lib/scan/engine';
import { byDay, groupBy, median, readRate, rightRate, tally, toSampleRow, triesToRead, wrongRate, type ScanSampleRow, type ScanTally } from '../../lib/scan/sampleStats';
import { Num } from '../Num';
import { NumericText } from '../Fmt';
import { InfoTip } from '../InfoTip';
import { Segmented } from '../Segmented';

const LIMIT = 3000;
const rate = (value: number | null, digits = 0) => value == null ? '—' : percentPlain(value * 100, digits);
const KIND = { pump: 'משאבה', odometer: 'קילומטראז׳' } as const, SOURCE = { camera: 'מצלמה', file: 'תמונה מהמכשיר' } as const;
const PLATFORM: Record<string, string> = { android: 'אנדרואיד', ios: 'אייפון', other: 'אחר' };
const SERIES = [['right', 'נקרא נכון', 'var(--accent)'], ['wrong', 'נקרא ותוקן', 'var(--danger)'], ['unreadable', 'לא נקרא', 'var(--ink-3)'], ['unknown', 'נקרא, לא נשמר', 'var(--surface-2)']] as const;

type Tuning = { engine: number; accept: Record<string, number>; updatedAt: number | null; labeled: Record<string, number> } | null;
type Picture = { w: number; h: number; jpeg: string; role?: string; text?: string };

/** How well the photo reader does in people's hands: every attempt, and what they finally saved. */
export function ScanAccuracy() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [loaded, setLoaded] = useState<{ days: string; rows: ScanSampleRow[] | null } | null>(null), [tuning, setTuning] = useState<Tuning>(null);
  const [now] = useState(() => Date.now());
  // Rows belong to the period they were loaded for; while another period loads there are none.
  const rows = loaded?.days === days ? loaded.rows : null, error = loaded?.days === days && loaded.rows === null;
  useEffect(() => {
    let live = true;
    void getDocs(query(collection(db, 'scanSamples'), where('createdAt', '>=', now - Number(days) * 86_400_000), orderBy('createdAt', 'desc'), limit(LIMIT)))
      .then(snapshot => { if (live) setLoaded({ days, rows: snapshot.docs.flatMap(d => { const r = toSampleRow(d.id, d.data()); return r ? [r] : []; }) }); })
      .catch(() => { if (live) setLoaded({ days, rows: null }); });
    return () => { live = false; };
  }, [days, now]);
  useEffect(() => {
    let live = true;
    void getDoc(doc(db, 'appConfig', 'scanTuning')).then(s => {
      const d = s.data(); if (!live || !d) return;
      setTuning({ engine: Number(d.engine) || 0, accept: (d.accept ?? {}) as Record<string, number>, updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : null, labeled: (d.labeled ?? {}) as Record<string, number> });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => {
    if (!rows) return null;
    const all = tally(rows), tries = triesToRead(rows), cameraReads = rows.filter(r => r.source === 'camera' && r.outcome === 'read');
    return { all, tries, bars: byDay(rows, Number(days), now), users: new Set(rows.map(r => r.uid)).size,
      seconds: median(cameraReads.map(r => r.seconds)), fileMs: median(rows.filter(r => r.source === 'file' && r.ms > 0).map(r => r.ms)),
      byKind: groupBy(rows, r => r.kind), bySource: groupBy(rows, r => r.source), byPlatform: groupBy(rows, r => r.platform),
      byVersion: groupBy(rows, r => `${r.appVersion} · מנוע ${r.engine}`), byAttempt: groupBy(rows, r => r.attempt >= 3 ? '3' : String(r.attempt) as '1' | '2' | '3').sort((a, b) => a.key.localeCompare(b.key)),
      problems: rows.filter(r => r.final && (r.outcome === 'unreadable' || r.guess !== r.final)).slice(0, 30) };
  }, [rows, days, now]);

  const active = tunedAccept(tuning && tuning.engine === ENGINE_VERSION ? tuning.accept : null);
  return <>
    <section aria-label="דיוק הסריקה" className="flex min-w-0 flex-col gap-2">
      <div className="admin-group-head"><h2>דיוק הסריקה</h2><InfoTip label="על מדדי הסריקה"><p>כל ניסיון סריקה (פתיחת מצלמה או בחירת תמונה) נרשם. כשהתדלוק נשמר, המספרים שנשמרו מצורפים לניסיון, וכך יודעים אם הקריאה הייתה נכונה.</p><p>„נקרא נכון״ ו„נקרא ותוקן״ נמדדים רק על ניסיונות שהתדלוק שלהם נשמר. ניסיון שהטופס שלו ננטש נספר כ„לא נשמר״.</p></InfoTip></div>
      <Segmented size="sm" value={days} onChange={setDays} ariaLabel="תקופה" options={[{ value: '7', label: '7 ימים' }, { value: '30', label: '30 ימים' }, { value: '90', label: '90 ימים' }]} />
      {error ? <p role="alert" className="admin-empty">נתוני הסריקה לא נטענו. נסו לרענן.</p> : !stats ? <p className="admin-empty" role="status">טוענים…</p> : !stats.all.attempts ? <p className="admin-empty">עדיין אין סריקות בתקופה הזו. הנתונים יופיעו אחרי הסריקה הראשונה בגרסה שאוספת אותם.</p> : <>
        <div className="admin-tiles">
          <Tile label="ניסיונות סריקה" value={int(stats.all.attempts)} />
          <Tile label="הוצגה קריאה" value={rate(readRate(stats.all))} />
          <Tile label="נקרא נכון · מתוך מה שנשמר" value={rate(rightRate(stats.all))} />
          <Tile label="קריאה שגויה · מתוך מה שהוצג" value={rate(wrongRate(stats.all), 1)} />
        </div>
        <div className="admin-kinds"><span>משתמשים <Num>{int(stats.users)}</Num></span><span>נשמרו עם תדלוק <Num>{int(stats.all.labeled)}</Num></span><span>ניחוש נכון שלא הוצג <Num>{int(stats.all.missedRight)}</Num></span>{stats.seconds != null ? <span>חציון עד קריאה במצלמה <Num>{num(stats.seconds, 1)}</Num> שנ׳</span> : null}{stats.fileMs != null ? <span>חציון לתמונה <Num>{num(stats.fileMs / 1000, 1)}</Num> שנ׳</span> : null}</div>
        {rows!.length >= LIMIT ? <p className="helper"><NumericText>{`מוצגים ${int(LIMIT)} הניסיונות האחרונים בלבד.`}</NumericText></p> : null}
      </>}
    </section>

    {stats?.all.attempts ? <>
      <section className="admin-spend-card" aria-label="סריקות לפי יום">
        <div className="admin-group-head"><h2>לפי יום</h2></div>
        <div className="admin-spend-plot" role="img" aria-label="מספר ניסיונות הסריקה בכל יום, לפי תוצאה">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={stats.bars} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="day" reversed tickLine={false} axisLine={false} minTickGap={24} tickFormatter={d => dayMonthShort(new Date(`${d}T12:00:00`))} tick={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-sans)' }} />
            <YAxis width={36} orientation="right" tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-mono)', direction: 'ltr' }} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active: on, payload }) => on && payload?.[0] ? <div className="admin-spend-tooltip"><strong><NumericText>{dayMonthShort(new Date(`${payload[0].payload.day}T12:00:00`))}</NumericText></strong>{SERIES.map(([key, label]) => <small key={key}>{label}: <Num>{int(Number(payload[0].payload[key]))}</Num></small>)}</div> : null} />
            {SERIES.map(([key, , fill]) => <Bar key={key} dataKey={key} stackId="a" fill={fill} stroke="var(--ink)" strokeWidth={1} maxBarSize={22} isAnimationActive={false} />)}
          </BarChart></ResponsiveContainer>
        </div>
        <p className="admin-scan-legend">{SERIES.map(([key, label, fill]) => <span key={key}><i style={{ background: fill }} aria-hidden="true" />{label}</span>)}</p>
        <ul className="sr-only">{stats.bars.filter(b => b.right + b.wrong + b.unreadable + b.unknown).map(b => <li key={b.day}><NumericText>{`${b.day}: ${SERIES.map(([key, label]) => `${label} ${b[key]}`).join(', ')}`}</NumericText></li>)}</ul>
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-label="כמה ניסיונות נדרשו">
        <div className="admin-group-head"><h2>באיזה ניסיון הצליח</h2><InfoTip label="על ספירת הניסיונות"><p>לכל צג (משאבה או קילומטראז׳) בכל תדלוק: באיזה ניסיון הוצגה קריאה לראשונה. ניסיון הוא פתיחת מצלמה אחת או תמונה אחת.</p></InfoTip></div>
        <div className="admin-group">
          <Row label="בניסיון הראשון" value={rate(stats.tries.tasks ? stats.tries.first / stats.tries.tasks : null)} detail={int(stats.tries.first)} />
          <Row label="בניסיון השני" value={rate(stats.tries.tasks ? stats.tries.second / stats.tries.tasks : null)} detail={int(stats.tries.second)} />
          <Row label="בניסיון שלישי ומעלה" value={rate(stats.tries.tasks ? stats.tries.later / stats.tries.tasks : null)} detail={int(stats.tries.later)} />
          <Row label="לא נקרא בכלל" value={rate(stats.tries.tasks ? stats.tries.never / stats.tries.tasks : null)} detail={int(stats.tries.never)} />
        </div>
        <Breakdown title="לפי מספר הניסיון" groups={stats.byAttempt.map(g => ({ label: g.key === '3' ? 'ניסיון 3+' : `ניסיון ${g.key}`, tally: g.tally }))} />
      </section>

      <Breakdown title="לפי סוג צג" groups={stats.byKind.map(g => ({ label: KIND[g.key], tally: g.tally }))} />
      <Breakdown title="לפי מקור" groups={stats.bySource.map(g => ({ label: SOURCE[g.key], tally: g.tally }))} />
      <Breakdown title="לפי מכשיר" groups={stats.byPlatform.map(g => ({ label: PLATFORM[g.key] ?? g.key, tally: g.tally }))} />
      <Breakdown title="לפי גרסה" groups={stats.byVersion.map(g => ({ label: g.key, tally: g.tally }))} />

      <section className="flex min-w-0 flex-col gap-2" aria-label="ספי הביטחון">
        <div className="admin-group-head"><h2>ספי הביטחון</h2><InfoTip label="על הכיוונון האוטומטי"><p>פעם בשבוע סקריפט ב־GitHub עובר על הניסיונות שנשמרו ומכוונן את הסף שמעליו מוצגת קריאה, כך שקריאות שגויות יישארו עד אחוז אחד. הוא זז צעד קטן בכל פעם ורק כשיש מספיק דוגמאות.</p></InfoTip></div>
        <div className="admin-group">
          <Row label="קילומטראז׳ · יש קריאה קודמת" value={num(active.odometer, 2)} detail={active.odometer === ACCEPT.odometer ? 'מובנה' : 'מכוונן'} />
          <Row label="קילומטראז׳ · קריאה ראשונה" value={num(active.odometerFirst, 2)} detail={active.odometerFirst === ACCEPT.odometerFirst ? 'מובנה' : 'מכוונן'} />
          <Row label="משאבה" value={num(active.pump, 2)} detail={active.pump === ACCEPT.pump ? 'מובנה' : 'מכוונן'} />
        </div>
        <p className="helper"><NumericText>{tuning?.updatedAt ? `כיוונון אחרון: ${dayMonthShort(tuning.updatedAt)}${tuning.engine !== ENGINE_VERSION ? ' · למנוע קודם, לא בשימוש' : ''}` : 'עדיין לא רץ כיוונון; בשימוש הספים המובנים.'}</NumericText></p>
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-label="קריאות שלא הצליחו">
        <div className="admin-group-head"><h2>קריאות שלא הצליחו</h2></div>
        {stats.problems.length ? <div className="admin-group">{stats.problems.map(r => <Problem key={r.id} row={r} />)}</div> : <p className="admin-empty">אין בתקופה הזו קריאה שגויה או ניסיון שנכשל ונשמר.</p>}
      </section>
    </> : null}
  </>;
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="admin-tile"><span className="text-[13px] text-muted">{label}</span><Num className="text-right text-[26px] font-bold leading-tight text-ink">{value}</Num></div>;
}
function Row({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="admin-data-row"><span>{label}</span><span className="admin-scan-value"><Num>{value}</Num>{detail ? <small><NumericText>{detail}</NumericText></small> : null}</span></div>;
}
function Breakdown({ title, groups }: { title: string; groups: { label: string; tally: ScanTally }[] }) {
  return <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
    <div className="admin-group-head"><h2>{title}</h2></div>
    <div className="admin-group admin-scan-table" role="table">
      <div role="row" className="admin-scan-head"><span role="columnheader" /><span role="columnheader">ניסיונות</span><span role="columnheader">הוצג</span><span role="columnheader">נכון</span><span role="columnheader">שגוי</span></div>
      {groups.map(g => <div role="row" key={g.label}><span role="rowheader"><NumericText>{g.label}</NumericText></span><Num>{int(g.tally.attempts)}</Num><Num>{rate(readRate(g.tally))}</Num><Num>{rate(rightRate(g.tally))}</Num><Num>{rate(wrongRate(g.tally), 1)}</Num></div>)}
    </div>
  </section>;
}

/** One failed attempt: what was read, what was saved, and (on request) the rows the engine saw. */
function Problem({ row }: { row: ScanSampleRow }) {
  const [pictures, setPictures] = useState<Picture[] | null | 'none'>(null), [loading, setLoading] = useState(false);
  function show() {
    setLoading(true);
    void getDoc(doc(db, 'scanImages', row.id)).then(s => {
      const d = s.data(), valid = (p: unknown): p is Picture => !!p && typeof (p as Picture).jpeg === 'string' && /^[A-Za-z0-9+/=]+$/.test((p as Picture).jpeg);
      const list = [...(Array.isArray(d?.strips) ? d.strips : []), d?.thumb].filter(valid);
      setPictures(list.length ? list : 'none');
    }).catch(() => setPictures('none')).finally(() => setLoading(false));
  }
  return <div className="admin-scan-problem">
    <div><strong>{row.outcome === 'read' ? 'נקרא ותוקן' : 'לא נקרא'} · {KIND[row.kind]}</strong><small><NumericText>{`${dayMonthShort(row.createdAt)} · ${SOURCE[row.source]} · ניסיון ${row.attempt} · ${row.appVersion}`}</NumericText></small></div>
    <p>נשמר <Num>{row.final ?? '—'}</Num>{row.guess ? <> · {row.outcome === 'read' ? 'הוצג' : 'ניחוש'} <Num>{row.guess}</Num></> : null}{row.confidence != null ? <> · ביטחון <Num>{num(row.confidence, 2)}</Num></> : null}</p>
    {pictures === null ? <button type="button" className="admin-link" disabled={loading} onClick={show}>{loading ? 'טוענים…' : 'הצגת מה שהמנוע ראה'}</button>
      : pictures === 'none' ? <small>לא נשמרו קטעים לניסיון הזה.</small>
      : <div className="admin-scan-pictures">{pictures.map((p, i) => <img key={i} src={`data:image/jpeg;base64,${p.jpeg}`} width={p.w} height={p.h} alt={p.text ? `שורה שנקראה כ־${p.text}` : 'תמונה מוקטנת של הצילום'} />)}</div>}
  </div>;
}
