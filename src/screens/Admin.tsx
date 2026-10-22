import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getCountFromServer,
  doc,
  documentId,
  getDoc,
  getDocFromServer,
  getDocFromCache,
  onSnapshot,
  getDocs,
  limit,
  orderBy,
  query,

  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useData } from "../context/DataContext";
import { SERVER_TIMESTAMP, toEpochMillis } from "../lib/fillupSerializer";
import { fetchBrowserPrice, type BrowserPriceReading } from "../lib/prices/browserFetch";
import { priceTimeline } from '../lib/prices/publicSource';
import type { OutboxOperation } from "../lib/outbox";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import {
  aggregateSummaries,
  aggregateLedgerSummaries,
  readUserSummary,
  type UserSummary,
  type VehicleSummary,
} from "../lib/summary";
import { ScreenHeader } from "../components/AppHeader";
import { Card, IconTile, Label, ListCard, Skeleton } from "../components/Card";
import { Num } from "../components/Num";
import { StationBrandMark } from "../components/StationBrand";
import { Avatar } from "../components/Avatar";
import { Segmented } from "../components/Segmented";
import { Button } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { useAppUpdateBlocker } from '../hooks/useAppUpdateBlocker';
import { AdminSpendChart } from '../components/admin/AdminSpendChart';
import { InfoTip } from "../components/InfoTip";
import { useToast } from "../context/ToastContext";
import {
  HeartIcon,
  LightbulbIcon,
  RefreshIcon,
  ShieldIcon,
  WarningIcon,
  ChevronStart,
  SearchIcon,
} from "../components/icons";
import { dayMonthShort, num, parseDecimal, price, shekel, timeAgo } from "../lib/format";
import { monthKey, type FuelType } from "../lib/stats";
import {
  REGULATED_SERVICE_MODE,
  adaptLegacyConfig,
  normalizePriceDocument,
  priceMonthLabel,
  regulatedMaxPrice,
  type RegulatedLookup,
  type RegulatedPriceConfig,
  type RegulatedSeries,
} from "../lib/prices/regulated";

/**
 * Admin dashboard.
 *
 * Read-only by construction: the security rules give admins `read` on user
 * documents and never `write`, so nothing here can modify somebody else's
 * account. Every figure is computed from raw fill-ups with the same engine
 * the user's own screens use.
 */

interface AdminUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: number | null;
  isAdmin: boolean;
  /** The account's published summary, or null if it has never written one. */
  summary: UserSummary | null;
  /** Derived from the summary. No fill-up document is ever read to get these. */
  vehicles: number;
  fillups: number;
  lastFillup: number | null;
}

type SortKey = "activity" | "spend" | "joined";

/** One page of users per request. */
const PAGE_SIZE = 25;


/**
 * The console is four screens, not one scroll.
 *
 * Everything used to be stacked on a single page — totals, every user, the
 * feedback inbox, the price editor, the station diagnostics and the benchmark
 * pool — so nothing could be found and each block invented its own header.
 * They are tabs now, and every block is a Panel with the same chrome.
 */
type AdminTab = "overview" | "users" | "data" | "feedback";

const ADMIN_TABS: { value: AdminTab; label: string }[] = [
  { value: "overview", label: "סקירה" },
  { value: "users", label: "משתמשים" },
  { value: "data", label: "נתונים" },
  { value: "feedback", label: "משוב" },
];

export function Admin() {
  const navigate = useNavigate();
  const { user, isAdmin, claimsLoaded } = useAuth();

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("activity");
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [pageCursor, setPageCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * Load one PAGE of users.
   *
   * The previous implementation read every user document, then every vehicle
   * of every user, then every fill-up of every vehicle — an unbounded N+1 scan
   * that, at 500 users, could be tens of thousands of document reads on a
   * single screen load, against a Spark daily quota of 50,000.
   *
   * Now: one paged query for the users, and a COUNT aggregation for vehicles
   * and fill-ups. A count query bills one read per query rather than one per
   * document, so a page of 25 users costs roughly 25 + 25 + (a count per
   * vehicle) reads instead of thousands. Nothing reads a fill-up document at
   * all unless an admin explicitly expands a row.
   */
  /**
   * Load one PAGE of users.
   *
   * The original implementation read every user document, then every vehicle
   * of every user, then every fill-up of every vehicle — an unbounded N+1 scan
   * that at 500 users could be tens of thousands of reads on one screen load,
   * against a Spark daily quota of 50,000.
   *
   * It now reads the profile page plus each account's published summary: two
   * documents per user, and NOT ONE fill-up record. The summaries are
   * client-produced operational telemetry and back no security decision; they
   * simply mean the dashboard does not need to see anybody's fuel log to count
   * it.
   */
  const load = useCallback(
    async (cursor: QueryDocumentSnapshot | null) => {
      setError(null);
      setLoadingMore(true);
      try {
        // Older profiles can lack createdAt; ordering by that field silently
        // omits them and falsely makes a partial page look like a census.
        const constraints = [orderBy(documentId()), limit(PAGE_SIZE)];
        const usersSnapshot = await getDocs(
          cursor
            ? query(collection(db, "users"), ...constraints, startAfter(cursor))
            : query(collection(db, "users"), ...constraints),
        );

        const rows = await Promise.all(
          usersSnapshot.docs.map(async (userDoc) => {
            const data = userDoc.data();
            const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : null;
            const joinedAt = toEpochMillis(data.createdAt);
            const photo = text(data.photoURL, 2048);

            let summary: UserSummary | null = null;
            try {
              const snapshot = await getDoc(doc(db, "userSummaries", userDoc.id));
              if (snapshot.exists()) summary = readUserSummary(snapshot.data());
            } catch {
              // A missing or unreadable summary leaves the row honest about
              // having none, rather than failing the whole page.
            }

            const vehicles: VehicleSummary[] = Object.values(summary?.vehicles ?? {});
            const lastFillup = vehicles.reduce<number | null>(
              (latest, entry) =>
                entry.lastFillupAt === null
                  ? latest
                  : Math.max(latest ?? 0, entry.lastFillupAt),
              null,
            );

            return {
              uid: userDoc.id,
              displayName: text(data.displayName, 120),
              email: text(data.email, 254),
              photoURL: photo?.startsWith('https://') ? photo : null,
              createdAt: joinedAt !== null && joinedAt >= 0 && joinedAt < 8.64e15 ? joinedAt : null,
              isAdmin: data.isAdmin === true,
              summary,
              vehicles: summary?.vehicleCount ?? 0,
              fillups: vehicles.reduce((sum, entry) => sum + entry.fillups, 0),
              lastFillup,
            } satisfies AdminUser;
          }),
        );

        setUsers((previous) => (cursor ? [...(previous ?? []), ...rows] : rows));
        setPageCursor(
          usersSnapshot.docs.length === PAGE_SIZE
            ? usersSnapshot.docs[usersSnapshot.docs.length - 1]
            : null,
        );
        setExhausted(usersSnapshot.docs.length < PAGE_SIZE);
      } catch (caught) {
        setError(
          (caught as { code?: string }).code === "permission-denied"
            ? "אין הרשאת אדמין לחשבון הזה. התנתקו והתחברו מחדש כדי לרענן את ההרשאות."
            : "טעינת הנתונים נכשלה.",
        );
        if (!cursor) setUsers([]);
      } finally {
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (claimsLoaded && isAdmin) void load(null);
  }, [claimsLoaded, isAdmin, load]);

  const sorted = useMemo(() => {
    if (!users) return [];
    const term = search.trim().toLocaleLowerCase();
    const copy = users.filter(u => !term || `${u.displayName ?? ''} ${u.email ?? ''}`.toLocaleLowerCase().includes(term));
    if (sort === "spend") copy.sort((a, b) => costOf(b.summary) - costOf(a.summary));
    else if (sort === "activity") copy.sort((a, b) => b.fillups - a.fillups);
    else copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return copy;
  }, [users, sort, search]);

  /**
   * Totals across the users LOADED SO FAR.
   *
   * Labelled as such rather than presented as a global figure: a paginated
   * list cannot honestly claim to cover the whole population, and fetching
   * everything to make it true is the read pattern this screen was rewritten
   * to remove. A real global count belongs in a backend-maintained aggregate
   * document (Blaze).
   */
  const totals = useMemo(() => {
    if (!users) return null;
    return aggregateSummaries(
      users.map((entry) => ({ uid: entry.uid, summary: entry.summary })),
    );
  }, [users]);
  const ledger = useMemo(() => aggregateLedgerSummaries((users ?? []).map(u => u.summary)), [users]);

  if (!claimsLoaded) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-5 pb-[104px] pt-safe">
        <Skeleton className="mt-6 h-8 w-40" />
        <Skeleton className="h-[92px] rounded-card" />
        <Skeleton className="h-[260px] rounded-card" />
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex flex-1 flex-col pb-[104px] pt-safe">
        <ScreenHeader title="לוח בקרה" onBack={() => navigate("/")} />
        <div className="px-5">
          <Card className="flex flex-col items-center gap-3 px-7 py-12 text-center">
            <IconTile tone="danger">
              <ShieldIcon size={18} />
            </IconTile>
            <span className="text-[18px] font-semibold text-ink">אין גישה</span>
            <span className="max-w-[260px] text-[14px] leading-relaxed text-muted">
              האזור הזה פתוח למנהלי מערכת בלבד.
              {user ? " אם קיבלתם הרשאה זה עתה, התנתקו והתחברו מחדש." : ""}
            </span>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="tm-admin flex min-w-0 flex-1 flex-col pb-safe pt-safe">
      <header className="admin-header"><button type="button" aria-label="חזרה להגדרות" onClick={() => navigate('/settings')}><ChevronStart size={22} className="rotate-180" /></button><h1>לוח בקרה</h1><span aria-hidden="true" /></header>
      <nav aria-label="מדורי ניהול" className="admin-tabs">
        {ADMIN_TABS.map(entry => <button key={entry.value} type="button" aria-current={tab === entry.value ? 'page' : undefined} aria-pressed={tab === entry.value} onClick={() => { setTab(entry.value); setSelectedUser(null); }}>{entry.label}</button>)}
      </nav>
      <div className="admin-page">
        {error ? <div role="alert" className="admin-alert"><WarningIcon size={18} /><span>{error}</span><button type="button" onClick={() => void load(null)} className="admin-link">ניסיון נוסף</button></div> : null}
        {!users ? <><Skeleton className="h-[170px] rounded-card" /><Skeleton className="h-[210px] rounded-card" /></> : <>
          {tab === 'overview' ? <>
            <section aria-label="סיכום המערכת">
              <div className="admin-group-head"><h2>המערכת</h2><button type="button" disabled={loadingMore} className="admin-link" onClick={() => void load(null)}>{loadingMore ? 'טוענים…' : 'רענון'}</button></div>
              <div className="admin-tiles">
                <StatTile label="משתמשים" value={num(totals?.users ?? 0, 0)} />
                <StatTile label="רכבים" value={num(totals?.vehicles ?? 0, 0)} />
                <StatTile label="רשומות יומן" value={num(ledger.records, 0)} />
                <StatTile label="צריכה ממוצעת · קמ״ל" value={totals?.kmPerLiter ? num(totals.kmPerLiter, 1) : '—'} />
              </div>
              <div className="admin-kinds" aria-label="פילוח רשומות">{([['fuel', 'תדלוקים'], ['expense', 'הוצאות'], ['service', 'טיפולים'], ['odometer', 'עדכוני ק״מ']] as const).map(([kind, title]) => <span key={kind}>{title} <Num>{kind === 'fuel' || ledger.ledgerVehicles ? num(ledger.counts[kind], 0) : '—'}</Num></span>)}</div>
              <p className="helper">{exhausted?'כל החשבונות נטענו. ':'נטענה רשימת חשבונות חלקית. '}{totals?.withoutSummary ? `${totals.withoutSummary} חשבונות ללא סיכום. ` : ''}{ledger.missingLedgers || ledger.missingVehicles ? 'חלק מהסיכומים עדיין כוללים תדלוקים בלבד. ' : ''}הספירות מסיכומים שפורסמו; הצריכה משוקללת לפי מרחק.</p>
            </section>
            <AdminSpendChart data={ledger} />
            <BenchmarkPool />
          </> : null}
          {tab === 'users' ? <>
            <label className="admin-search"><SearchIcon size={18} /><input type="search" aria-label="חיפוש משתמשים" placeholder="חיפוש לפי שם או מייל" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <Segmented size="sm" value={sort} onChange={setSort} ariaLabel="מיון משתמשים" options={[{ value: 'activity', label: 'תדלוקים' }, { value: 'spend', label: 'הוצאה' }, { value: 'joined', label: 'הצטרפות' }]} />
            <div className="admin-group">{sorted.map(entry => <button className="admin-user-row" type="button" key={entry.uid} aria-haspopup="dialog" onClick={() => setSelectedUser(entry)}>
              <Avatar name={entry.displayName} photoURL={entry.photoURL} size={36} />
              <span className="admin-row-main"><strong>{entry.displayName ?? 'ללא שם'}</strong><small dir="ltr">{entry.email ?? 'ללא כתובת מייל'}</small></span>
              <span className="admin-user-value"><Num>{entry.summary ? num(entry.fillups, 0) : '—'}</Num><small>תדלוקים</small></span><ChevronStart size={16} className="text-muted" />
            </button>)}</div>
            {!sorted.length ? <p className="admin-empty">{search ? 'לא נמצאו משתמשים בחשבונות שנטענו' : 'אין עדיין משתמשים'}</p> : null}
            {!exhausted ? <button type="button" disabled={loadingMore} onClick={() => void load(pageCursor)} className="tm-text-action">{loadingMore ? 'טוענים…' : `טעינת ${PAGE_SIZE} משתמשים נוספים`}</button> : null}
            <p className="helper">החיפוש והמיון חלים על {users.length} החשבונות שנטענו. נתוני משתמשים הם לקריאה בלבד.</p>
          </> : null}
          {tab === 'data' ? <><FuelPriceEditor key={user?.uid} /><StationDataPanel /></> : null}
          {tab === 'feedback' ? <FeedbackInbox /> : null}
        </>}
      </div>
      <Sheet open={selectedUser !== null} onClose={() => setSelectedUser(null)} title={selectedUser?.displayName ?? 'פרטי משתמש'}>
        {selectedUser ? <div className="flex flex-col gap-4"><p dir="ltr" className="text-right text-muted">{selectedUser.email ?? 'ללא כתובת מייל'}</p><div className="admin-group">
          {[
            ['רכבים', selectedUser.summary ? num(selectedUser.vehicles, 0) : '—'],
            ['תדלוקים', selectedUser.summary ? num(selectedUser.fillups, 0) : '—'],
            ['צריכה ממוצעת', selectedUser.summary ? consumptionOf(selectedUser.summary) + ' קמ״ל' : '—'],
            ['הוצאה שפורסמה', selectedUser.summary ? shekel(costOf(selectedUser.summary)) : '—'],
            ['הצטרפות', selectedUser.createdAt ? dayMonthShort(selectedUser.createdAt) : 'לא ידוע'],
          ].map(([label, value]) => <div className="admin-data-row" key={label}><span>{label}</span><Num>{value}</Num></div>)}
        </div><p className="helper">{selectedUser.summary ? 'הנתונים הם סיכומים שהחשבון פרסם. סיכום ישן עשוי לכלול תדלוקים בלבד.' : 'לא זמין סיכום תקין לחשבון הזה, ולכן אין עדיין ספירה מאומתת.'} אין אפשרות לערוך או למחוק נתונים של משתמש אחר.</p></div> : null}
      </Sheet>
    </main>
  );
}

/**
 * The one section shell every panel on this screen uses: a title, an optional
 * control opposite it, an optional note under it, and a card for the body.
 * `bare` is for a body that is already made of cards.
 */
function Panel({
  title,
  note,
  trailing,
  bare = false,
  children,
}: {
  title: string;
  note?: string;
  trailing?: React.ReactNode;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="admin-group-head">
        <Label>{title}</Label>
        {trailing}
      </div>
      {note ? <p className="-mt-1 text-[13px] text-muted">{note}</p> : null}
      {bare ? children : <div className="admin-group">{children}</div>}
    </section>
  );
}

interface FeedbackEntry {
  id: string;
  message: string;
  sentiment: "good" | "idea" | "bug" | null;
  displayName: string | null;
  email: string | null;
  appVersion: string | null;
  createdAt: number | null;
}

const SENTIMENT = {
  good: { label: "מחמאה", Icon: HeartIcon, tone: "success" as const },
  idea: { label: "רעיון", Icon: LightbulbIcon, tone: "accent" as const },
  bug: { label: "תקלה", Icon: WarningIcon, tone: "danger" as const },
};

/** Everything users sent through Settings → משוב, newest first. */
function FeedbackInbox() {
  const [entries, setEntries] = useState<FeedbackEntry[] | null>(null);
  const [selected, setSelected] = useState<FeedbackEntry | null>(null);
  const [filter, setFilter] = useState<"all" | "good" | "idea" | "bug">("all");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        return await getDocs(query(collection(db, "feedback"), orderBy("createdAt", "desc"), limit(200)));
      } catch {
        return getDocs(query(collection(db, "feedback"), limit(200)));
      }
    };
    void load().then(snapshot => {
      if (!active) return;
      const rows = snapshot.docs.map(entry => {
        const data = entry.data();
        return {
          id: entry.id, message: String(data.message ?? ""),
          sentiment: Object.hasOwn(SENTIMENT, data.sentiment) ? data.sentiment as keyof typeof SENTIMENT : null,
          displayName: data.displayName ?? null, email: data.email ?? null,
          appVersion: data.appVersion ?? null, createdAt: data.createdAt?.toMillis?.() ?? null,
        } satisfies FeedbackEntry;
      });
      rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setEntries(rows);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  const visible = entries?.filter(entry => filter === "all" || entry.sentiment === filter);

  return <Panel title="משוב ממשתמשים" bare trailing={entries ? <Num className="text-[13.5px] text-muted">{entries.length}</Num> : null}>
    <Segmented ariaLabel="סינון משוב" value={filter} onChange={setFilter} options={[
      { value: "all", label: "הכול" }, { value: "good", label: "מחמאות" },
      { value: "idea", label: "רעיונות" }, { value: "bug", label: "תקלות" },
    ]} />
    {error ? <div role="alert" className="flex items-center justify-between gap-3 py-4 text-[14px] text-danger-ink">
      לא ניתן לטעון את המשוב <button type="button" className="tm-text-action" onClick={() => { setError(false); setAttempt(n => n + 1); }}>ניסיון נוסף</button>
    </div> : !visible ? <Skeleton className="h-[120px] rounded-card" /> : visible.length === 0 ?
      <p className="py-8 text-center text-[15.5px] text-muted">{entries?.length ? "אין משוב בקטגוריה הזו" : "עוד לא התקבל משוב"}</p> :
      <ListCard>{visible.map(entry => {
        const meta = entry.sentiment ? SENTIMENT[entry.sentiment] : null;
        return <button key={entry.id} type="button" onClick={() => setSelected(entry)} className="flex w-full flex-col gap-2 px-4 py-4 text-start active:bg-surface-2" aria-haspopup="dialog">
          <span className="flex items-center gap-2">
            {meta ? <meta.Icon size={18} className="text-muted" /> : null}
            <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold">{entry.displayName ?? "משתמש"}</span>
            <span className="text-[12px] text-muted">{entry.createdAt ? timeAgo(entry.createdAt) : "—"}</span>
          </span>
          <span className="line-clamp-2 whitespace-pre-wrap break-words text-[14px] text-muted">{entry.message}</span>
        </button>;
      })}</ListCard>}
    <Sheet open={selected !== null} onClose={() => setSelected(null)} title={<h2 className="text-[19px] font-bold">{selected?.sentiment ? SENTIMENT[selected.sentiment].label : "משוב"}</h2>}>
      {selected ? <div className="flex flex-col gap-4">
        <div><p className="text-[15.5px] font-semibold">{selected.displayName ?? "משתמש"}</p><p className="break-words text-[13.5px] text-muted">{selected.email ?? ""}</p></div>
        <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">{selected.message}</p>
        <p className="text-[13.5px] text-muted">{selected.createdAt ? dayMonthShort(selected.createdAt) : "תאריך לא ידוע"}{selected.appVersion ? ` · גרסה ${selected.appVersion}` : ""}</p>
      </div> : null}
    </Sheet>
  </Panel>;
}

/** Admin prices: durable manual saves, stored refresh and independent browser reading. */
const EDITABLE_FUELS: { fuelType: FuelType; label: string }[] = [
  { fuelType: "95", label: "בנזין 95" },
  { fuelType: "98", label: "בנזין 98" },
  { fuelType: "diesel", label: "סולר" },
  { fuelType: "other", label: "אחר" },
];

/** Which copy answered the last read — shown beside the panel title. */
type ReadSource = "server" | "cache" | null;

function daysAgoText(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "רץ היום";
  if (days === 1) return "רץ אתמול";
  return `רץ לפני ${days} ימים`;
}

function FuelPriceEditor() {
  const { showToast } = useToast();
  const { user, isAdmin, claimsLoaded } = useAuth();
  const { updateAdminPrices, outbox: outboxOps, retryOperation, outboxReady } = useData();
  const priceOps = outboxOps.filter(op => op.uid === user?.uid && op.kind === "adminPrice.update");
  const latest95Op = priceOps.filter(op => Object.keys(op.payload ?? {}).some(key => key.startsWith('byFuelType.95.'))).at(-1);
  const [pulling, setPulling] = useState(false);
  const [reading, setReading] = useState<BrowserPriceReading | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [config, setConfig] = useState<RegulatedPriceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [readSource, setReadSource] = useState<ReadSource>(null);

  const load = useCallback(async (fromServer = false): Promise<ReadSource> => {
    setLoading(true);
    try {
      const ref = doc(db, "appConfig", "fuelPrices");
      // The refresh must not be answered by the offline cache — the whole
      // point of it is to see what the server holds right now. When the
      // server cannot be reached the cache answers, and the caller is told.
      let source: ReadSource = "cache";
      let snapshot;
      if (fromServer) {
        try {
          snapshot = await Promise.race([getDocFromServer(ref), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("read-timeout")), 8000))]);
          source = "server";
        } catch {
          snapshot = await getDocFromCache(ref);
        }
      } else {
        snapshot = await getDoc(ref);
        source = snapshot.metadata.fromCache ? "cache" : "server";
      }
      // Normalised first: the raw document carries Firestore Timestamps, and
      // the freshness line does date arithmetic on them.
      setConfig(
        snapshot.exists()
          ? adaptLegacyConfig(normalizePriceDocument(snapshot.data()))
          : { byFuelType: {} },
      );
      setReadSource(source);
      return source;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => onSnapshot(doc(db, "appConfig", "fuelPrices"), { includeMetadataChanges: true }, snapshot => {
    setConfig(snapshot.exists() ? adaptLegacyConfig(normalizePriceDocument(snapshot.data())) : { byFuelType: {} });
    setReadSource(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites ? "cache" : "server");
    setLoading(false);
  }, () => setLoading(false)), []);

  async function applyOfficial(read: BrowserPriceReading) {
    const prefix = 'byFuelType.95.self';
    const old = config?.byFuelType?.['95']?.self;
    if ((old?.current?.effectiveFrom ?? 0) > read.effectiveFrom) throw new Error('נמצא פרסום ישן יותר. המחיר הקיים נשמר.');
    await updateAdminPrices({
      [`${prefix}.current`]: { pricePerLiter: read.price, effectiveFrom: read.effectiveFrom, updatedAt: read.readAt },
      [`${prefix}.history.${read.month}`]: read.price,
      [`${prefix}.scheduledHistory.${read.month}`]: read.price,
      ...Object.fromEntries(Object.entries(priceTimeline(old, read)).map(([at, value]) => [`${prefix}.timeline.${at}`, value])),
      [`${prefix}.source`]: 'scheduled', [`${prefix}.sourceUrl`]: read.url,
      [`${prefix}.retrievedAt`]: read.readAt, [`${prefix}.manualOverride`]: null,
    });
    showToast({ tone: 'info', title: 'המחיר אומת ונשלח לשמירה' });
  }

  async function pull() {
    if (pulling) return;
    setPulling(true);
    setReading(null);
    setPullError(null);
    try { const read = await fetchBrowserPrice(); setReading(read); await applyOfficial(read); }
    catch (error) { setPullError(error instanceof Error ? error.message : "הקריאה נכשלה — נסו שוב"); }
    finally { setPulling(false); }
  }

  /** Returns after both journal and SDK disk acceptance; server acknowledgement remains visible below. */
  async function save(fuelType: FuelType, value: number) {
    const now = new Date();
    const month = monthKey(now.getTime());
    const prefix = `byFuelType.${fuelType}.${REGULATED_SERVICE_MODE}`;
    await updateAdminPrices({
      [`${prefix}.current.pricePerLiter`]: value,
      [`${prefix}.current.effectiveFrom`]: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      [`${prefix}.current.updatedAt`]: SERVER_TIMESTAMP,
      [`${prefix}.history.${month}`]: value,
      [`${prefix}.source`]: "manual",
      [`${prefix}.manualOverride`]: { pricePerLiter: value, month, setAt: Date.now(), note: null },
    });
    showToast({ tone: "info", title: "הקלט נשמר במכשיר — ממתין לאישור השרת" });
  }

  async function restoreScheduled(fuelType: FuelType, month: string, scheduled: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const prefix = `byFuelType.${fuelType}.${REGULATED_SERVICE_MODE}`;
    await updateAdminPrices({
      [`${prefix}.manualOverride`]: null,
      [`${prefix}.history.${month}`]: scheduled,
      [`${prefix}.current.pricePerLiter`]: scheduled,
      [`${prefix}.current.effectiveFrom`]: new Date(year, monthNumber - 1, 1).getTime(),
      [`${prefix}.current.updatedAt`]: SERVER_TIMESTAMP,
      [`${prefix}.source`]: "scheduled",
    });
  }

  /**
   * Whether the daily job is alive, from what the job itself reports — never
   * inferred from a series' `source`, which flips to "manual" on every admin
   * save while the job keeps running.
   */
  const [now] = useState(() => Date.now());
  const automation = config?.automation ?? null;
  const lastAttempt = automation?.lastAttemptAt ?? null;
  const lastSuccess = automation?.lastSuccessAt ?? null;
  const lastFailure = automation?.lastFailureAt ?? null;
  const failedLast = lastFailure !== null && (lastSuccess === null || lastFailure > lastSuccess);
  const ranRecently = lastSuccess !== null && now - lastSuccess < 3 * 86_400_000;

  const automatic =
    lastAttempt === null
      ? {
          ok: false,
          value: "אין דיווח",
          detail:
            "אין דיווח ריצות עדיין (גרסת סקריפט ישנה). המשימה היומית ב־GitHub Actions מדווחת על עצמה מגרסה זו ואילך — בדקו את הלוג ב־GitHub → Actions → Fuel price.",
        }
      : {
          ok: ranRecently && !failedLast,
          value: failedLast ? "נכשל" : ranRecently ? "פעיל" : "לא רץ לאחרונה",
          detail: [
            `ניסיון אחרון: ${daysAgoText(lastAttempt, now)} (${dayMonthShort(lastAttempt)})`,
            lastSuccess !== null
              ? `הצלחה אחרונה: ${dayMonthShort(lastSuccess)}${
                  automation?.lastReadMonth
                    ? ` · נקרא ${priceMonthLabel(automation.lastReadMonth, now)}${
                        automation.lastReadPrice != null ? ` ₪${automation.lastReadPrice}` : ""
                      }`
                    : ""
                }${automation?.lastVia ? ` · דרך ${automation.lastVia}` : ""}`
              : "טרם הצליח",
            failedLast && automation?.lastError
              ? `שגיאה אחרונה: ${automation.lastError.split("\n")[0]}`
              : null,
            automation?.targetProjectId ? `פרויקט: ${automation.targetProjectId}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        };

  return <>
    <Panel title="מחירי דלק רשמיים" note={readSource === 'server' ? 'נקרא מהשרת' : readSource === 'cache' ? 'מוצג עותק מקומי' : undefined} bare trailing={<button type="button" className="admin-link" disabled={pulling || !isAdmin || !outboxReady || priceOps.some(op => op.status === 'pending')} aria-label="משיכת מחיר מהדפדפן" aria-busy={pulling || undefined} onClick={() => void pull()}><RefreshIcon size={15} />{pulling ? 'קוראים…' : 'משיכה עכשיו'}</button>}>
      <div className="admin-group">{EDITABLE_FUELS.map(({ fuelType, label }) => <FuelPriceRow key={fuelType} label={label} draftKey={`tm.adminPriceDraft.${user?.uid}.${fuelType}`} writable={isAdmin && outboxReady} serverConfirmed={readSource === 'server'} operation={priceOps.filter(op => Object.keys(op.payload ?? {}).some(key => key.startsWith(`byFuelType.${fuelType}.`))).at(-1)} onRetry={opId => retryOperation(opId)} lookup={regulatedMaxPrice(config, fuelType, now)} series={config?.byFuelType?.[fuelType]?.[REGULATED_SERVICE_MODE]} onSave={value => save(fuelType, value)} onRestore={(month, scheduled) => restoreScheduled(fuelType, month, scheduled)} />)}</div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-[12px] text-muted">
        <span>95 בשירות עצמי · 98 וסולר אינם בפיקוח</span>
        <RefreshButton busy={loading} label="רענון מהשרת" onClick={() => void load(true).then(source => showToast({ tone: source === 'server' ? 'success' : 'info', title: source === 'server' ? 'נקרא מהשרת' : 'השרת לא זמין — מוצג עותק מקומי' })).catch(() => showToast({ tone: 'error', title: 'הקריאה נכשלה' }))} />
      </div>
      {pullError ? <p role="alert" className="text-[13px] text-danger-ink">{pullError}</p> : null}
      {reading ? <p className="helper">נקרא פרסום משרד האנרגיה לחודש {priceMonthLabel(reading.month, now)}. {latest95Op ? 'אישור השמירה מוצג ליד המחיר.' : readSource === 'server' ? 'המחיר מאושר בשרת.' : 'ממתינים לאישור השרת.'}</p> : null}
      {config?.byFuelType?.['95']?.self?.sourceUrl ? <a href={config.byFuelType['95'].self.sourceUrl} target="_blank" rel="noopener noreferrer" className="admin-link self-start">מקור: משרד האנרגיה</a> : null}
    </Panel>
    <Panel title="הרשאות ועדכונים">
      <DiagnosticRow title="הרשאת כתיבה למחירים" ok={isAdmin} value={!claimsLoaded ? 'בודקים…' : isAdmin ? 'מותרת' : 'חסרה'} detail={isAdmin ? 'אפשר לשמור מחירים. אישור השרת מוצג ליד הערך שנשמר.' : 'שמירה זמינה למנהלי מערכת בלבד.'} />
      <DiagnosticRow title="עדכון אוטומטי (95)" ok={automatic.ok} value={automatic.value} detail={automatic.detail} />
    </Panel>
  </>;
}

/** The one refresh control the console uses. */
function RefreshButton({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex min-h-[44px] flex-none items-center gap-1.5 rounded-pill bg-surface-2 px-3 text-[14px] font-semibold text-accent transition-[background-color,scale] duration-200 active:scale-[0.96] disabled:opacity-50"
    >
      <RefreshIcon size={14} />
      {busy ? "בודק…" : label}
    </button>
  );
}

/** One fuel type: the stored figure, where it came from, and an inline edit. */
function FuelPriceRow({
  label,
  lookup,
  series,
  onSave,
  onRestore,
  draftKey,
  writable,
  serverConfirmed,
  operation,
  onRetry,
}: {
  draftKey: string;
  writable: boolean;
  serverConfirmed: boolean;
  operation?: OutboxOperation;
  onRetry: (opId: string) => Promise<void>;
  label: string;
  lookup: RegulatedLookup;
  series: RegulatedSeries | undefined;
  onSave: (value: number) => Promise<void>;
  onRestore: (month: string, scheduled: number) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem(draftKey) ?? ""; } catch { return ""; } });
  const [draftError, setDraftError] = useState(false);
  const [editing, setEditing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  useAppUpdateBlocker(editing && (saving || restoring || draftError));

  const parsed = parseDecimal(draft);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed < 20;
  const changed = valid && parsed !== lookup.price;

  const [now] = useState(() => Date.now());
  const thisMonth = monthKey(now);
  const currentMonth = lookup.effectiveMonth === thisMonth;
  const monthText = priceMonthLabel(lookup.effectiveMonth, now);

  // The job's own figure for the month the override covers, when it exists.
  const override = series?.manualOverride ?? null;
  const overrideActive = override !== null && override.month === thisMonth;
  const scheduledForMonth = overrideActive
    ? (series?.scheduledHistory?.[override.month] ?? null)
    : null;

  const sourceText =
    lookup.price === null
      ? "לא הוזן"
      : [
          lookup.isManual ? "ידני" : "אוטומטי",
          monthText || null,
          overrideActive && scheduledForMonth !== null
            ? `דורס את הערך האוטומטי ${price(scheduledForMonth)}`
            : overrideActive
              ? "אין ערך אוטומטי לחודש זה"
              : null,
          currentMonth ? null : "לא לחודש הנוכחי",
        ]
          .filter(Boolean)
          .join(" · ");

  function failureTitle(error: unknown): string {
    const code = (error as { code?: unknown })?.code;
    return code === "permission-denied"
      ? "אין הרשאת מנהל (custom claim admin) — ראו scripts/grantAdmin.mjs"
      : `הפעולה נכשלה (${typeof code === "string" ? code : "unknown"})`;
  }

  const status = operation ? <div className="flex flex-col gap-1" role="status">
    <span className={operation.status === 'pending' ? 'text-muted' : 'text-danger-ink'}>{operation.status === 'pending' ? 'נשמר במכשיר · ממתין לאישור השרת' : 'לא סונכרן · הקלט נשמר במכשיר'}</span>
    {operation.error ? <span className="text-danger-ink">{operation.error.message}</span> : null}
    {operation.status !== 'pending' ? <button type="button" disabled={!writable || saving} className="admin-link" onClick={() => { setSaving(true); void onRetry(operation.opId).catch(error => showToast({ tone: 'error', title: failureTitle(error) })).finally(() => setSaving(false)); }}>ניסיון שמירה נוסף</button> : null}
  </div> : serverConfirmed && lookup.price !== null ? <span className="text-success">המחיר מאושר בשרת</span> : null;
  function closeEditor() {
    if (saving || restoring || draftError) return;
    if (!changed && !operation) {
      try { localStorage.removeItem(draftKey); } catch { /* No new input to lose. */ }
      setDraft('');
    }
    setEditing(false);
  }
  return <div className="admin-price-entry">
    <button type="button" className="admin-price-row" aria-label={`עריכת מחיר · ${label}`} aria-haspopup="dialog" onClick={() => { if (!draft && lookup.price !== null) setDraft(String(lookup.price)); setEditing(true); }}>
      <span className="admin-row-main"><strong>{label}</strong><small className={currentMonth ? '' : 'text-warning-ink'}>{sourceText}</small>{changed && !operation ? <small className="text-accent">טיוטה ממתינה</small> : null}</span>
      <Num className="text-[17px] font-semibold">{lookup.price === null ? '—' : price(lookup.price)}</Num><ChevronStart size={16} className="text-muted" />
    </button>
    {!editing && operation ? <div className="admin-price-status">{status}</div> : null}
    <Sheet open={editing} onClose={closeEditor} title={`מחיר לליטר · ${label}`}>
      <form className="admin-price-editor" onSubmit={event => { event.preventDefault(); if (!changed || !writable || saving || operation?.status === 'pending') return; setSaving(true); void onSave(parsed).catch(error => showToast({ tone: 'error', title: failureTitle(error) })).finally(() => setSaving(false)); }}>
        <p className="helper">{label === 'בנזין 95' ? 'ערך ידני מחליף את המחיר האוטומטי לחודש הנוכחי. תדלוקים קיימים אינם משתנים.' : 'סוג דלק זה אינו בפיקוח. הערך הידני ישמש כברירת מחדל בתדלוקים חדשים.'}</p>
        <label className="admin-price-field"><span>מחיר לליטר</span><input inputMode="decimal" aria-label={`מחיר חדש לליטר · ${label}`} value={draft} onChange={event => { const value = event.target.value; setDraft(value); try { localStorage.setItem(draftKey, value); setDraftError(false); } catch { setDraftError(true); } }} placeholder={lookup.price !== null ? String(lookup.price) : '—'} dir="ltr" className="num" /><span>₪</span></label>
        {draftError ? <p role="alert" className="text-[13px] text-danger-ink">הטיוטה לא נשמרה באחסון המקומי. השאירו את המסך פתוח עד לשמירה.</p> : null}
        {draft && !valid ? <p role="alert" className="text-[13px] text-danger-ink">הזינו מחיר מלא בין 0 ל־20 ₪.</p> : null}
        <div className="text-[13px] leading-relaxed" aria-live="polite">{status}</div>
        <Button type="submit" full disabled={!changed || !writable || operation?.status === 'pending'} loading={saving}>שמירה</Button>
        {overrideActive && scheduledForMonth !== null && override ? <button type="button" disabled={restoring || !writable || operation?.status === 'pending'} onClick={() => { setRestoring(true); void onRestore(override.month, scheduledForMonth).catch(error => showToast({ tone: 'error', title: failureTitle(error) })).finally(() => setRestoring(false)); }} className="tm-text-action">{restoring ? 'מחזירים…' : `החזרת הערך האוטומטי (${price(scheduledForMonth)})`}</button> : null}
      </form>
    </Sheet>
  </div>;
}

/**
 * Where station data comes from, and whether any of it is actually arriving.
 *
 * There is no live pump-price feed anywhere in this system, and the admin
 * screen used to imply otherwise by simply not mentioning it. This states the
 * three real sources separately and checks each one on demand:
 *
 *   1. the station CATALOG — a static file built from the Ministry of Energy
 *      register by `scripts/buildStationCatalog.mjs` and shipped with the app;
 *   2. that register, live, so a stale shipped catalog is visible;
 *   3. station PRICES — community reports aggregated by a backend that needs
 *      Blaze, so until it runs the count here is honestly zero.
 */
const REGISTER_RESOURCE = "5537a0ef-3eeb-449c-90c8-51e27564f0cb";
const CATALOG_CACHE_KEY = "tm.stations.v1";
const AGGREGATE_FRESH_MS = 14 * 86_400_000;

interface StationDiagnostics {
  catalog:
    | { ok: true; count: number; registryCount: number | null; generatedAt: string | null; sourceUpdatedAt: string | null; brands: [string, number][] }
    | { ok: false; error: string };
  register: { ok: true; total: number } | { ok: false; error: string };
  prices: { ok: true; count: number; fresh: number; newest: number | null } | { ok: false; error: string };
}

function StationDataPanel() {
  const { showToast } = useToast();
  const [data, setData] = useState<StationDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);

    // 1. The shipped catalog, read past every cache so the figure is the one
    //    currently being served — not the copy this browser saved last week.
    let catalog: StationDiagnostics["catalog"];
    try {
      localStorage.removeItem(CATALOG_CACHE_KEY);
      const response = await fetch(`/fuel-stations.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        count?: number;
        registryCount?: number;
        generatedAt?: string;
        sourceUpdatedAt?: string;
        stations?: { c?: string | null }[];
      };
      const counts = new Map<string, number>();
      for (const station of payload.stations ?? []) {
        const brand = station.c?.trim() || "ללא חברה";
        counts.set(brand, (counts.get(brand) ?? 0) + 1);
      }
      catalog = {
        ok: true,
        count: payload.count ?? payload.stations?.length ?? 0,
        registryCount: payload.registryCount ?? null,
        generatedAt: payload.generatedAt ?? null,
        sourceUpdatedAt: payload.sourceUpdatedAt ?? null,
        brands: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      };
    } catch (error) {
      catalog = { ok: false, error: (error as Error).message };
    }

    // 2. The live register. CKAN answers CORS, so this runs in the browser
    //    with no function and no key.
    let register: StationDiagnostics["register"];
    try {
      const url = new URL("https://data.gov.il/api/3/action/datastore_search");
      url.searchParams.set("resource_id", REGISTER_RESOURCE);
      url.searchParams.set("limit", "1");
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { result?: { total?: number } };
      const total = payload.result?.total;
      if (typeof total !== "number") throw new Error("תשובה לא צפויה מהמרשם");
      register = { ok: true, total };
    } catch (error) {
      register = { ok: false, error: (error as Error).message };
    }

    // 3. Station-specific prices.
    let prices: StationDiagnostics["prices"];
    try {
      const snapshot = await getDocs(
        query(collection(db, "stationPriceAggregates"), limit(500)),
      );
      let fresh = 0;
      let newest: number | null = null;
      for (const document of snapshot.docs) {
        const verified = Number(document.data().lastVerifiedAt) || null;
        if (verified === null) continue;
        if (Date.now() - verified < AGGREGATE_FRESH_MS) fresh += 1;
        if (newest === null || verified > newest) newest = verified;
      }
      prices = { ok: true, count: snapshot.size, fresh, newest };
    } catch (error) {
      prices = { ok: false, error: (error as Error).message };
    }

    setData({ catalog, register, prices });
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const catalogStale =
    data?.catalog.ok &&
    data.register.ok &&
    data.catalog.registryCount !== null &&
    data.catalog.registryCount !== data.register.total;

  return (
    <Panel
      title="נתוני תחנות"
      trailing={
        <RefreshButton
          busy={checking}
          label="בדיקה עכשיו"
          onClick={() =>
            void check().then(() => showToast({ tone: "success", title: "הבדיקה הושלמה" }))
          }
        />
      }
      bare
    >
      <Card className="flex flex-col gap-3 p-4">
        {!data ? (
          <Skeleton className="h-[120px] rounded-[12px]" />
        ) : (
          <>
            <DiagnosticRow
              title="קטלוג התחנות (קובץ סטטי)"
              ok={data.catalog.ok}
              value={
                data.catalog.ok
                  ? `${num(data.catalog.count, 0)} עם נ״צ · ${num(data.catalog.registryCount ?? data.catalog.count, 0)} במרשם`
                  : "לא נטען"
              }
              detail={
                data.catalog.ok
                  ? `נבנה ${data.catalog.generatedAt ? new Date(data.catalog.generatedAt).toLocaleDateString("he-IL") : "—"} · מקור עודכן ${
                      data.catalog.sourceUpdatedAt
                        ? new Date(data.catalog.sourceUpdatedAt).toLocaleDateString("he-IL")
                        : "—"
                    }`
                  : data.catalog.error
              }
            />

            {data.catalog.ok ? (
              <div className="flex flex-col gap-3 border-b border-[var(--hairline)] py-2">
                {data.catalog.brands.map(([brand, count], _, brands) => (
                  <div key={brand} className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 text-[13.5px]">
                    <StationBrandMark brand={brand} size={26} />
                    <div className="flex min-w-0 flex-col gap-1"><span>{brand}</span><span aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-surface-2"><span className="block h-full rounded-pill bg-accent/40" style={{width:`${count / Math.max(1, ...brands.map(([, n]) => n)) * 100}%`}} /></span></div>
                    <Num className="font-semibold">{num(count, 0)}</Num>
                  </div>
                ))}
              </div>
            ) : null}

            <DiagnosticRow
              title="מרשם משרד האנרגיה (data.gov.il)"
              ok={data.register.ok}
              value={data.register.ok ? `${num(data.register.total, 0)} תחנות` : "לא נקרא"}
              detail={
                data.register.ok
                  ? catalogStale
                    ? "המרשם השתנה — יש להריץ scripts/buildStationCatalog.mjs ולפרוס"
                    : "הקטלוג המשולח תואם למרשם"
                  : data.register.error
              }
            />

            <DiagnosticRow
              title="מחירים לפי תחנה"
              ok={data.prices.ok && data.prices.count > 0}
              value={
                data.prices.ok
                  ? `${num(data.prices.count, 0)} תחנות · ${num(data.prices.fresh, 0)} עדכניות`
                  : "לא נקרא"
              }
              detail={
                !data.prices.ok
                  ? data.prices.error
                  : data.prices.count === 0
                    ? "אין אף מחיר ספציפי לתחנה. אין ספק חיצוני מחובר, ודיווחי נהגים נצברים רק על ידי פונקציית שרת (Blaze)."
                    : `העדכני ביותר: ${data.prices.newest ? dayMonthShort(data.prices.newest) : "—"}`
              }
            />

            <div className="flex items-center justify-between text-[13.5px] text-muted">מקור המחיר ליד כל תחנה<InfoTip label="איך מוצג מחיר התחנה"><p>כשאין מחיר ספציפי לתחנה מוצג המחיר הארצי, עם התווית „מחיר ארצי”. מחיר תחנה שנמשך או דווח מוצג עם מקורו ומועד העדכון.</p></InfoTip></div>
          </>
        )}
      </Card>
    </Panel>
  );
}

/** One checked source: a status dot, the figure, and one line of detail. */
function DiagnosticRow({
  title,
  ok,
  value,
  detail,
}: {
  title: string;
  ok: boolean;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-2 border-b border-[var(--hairline)] last:border-b-0">
      <span className={`size-[7px] flex-none rounded-full ${ok ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[15.5px] font-semibold">{title}</span>
      <span className="text-[13.5px] text-muted">{value}</span>
      <InfoTip label={`פרטים · ${title}`}><p className="break-words">{detail}</p></InfoTip>
    </div>
  );
}

/** The anonymous pool that powers the peer comparison, shown for auditing. */
function BenchmarkPool() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    void getCountFromServer(collection(db, 'benchmarks')).then(snapshot => { if (current) setCount(snapshot.data().count); }).catch(() => { if (current) setCount(null); });
    return () => { current = false; };
  }, []);

  return (
    <Panel title="מאגר ההשוואה">
      <div className="flex items-center justify-between gap-3 p-4">
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-ink">רשומות משתתפות</span>
          <span className="text-[12px] text-muted">
            סיכומי צריכה ללא שם או מייל. מזהי התרומות מקושרים לחשבון.
          </span>
        </span>
        <Num className="text-[19px] font-bold text-ink">{count ?? "—"}</Num>
      </div>
    </Panel>
  );
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="admin-tile">
      <span className="text-[13px] text-muted">{label}</span>
      <Num className="text-right text-[26px] font-bold leading-tight text-ink">
        {value}
      </Num>
    </div>
  );
}


/** Distance-weighted consumption across a summary's vehicles. */
function consumptionOf(summary: UserSummary): string {
  let km = 0;
  let liters = 0;
  for (const vehicle of Object.values(summary.vehicles ?? {})) {
    if (vehicle.kmPerLiter && vehicle.kmPerLiter > 0 && vehicle.trackedKm > 0) {
      km += vehicle.trackedKm;
      liters += vehicle.trackedKm / vehicle.kmPerLiter;
    }
  }
  return liters > 0 ? num(km / liters, 1) : "—";
}

function costOf(summary: UserSummary | null): number {
  return Object.values(summary?.vehicles ?? {}).reduce(
    (sum, vehicle) => sum + (vehicle.ledger ? vehicle.ledger.totalAgorot / 100 : vehicle.cost),
    0,
  );
}
