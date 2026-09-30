import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Avatar } from "../components/Avatar";
import { Card, IconTile, Label } from "../components/Card";
import { RowButton } from "../components/Button";
import { ConfirmDialog } from "../components/Sheet";
import { downloadFillupsCsv } from "../lib/csv";
import { Num } from "../components/Num";
import { computeStats } from "../lib/stats";
import { fullDate, loginMoment, num, price, shekel } from "../lib/format";
import { DownloadIcon, LogoutIcon, ShieldIcon, TrashIcon } from "../components/icons";

/**
 * Profile & account.
 *
 * Identity sits on the same dark hero card the home screen uses, so the two
 * "who/what am I looking at" surfaces read as one family, and the lifetime
 * totals below it are the same stat-card pair. Account SETTINGS are not here —
 * this screen states who you are and what you have logged.
 */
export function Profile() {
  const navigate = useNavigate();
  const { user, signOutUser, isAdmin, previousLoginAt } = useAuth();
  const { outbox, writes, outboxHealth, checkUnacknowledged } = useData();
  const unsynced = outbox.length + writes.pending.length;
  const healthUnknown = outboxHealth.state !== "ok";
  // Device-wide state, read when the dialog opens: other accounts' queued
  // writes count too, because the Firestore cache is shared.
  const [deviceState, setDeviceState] = useState<"none" | "some" | "unknown" | null>(null);
  const [clearLocal, setClearLocal] = useState(false);
  const { fillups, activeVehicle, vehicles, deleteAccount } = useData();
  const stats = useMemo(
    () => computeStats(fillups, activeVehicle),
    [fillups, activeVehicle],
  );

  // Firebase records the real account creation time; fall back to the oldest
  // record we hold if the metadata is unavailable.
  const joinedAt = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).getTime()
    : null;
  // NOT metadata.lastSignInTime: once signed in, that IS the current session,
  // so showing it as "last login" always reported "now". previousLoginAt is
  // rotated once per authentication event and is genuinely the one before.
  const { showToast } = useToast();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Account deletion is irreversible, so it takes two separate confirmations.
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);

  const active = vehicles.filter((vehicle) => !vehicle.archived);
  const avgPricePaid =
    stats.records.totalLiters > 0
      ? stats.records.totalCost / stats.records.totalLiters
      : null;

  async function reallyDelete() {
    setDeleting(true);
    try {
      const result = await deleteAccount();

      // Reauthentication is proved BEFORE anything is deleted, so this branch
      // means nothing was touched — the user can simply try again.
      if (result.needsReauth) {
        showToast({
          tone: "info",
          title: "נדרשת התחברות מחדש לפני המחיקה",
          detail: "לא נמחק דבר. התחברו שוב ונסו שנית.",
        });
        return;
      }

      if (result.ok) {
        showToast({ tone: "success", title: "החשבון וכל הנתונים נמחקו" });
      } else {
        // Never report a clean sweep that did not happen.
        showToast({
          tone: "error",
          title: "המחיקה הושלמה חלקית",
          detail: `לא נמחקו: ${result.failed.join(", ")}. פנו אלינו כדי להשלים.`,
        });
      }
    } catch {
      showToast({
        tone: "error",
        title: "מחיקת החשבון נכשלה",
        detail: "לא בוצע שינוי. נסו שוב בעוד רגע.",
      });
    } finally {
      setDeleting(false);
      setDeleteStep(0);
    }
  }

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <ScreenHeader title="פרופיל" onBack={() => navigate(-1)} />

      <div className="flex flex-col gap-4 px-5">
        <section className="tm-rise flex flex-col gap-3.5 rounded-hero bg-hero p-[16px_18px_15px] text-hero-ink shadow-raised">
          <div className="flex items-center gap-3.5">
            <Avatar name={user?.displayName} photoURL={user?.photoURL} size={62} />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="truncate text-[21px] font-bold leading-tight">
                {user?.displayName ?? "משתמש"}
              </span>
              <span dir="ltr" className="max-w-full truncate text-[13px] text-hero-muted">
                {user?.email}
              </span>
              {isAdmin ? (
                <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-pill bg-hero-soft px-2.5 py-1 text-[11.5px] font-bold">
                  <ShieldIcon size={13} />
                  מנהל מערכת
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-hero-line pt-3 text-[12px] text-hero-muted">
            <span>חבר מאז {joinedAt ? fullDate(joinedAt) : "—"}</span>
            <span>
              {previousLoginAt === undefined
                ? ""
                : previousLoginAt === null
                  ? "זו ההתחברות הראשונה"
                  : `נכנס לאחרונה ${loginMoment(previousLoginAt)}`}
            </span>
          </div>
        </section>

        {/* Lifetime totals — the reason to keep a log in the first place. */}
        <section className="flex flex-col gap-2">
          <Label>הפעילות שלי</Label>
          <div className="flex gap-3">
            <MetricCard
              label="תדלוקים"
              value={num(stats.records.fillupCount, 0)}
              meta={`${num(stats.records.totalLiters, 0)} ליטר בסך הכול`}
            />
            <MetricCard
              label="סה״כ הוצאה"
              value={shekel(stats.records.totalCost)}
              meta={avgPricePaid !== null ? `ממוצע ${price(avgPricePaid)} לליטר` : undefined}
            />
          </div>
          <div className="flex gap-3">
            <MetricCard
              label="ק״מ שתועדו"
              value={num(stats.records.totalKm, 0)}
              unit="ק״מ"
              meta={`על פני ${num(stats.records.fillupCount, 0)} תדלוקים`}
            />
            <MetricCard
              label="רכבים"
              value={num(active.length, 0)}
              meta={
                active.length === 1
                  ? (active[0].nickname?.trim() ||
                    `${active[0].make} ${active[0].model}`.trim())
                  : vehicles.length > active.length
                    ? `${num(vehicles.length - active.length, 0)} בארכיון`
                    : undefined
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>פרטי חשבון</Label>
          <Card className="overflow-hidden">
            <DetailRow label="שיטת התחברות" value="חשבון Google" badge="מחובר" />
            {isAdmin ? <DetailRow label="הרשאות" value="מנהל מערכת" badge="אדמין" /> : null}
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <Label>הנתונים שלי</Label>
          <Card className="overflow-hidden">
            <RowButton
              icon={
                <IconTile tone="muted">
                  <DownloadIcon size={18} />
                </IconTile>
              }
              title="ייצוא הנתונים שלי"
              subtitle="קובץ CSV עם כל התדלוקים"
              onClick={() => {
                if (fillups.length === 0) {
                  showToast({ tone: "info", title: "אין עדיין תדלוקים לייצוא" });
                  return;
                }
                downloadFillupsCsv(fillups, activeVehicle);
                showToast({ tone: "success", title: "הקובץ הורד" });
              }}
            />
          </Card>
        </section>

        <Card className="overflow-hidden">
          {/* Signing out clears the local session and cache, so the next
              sign-in — with this account or another — starts clean. */}
          <RowButton
            icon={
              <IconTile tone="muted">
                <LogoutIcon size={18} />
              </IconTile>
            }
            title="התנתקות"
            subtitle="אפשר להתחבר אחר כך עם כל חשבון Google"
            onClick={() => {
              setDeviceState(null);
              setClearLocal(false);
              void checkUnacknowledged().then(setDeviceState);
              setConfirmSignOut(true);
            }}
          />
          <RowButton
            icon={
              <IconTile tone="danger">
                <TrashIcon size={18} />
              </IconTile>
            }
            title="מחיקת חשבון"
            tone="danger"
            onClick={() => setDeleteStep(1)}
            disabled={deleting}
          />
        </Card>

        <p className="px-1 pb-2 text-[12.5px] leading-relaxed text-muted">
          מחיקת חשבון היא פעולה בלתי הפיכה — כל הרכבים, התדלוקים והנתונים יימחקו לצמיתות.
        </p>
      </div>

      <p className="px-1 text-[12px] leading-relaxed text-muted/80">
        השימוש כפוף{" "}
        <button
          type="button"
          onClick={() => navigate("/legal/terms")}
          className="font-semibold text-accent"
        >
          לתנאי השימוש
        </button>{" "}
        ו
        <button
          type="button"
          onClick={() => navigate("/legal/privacy")}
          className="font-semibold text-accent"
        >
          למדיניות הפרטיות
        </button>
        .
      </p>

      <ConfirmDialog
        open={confirmSignOut}
        title={
          unsynced > 0 || healthUnknown || deviceState === "some" || deviceState === "unknown"
            ? "יש פעולות שעדיין לא סונכרנו"
            : "להתנתק מהחשבון?"
        }
        body={
          <span className="flex flex-col gap-2">
            {unsynced > 0 ? (
              <span>
                <Num>{unsynced}</Num> פעולות של החשבון הזה עוד לא אושרו על ידי השרת. הן יישארו
                שמורות במכשיר הזה ויישלחו בהתחברות הבאה — אבל לא ייראו בחשבון אחר או במכשיר אחר.
                אפשר לבדוק אותן במסך „לא סונכרן״ לפני ההתנתקות.
              </span>
            ) : healthUnknown ? (
              <span>
                לא ניתן לוודא שאין פעולות שלא סונכרנו ({outboxHealth.message ?? "אחסון לא קריא"}).
                שום דבר מקומי לא יימחק.
              </span>
            ) : deviceState === "some" ? (
              <span>חשבון אחר במכשיר הזה עדיין מחזיק פעולות שלא אושרו. הן לא יימחקו.</span>
            ) : deviceState === "unknown" ? (
              <span>לא ניתן לוודא את מצב הפעולות המקומיות. שום דבר מקומי לא יימחק.</span>
            ) : (
              <span>הנתונים יישמרו בענן ויחזרו בהתחברות הבאה. שום דבר מקומי לא נמחק בהתנתקות.</span>
            )}
            {deviceState === "none" && !healthUnknown && unsynced === 0 ? (
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={clearLocal}
                  onChange={(event) => setClearLocal(event.target.checked)}
                />
                למחוק גם את הנתונים המקומיים במכשיר הזה (מחשב משותף)
              </label>
            ) : null}
          </span>
        }
        confirmLabel={unsynced > 0 || healthUnknown ? "התנתקות בכל זאת" : "התנתקות"}
        tone={unsynced > 0 || healthUnknown ? "danger" : "accent"}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOutUser({ clearLocalData: clearLocal }).then((result) => {
            if (result.refused) showToast({ tone: "info", title: result.refused });
          });
        }}
        onCancel={() => setConfirmSignOut(false)}
      />

      <ConfirmDialog
        open={deleteStep === 1}
        title="למחוק את החשבון?"
        body="כל הרכבים והתדלוקים יימחקו לצמיתות. לא ניתן לשחזר."
        confirmLabel="המשך למחיקה"
        onConfirm={() => setDeleteStep(2)}
        onCancel={() => setDeleteStep(0)}
      />

      <ConfirmDialog
        open={deleteStep === 2}
        title="אישור אחרון"
        body="זו ההזדמנות האחרונה לבטל. למחוק את כל הנתונים לצמיתות?"
        confirmLabel="כן, מחקו הכול"
        onConfirm={() => void reallyDelete()}
        onCancel={() => setDeleteStep(0)}
      />
    </main>
  );
}

/** Same stat card the home screen uses: label, figure, one line of context. */
function MetricCard({
  label,
  value,
  unit,
  meta,
}: {
  label: string;
  value: string;
  unit?: string;
  meta?: string;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <Label className="text-[12.5px]">{label}</Label>
      <span className="flex items-baseline gap-1.5">
        <Num className="text-[24px] font-bold leading-tight text-ink">{value}</Num>
        {unit ? <span className="text-[12px] text-muted">{unit}</span> : null}
      </span>
      {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
    </Card>
  );
}

function DetailRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="text-[14px] text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">{value}</span>
        {badge ? (
          <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
            {badge}
          </span>
        ) : null}
      </span>
    </div>
  );
}
