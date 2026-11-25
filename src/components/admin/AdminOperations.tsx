import { useEffect, useState, type ReactNode } from 'react';
import journey from '../../lib/monitoring/journey.json';
import { loadJourney, type JourneySnapshot } from '../../lib/adminOperations';
import { num } from '../../lib/format';
import {
  JOBS, productReports, loadGithub, loadOperations, loadSystem, TANK_CLOUD, TANK_FIREBASE, TANK_GITHUB, TANK_HOSTING,
  type GithubRun, type OperationsSnapshot, type Source,
} from '../../lib/adminOperations';
import { Skeleton } from '../Card';
import { Num } from '../Num';
import { AdminPanel } from './AdminPanel';

const dateFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' });
const DAY = 86_400_000;

function date(value: number | string | null | undefined) {
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return typeof time === 'number' && Number.isFinite(time) ? dateFormat.format(time) : '—';
}

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, revision: number) {
  const [result, setResult] = useState<{ revision: number; value: T }>();
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(value => {
      if (!controller.signal.aborted) setResult({ revision, value });
    });
    return () => controller.abort();
  }, [load, revision]);
  return { value: result?.value, loading: result?.revision !== revision };
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return <a className="admin-link admin-ops-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

function Row({ title, detail, value }: { title: ReactNode; detail?: ReactNode; value?: ReactNode }) {
  return <div className="admin-data-row admin-ops-row">
    <div><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</div>
    {value ? <div className="admin-ops-row-value">{value}</div> : null}
  </div>;
}

function Badge({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className="admin-ops-state" data-tone={tone}>{children}</span>;
}

const SOURCE_LABELS = {
  ok: 'זמין', empty: 'אין נתונים', forbidden: 'אין הרשאה',
  limited: 'מכסת בקשות', unavailable: 'לא זמין כרגע', disabled: 'כבוי בתצוגה זו',
};
function SourceNote({ status }: { status: keyof typeof SOURCE_LABELS }) {
  return <Badge tone={status === 'ok' ? 'good' : status === 'unavailable' || status === 'forbidden' ? 'bad' : 'neutral'}>{SOURCE_LABELS[status]}</Badge>;
}

function Pending({ loading }: { loading: boolean }) {
  return loading ? <p className="helper" role="status">מרעננים נתוני תפעול…</p> : null;
}

async function readSystem(signal: AbortSignal) {
  const sources = loadSystem(signal);
  const [hosting, firestore, registry] = await Promise.all([sources.hosting, sources.firestore, sources.registry]);
  return { hosting, firestore, registry, checkedAt: Date.now() };
}

const workbench = [
  ...productReports.map(report => [report.label, report.href]),
  ['Firebase Hosting · פריסות', `${TANK_FIREBASE}/hosting/sites`],
  ['Firestore · שימוש במסד', `${TANK_FIREBASE}/firestore/usage`],
  ['Firebase Authentication · חשבונות', `${TANK_FIREBASE}/authentication/users`],
  ['Cloud Functions · שירותים', `${TANK_FIREBASE}/functions`],
  ['Cloud IAM · הרשאות', `${TANK_CLOUD}/iam-admin/iam?project=tank-malle`],
  ['Cloud Logging · לוגים', `${TANK_CLOUD}/logs/query?project=tank-malle`],
  ['Firestore · גיבויים', `${TANK_CLOUD}/firestore/databases?project=tank-malle`],
  ['Google Play Console', 'https://play.google.com/console/'],
];

export function AdminSystem({ revision }: { revision: number }) {
  const { value, loading } = useLoad(readSystem, revision);
  if (!value) return <Skeleton className="h-[210px] rounded-card" />;
  const { hosting, firestore, registry, checkedAt } = value;
  const config = firestore.status === 'ok' ? firestore.value.value : null;
  const failed = config?.lastFailure && config.lastFailure >= (config.lastSuccess ?? 0);
  const delayed = config?.lastSuccess != null && checkedAt - config.lastSuccess > 6 * 3_600_000;
  const release = hosting.status === 'ok' ? hosting.value.value : null;
  return <div className="admin-ops-view" aria-busy={loading}>
    <Pending loading={loading} />
    <AdminPanel title="זמינות שירותים" note="זמן התגובה נמדד מהמכשיר הזה בעת פתיחת המדור או בלחיצה על רענון.">
      <Row title="Firebase Hosting" detail={release ? <>גרסה <bdi>{release.version}</bdi> · קומיט <bdi>{release.commit.slice(0, 8)}</bdi>{release.dirty ? ' · נבנה עם שינויים מקומיים' : ''}</> : 'מטא־נתוני הגרסה בשרת שמגיש את המסך הזה'}
        value={hosting.status === 'ok' ? <Badge tone="good"><Num>{hosting.value.ms}</Num> מ״ש</Badge> : <SourceNote status={hosting.status} />} />
      <Row title="Cloud Firestore" detail={<><bdi>{import.meta.env.VITE_FIREBASE_PROJECT_ID}</bdi> · {config ? 'קריאה ישירה מהשרת' : 'בדיקת קריאה מהשרת'}</>}
        value={firestore.status === 'ok' ? <Badge tone="good"><Num>{firestore.value.ms}</Num> מ״ש</Badge> : <SourceNote status={firestore.status} />} />
      <Row title="מרשם הרכב · data.gov.il" detail="בדיקת ה־API על מאגר הרכב הפרטי"
        value={registry.status === 'ok' ? <Badge tone="good"><Num>{registry.value.ms}</Num> מ״ש</Badge> : <SourceNote status={registry.status} />} />
      <Row title="עדכון מחירי דלק" detail={config?.lastAttempt ? <>ניסיון אחרון {date(config.lastAttempt)} · הצלחה אחרונה {date(config.lastSuccess)}</> : config && !config.hasConfig ? 'מסמך המחירים חסר' : 'ממתין לדיווח ממשימת העדכון'}
        value={failed ? <Badge tone="bad">העדכון נכשל</Badge> : config?.lastSuccess ? <Badge tone={delayed ? 'warn' : 'good'}>{delayed ? 'עדכון מתעכב' : 'עדכון הצליח'}</Badge> : <SourceNote status={firestore.status === 'ok' ? 'empty' : firestore.status} />} />
    </AdminPanel>
    <AdminPanel title="תשתיות וניהול" note="קישורים למסכי הניהול של הספקים. הגישה מצריכה הרשאה בכל שירות.">
      <Row title="האתר החי" value={<Link href={TANK_HOSTING}>פתיחת האתר</Link>} />
      {workbench.map(([title, url]) => <Row key={title} title={title} value={<Link href={url}>פתיחה</Link>} />)}
    </AdminPanel>
  </div>;
}

function MetricBoard({ data }: { data: OperationsSnapshot }) {
  const { calls, reads, writes, deletes, bandwidth } = data.metrics;
  const bytes = bandwidth.days?.at(-1);
  const count = calls.days?.at(-1);
  const total = calls.days?.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const counts = [
    ['בקשות API · 24 שעות', count, calls.status],
    ['בקשות API · 7 ימים', total, calls.status],
    ['קריאות מסמכים · 24 שעות', reads.days?.at(-1), reads.status],
    ['כתיבות מסמכים · 24 שעות', writes.days?.at(-1), writes.status],
    ['מחיקות מסמכים · 24 שעות', deletes.days?.at(-1), deletes.status],
    ['תעבורת Hosting · 24 שעות', bytes == null ? null : bytes / 1_000_000, bandwidth.status],
  ] as const;
  return <div className="admin-tiles">
    {counts.map(([label, value, status]) => <div className="admin-tile" key={label}>
      <Num>{value == null ? '—' : label.startsWith('תעבורת') ? `${num(value, 2)} MB` : num(value, 0)}</Num>
      <span>{label}</span>
      {status !== 'ok' ? <small className="helper">{SOURCE_LABELS[status]}</small> : null}
    </div>)}
  </div>;
}

function DailyCalls({ days, end }: { days: (number | null)[]; end: number }) {
  const max = Math.max(1, ...days.map(value => value ?? 0));
  return <ul className="admin-ops-history" aria-label="מספר קריאות לפי יממה">
    {days.map((value, index) => {
      const label = dayFormat.format(end - (days.length - 1 - index) * DAY);
      return <li key={index}>
        <Num>{label}</Num>
        <span className="admin-ops-bar" aria-hidden="true"><span style={{ width: `${(value ?? 0) / max * 100}%` }} /></span>
        <Num>{value == null ? '—' : num(value, 0)}</Num>
      </li>;
    })}
  </ul>;
}

function ApiBreakdown({ data }: { data: OperationsSnapshot['metrics']['calls'] }) {
  const [term, setTerm] = useState('');
  const [errors, setErrors] = useState(false);
  const [limit, setLimit] = useState(12);
  const query = term.trim().toLowerCase();
  const rows = (data.calls ?? []).filter(row => (!errors || /^[45]/.test(row.code)) &&
    `${row.service} ${row.method} ${row.code}`.toLowerCase().includes(query));
  return <AdminPanel title="קריאות לפי פעולה" bare
    note={`שבע יממות · מוצגות ${num(data.calls?.length ?? 0, 0)} שורות מתוך ${num(data.breakdownSize ?? 0, 0)} שילובי שירות, פעולה וקוד תשובה`}>
    <label className="admin-search"><input type="search" placeholder="חיפוש לפי שירות, פעולה או קוד" aria-label="חיפוש קריאות API" value={term} onChange={event => { setTerm(event.target.value); setLimit(12); }} /></label>
    <label className="admin-ops-check"><input type="checkbox" checked={errors} onChange={event => { setErrors(event.target.checked); setLimit(12); }} /> רק תשובות 4xx ו־5xx</label>
    <div className="admin-group">
      {rows.slice(0, limit).map(({ service, method, code, count }) => <Row key={JSON.stringify([service, method, code])}
        title={<bdi>{method}</bdi>} detail={<bdi>{service}</bdi>}
        value={<><Badge tone={/^[45]/.test(code) ? 'bad' : 'neutral'}><bdi>{code}</bdi></Badge> <Num>{num(count, 0)}</Num></>} />)}
    </div>
    {!rows.length ? <p className="admin-empty">אין קריאות שתואמות לסינון.</p> : null}
    {rows.length > limit ? <button type="button" className="tm-text-action" onClick={() => setLimit(limit + 12)}>הצגת פעולות נוספות</button> : null}
  </AdminPanel>;
}

function SnapshotMessage({ result }: { result: Exclude<Source<OperationsSnapshot>, { status: 'ok' }> }) {
  if (result.status === 'empty') return <p className="admin-empty">עדיין לא פורסמה תמונת מדדים ממשימת התפעול.</p>;
  if (result.status === 'forbidden') return <p className="admin-empty">אין הרשאה לקרוא את תמונת המדדים. בדקו את כללי Firestore ואת הרשאת האדמין.</p>;
  return <p className="admin-empty">קריאת תמונת המדדים מהשרת נכשלה.</p>;
}

async function readOperations(signal: AbortSignal) {
  const result = await loadOperations(signal);
  return { result, checkedAt: Date.now() };
}

function JourneyRows({ labels, report }: { labels: Record<string, string>; report: JourneySnapshot['funnel'] }) {
  if (report.status !== 'ok') return <SourceNote status={report.status} />;
  return <>
    {Object.entries(labels).map(([name, label]) => <Row key={name} title={label}
      value={<Num>{report.counts?.[name] == null ? '—' : num(report.counts[name], 0)}</Num>} />)}
    {report.limited && <p className="helper">Google החילה דגימה או סף דיווח על התוצאות.</p>}
  </>;
}

async function readJourney(signal: AbortSignal) {
  return { result: await loadJourney(signal), checkedAt: Date.now() };
}

export function AdminJourney({ revision }: { revision: number }) {
  const { value, loading } = useLoad(readJourney, revision);
  const result = value?.result;
  const data = result?.status === 'ok' ? result.value : null;
  return <AdminPanel title="מהכניסה לפעולה הראשונה" note="שבעת הימים המלאים האחרונים לפי GA4 · מכשירים שהפעילו מדידה">
    {data ? <>
      <p className="helper">עודכן {date(data.collectedAt)} {value && value.checkedAt - data.collectedAt > 12 * 3600000 && <Badge tone="warn">הנתונים ישנים</Badge>}</p>
      <h3>משתמשים שהגיעו לכל שלב לפי הסדר</h3>
      <JourneyRows labels={journey.steps} report={data.funnel} />
      <h3>שמירה וסנכרון בכל המסלולים הנמדדים</h3>
      <p className="helper">כל רשומת יומן נספרת כשהיא נשמרת במכשיר וכשהשרת מאשר אותה. בייבוא נספרת כל רשומה בנפרד. האישור עשוי להגיע ביום אחר.</p>
      <JourneyRows labels={journey.writes} report={data.operations} />
    </> : loading ? <Pending loading /> : <SourceNote status={result?.status === 'ok' ? 'unavailable' : result?.status ?? 'unavailable'} />}
  </AdminPanel>;
}

export function AdminApi({ revision }: { revision: number }) {
  const { value, loading } = useLoad(readOperations, revision);
  if (!value) return <Skeleton className="h-[210px] rounded-card" />;
  const { result, checkedAt } = value;
  const data = result.status === 'ok' ? result.value : null;
  const stale = data && checkedAt - data.collectedAt > 12 * 3_600_000;
  const calls = data?.metrics.calls;
  return <div className="admin-ops-view" aria-busy={loading}>
    <Pending loading={loading} />
    <AdminPanel title="קריאות API ותעבורה" bare note="מדדים מצטברים של טנק מלא מ־Google Cloud Monitoring. זמני התצוגה לפי שעון ישראל.">
      {data ? <>
        <p className="helper">עודכן {date(data.collectedAt)} · סוף חלון המדידה {date(data.end)} {stale ? <Badge tone="warn">הנתונים ישנים</Badge> : null}</p>
        <MetricBoard data={data} />
      </> : result.status !== 'ok' ? <SnapshotMessage result={result} /> : null}
    </AdminPanel>
    {data && calls?.days ? <AdminPanel title="בקשות ב־7 היממות האחרונות" note="כל תאריך מציין את סוף חלון המדידה. מקף מציין יממה ללא דגימה.">
      <DailyCalls days={calls.days} end={data.end} />
    </AdminPanel> : null}
    {calls?.codes?.length ? <AdminPanel title="קודי תשובה" note="סך הבקשות ב־7 יממות לפי קוד HTTP או המקבילה של gRPC.">
      {[...calls.codes].sort((a, b) => a.code.localeCompare(b.code)).map(({ code, count }) => <Row key={code}
        title={<bdi>{code}</bdi>} value={<Num>{num(count, 0)}</Num>} />)}
    </AdminPanel> : null}
    {calls?.calls ? <ApiBreakdown data={calls} /> : null}
    <AdminPanel title="מקורות המדידה" note="הספירה מכסה את ממשקי Google שנמדדים בפרויקט. קריאות דפדפן ישירות ל־data.gov.il, ‏gov.il ו־Jina אינן נספרות כאן.">
      <Row title="Cloud Monitoring" detail="מדדים, גרפים ותקופות נוספות" value={<Link href={`${TANK_CLOUD}/monitoring/metrics-explorer?project=tank-malle`}>פתיחה</Link>} />
      <Row title="יומן ענן" detail="לוגים הזמינים בהרשאת Google Cloud" value={<Link href={`${TANK_CLOUD}/logs/query?project=tank-malle`}>פתיחה</Link>} />
    </AdminPanel>
  </div>;
}

async function readGithub(signal: AbortSignal) {
  const sources = loadGithub(signal);
  const [main, runs, scheduled, issues] = await Promise.all([sources.main, sources.runs, sources.scheduled, sources.issues]);
  return { main, runs, scheduled, issues, checkedAt: Date.now() };
}

function RunStatus({ run }: { run: GithubRun }) {
  if (run.conclusion === 'success') return <Badge tone="good">הצלחה</Badge>;
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') return <Badge tone="bad">נכשלה</Badge>;
  if (run.conclusion === 'cancelled') return <Badge tone="warn">בוטלה</Badge>;
  if (run.status === 'in_progress') return <Badge tone="warn">רצה</Badge>;
  if (run.status !== 'completed') return <Badge>ממתינה</Badge>;
  return <Badge><bdi>{run.conclusion ?? run.status}</bdi></Badge>;
}

function RunLink({ run }: { run: GithubRun }) {
  return <Link href={`${TANK_GITHUB}/actions/runs/${run.id}`}>פרטים</Link>;
}

export function AdminGithub({ revision }: { revision: number }) {
  const { value, loading } = useLoad(readGithub, revision);
  if (!value) return <Skeleton className="h-[210px] rounded-card" />;
  const { main, runs, scheduled, issues, checkedAt } = value;
  return <div className="admin-ops-view" aria-busy={loading}>
    <Pending loading={loading} />
    <AdminPanel title="GitHub" note={`המאגר הציבורי MeniViner/tank-malle · בדיקה אחרונה ${date(checkedAt)}`}>
      <Row title={<bdi>main</bdi>} detail={main.status === 'ok' ? <><bdi>{main.value.sha.slice(0, 8)}</bdi> · <bdi>{main.value.message}</bdi><br />{date(main.value.date)}</> : 'הקומיט האחרון בענף הראשי'}
        value={main.status === 'ok' ? <Link href={`${TANK_GITHUB}/commit/${main.value.sha}`}>קומיט</Link> : <SourceNote status={main.status} />} />
      <Row title="מאגר הקוד" value={<Link href={TANK_GITHUB}>פתיחה</Link>} />
    </AdminPanel>
    <AdminPanel title="משימות מתוזמנות" note="הריצה האחרונה של כל משימה מתוך 30 הריצות המתוזמנות האחרונות ב־main.">
      {JOBS.map(job => {
        const run = scheduled.status === 'ok' ? scheduled.value.find(item => item.path === `.github/workflows/${job.file}`) : undefined;
        return <Row key={job.file} title={job.title} detail={run ? <>{job.cadence} · {date(run.run_started_at || run.updated_at)}</> : job.cadence}
          value={run ? <><RunStatus run={run} /><RunLink run={run} /></> : <SourceNote status={scheduled.status === 'ok' ? 'empty' : scheduled.status} />} />;
      })}
    </AdminPanel>
    <AdminPanel title="ריצות אחרונות" trailing={<Link href={`${TANK_GITHUB}/actions`}>כל הריצות</Link>}>
      {runs.status === 'ok' && runs.value.length ? runs.value.map(run => <Row key={run.id} title={<bdi>{run.name}</bdi>}
        detail={<><bdi>{run.head_branch} · {run.head_sha?.slice(0, 8)}</bdi> · {date(run.run_started_at || run.updated_at)}</>}
        value={<><RunStatus run={run} /><RunLink run={run} /></>} />) : <Row title="GitHub Actions" value={<SourceNote status={runs.status === 'ok' ? 'empty' : runs.status} />} />}
    </AdminPanel>
    <AdminPanel title="קריאות ו־PR פתוחים" note="עד 20 פריטים לפי עדכון אחרון.">
      {issues.status === 'ok' && issues.value.length ? issues.value.map(issue => <Row key={issue.number} title={<bdi>{issue.title}</bdi>}
        detail={<><bdi>#{issue.number}</bdi> · {issue.pull_request ? 'בקשת מיזוג' : 'קריאה'} · {date(issue.updated_at)}</>}
        value={<Link href={`${TANK_GITHUB}/${issue.pull_request ? 'pull' : 'issues'}/${issue.number}`}>פתיחה</Link>} />)
        : <Row title="קריאות ובקשות מיזוג" value={<SourceNote status={issues.status === 'ok' ? 'empty' : issues.status} />} />}
    </AdminPanel>
  </div>;
}
