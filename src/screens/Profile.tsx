import { vehicleMoney } from "../lib/vehicle/format";
import { LegacyCareTransfer } from "../components/LegacyCareTransfer";
import { UnifiedTransfer } from "../components/UnifiedTransfer";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Avatar } from "../components/Avatar";
import { IconTile, Label, ListCard } from "../components/Card";
import { RowButton } from "../components/Button";
import { ConfirmDialog, Sheet } from "../components/Sheet";
import { downloadAllVehiclesCsv, downloadFillupsCsv, downloadTankUpdatesCsv } from "../lib/csv";
import { Num } from "../components/Num";
import { loadAccountExport, accountTotals, type AccountExport } from "../lib/accountExport";
import { db } from "../lib/firebase";
import { fullDate, loginMoment, num, price } from "../lib/format";
import { ChevronStart, DownloadIcon, LogoutIcon, ShieldIcon, TrashIcon, UploadIcon } from "../components/icons";

/** Account identity, data tools and guarded account actions. */
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
  const { vehicles, activeVehicle, fillups, observations, plans, deleteAccount, accountDeletionPending } = useData();
  const [exportScope, setExportScope] = useState<"account" | "active">("account");
  const [scopeOpen, setScopeOpen] = useState(false);
  const uid = user?.uid;
  const [accountData, setAccountData] = useState<AccountExport | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (!uid || accountDeletionPending) return;
    let current = true;
    setAccountData(null); setExportError(null);
    void loadAccountExport(db, uid).then((data) => { if (current) setAccountData(data); },
      () => { if (current) setExportError("לא ניתן לטעון את נתוני כל הרכבים. נדרש חיבור לשרת."); });
    return () => { current = false; };
  }, [uid, accountDeletionPending, loadAttempt]);
  const records = useMemo(() => accountData ? accountTotals(accountData) : null, [accountData]);
  async function exportAll(kind: "fillups" | "tank") {
    if (!user || exporting) return;
    setExporting(true); setExportError(null);
    try {
      const data = await loadAccountExport(db, user.uid);
      setAccountData(data);
      const hasData = kind === "fillups" ? data.rows.length : data.observations.length + data.plans.length;
      if (!hasData) {
        showToast({ tone: "info", title: "אין עדיין נתונים מהסוג הזה לייצוא" }); return;
      }
      // One file per explicit gesture: browsers can block a second automatic
      // download even though both CSV files were generated successfully.
      if (kind === "fillups") downloadAllVehiclesCsv(data.rows);
      else downloadTankUpdatesCsv(data.observations, data.plans);
      showToast({ tone: "success", title: "הקובץ הוכן להורדה", detail: "כולל רכבים בארכיון. בדקו שהקובץ נשמר בהורדות הדפדפן." });
    } catch { setExportError("הייצוא לא הושלם. בדקו את החיבור ונסו שוב."); }
    finally { setExporting(false); }
  }

  function exportSelected(kind: "fillups" | "tank") {
    if (exportScope === "account") { void exportAll(kind); return; }
    if (!activeVehicle || exporting) return;
    if (kind === "fillups" ? !fillups.length : !observations.length && !plans.length) {
      showToast({ tone: "info", title: "אין עדיין נתונים מהסוג הזה לייצוא" }); return;
    }
    if (kind === "fillups") downloadFillupsCsv(fillups, activeVehicle);
    else downloadTankUpdatesCsv(observations, plans);
    showToast({ tone: "success", title: "הקובץ הוכן להורדה" });
  }
  const scopeLabel = exportScope === "account" ? "כל הרכבים, כולל הארכיון" : "הרכב הפעיל";

  // Firebase records the real account creation time; missing metadata stays unknown.
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
    records && records.unknownFuelCosts===0 && records.totalLiters > 0
      ? records.fuelCost / records.totalLiters
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
          title: result.deleted.length ? "המחיקה נעצרה לפני השלמתה" : "המחיקה לא החלה",
          detail: result.failed.includes("pending-writes") ? "יש פעולות שלא סונכרנו במכשיר. טפלו בהן לפני המחיקה."
            : result.failed.includes("local-cache") ? "סגרו לשוניות נוספות של האפליקציה, רעננו ונסו שוב. חשבון ההתחברות נשמר."
            : "חשבון ההתחברות נשמר כדי שתוכלו לנסות שוב. רעננו ונסו להשלים את המחיקה.",
        });
      }
    } catch {
      showToast({
        tone: "error",
        title: "מחיקת החשבון נכשלה",
        detail: "לא ניתן לאשר שהמחיקה הושלמה. רעננו ונסו שוב.",
      });
    } finally {
      setDeleting(false);
      setDeleteStep(0);
    }
  }

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <ScreenHeader title="פרופיל וחשבון" onBack={() => navigate(-1)} />

      <div className="tm-page">
        <UnifiedTransfer />
        <LegacyCareTransfer />
        {accountDeletionPending ? <p role="alert" className="rounded-card bg-danger/10 p-4 text-sm text-danger">מחיקת החשבון ממתינה להשלמה. הנתונים שכבר נמחקו לא ישוחזרו; ניתן לנסות שוב דרך מחיקת החשבון למטה. אם הפעולה נעצרה, רעננו תחילה.</p> : null}
        <section className="tm-rise flex flex-col gap-3.5 py-2 text-ink">
          <div className="flex items-center gap-3.5">
            <Avatar name={user?.displayName} photoURL={user?.photoURL} size={62} />
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className="truncate font-display text-[28px] font-semibold leading-tight">
                {user?.displayName ?? "משתמש"}
              </span>
              <span dir="ltr" className="max-w-full truncate text-[13px] text-muted">
                {user?.email}
              </span>
              {isAdmin ? (
                <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-[13px] font-bold">
                  <ShieldIcon size={13} />
                  מנהל מערכת
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-muted">
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
          <Label>הפעילות שלי · כל הרכבים, כולל הארכיון</Label>
          {exportError ? <p role="alert" className="text-sm text-danger">{exportError} <button className="min-h-10 px-2 underline" onClick={() => setLoadAttempt((n) => n + 1)}>ניסיון חוזר</button></p> : null}
          <div className="tm-metrics grid grid-cols-2 overflow-hidden rounded-card bg-surface">
            <MetricCard
              label="תדלוקים"
              value={records ? num(records.fillupCount, 0) : "—"}
              meta={`${records ? num(records.totalLiters, 0) : "—"} ליטר בסך הכול`}
            />
            <MetricCard
              label="סה״כ הוצאה"
              value={records ? vehicleMoney(Math.round(records.totalCost*100)) : "—"}
              meta={records?.unknownCosts?`${records.unknownCosts} רשומות עם עלות חסרה לא נכללו`:avgPricePaid !== null ? `כולל תחזוקה והוצאות · ממוצע דלק ${price(avgPricePaid)} לליטר` : "רכישות דלק, טיפולים והוצאות פחות החזרים"}
            />

            <MetricCard
              label="ק״מ שתועדו"
              value={records && !records.distanceUnknown ? num(records.totalKm, 0) : "—"}
              unit="ק״מ"
              meta={records?.distanceUnknown?"אין כיסוי מד־דרך מספק בכל הרכבים":"מרחק מתועד מכל מקורות מד־הדרך"}
            />
            <MetricCard
              label="רכבים"
              value={num(vehicles.length, 0)}
              meta={
                vehicles.length > active.length
                  ? `${num(active.length, 0)} פעילים · ${num(vehicles.length - active.length, 0)} בארכיון`
                  : active.length === 1
                  ? (active[0].nickname?.trim() ||
                    `${active[0].make} ${active[0].model}`.trim())
                  : undefined
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>פרטי חשבון</Label>
          <ListCard>
            <DetailRow label="שיטת התחברות" value="חשבון Google" badge="מחובר" />
            {isAdmin ? <DetailRow label="הרשאות" value="מנהל מערכת" badge="אדמין" /> : null}
          </ListCard>
        </section>

        <section className="flex flex-col gap-2">
          <Label>הנתונים שלי</Label>
          <ListCard>
            <RowButton title="היקף הייצוא" value={scopeLabel} trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => setScopeOpen(true)} />
            <RowButton
              icon={
                <IconTile tone="muted">
                  <DownloadIcon size={18} />
                </IconTile>
              }
              title="ייצוא תדלוקים"
              subtitle={exporting ? "טוען נתונים מכל הרכבים…" : `CSV · ${scopeLabel}`}
              disabled={exporting || (exportScope === "active" && !activeVehicle)}
              onClick={() => exportSelected("fillups")}
            />
            <RowButton
              icon={<IconTile tone="muted"><DownloadIcon size={18} /></IconTile>}
              title="ייצוא עדכוני מיכל ונסיעות"
              subtitle={exporting ? "טוען נתונים מכל הרכבים…" : `CSV נפרד · ${scopeLabel}`}
              disabled={exporting || (exportScope === "active" && !activeVehicle)}
              onClick={() => exportSelected("tank")}
            />
            <RowButton icon={<UploadIcon size={18} className="text-muted" />} title="ייבוא נתונים" subtitle="CSV או Excel · גם יומנים ישנים" trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/settings/import")} />
            <RowButton title="פעולות שלא סונכרנו" value={healthUnknown ? "מצב האחסון לא ידוע" : unsynced > 0 ? "יש פעולות לטיפול" : "הכול מסונכרן"} trailing={<ChevronStart size={17} className="text-muted" />} onClick={() => navigate("/settings/unsynced")} />
          </ListCard>
        </section>

        <ListCard>
          {/* Local data is preserved unless the user explicitly requests clearing,
              after the existing device-wide pending-write checks pass. */}
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
        </ListCard>

        <p className="px-1 pb-2 text-[14px] leading-relaxed text-muted">
          מחיקת חשבון היא פעולה בלתי הפיכה — כל הרכבים, התדלוקים והנתונים יימחקו לצמיתות.
        </p>
      </div>

      <p className="px-5 pt-3 text-[12px] leading-relaxed text-muted/80">
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

      <Sheet open={scopeOpen} onClose={() => setScopeOpen(false)} title={<h2 className="text-[18px] font-bold">היקף הייצוא</h2>}>
        <div role="radiogroup" aria-label="היקף הייצוא" className="flex flex-col">
          {(["account", "active"] as const).map((scope) => (
            <label key={scope} className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 px-3 text-[16px]">
              <span>{scope === "account" ? "כל הרכבים, כולל הארכיון" : "הרכב הפעיל"}</span>
              <input type="radio" name="export-scope" value={scope} checked={exportScope === scope} className="size-5 accent-accent" onChange={() => { setExportScope(scope); setScopeOpen(false); }} />
            </label>
          ))}
        </div>
      </Sheet>

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
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-4">
      <Label>{label}</Label>
      <span className="flex items-baseline gap-1.5">
        <Num className="font-display text-[26px] font-bold leading-tight text-ink">{value}</Num>
        {unit ? <span className="text-[12px] text-muted">{unit}</span> : null}
      </span>
      {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
    </div>
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
