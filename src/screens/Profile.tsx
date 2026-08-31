import { useState } from "react";
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
import { DownloadIcon, LogoutIcon, ShieldIcon, TrashIcon } from "../components/icons";

/** Profile & account (design 19). */
export function Profile() {
  const navigate = useNavigate();
  const { user, signOutUser } = useAuth();
  const { fillups, activeVehicle, deleteAccount } = useData();
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

        <Card className="flex items-center gap-3 p-4">
          <IconTile>
            <ShieldIcon size={18} />
          </IconTile>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[14.5px] font-semibold text-ink">חשבון Google</span>
            <span className="text-[12.5px] text-muted">ההתחברות היחידה לאפליקציה</span>
          </span>
          <span className="flex-none rounded-pill bg-success-soft px-2.5 py-1 text-[12px] font-semibold text-success-ink">
            מחובר
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
