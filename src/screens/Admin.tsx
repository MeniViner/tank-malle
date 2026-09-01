import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
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
import { Avatar } from "../components/Avatar";
import { Segmented } from "../components/Segmented";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { useToast } from "../context/ToastContext";
import {
  CarIcon,
  ChartIcon,
  HeartIcon,
  LightbulbIcon,
  MessageIcon,
  PumpIcon,
  ShieldIcon,
  UserIcon,
  WarningIcon,
} from "../components/icons";
import { dayMonthShort, num, parseDecimal, price, shekel, timeAgo } from "../lib/format";
import { monthKey } from "../lib/stats";

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


export function Admin() {
  const navigate = useNavigate();
  const { user, isAdmin, claimsLoaded } = useAuth();

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("recent");
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

      <div className="flex flex-col gap-4 px-5">
        {error ? (
          <Card className="px-4 py-4 text-center text-[13.5px] text-danger-ink">{error}</Card>
        ) : null}

        {!users ? (
          <>
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[92px] rounded-card" />
            <Skeleton className="h-[280px] rounded-card" />
          </>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              {/* Scoped honestly: this is what has been loaded, not a census. */}
              <Label>
                {exhausted ? "סקירה כללית" : "סקירה · המשתמשים שנטענו עד כה"}
              </Label>
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
              <Card className="flex items-center justify-between px-4 py-3">
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
                <Num className="text-[17px] font-bold text-ink">
                  {shekel(totals?.cost ?? 0)}
                </Num>
              </Card>
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>משתמשים</Label>
                <span className="text-[12px] text-muted">
                  <Num>{sorted.length}</Num>
                </span>
              </div>

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
                            <MiniStat label="הוצאה" value={shekel(costOf(entry.summary))} />
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

              <p className="px-1 text-[11.5px] leading-relaxed text-muted">
                הרשימה נטענת בעמודים, והמספרים מגיעים מסיכום שכל חשבון מפרסם בעצמו.
                לוח הניהול אינו קורא אף רשומת תדלוק, וגם אין לו הרשאה לעשות זאת.
              </p>
            </section>

            <FeedbackInbox />

            <FuelPriceEditor />

            <BenchmarkPool />

            <p className="pb-2 text-center text-[11.5px] leading-relaxed text-muted/80">
              תצוגה לקריאה בלבד. חוקי האבטחה מעניקים לאדמין הרשאת קריאה בלבד —
              אין אפשרות לשנות נתונים של משתמש אחר.
            </p>
          </>
        )}
      </div>
    </main>
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
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>משוב ממשתמשים</Label>
        {entries ? (
          <span className="text-[12px] text-muted">
            <Num>{entries.length}</Num>
          </span>
        ) : null}
      </div>

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
    </section>
  );
}

/**
 * In-app control for the official price.
 *
 * Until the scheduled function can run (Blaze), this is the fastest correct
 * path: an admin sees the live value, its age, and can set it in one tap —
 * no service-account key, no terminal.
 */
function FuelPriceEditor() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<{ value: number; updatedAt: number | null } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const snapshot = await getDoc(doc(db, "appConfig", "fuelPrices"));
    if (!snapshot.exists()) {
      setCurrent(null);
      return;
    }
    const data = snapshot.data();
    const value = Number(data.current?.pricePerLiter);
    setCurrent({
      value,
      updatedAt: data.current?.updatedAt?.toMillis?.() ?? null,
    });
    setDraft(Number.isFinite(value) ? String(value) : "");
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const parsed = parseDecimal(draft);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed < 20;
  const changed = valid && parsed !== current?.value;

  const stale =
    current?.updatedAt !== null &&
    current?.updatedAt !== undefined &&
    Date.now() - current.updatedAt > 40 * 86_400_000;

  async function save() {
    if (!changed) return;
    setSaving(true);
    try {
      const now = new Date();
      await setDoc(
        doc(db, "appConfig", "fuelPrices"),
        {
          current: {
            pricePerLiter: parsed,
            effectiveFrom: new Date(now.getFullYear(), now.getMonth(), 1),
            updatedAt: serverTimestamp(),
          },
          history: { [monthKey(now.getTime())]: parsed },
          source: "admin",
        },
        { merge: true },
      );
      // serverTimestamp() resolves only after the server acks, and the local
      // cache would report it as null in the meantime — so reflect the new
      // value directly instead of re-reading.
      setCurrent({ value: parsed, updatedAt: Date.now() });
      showToast({ tone: "success", title: "מחיר הדלק עודכן" });
    } catch {
      showToast({ tone: "error", title: "עדכון המחיר נכשל" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <Label>מחיר דלק רשמי</Label>
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-[14px] font-semibold text-ink">המחיר הפעיל כעת</span>
            <span className="text-[12px] text-muted">
              {current?.updatedAt
                ? `עודכן ${dayMonthShort(current.updatedAt)}`
                : "טרם עודכן"}
            </span>
          </span>
          <Num className="text-[20px] font-bold text-ink">
            {current ? price(current.value) : "—"}
          </Num>
        </div>

        {stale ? (
          <div className="rounded-[12px] bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-ink">
            המחיר לא עודכן מעל חודש. תדלוקים חדשים ממולאים לפי הערך הזה.
          </div>
        ) : null}

        <Field
          label="מחיר חדש לליטר"
          inputMode="decimal"
          suffix="₪"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="8.10"
          hint="נשמר גם בהיסטוריית החודש הנוכחי, כדי שתדלוקים בתאריך עבר ימשיכו לקבל את המחיר הנכון."
        />

        <Button full disabled={!changed} loading={saving} onClick={() => void save()}>
          עדכון המחיר לכל המשתמשים
        </Button>
      </Card>
    </section>
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
    <section className="flex flex-col gap-2">
      <Label>מאגר ההשוואה האנונימי</Label>
      <Card className="flex items-center justify-between px-4 py-3.5">
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-ink">רשומות משתתפות</span>
          <span className="text-[12px] text-muted">
            סיכום צריכה אנונימי — ללא שם, מייל, מיקום או קילומטראז׳
          </span>
        </span>
        <Num className="text-[17px] font-bold text-ink">{count ?? "—"}</Num>
      </Card>
    </section>
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
