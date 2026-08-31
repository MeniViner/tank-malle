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
import { fullDate, num, shekel, timeAgo } from "../lib/format";
import {
  CarIcon,
  DownloadIcon,
  LogoutIcon,
  PumpIcon,
  ShieldIcon,
  TrashIcon,
} from "../components/icons";

/** Profile & account (design 19). */
export function Profile() {
  const navigate = useNavigate();
  const { user, signOutUser, isAdmin } = useAuth();
  const { fillups, activeVehicle, vehicles, deleteAccount, settings } = useData();
  const stats = useMemo(
    () => computeStats(fillups, activeVehicle),
    [fillups, activeVehicle],
  );

  // Firebase records the real account creation time; fall back to the oldest
  // record we hold if the metadata is unavailable.
  const joinedAt = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).getTime()
    : null;
  const lastSignIn = user?.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).getTime()
    : null;
  const { showToast } = useToast();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Account deletion is irreversible, so it takes two separate confirmations.
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);

  async function reallyDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      showToast({ tone: "success", title: "החשבון נמחק" });
    } catch {
      showToast({
        tone: "error",
        title: "מחיקת החשבון נכשלה",
        detail: "ייתכן שנדרשת התחברות מחדש לפני המחיקה",
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
        <div className="flex flex-col items-center gap-3 py-3">
          <Avatar name={user?.displayName} photoURL={user?.photoURL} size={84} />
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[19px] font-bold text-ink">
              {user?.displayName ?? "משתמש"}
            </span>
            <span dir="ltr" className="text-[13.5px] text-muted">
              {user?.email}
            </span>
          </div>
        </div>

        {/* Lifetime totals — the reason to keep a log in the first place. */}
        <section className="flex flex-col gap-2">
          <Label>הפעילות שלי</Label>
          <div className="flex gap-3">
            <MetricCard
              icon={<PumpIcon size={16} />}
              label="תדלוקים"
              value={num(stats.records.fillupCount, 0)}
              meta={`${num(stats.records.totalLiters, 0)} ליטר`}
            />
            <MetricCard
              icon={<CarIcon size={16} />}
              label="רכבים"
              value={num(vehicles.length, 0)}
              meta={vehicles.filter((v) => v.archived).length > 0
                ? `${num(vehicles.filter((v) => v.archived).length, 0)} בארכיון`
                : undefined}
            />
          </div>
          <div className="flex gap-3">
            <MetricCard
              label="סה״כ הוצאה"
              value={shekel(stats.records.totalCost)}
            />
            <MetricCard
              label="ק״מ שתועדו"
              value={num(stats.records.totalKm, 0)}
              meta="ק״מ"
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>פרטי חשבון</Label>
          <Card className="overflow-hidden">
            <DetailRow
              label="הצטרפתי"
              value={joinedAt ? fullDate(joinedAt) : "—"}
              meta={joinedAt ? timeAgo(joinedAt) : undefined}
            />
            <DetailRow
              label="התחברות אחרונה"
              value={lastSignIn ? timeAgo(lastSignIn) : "—"}
            />
            <DetailRow
              label="שיטת התחברות"
              value="חשבון Google"
              badge="מחובר"
            />
            <DetailRow
              label="השוואה אנונימית"
              value={settings.shareBenchmarks !== false ? "משתתף" : "כבוי"}
            />
            {isAdmin ? <DetailRow label="הרשאות" value="מנהל מערכת" badge="אדמין" /> : null}
          </Card>
        </section>

        <Card className="flex items-center gap-3 p-4">
          <IconTile>
            <ShieldIcon size={18} />
          </IconTile>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[14.5px] font-semibold text-ink">הנתונים מוצפנים בהעברה</span>
            <span className="text-[12.5px] leading-relaxed text-muted">
              ההרשאות נאכפות בצד השרת — רק אתם יכולים לקרוא ולכתוב את הנתונים שלכם.
            </span>
          </span>
        </Card>

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
          <RowButton
            icon={
              <IconTile tone="muted">
                <LogoutIcon size={18} />
              </IconTile>
            }
            title="התנתקות"
            onClick={() => setConfirmSignOut(true)}
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
        title="להתנתק מהחשבון?"
        body="הנתונים יישמרו בענן ויחזרו בהתחברות הבאה."
        confirmLabel="התנתקות"
        tone="accent"
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOutUser();
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

function MetricCard({
  icon,
  label,
  value,
  meta,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <Card className="flex flex-1 flex-col gap-1.5 p-[14px_16px]">
      <span className="flex items-center gap-1.5 text-muted">
        {icon}
        <Label className="text-[12.5px]">{label}</Label>
      </span>
      <Num className="text-[21px] font-bold leading-tight text-ink">{value}</Num>
      {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
    </Card>
  );
}

function DetailRow({
  label,
  value,
  meta,
  badge,
}: {
  label: string;
  value: string;
  meta?: string;
  badge?: string;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="text-[14px] text-muted">{label}</span>
      <span className="flex items-center gap-2">
        {meta ? <span className="text-[12px] text-muted">{meta}</span> : null}
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
