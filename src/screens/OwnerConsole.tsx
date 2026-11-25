import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import {
  ArchiveIcon, BellIcon, CalendarIcon, ChartIcon, CheckIcon, CloudIcon, CoinIcon, DocumentIcon,
  GaugeIcon, GoogleMark, HomeIcon, ListIcon, LogoutIcon, MessageIcon, RefreshIcon, ShieldIcon,
  SlidersIcon, TabPumpIcon, ToolsIcon, UploadIcon, UsersIcon, WifiIcon,
} from '../components/icons';
import {
  JOBS, productReports, loadGithub, loadOperations, loadSystem, TANK_CLOUD, TANK_FIREBASE, TANK_GITHUB, TANK_HOSTING,
  type GithubRun, type OperationsSnapshot,
} from '../lib/adminOperations';
import { getConsoleAccess, getConsoleTelemetry, getDeliveryReport, type ConsoleProbe, type ConsoleTelemetry } from '../lib/ownerConsole';
import { num } from '../lib/format';
import { Admin, type AdminSection } from './Admin';
import '../owner-console.css';

const groups = [
  { name: 'מצב', links: [
    { id: 'overview', label: 'מצב כללי', icon: HomeIcon, intro: 'סטטוס התשתית ופעילות אחרונה במקום אחד' },
    { id: 'monitor', label: 'ניטור שירותים', icon: WifiIcon, intro: 'בדיקות זמינות מדוגמות מהשרת וקריאות בזמן אמת' },
    { id: 'speed', label: 'מהירות', icon: GaugeIcon, intro: 'זמני תגובה של השירותים וביצועי Firestore' },
  ] },
  { name: 'טנק מלא במספרים', links: [
    { id: 'stats', label: 'סטטיסטיקות', icon: ChartIcon, intro: 'חשבונות, רכבים, רשומות יומן וצריכת דלק' },
    { id: 'api', label: 'קריאות API ותעבורה', icon: ListIcon, intro: 'קריאות לשירותי Google, קודי תשובה ותעבורת האתר' },
    { id: 'costs', label: 'הוצאות רכב', icon: CoinIcon, intro: 'סיכומי הוצאות חודשיים שפורסמו באפליקציה' },
  ] },
  { name: 'נתונים', links: [
    { id: 'inventory', label: 'דפדוף בנתונים', icon: DocumentIcon, intro: 'אוספי המערכת ומספר הרשומות בכל אוסף' },
    { id: 'users', label: 'אנשים והרשאות', icon: UsersIcon, intro: 'חיפוש חשבונות ועיון בפרופילים ובסיכומים שפורסמו' },
    { id: 'data', label: 'מחירי דלק ותחנות', icon: TabPumpIcon, intro: 'מחירים מפוקחים, מקורות ותקינות קטלוג התחנות' },
    { id: 'scan', label: 'דיוק סריקות', icon: GaugeIcon, intro: 'דגימות קלט, תוצאות סריקה ושיפורים' },
    { id: 'feedback', label: 'משוב משתמשים', icon: MessageIcon, intro: 'הודעות מהאפליקציה ומעקב אחר הטיפול' },
    { id: 'import', label: 'ייבוא וייצוא', icon: UploadIcon, intro: 'כלי העברת הנתונים לחשבון באפליקציה' },
    { id: 'backups', label: 'גיבויים', icon: ArchiveIcon, intro: 'גיבויים מנוהלים בפרויקט וכלי השחזור של Firebase' },
  ] },
  { name: 'שליחה ותזמון', links: [
    { id: 'delivery', label: 'התראות ושליחה', icon: BellIcon, intro: 'מצב השליחה המתוזמנת ומעקב אחר ריצות' },
    { id: 'jobs', label: 'משימות מתוזמנות', icon: CalendarIcon, intro: 'מועד ותוצאה של ריצות תחזוקה ברקע' },
    { id: 'github', label: 'GitHub ופריסות', icon: CloudIcon, intro: 'קוד, משימות CI, בקשות מיזוג וקריאות פתוחות' },
  ] },
  { name: 'גישה ואבטחה', links: [
    { id: 'services', label: 'שירותים והגדרות', icon: SlidersIcon, intro: 'מערכות ותלויות שמשרתות את האפליקציה' },
    { id: 'keys', label: 'גישה ל־API', icon: ShieldIcon, intro: 'זהויות והרשאות של הספקים המחוברים' },
    { id: 'actions', label: 'בדיקות תפעול', icon: ToolsIcon, intro: 'בדיקות קריאה ופתיחת כלי הספקים' },
    { id: 'security', label: 'אבטחה ויומנים', icon: ShieldIcon, intro: 'אימות הבעלים, כללי גישה ועיון ביומני ענן' },
  ] },
] as const;

type Tab = typeof groups[number]['links'][number]['id'];
const tabs = groups.flatMap(group => group.links.map(link => ({ ...link, group: group.name })));
const product: Partial<Record<Tab, AdminSection>> = {
  stats: 'overview', costs: 'costs', users: 'users', data: 'data', scan: 'scan', feedback: 'feedback', api: 'api', github: 'github',
};
const timeFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
const date = (value: number | string | null | undefined) => {
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return typeof time === 'number' && Number.isFinite(time) ? timeFormat.format(time) : '—';
};
const numeric = (n: number | null | undefined) => n == null ? '—' : num(n, 0);
const ms = (n: number | null | undefined) => n == null ? '—' : `${num(n, 0)} מ״ש`;
const HOUR = 3_600_000;

function Brand() {
  return <span className="oc-brand"><span className="oc-logo"><TabPumpIcon size={23} /></span><span><strong>טנק מלא</strong><small>קונסולת הבעלים</small></span></span>;
}

function Entry({ children }: { children: ReactNode }) {
  return <main dir="rtl" className="oc-entry"><section className="oc-entry-card"><Brand />{children}<Link to="/">לאפליקציית טנק מלא</Link></section></main>;
}

export function OwnerConsole() {
  const { user, claimsLoaded, isAdmin, signIn, signOutUser, signingIn, error } = useAuth();
  const [access, setAccess] = useState<'allowed' | 'blocked' | 'unavailable'>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user || !claimsLoaded || !isAdmin) return;
    let active = true;
    void getConsoleAccess(user.uid).then(
      allowed => { if (active) setAccess(allowed ? 'allowed' : 'blocked'); },
      (cause: { code?: string }) => {
        if (active) setAccess(cause.code === 'permission-denied' ? 'blocked' : 'unavailable');
      },
    );
    return () => { active = false; };
  }, [user, claimsLoaded, isAdmin, attempt]);

  if (!user) return <Entry>
    <h1>כניסה לקונסולת הבעלים</h1><p>הכניסה מיועדת לחשבון Google של בעל המערכת.</p>
    <Button full loading={signingIn} onClick={() => void signIn()}><GoogleMark /> כניסה עם Google</Button>
    {error ? <p role="alert">{error}</p> : null}
  </Entry>;
  if (!claimsLoaded || (isAdmin && !access)) return <Entry><h1>בודקים הרשאה</h1><p role="status">מאמתים את חשבון הבעלים מול השרת…</p></Entry>;
  if (!isAdmin || access !== 'allowed') return <Entry>
    <h1>{access === 'unavailable' ? 'בדיקת ההרשאה נכשלה' : 'הגישה שמורה לבעלים'}</h1>
    <p>{access === 'unavailable' ? 'אפשר לנסות שוב כשהחיבור חוזר.' : 'כדי לפתוח את הקונסולה יש להיכנס עם חשבון Google של מני וינר.'}</p>
    {access === 'unavailable' ? <Button full onClick={() => { setAccess(undefined); setAttempt(n => n + 1); }}>ניסיון נוסף</Button> : null}
    <Button full variant="secondary" onClick={() => void signOutUser()}>יציאה להחלפת חשבון</Button>
  </Entry>;
  return <Console operator={user.displayName || 'מני וינר'} onSignOut={() => void signOutUser()} />;
}

function Console({ operator, onSignOut }: { operator: string; onSignOut: () => void }) {
  const [params] = useSearchParams();
  const requested = params.get('tab') === 'system' ? 'monitor' : params.get('tab');
  const tab = tabs.find(item => item.id === requested) ?? tabs[0];
  const section = product[tab.id];
  const [revision, setRevision] = useState(0);
  const href = (id: Tab) => id === 'overview' ? '/admin' : `/admin?tab=${id}`;

  return <div className="oc-layout" dir="rtl">
    <aside className="oc-side">
      <Link to="/admin" className="oc-brand-link"><Brand /></Link>
      <nav className="oc-nav" aria-label="מדורי הקונסולה">
        {groups.map(group => <div key={group.name} className="oc-nav-group">
          <span>{group.name}</span>
          {group.links.map(({ id, label, icon: Icon }) => <Link key={id} to={href(id)} aria-current={id === tab.id ? 'page' : undefined}>
            <Icon size={17} />{label}
          </Link>)}
        </div>)}
      </nav>
      <footer className="oc-side-footer">
        <Link to="/">לאפליקציה</Link>
        <div><span className="oc-avatar"><ShieldIcon size={17} /></span><span><strong>{operator}</strong><small>בעלים מאומת</small></span><button type="button" aria-label="יציאה מחשבון הבעלים" onClick={onSignOut}><LogoutIcon size={18} /></button></div>
      </footer>
    </aside>
    <main className="oc-main">
      <header className="oc-header">
        <div><span className="oc-crumb">{tab.group}</span><h1>{tab.label}</h1><p>{tab.intro}</p></div>
        <button type="button" className="oc-button" onClick={() => setRevision(n => n + 1)}><RefreshIcon size={16} /> רענון</button>
      </header>
      <div key={tab.id} className={`oc-content oc-content--${tab.id}`}>
        {section ? <Admin key={revision} section={section} /> : <ConsoleView tab={tab.id} revision={revision} />}
      </div>
    </main>
  </div>;
}

function Panel({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return <section className="oc-panel"><header><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</header>{children}</section>;
}
function External({ href, children }: { href: string; children: ReactNode }) {
  return <a className="oc-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
}
function Rows({ rows }: { rows: { label: string; detail?: ReactNode; value?: ReactNode }[] }) {
  return <dl className="oc-rows">{rows.map(({ label, detail, value }) => <div key={label}><dt>{label}{detail ? <small>{detail}</small> : null}</dt><dd>{value ?? '—'}</dd></div>)}</dl>;
}
function State({ tone, children }: { tone: 'ok' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className="oc-state" data-tone={tone}><i />{children}</span>;
}
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return <div><bdi>{value}</bdi><span>{label}</span></div>;
}

const destinations = {
  hosting: `${TANK_FIREBASE}/hosting/sites`,
  firestore: `${TANK_FIREBASE}/firestore/usage`,
  auth: `${TANK_FIREBASE}/authentication/users`,
  backups: `${TANK_CLOUD}/firestore/databases?project=tank-malle`,
  iam: `${TANK_CLOUD}/iam-admin/iam?project=tank-malle`,
  credentials: `${TANK_CLOUD}/apis/credentials?project=tank-malle`,
  logs: `${TANK_CLOUD}/logs/query?project=tank-malle`,
  metrics: `${TANK_CLOUD}/monitoring/metrics-explorer?project=tank-malle`,
  rules: `${TANK_FIREBASE}/firestore/rules`,
  health: 'https://status.firebase.google.com/',
};

const collectionNames: Record<string, [string, Tab]> = {
  users: ['פרופילים', 'users'],
  userSummaries: ['סיכומי רכב שפורסמו', 'stats'],
  feedback: ['משוב', 'feedback'],
  scanSamples: ['דגימות סריקה', 'scan'],
  benchmarks: ['השוואות צריכה', 'stats'],
  costBenchmarks: ['השוואות עלויות', 'costs'],
  stationPriceAggregates: ['מחירי תחנות קהילתיים', 'data'],
  appConfig: ['תצורת אפליקציה', 'services'],
};

type LiveChecks = Awaited<ReturnType<typeof readChecks>>;
async function readChecks(signal: AbortSignal) {
  const sources = loadSystem(signal);
  const [hosting, firestore, registry] = await Promise.all([sources.hosting, sources.firestore, sources.registry]);
  return { hosting, firestore, registry };
}

function useDiagnostics(revision: number, needsChecks: boolean, needsInventory: boolean, needsMetrics: boolean) {
  const [checks, setChecks] = useState<LiveChecks>();
  const [telemetry, setTelemetry] = useState<ConsoleTelemetry | null>();
  const [operations, setOperations] = useState<OperationsSnapshot | null>();
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted;
    if (needsChecks) void readChecks(controller.signal).then(value => { if (current()) setChecks(value); });
    if (needsInventory) void getConsoleTelemetry().catch(() => null).then(value => { if (current()) setTelemetry(value); });
    if (needsMetrics) void loadOperations(controller.signal).then(value => { if (current()) setOperations(value.status === 'ok' ? value.value : null); });
    return () => controller.abort();
  }, [revision, needsChecks, needsInventory, needsMetrics]);
  return { checks, telemetry, operations };
}

function LiveRows({ checks }: { checks: LiveChecks | undefined }) {
  const status = (source: LiveChecks[keyof LiveChecks] | undefined) => !source ? <State tone="neutral">בודק</State>
    : source.status === 'ok' ? <State tone="ok">{ms(source.value.ms)}</State>
    : <State tone="bad">הבדיקה לא עברה</State>;
  const hosting = checks?.hosting;
  const config = checks?.firestore.status === 'ok' ? checks.firestore.value.value : null;
  const fails = config?.lastFailure && config.lastFailure >= (config.lastSuccess ?? 0);
  return <Rows rows={[
    { label: 'Firebase Hosting', detail: hosting?.status === 'ok' ? <>גרסה <bdi>{hosting.value.value.version}</bdi> · <bdi>{hosting.value.value.commit.slice(0, 8)}</bdi></> : 'הגרסה שמוגשת לאתר', value: status(hosting) },
    { label: 'Cloud Firestore', detail: 'קריאת תצורת המחירים מהשרת', value: status(checks?.firestore) },
    { label: 'מרשם הרכב · data.gov.il', detail: 'בדיקה ללא מספר רישוי', value: status(checks?.registry) },
    { label: 'משימת מחירי דלק', detail: `הצלחה אחרונה · ${date(config?.lastSuccess)}`, value: fails ? <State tone="bad">נכשלה</State> : config?.lastSuccess ? <State tone="ok">הצליחה</State> : <State tone="neutral">אין דיווח</State> },
  ]} />;
}

function Health({ telemetry, checks, operations }: ReturnType<typeof useDiagnostics>) {
  const now = telemetry?.checkedAt ?? 0;
  const recent = (telemetry?.probes ?? []).filter(probe => probe.at >= now - 24 * HOUR);
  const passed = recent.filter(probe => probe.hostingMs !== null).length;
  const main = checks?.hosting;
  const core = checks && [checks.hosting, checks.firestore];
  const ok = core?.every(source => source.status === 'ok');
  const callCount = operations?.metrics.calls.days?.at(-1);
  return <>
    <section className="oc-health" data-health={core ? (ok ? 'ok' : 'bad') : 'pending'}>
      <div className="oc-health-title"><span>{ok ? <CheckIcon size={24} /> : <WifiIcon size={24} />}</span><div><h2>{core ? (ok ? 'השירותים המרכזיים זמינים' : 'נדרשת בדיקה') : 'בודקים זמינות'}</h2><p>{main?.status === 'ok' ? <>גרסה <bdi>{main.value.value.version}</bdi> · <bdi>{main.value.value.commit.slice(0, 8)}</bdi></> : 'Firebase Hosting ו־Firestore'}</p></div></div>
      <div className="oc-uptime">
        <span>בדיקות Hosting · 24 שעות לפני האיסוף האחרון</span>
        <div aria-label={recent.length ? `${passed} מתוך ${recent.length} בדיקות עברו` : 'אין דגימות זמינות'} role="img">
          {recent.length ? recent.map(probe => <i key={probe.at} data-result={probe.hostingMs !== null ? 'ok' : 'bad'} title={`${date(probe.at)} · ${ms(probe.hostingMs)}`} />) : <i data-result="empty" />}
        </div>
        <small>{recent.length ? `${passed} מתוך ${recent.length} בדיקות עברו` : 'ממתין לדגימה ראשונה'} · {date(now || null)}</small>
      </div>
      <div className="oc-figures"><Figure label="בקשות API ביממה" value={numeric(callCount)} /><Figure label="Hosting · זמן תגובה" value={main?.status === 'ok' ? ms(main.value.ms) : '—'} /></div>
    </section>
    <div className="oc-overview">
      <Panel title="בדיקת השירותים" meta={<Link className="oc-link" to="/admin?tab=monitor">לניטור מלא</Link>}><LiveRows checks={checks} /></Panel>
      <Panel title="תמונת שימוש" meta={telemetry?.checkedAt ? date(telemetry.checkedAt) : undefined}><div className="oc-figures oc-figures--wide">
        <Figure label="פרופילים" value={numeric(telemetry?.inventory.users)} /><Figure label="סיכומים שפורסמו" value={numeric(telemetry?.inventory.userSummaries)} />
        <Figure label="קריאות מסמכים ביממה" value={numeric(operations?.metrics.reads.days?.at(-1))} /><Figure label="כתיבות מסמכים ביממה" value={numeric(operations?.metrics.writes.days?.at(-1))} />
      </div></Panel>
      <Panel title="בדיקות שרת אחרונות" meta={<Link className="oc-link" to="/admin?tab=monitor">היסטוריה</Link>}><ProbeTable probes={telemetry?.probes.slice(-6)} /></Panel>
      <Panel title="תפעול שוטף"><Rows rows={[
        { label: 'גרסאות וקוד', value: <Link className="oc-link" to="/admin?tab=github">GitHub ופריסות</Link> },
        { label: 'ריצות רקע', value: <Link className="oc-link" to="/admin?tab=jobs">משימות מתוזמנות</Link> },
        { label: 'שימוש ב־Firestore', value: <External href={destinations.firestore}>פתיחה</External> },
        { label: 'לוגים', value: <External href={destinations.logs}>Cloud Logging</External> },
      ]} /></Panel>
    </div>
  </>;
}

function ProbeTable({ probes, showVersion = false }: { probes: ConsoleProbe[] | undefined; showVersion?: boolean }) {
  if (!probes?.length) return <p className="oc-empty">אין עדיין דגימות מהמשימה המתוזמנת.</p>;
  return <table className="oc-table"><thead><tr><th scope="col">מתי</th><th scope="col">Hosting</th><th scope="col">Firestore</th><th scope="col">מרשם רכב</th>{showVersion ? <th scope="col">גרסה</th> : null}</tr></thead>
    <tbody>{[...probes].reverse().map(probe => <tr key={probe.at}><td>{date(probe.at)}</td>{([probe.hostingMs, probe.firestoreMs, probe.registryMs]).map((value, i) =>
      <td key={i}><State tone={value === null ? 'bad' : 'ok'}>{value === null ? 'הבדיקה נכשלה' : ms(value)}</State></td>)}{showVersion ? <td><bdi>{probe.version ?? '—'}</bdi></td> : null}</tr>)}</tbody></table>;
}

function Latency({ telemetry }: { telemetry: ConsoleTelemetry | null | undefined }) {
  const data = telemetry?.latency;
  if (!data) return <p className="oc-empty">אין דגימות זמינות לחישוב האחוזונים.</p>;
  const max = Math.max(1, ...data.p95.map(value => value ?? 0));
  return <><p className="oc-note">החציון (P50) והאחוזון ה־95 (P95) של בקשות Firestore, בחלונות של 24 שעות.</p>
    <table className="oc-table oc-latency"><thead><tr><th scope="col">סוף החלון</th><th scope="col">P50</th><th scope="col">P95</th><th scope="col">זמן תגובה</th></tr></thead>
      <tbody>{data.p95.map((value, index) => <tr key={index}><td>{date(data.end - (6 - index) * 24 * HOUR)}</td><td>{ms(data.p50[index])}</td><td>{ms(value)}</td>
        <td><span className="oc-meter" aria-hidden="true"><i style={{ width: `${(value ?? 0) / max * 100}%` }} /></span></td></tr>)}</tbody></table>
  </>;
}

function DeliverySummary({ revision }: { revision: number }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof getDeliveryReport>>>();
  useEffect(() => {
    let current = true;
    void getDeliveryReport().then(value => { if (current) setReport(value); }, () => { if (current) setReport(null); });
    return () => { current = false; };
  }, [revision]);
  return <Panel title="תוצאות מסירה" meta={date(report?.checkedAt)}>
    <div className="oc-figures oc-figures--wide">
      <Figure label="מכשירים שנבדקו" value={numeric(report?.devices)} />
      <Figure label="הודעות התקבלו אצל ספק השליחה" value={numeric(report?.messages)} />
      <Figure label="ניסיונות שליחה שנכשלו" value={numeric(report?.failed)} />
      <Figure label="כתובות לא תקפות שהוסרו" value={numeric(report?.removed)} />
    </div>
  </Panel>;
}

function Jobs({ revision, onlyPush }: { revision: number; onlyPush: boolean }) {
  const [runs, setRuns] = useState<GithubRun[] | null>();
  useEffect(() => {
    const controller = new AbortController();
    void loadGithub(controller.signal).scheduled.then(result => {
      if (!controller.signal.aborted) setRuns(result.status === 'ok' ? result.value : null);
    });
    return () => controller.abort();
  }, [revision]);
  const jobs = onlyPush ? JOBS.filter(job => job.file === 'push-notifications.yml') : JOBS;
  return <Panel title={onlyPush ? 'ריצת השליחה האחרונה' : 'תזמון וריצות אחרונות'} meta={<External href={`${TANK_GITHUB}/actions`}>כל הריצות</External>}>
    <table className="oc-table"><thead><tr><th scope="col">משימה</th><th scope="col">תזמון</th><th scope="col">ריצה אחרונה</th><th scope="col">תוצאה</th><th scope="col">פרטים</th></tr></thead>
      <tbody>{jobs.map(job => {
        const run = runs?.find(row => row.path === `.github/workflows/${job.file}`);
        return <tr key={job.file}><td>{job.title}</td><td>{job.cadence}</td><td>{date(run?.run_started_at)}</td>
          <td>{run ? <State tone={run.conclusion === 'success' ? 'ok' : run.conclusion === 'failure' ? 'bad' : 'neutral'}>{run.conclusion === 'success' ? 'הצלחה' : run.conclusion === 'failure' ? 'נכשלה' : run.conclusion ?? 'בתהליך'}</State> : runs === undefined ? 'טוענים…' : runs === null ? 'GitHub לא זמין' : 'אין ריצה'}</td>
          <td><External href={`${TANK_GITHUB}/actions/${run ? `runs/${run.id}` : `workflows/${job.file}`}`}>פרטים</External></td></tr>;
      })}</tbody></table>
  </Panel>;
}

function ConsoleView({ tab, revision }: { tab: Tab; revision: number }) {
  const diagnostics = useDiagnostics(revision, ['overview', 'monitor', 'speed', 'actions'].includes(tab),
    ['overview', 'monitor', 'speed', 'inventory', 'backups'].includes(tab), tab === 'overview');
  const { telemetry, checks } = diagnostics;
  switch (tab) {
    case 'overview': return <Health {...diagnostics} />;
    case 'monitor': return <>
      <Panel title="שימוש ובריאות האפליקציה"><Rows rows={productReports.map(({ label, detail, href }) =>
        ({ label, detail, value: <External href={href}>פתיחת הדוח</External> }))} /></Panel>
      <Panel title="בדיקה מהמכשיר הזה" meta={<External href={destinations.health}>סטטוס Firebase</External>}><LiveRows checks={checks} /></Panel>
      <Panel title="היסטוריית בדיקות מהשרת" meta="בדיקה כל 6 שעות"><ProbeTable probes={telemetry?.probes} showVersion /></Panel>
    </>;
    case 'speed': return <>
      <Panel title="זמני תגובה עכשיו"><LiveRows checks={checks} /></Panel>
      <Panel title="זמני תגובה של Firestore" meta={<External href={destinations.metrics}>Cloud Monitoring</External>}><Latency telemetry={telemetry} /></Panel>
    </>;
    case 'inventory': return <Panel title="אוספי האפליקציה" meta={date(telemetry?.checkedAt)}>
      <table className="oc-table"><thead><tr><th scope="col">אוסף</th><th scope="col">שם טכני</th><th scope="col">רשומות</th><th scope="col">פתיחה</th></tr></thead>
        <tbody>{Object.entries(collectionNames).map(([key, [title, section]]) => <tr key={key}><td>{title}</td><td><bdi>{key}</bdi></td><td>{numeric(telemetry?.inventory[key])}</td><td><Link className="oc-link" to={`/admin?tab=${section}`}>למדור</Link></td></tr>)}</tbody></table>
      <p className="oc-note">יומני רכב, קבלות ורשומות אישיות מפורטות זמינים רק לבעלי החשבונות.</p>
    </Panel>;
    case 'import': return <Panel title="קבצים ונתוני חשבון"><Rows rows={[
      { label: 'ייבוא תדלוקים', detail: 'ייבוא קובץ באמצעות האשף הקיים באפליקציה', value: <Link className="oc-link" to="/settings/import">לאשף הייבוא</Link> },
      { label: 'ייצוא נתוני חשבון', detail: 'הורדת נתוני החשבון ממסך ההגדרות', value: <Link className="oc-link" to="/account">להגדרות החשבון</Link> },
    ]} /></Panel>;
    case 'backups': return <Panel title="גיבויי Firestore מנוהלים" meta={<External href={destinations.backups}>ניהול ב־Google Cloud</External>}>
      {telemetry?.backups?.length ? <table className="oc-table"><thead><tr><th scope="col">נקודת גיבוי</th><th scope="col">תפוגה</th><th scope="col">מצב</th></tr></thead>
        <tbody>{telemetry.backups.map(item => <tr key={item.at}><td>{date(item.at)}</td><td>{date(item.expiresAt)}</td><td><bdi>{item.state}</bdi></td></tr>)}</tbody></table>
        : <p className="oc-empty">{telemetry?.backups ? 'הפרויקט אינו מדווח על גיבויים מנוהלים.' : 'פרטי הגיבויים אינם זמינים בקונסולה.'}</p>}
    </Panel>;
    case 'delivery': return <>
      <Jobs revision={revision} onlyPush />
      <DeliverySummary revision={revision} />
      <Panel title="ערוצי התראות"><Rows rows={[
        { label: 'Android · Firebase Cloud Messaging', detail: 'הודעות מערכת למכשירים שנרשמו באפליקציית Android' },
        { label: 'Web Push', detail: 'מועדי טסט, ביטוח וטיפולים נשלחים לדפדפנים רשומים דרך משימת השליחה', value: <Link className="oc-link" to="/notifications">להתראות באפליקציה</Link> },
        { label: 'הגדרות במכשיר', detail: 'הסכמה לקבלת התראות והעדפות תזכורות', value: <Link className="oc-link" to="/account">להגדרות חשבון</Link> },
      ]} /></Panel>
    </>;
    case 'jobs': return <Jobs revision={revision} onlyPush={false} />;
    case 'services': return <Panel title="שירותי הפרויקט"><Rows rows={[
      { label: 'Firebase Hosting', detail: 'אתר ואפליקציית רשת', value: <External href={destinations.hosting}>גרסאות ופריסות</External> },
      { label: 'Cloud Firestore', detail: 'מסד נתונים מנוהל', value: <External href={destinations.firestore}>שימוש ומכסות</External> },
      { label: 'Firebase Authentication', detail: 'התחברות וחשבונות', value: <External href={destinations.auth}>ניהול חשבונות</External> },
      { label: 'GitHub Actions', detail: 'משימות אוטומטיות ובנייה', value: <Link className="oc-link" to="/admin?tab=jobs">למשימות</Link> },
      { label: 'Google Play Console', detail: 'גרסאות Android', value: <External href="https://play.google.com/console/">לניהול הפצה</External> },
    ]} /></Panel>;
    case 'keys': return <Panel title="אימות והרשאות לשירותים"><Rows rows={[
      { label: 'Firebase Authentication', detail: 'מזהה חשבון קבוע, Google מאומת והרשאת אדמין', value: <External href={destinations.auth}>חשבונות</External> },
      { label: 'Google Cloud API', detail: 'מפתחות SDK והרשאות ספקים מנוהלים בפרויקט', value: <External href={destinations.credentials}>ניהול מפתחות</External> },
      { label: 'חשבונות שירות', detail: 'הרשאות הסביבה המתוזמנת', value: <External href={destinations.iam}>Cloud IAM</External> },
    ]} /></Panel>;
    case 'actions': return <>
      <Panel title="בדיקות קריאה" meta="כפתור הרענון מריץ את הבדיקות שוב"><LiveRows checks={checks} /></Panel>
      <Panel title="כלי תפעול"><Rows rows={[
        { label: 'האתר המפורסם', value: <External href={TANK_HOSTING}>פתיחה</External> },
        { label: 'מדדי Google Cloud', value: <External href={destinations.metrics}>פתיחה</External> },
        { label: 'ריצות GitHub Actions', value: <External href={`${TANK_GITHUB}/actions`}>פתיחה</External> },
      ]} /></Panel>
    </>;
    case 'security': return <Panel title="גישה ויומני מערכת"><Rows rows={[
      { label: 'כניסה לקונסולה', detail: 'חשבון הבעלים אושר בקריאה מאובטחת מ־Firestore', value: <State tone="ok">מאומתת</State> },
      { label: 'כללי גישה למסד', value: <External href={destinations.rules}>כללי Firestore</External> },
      { label: 'בעלי הרשאות בפרויקט', value: <External href={destinations.iam}>הרשאות IAM</External> },
      { label: 'אירועי מערכת', value: <External href={destinations.logs}>עיון ב־Cloud Logging</External> },
    ]} /></Panel>;
    default: return null;
  }
}
