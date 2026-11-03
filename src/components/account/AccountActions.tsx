import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { num } from "../../lib/format";
import { GroupRow } from "../DesignPrimitives";
import { NumericText, NumRun } from "../Fmt";
import { LogoutIcon, TrashIcon } from "../icons";
import { ConfirmDialog } from "../Sheet";
import { useAccountScope } from "./useAccountScope";

/** Account actions retain the device-wide write/cache checks in the auth layer. */
export function AccountActions() {
  const { user, signOutUser } = useAuth();
  const { outbox, writes, outboxHealth, checkUnacknowledged, deleteAccount } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(user?.uid);
  const [deviceState, setDeviceState] = useState<"none" | "some" | "unknown" | null>(null);
  const [clearLocal, setClearLocal] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const signOutBusy = useRef(false);
  const deleteBusy = useRef(false);
  const checkGeneration = useRef(0);
  const healthUnknown = outboxHealth.state !== "ok";
  const trackerAttention = writes.pending.length > 0 || writes.failed.length > 0;
  const accountAttention = outbox.length > 0 || trackerAttention;
  const attention = accountAttention || healthUnknown || deviceState === "some" || deviceState === "unknown";
  const mayClearLocal = deviceState === "none" && !healthUnknown && !accountAttention;

  function openSignOut() {
    const current = captureScope();
    const generation = ++checkGeneration.current;
    setDeviceState(null);
    setClearLocal(false);
    setConfirmSignOut(true);
    void checkUnacknowledged().then(state => {
      if (current() && generation === checkGeneration.current) setDeviceState(state);
    }, () => {
      if (current() && generation === checkGeneration.current) setDeviceState("unknown");
    });
  }

  async function reallySignOut() {
    if (signOutBusy.current) return;
    const current = captureScope();
    signOutBusy.current = true;
    setSigningOut(true);
    setConfirmSignOut(false);
    try {
      // The auth operation checks again before clearing the shared cache.
      const result = await signOutUser({ clearLocalData: clearLocal && mayClearLocal });
      if (current() && result.refused) showToast({ tone: "info", title: result.refused });
    } catch {
      if (current()) showToast({ tone: "error", title: "ההתנתקות לא הושלמה", detail: "נסו שוב. הנתונים המקומיים נשמרים." });
    } finally {
      signOutBusy.current = false;
      if (current()) setSigningOut(false);
    }
  }

  async function reallyDelete() {
    if (deleteBusy.current) return;
    const current = captureScope();
    deleteBusy.current = true;
    setDeleting(true);
    setDeleteStep(0);
    try {
      const result = await deleteAccount();
      if (!current()) return;
      if (result.needsReauth) {
        showToast({ tone: "info", title: "נדרשת התחברות מחדש לפני המחיקה", detail: "לא נמחק דבר. התחברו שוב ונסו שנית." });
      } else if (result.ok) {
        showToast({ tone: "success", title: "החשבון וכל הנתונים נמחקו" });
      } else {
        showToast({ tone: "error", title: result.deleted.length ? "המחיקה נעצרה לפני השלמתה" : "המחיקה לא החלה",
          detail: result.failed.includes("pending-writes") ? "יש שינויים שעוד לא עלו לענן במכשיר. טפלו בהם לפני המחיקה."
            : result.failed.includes("local-cache") ? "סגרו לשוניות נוספות של האפליקציה, רעננו ונסו שוב. חשבון ההתחברות נשמר."
              : "חשבון ההתחברות נשמר כדי שתוכלו לנסות שוב. רעננו ונסו להשלים את המחיקה." });
      }
    } catch {
      if (current()) showToast({ tone: "error", title: "מחיקת החשבון נכשלה", detail: "לא ניתן לאשר שהמחיקה הושלמה. רעננו ונסו שוב." });
    } finally {
      deleteBusy.current = false;
      if (current()) setDeleting(false);
    }
  }

  return <>
    <GroupRow testId="account-signout" icon={<LogoutIcon />} title={signingOut ? "מתנתקים…" : "התנתקות"}
      onClick={openSignOut} disabled={signingOut || deleting} chevron={false} />
    <GroupRow testId="account-delete" icon={<TrashIcon />} title={deleting ? "מוחקים את החשבון…" : "מחיקת החשבון"}
      danger onClick={() => setDeleteStep(1)} disabled={deleting || signingOut} chevron={false} />
    {deleting ? <p role="status" className="account-note">המחיקה מתבצעת. ממתינים לאישור השרת.</p> : null}

    <ConfirmDialog open={confirmSignOut} title={attention ? "שינויים שעוד לא עלו לענן" : "להתנתק מהחשבון?"}
      body={<div className="account-sheet-stack">
        {outbox.length > 0 ? <p><NumRun>{num(outbox.length, 0)}</NumRun> שינויים של החשבון הזה עוד לא אושרו בשרת. הם נשמרים במכשיר הזה וזמינים לטיפול בהתחברות הבאה לאותו חשבון.</p>
          : healthUnknown ? <p>לא ניתן לוודא שאין שינויים שעוד לא עלו לענן (<NumericText>{outboxHealth.message ?? "אחסון לא קריא"}</NumericText>). הנתונים המקומיים לא יימחקו.</p>
            : trackerAttention ? <p>יש שינויים שעדיין ממתינים לאישור או דורשים טיפול. בדקו אותם במסך ״שינויים שעוד לא עלו לענן״. הנתונים המקומיים לא יימחקו.</p>
              : deviceState === "some" ? <p>לחשבון אחר במכשיר הזה יש שינויים שעוד לא אושרו. הם לא יימחקו.</p>
                : deviceState === "unknown" ? <p>לא ניתן לוודא את מצב השינויים המקומיים. הנתונים המקומיים לא יימחקו.</p>
                  : deviceState === null ? <p>בודקים את השינויים שבמכשיר. התנתקות תשאיר את הנתונים המקומיים.</p>
                    : <p>הנתונים שבענן יחזרו בהתחברות הבאה. הנתונים המקומיים נשמרים במכשיר.</p>}
        {mayClearLocal ? <label className="account-checkbox-row">
          <input type="checkbox" checked={clearLocal} onChange={event => setClearLocal(event.target.checked)} />
          <span>למחוק גם את הנתונים המקומיים במכשיר הזה (מחשב משותף)</span>
        </label> : null}
      </div>}
      confirmLabel={attention ? "התנתקות בכל זאת" : "התנתקות"} tone={attention ? "danger" : "accent"}
      onConfirm={() => void reallySignOut()} onCancel={() => { checkGeneration.current += 1; setConfirmSignOut(false); }} />
    <ConfirmDialog open={deleteStep === 1} title="למחוק את החשבון?"
      body="כל הרכבים, התדלוקים, הטיפולים והנתונים יימחקו לצמיתות. לא ניתן לשחזר. כדאי לשמור גיבוי קודם."
      confirmLabel="המשך למחיקה" onConfirm={() => setDeleteStep(2)} onCancel={() => setDeleteStep(0)} />
    <ConfirmDialog open={deleteStep === 2} title="אישור אחרון"
      body="זו ההזדמנות האחרונה לבטל. למחוק את כל הנתונים לצמיתות?"
      confirmLabel="כן, מחקו הכול" onConfirm={() => void reallyDelete()} onCancel={() => setDeleteStep(0)} />
  </>;
}
