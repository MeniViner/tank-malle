import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import {
  aggregateSummaries,
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
import { useToast } from "../context/ToastContext";
import {
  CarIcon,
  ChartIcon,
  HeartIcon,
  LightbulbIcon,
  MessageIcon,
  PumpIcon,
  RefreshIcon,
  ShieldIcon,
  UserIcon,
  WarningIcon,
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

type SortKey = "recent" | "activity" | "joined";

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
  const [sort, setSort] = useState<SortKey>("recent");
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
        const constraints = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];
        const usersSnapshot = await getDocs(
          cursor
            ? query(collection(db, "users"), ...constraints, startAfter(cursor))
            : query(collection(db, "users"), ...constraints),
        );

        const rows = await Promise.all(
          usersSnapshot.docs.map(async (userDoc) => {
            const data = userDoc.data();

            let summary: UserSummary | null = null;
            try {
              const snapshot = await getDoc(doc(db, "userSummaries", userDoc.id));
              if (snapshot.exists()) summary = snapshot.data() as UserSummary;
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
              displayName: data.displayName ?? null,
              email: data.email ?? null,
              photoURL: data.photoURL ?? null,
              createdAt: data.createdAt?.toMillis?.() ?? null,
              isAdmin: Boolean(data.isAdmin),
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
    const copy = [...users];
    if (sort === "recent") copy.sort((a, b) => (b.lastFillup ?? 0) - (a.lastFillup ?? 0));
    else if (sort === "activity") copy.sort((a, b) => b.fillups - a.fillups);
    else copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return copy;
  }, [users, sort]);

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
        <ScreenHeader title="ניהול" onBack={() => navigate("/")} />
        <div className="px-5">
          <Card className="flex flex-col items-center gap-3 px-7 py-12 text-center">
            <IconTile tone="danger">
              <ShieldIcon size={18} />
            </IconTile>
            <span className="text-[17px] font-bold text-ink">אין גישה</span>
            <span className="max-w-[260px] text-[13.5px] leading-relaxed text-muted">
              האזור הזה פתוח למנהלי מערכת בלבד.
              {user ? " אם קיבלתם הרשאה זה עתה, התנתקו והתחברו מחדש." : ""}
            </span>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <ScreenHeader
        title="ניהול"
        onBack={() => navigate("/settings")}
        trailing={
          <span className="rounded-pill bg-accent-soft px-2.5 py-1 text-[11.5px] font-bold text-accent">
            אדמין
          </span>
        }
      />

      {/* Four sections, one at a time. */}
      <nav aria-label="מדורי ניהול" className="grid flex-none grid-cols-4 gap-1.5 px-5 pb-3">
        {ADMIN_TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-current={tab === entry.value ? "page" : undefined}
            onClick={() => setTab(entry.value)}
            className={`min-h-[34px] rounded-pill px-1 text-[12.5px] font-semibold transition-[background-color,color] duration-200 ${
              tab === entry.value
                ? "bg-accent text-accent-contrast"
                : "bg-surface-2 text-muted"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-4 px-5">
        {error ? (
          <Card className="flex items-start gap-3 p-4">
            <IconTile tone="danger">
              <WarningIcon size={17} />
            </IconTile>
            <span className="flex-1 text-[13.5px] leading-relaxed text-danger-ink">
              {error}
            </span>
          </Card>
        ) : null}

        {!users ? (
          <>
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[280px] rounded-card" />
          </>
        ) : (
          <>
            {tab === "overview" ? (
              <>
                <Panel
                  title="סקירה"
                  /* Scoped honestly: this is what has been loaded, not a census. */
                  note={
                    exhausted
                      ? "כל המשתמשים נטענו"
                      : "מבוסס על המשתמשים שנטענו עד כה"
                  }
                  bare
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                      <StatTile
                        icon={<UserIcon size={17} />}
                        label="משתמשים"
                        value={num(totals?.users ?? 0, 0)}
                        meta={`${num(totals?.active ?? 0, 0)} פעילים החודש`}
                      />
                      <StatTile
                        icon={<CarIcon size={17} />}
                        label="רכבים"
                        value={num(totals?.vehicles ?? 0, 0)}
                      />
                    </div>
                    <div className="flex gap-3">
                      <StatTile
                        icon={<PumpIcon size={17} />}
                        label="תדלוקים"
                        value={num(totals?.fillups ?? 0, 0)}
                        meta={`${num(totals?.liters ?? 0, 0)} ליטר`}
                      />
                      <StatTile
                        icon={<ChartIcon size={17} />}
                        label="צריכה ממוצעת"
                        value={totals?.kmPerLiter ? num(totals.kmPerLiter, 1) : "—"}
                        meta={
                          totals && totals.withoutSummary > 0
                            ? `קמ״ל · ${totals.withoutSummary} ללא סיכום`
                            : "קמ״ל · משוקלל לפי מרחק"
                        }
                        accent
                      />
                    </div>
                  </div>
                </Panel>

                <Panel title="הוצאה מצטברת">
                  <div className="flex items-center justify-between gap-3 p-4">
                    <span className="flex flex-col">
                      <span className="text-[14px] font-semibold text-ink">
                        סך ההוצאה שתועדה
                      </span>
                      {totals && totals.withoutSummary > 0 ? (
                        <span className="text-[11.5px] text-muted">
                          <Num>{totals.withoutSummary}</Num> משתמשים עדיין ללא סיכום
                        </span>
                      ) : null}
                    </span>
                    <Num className="text-[19px] font-bold text-ink">
                      {shekel(totals?.cost ?? 0)}
                    </Num>
                  </div>
                </Panel>

                <BenchmarkPool />

                <p className="px-1 pb-2 text-[11.5px] leading-relaxed text-muted">
                  המספרים מגיעים מסיכום שכל חשבון מפרסם בעצמו. לוח הניהול אינו קורא
                  אף רשומת תדלוק, וגם אין לו הרשאה לעשות זאת.
                </p>
              </>
            ) : null}

            {tab === "users" ? (
              <Panel
                title="משתמשים"
                trailing={
                  <span className="text-[12px] font-semibold text-muted">
                    <Num>{sorted.length}</Num>
                  </span>
                }
                bare
              >
                <div className="flex flex-col gap-2">
                  <Segmented
                    size="sm"
                    value={sort}
                    onChange={setSort}
                    ariaLabel="מיון משתמשים"
                    options={[
                      { value: "recent", label: "פעילות אחרונה" },
                      { value: "activity", label: "הכי פעילים" },
                      { value: "joined", label: "הצטרפות" },
                    ]}
                  />

                  {sorted.length === 0 ? (
                    <Card className="px-6 py-10 text-center text-[14px] text-muted">
                      אין עדיין משתמשים
                    </Card>
                  ) : (
                    <ListCard>
                      {sorted.map((entry) => (
                        <div key={entry.uid} className="flex flex-col gap-2 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar
                              name={entry.displayName}
                              photoURL={entry.photoURL}
                              size={38}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[15px] font-semibold text-ink">
                                  {entry.displayName ?? "ללא שם"}
                                </span>
                                {entry.isAdmin ? (
                                  <span className="flex-none rounded-pill bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold text-accent">
                                    אדמין
                                  </span>
                                ) : null}
                              </span>
                              <span dir="ltr" className="truncate text-[12px] text-muted">
                                {entry.email ?? "—"}
                              </span>
                            </div>
                            <span className="flex-none text-[11.5px] text-muted">
                              {entry.lastFillup ? timeAgo(entry.lastFillup) : "לא תדלק"}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 ps-[50px]">
                            <MiniStat label="רכבים" value={num(entry.vehicles, 0)} />
                            <MiniStat label="תדלוקים" value={num(entry.fillups, 0)} />
                            <MiniStat
                              label="הצטרף"
                              value={entry.createdAt ? dayMonthShort(entry.createdAt) : "—"}
                            />

                            {/* From the account's own published summary. The
                                dashboard reads no fill-up records at all. */}
                            {entry.summary ? (
                              <>
                                <MiniStat
                                  label="קמ״ל"
                                  value={consumptionOf(entry.summary)}
                                />
                                <MiniStat
                                  label="הוצאה"
                                  value={shekel(costOf(entry.summary))}
                                />
                              </>
                            ) : (
                              <span className="rounded-pill bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-muted">
                                עדיין ללא סיכום
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </ListCard>
                  )}

                  {!exhausted ? (
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => void load(pageCursor)}
                      className="min-h-[44px] rounded-[12px] bg-surface-2 text-[13.5px] font-semibold text-accent disabled:opacity-50"
                    >
                      {loadingMore ? "טוען…" : `טעינת ${PAGE_SIZE} משתמשים נוספים`}
                    </button>
                  ) : null}
                </div>
              </Panel>
            ) : null}

            {tab === "data" ? (
              <>
                <FuelPriceEditor />
                <StationDataPanel />
              </>
            ) : null}

            {tab === "feedback" ? <FeedbackInbox /> : null}

            <p className="pb-2 text-center text-[11.5px] leading-relaxed text-muted/80">
              נתוני משתמשים הם לקריאה בלבד. חוקי האבטחה מעניקים לאדמין הרשאת קריאה —
              אין אפשרות לשנות נתונים של משתמש אחר.
            </p>
          </>
        )}
      </div>
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
    <section className="flex flex-col gap-2">
      <div className="flex min-h-[26px] items-center justify-between gap-2">
        <Label>{title}</Label>
        {trailing}
      </div>
      {note ? <p className="-mt-1 text-[11.5px] text-muted">{note}</p> : null}
      {bare ? children : <Card className="overflow-hidden">{children}</Card>}
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
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      // orderBy needs an index the first time; fall back to client sorting.
      try {
        const snapshot = await getDocs(
          query(collection(db, "feedback"), orderBy("createdAt", "desc"), limit(200)),
        );
        return snapshot;
      } catch {
        return getDocs(query(collection(db, "feedback"), limit(200)));
      }
    };

    void load()
      .then((snapshot) => {
        const rows = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            message: String(data.message ?? ""),
            sentiment: (data.sentiment ?? null) as FeedbackEntry["sentiment"],
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            appVersion: data.appVersion ?? null,
            createdAt: data.createdAt?.toMillis?.() ?? null,
          } satisfies FeedbackEntry;
        });
        rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        setEntries(rows);
      })
      .catch(() => setEntries([]));
  }, []);

  return (
    <Panel
      title="משוב ממשתמשים"
      bare
      trailing={
        entries ? (
          <span className="text-[12px] font-semibold text-muted">
            <Num>{entries.length}</Num>
          </span>
        ) : null
      }
    >
      {!entries ? (
        <Skeleton className="h-[120px] rounded-card" />
      ) : entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <IconTile tone="muted">
            <MessageIcon size={18} />
          </IconTile>
          <span className="text-[14px] text-muted">עוד לא התקבל משוב</span>
        </Card>
      ) : (
        <ListCard>
          {entries.map((entry) => {
            const meta = entry.sentiment ? SENTIMENT[entry.sentiment] : null;
            const isOpen = expanded === entry.id;
            const isLong = entry.message.length > 150;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setExpanded(isOpen ? null : entry.id)}
                className="flex w-full flex-col gap-2 px-4 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2"
              >
                <div className="flex items-center gap-2.5">
                  {meta ? (
                    <IconTile tone={meta.tone} className="size-7 rounded-[9px]">
                      <meta.Icon size={15} />
                    </IconTile>
                  ) : null}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold text-ink">
                      {entry.displayName ?? "משתמש"}
                    </span>
                    <span dir="ltr" className="truncate text-[11.5px] text-muted">
                      {entry.email ?? "—"}
                    </span>
                  </span>
                  <span className="flex-none text-[11px] text-muted">
                    {entry.createdAt ? timeAgo(entry.createdAt) : "—"}
                  </span>
                </div>

                <p
                  className={`whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/85 ${
                    isOpen ? "" : "line-clamp-3"
                  }`}
                >
                  {entry.message}
                </p>

                {isLong ? (
                  <span className="text-[11.5px] font-semibold text-accent">
                    {isOpen ? "הצג פחות" : "הצג הכול"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </ListCard>
      )}
    </Panel>
  );
}

/**
 * In-app control for the official prices — every fuel type, not just 95.
 *
 * The old editor wrote one number into the legacy top-level field, which the
 * adapter files under 95/self. A driver on diesel or 98 therefore had no
 * official figure at all and nothing an admin could do about it. Each fuel
 * type is now its own series, written where `regulatedMaxPrice` reads it.
 *
 * The 95 figure arrives on its own: a daily GitHub Actions job reads the
 * ministry's monthly announcement and writes it here (scripts/updateFuelPrices
 * .mjs). A browser cannot do that itself — the page is Cloudflare-protected
 * and sends no CORS headers — so the refresh below re-reads the stored
 * document from the SERVER, which is how an admin sees whether the job landed.
 * 98 and diesel are not regulated in Israel at all; there is no published
 * figure to fetch, so they stay manual and say so.
 */
const EDITABLE_FUELS: { fuelType: FuelType; label: string }[] = [
  { fuelType: "95", label: "בנזין 95" },
  { fuelType: "98", label: "בנזין 98" },
  { fuelType: "diesel", label: "סולר" },
  { fuelType: "other", label: "אחר" },
];

/** Which copy answered the last read — shown beside the panel title. */
type ReadSource = "server" | "cache" | null;

/** Firestore's error shape, duck-typed so this file needs no SDK error class. */
function firestoreCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "unknown";
}

function daysAgoText(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "רץ היום";
  if (days === 1) return "רץ אתמול";
  return `רץ לפני ${days} ימים`;
}

function FuelPriceEditor() {
  const { showToast } = useToast();
  const { isAdmin, claimsLoaded } = useAuth();
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
          snapshot = await getDocFromServer(ref);
          source = "server";
        } catch {
          snapshot = await getDoc(ref);
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

  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load]);

  /** The Hebrew reason a write was refused, precise enough to act on. */
  function writeErrorTitle(error: unknown): string {
    const code = firestoreCode(error);
    if (code === "permission-denied") {
      return "אין הרשאת מנהל (custom claim admin) — ראו scripts/grantAdmin.mjs";
    }
    if (code === "unavailable") return "השרת לא זמין — נסו שוב";
    return `השמירה נכשלה (${code})`;
  }

  /** Apply a merged write locally, so the row reflects it before any ack. */
  function applyLocal(
    fuelType: FuelType,
    update: (series: RegulatedSeries | undefined) => RegulatedSeries,
  ) {
    setConfig((previous) => {
      const base = previous ?? { byFuelType: {} };
      const series = base.byFuelType?.[fuelType]?.[REGULATED_SERVICE_MODE];
      return {
        ...base,
        byFuelType: {
          ...base.byFuelType,
          [fuelType]: {
            ...base.byFuelType?.[fuelType],
            [REGULATED_SERVICE_MODE]: update(series),
          },
        },
      };
    });
  }

  /**
   * Commit a merged write. Online, the server's answer is awaited so a refused
   * write is reported and the draft kept. Offline, a Firestore promise never
   * settles until the connection returns, so it is NOT awaited: the local
   * cache holds the change and the toast says exactly that — never
   * "עודכן לכל המשתמשים" before an ack.
   */
  async function commit(payload: Record<string, unknown>, successTitle: string) {
    const ref = doc(db, "appConfig", "fuelPrices");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setDoc(ref, payload, { merge: true }).catch((error: unknown) =>
        showToast({ tone: "error", title: writeErrorTitle(error) }),
      );
      showToast({ tone: "info", title: "נשמר במכשיר — יישלח כשיחזור החיבור" });
      return;
    }
    await setDoc(ref, payload, { merge: true });
    showToast({ tone: "success", title: successTitle });
  }

  /** A manual entry for the current month. Never labelled "מפוקח". */
  async function save(fuelType: FuelType, value: number) {
    const now = new Date();
    const month = monthKey(now.getTime());
    const effectiveFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    await commit(
      {
        byFuelType: {
          [fuelType]: {
            [REGULATED_SERVICE_MODE]: {
              current: {
                pricePerLiter: value,
                effectiveFrom,
                updatedAt: serverTimestamp(),
              },
              history: { [month]: value },
              source: "manual",
              manualOverride: {
                pricePerLiter: value,
                month,
                setAt: serverTimestamp(),
                note: null,
              },
            },
          },
        },
      },
      "המחיר עודכן לכל המשתמשים",
    );
    // serverTimestamp() resolves only after the server acks, so reflect the
    // new value locally rather than re-reading a null timestamp.
    applyLocal(fuelType, (series) => ({
      ...series,
      history: { ...(series?.history ?? {}), [month]: value },
      current: {
        pricePerLiter: value,
        effectiveFrom: effectiveFrom.getTime(),
        updatedAt: Date.now(),
      },
      source: "manual" as const,
      manualOverride: { pricePerLiter: value, month, setAt: Date.now(), note: null },
    }));
  }

  /** Clear the override and put the job's figure for that month back in force. */
  async function restoreScheduled(fuelType: FuelType, month: string, scheduled: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const effectiveFrom = new Date(year, monthNumber - 1, 1);
    await commit(
      {
        byFuelType: {
          [fuelType]: {
            [REGULATED_SERVICE_MODE]: {
              manualOverride: null,
              history: { [month]: scheduled },
              current: {
                pricePerLiter: scheduled,
                effectiveFrom,
                updatedAt: serverTimestamp(),
              },
              source: "scheduled",
            },
          },
        },
      },
      "הערך האוטומטי הוחזר",
    );
    applyLocal(fuelType, (series) => ({
      ...series,
      history: { ...(series?.history ?? {}), [month]: scheduled },
      current: {
        pricePerLiter: scheduled,
        effectiveFrom: effectiveFrom.getTime(),
        updatedAt: Date.now(),
      },
      source: "scheduled" as const,
      manualOverride: null,
    }));
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

  return (
    <Panel
      title="מחירי דלק רשמיים"
      note={
        readSource === "server"
          ? "נקרא מהשרת"
          : readSource === "cache"
            ? "מוצג עותק מקומי"
            : undefined
      }
      trailing={
        <RefreshButton
          busy={loading}
          label="בדיקת עדכון"
          onClick={() =>
            void load(true)
              .then((source) =>
                source === "server"
                  ? showToast({ tone: "success", title: "נקרא מהשרת" })
                  : showToast({ tone: "info", title: "השרת לא זמין — מוצג עותק מקומי" }),
              )
              .catch(() => showToast({ tone: "error", title: "הקריאה נכשלה" }))
          }
        />
      }
      bare
    >
      <Card className="flex flex-col gap-3 p-4">
        {/* Whether the nightly job is alive, stated before the numbers it
            writes — the question an admin opens this panel to answer. */}
        <DiagnosticRow
          title="עדכון אוטומטי (95)"
          ok={automatic.ok}
          value={automatic.value}
          detail={automatic.detail}
        />

        <DiagnosticRow
          title="הרשאת כתיבה"
          ok={isAdmin}
          value={!claimsLoaded ? "בודק…" : isAdmin ? "custom claim admin קיים" : "חסר"}
          detail={
            isAdmin
              ? "האסימון של החשבון הזה נושא claim admin; שמירה כאן תתקבל בשרת."
              : "ללא claim admin כל שמירה תידחה (permission-denied). מוענק רק מהמחשב של המפתח: scripts/grantAdmin.mjs."
          }
        />

        {EDITABLE_FUELS.map(({ fuelType, label }) => {
          const series = config?.byFuelType?.[fuelType]?.[REGULATED_SERVICE_MODE];
          return (
            <FuelPriceRow
              key={fuelType}
              label={label}
              lookup={regulatedMaxPrice(config, fuelType, now)}
              series={series}
              onSave={(value) => save(fuelType, value)}
              onRestore={(month, scheduled) => restoreScheduled(fuelType, month, scheduled)}
            />
          );
        })}

        <p className="text-[11.5px] leading-relaxed text-muted">
          בנזין 95 מתעדכן אוטומטית: משימה יומית ב־GitHub Actions קוראת את הודעת
          משרד האנרגיה לאותו חודש וכותבת אותה לכאן, בחינם. מחיר שהוזן כאן ידנית
          גובר על הערך האוטומטי רק בחודש שבו הוזן, ולעולם אינו מוצג כ״מחיר מרבי
          מפוקח״. 98 וסולר אינם בפיקוח ואין להם מחיר מפורסם — הם נשארים ידניים.
        </p>
      </Card>
    </Panel>
  );
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
      className="flex min-h-[32px] flex-none items-center gap-1.5 rounded-pill bg-surface-2 px-3 text-[12.5px] font-semibold text-accent transition-[background-color,scale] duration-200 active:scale-[0.97] disabled:opacity-50"
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
}: {
  label: string;
  lookup: RegulatedLookup;
  series: RegulatedSeries | undefined;
  onSave: (value: number) => Promise<void>;
  onRestore: (month: string, scheduled: number) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

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

  return (
    <div className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-ink">{label}</span>
        <span className="flex items-baseline gap-2">
          <span
            className={`text-[11.5px] ${currentMonth ? "text-muted" : "text-warning-ink"}`}
          >
            {sourceText}
          </span>
          <Num className="text-[17px] font-bold text-ink">
            {lookup.price !== null ? price(lookup.price) : "—"}
          </Num>
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* A compact inline input rather than a full Field: four labelled
            fields stacked would say the fuel name twice per row. */}
        <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-[12px] border border-line bg-surface px-3 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]">
          <span className="text-[13px] text-muted">₪</span>
          <input
            inputMode="decimal"
            aria-label={`מחיר חדש לליטר · ${label}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={lookup.price !== null ? String(lookup.price) : "8.10"}
            className="num min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </label>
        <Button
          disabled={!changed}
          loading={saving}
          onClick={() => {
            setSaving(true);
            // The draft is cleared only on success: a refused write keeps
            // what was typed so it can be retried once the claim exists.
            void onSave(parsed)
              .then(() => setDraft(""))
              .catch((error: unknown) =>
                showToast({ tone: "error", title: failureTitle(error) }),
              )
              .finally(() => setSaving(false));
          }}
        >
          שמירה
        </Button>
      </div>

      {overrideActive && scheduledForMonth !== null && override ? (
        <button
          type="button"
          disabled={restoring}
          onClick={() => {
            setRestoring(true);
            void onRestore(override.month, scheduledForMonth)
              .catch((error: unknown) =>
                showToast({ tone: "error", title: failureTitle(error) }),
              )
              .finally(() => setRestoring(false));
          }}
          className="self-start text-[12.5px] font-semibold text-accent disabled:opacity-50"
        >
          {restoring ? "מחזיר…" : `החזרת הערך האוטומטי (${price(scheduledForMonth)})`}
        </button>
      ) : null}
    </div>
  );
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
              <div className="flex flex-wrap gap-1.5">
                {data.catalog.brands.map(([brand, count]) => (
                  <span
                    key={brand}
                    className="flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-muted"
                  >
                    <StationBrandMark brand={brand} size={18} />
                    {brand} <Num>{count}</Num>
                  </span>
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

            <p className="text-[11.5px] leading-relaxed text-muted">
              כל עוד אין מחיר ספציפי לתחנה, שורת תחנה מציגה את המחיר הארצי בסימון
              „מחיר ארצי”. מחיר שדווח או נמשך באמת מוצג בירוק עם מקורו וגילו.
            </p>
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
    <div className="flex flex-col gap-0.5 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span
            aria-hidden="true"
            className={`size-[7px] flex-none rounded-full ${ok ? "bg-success" : "bg-warning"}`}
          />
          {title}
        </span>
        <span className="flex-none text-[12.5px] font-semibold text-ink">{value}</span>
      </div>
      <span className="text-[11.5px] leading-relaxed text-muted">{detail}</span>
    </div>
  );
}

/** The anonymous pool that powers the peer comparison, shown for auditing. */
function BenchmarkPool() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    getDocs(query(collectionGroup(db, "benchmarks"), limit(500)))
      .then((snapshot) => setCount(snapshot.size))
      .catch(() =>
        getDocs(query(collection(db, "benchmarks"), limit(500)))
          .then((snapshot) => setCount(snapshot.size))
          .catch(() => setCount(null)),
      );
  }, []);

  return (
    <Panel title="מאגר ההשוואה האנונימי">
      <div className="flex items-center justify-between gap-3 p-4">
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-ink">רשומות משתתפות</span>
          <span className="text-[12px] text-muted">
            סיכום צריכה אנונימי — ללא שם, מייל, מיקום או קילומטראז׳
          </span>
        </span>
        <Num className="text-[19px] font-bold text-ink">{count ?? "—"}</Num>
      </div>
    </Panel>
  );
}

function StatTile({
  icon,
  label,
  value,
  meta,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta?: string;
  accent?: boolean;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <span className="flex items-center gap-2 text-muted">
        {icon}
        <Label className="text-[12.5px]">{label}</Label>
      </span>
      <Num className={`text-[22px] font-bold leading-tight ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </Num>
      {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 text-[11.5px]">
      <span className="text-muted">{label}</span>
      <Num className="font-bold text-ink">{value}</Num>
    </span>
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

function costOf(summary: UserSummary): number {
  return Object.values(summary.vehicles ?? {}).reduce(
    (sum, vehicle) => sum + vehicle.cost,
    0,
  );
}
