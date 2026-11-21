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
export function AccountActions({ openDeleteConfirmation = false }: { openDeleteConfirmation?: boolean }) {
  const { user, signOutUser } = useAuth();
  const { outbox, writes, outboxHealth, checkUnacknowledged, deleteAccount } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(user?.uid);
  const [deviceState, setDeviceState] = useState<"none" | "some" | "unknown" | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(openDeleteConfirmation ? 1 : 0);
  const [deleting, setDeleting] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const passwordAccount = user?.providerData.some(provider => provider.providerId === "password") ?? false;
  const signOutBusy = useRef(false);
  const deleteBusy = useRef(false);
  const checkGeneration = useRef(0);
  const healthUnknown = outboxHealth.state !== "ok";
  const trackerAttention = writes.pending.length > 0 || writes.failed.length > 0;
  const accountAttention = outbox.length > 0 || trackerAttention;

  /**
   * Signing out wipes this device's local data without asking. The only time the person is asked
   * anything is when something has not reached the cloud yet: then nothing is wiped, and they are told.
   */
  async function openSignOut() {
    if (signOutBusy.current || checking) return;
    const current = captureScope();
    const generation = ++checkGeneration.current;
    setChecking(true);
    let state: "none" | "some" | "unknown";
    try { state = await checkUnacknowledged(); } catch { state = "unknown"; }
    if (!current() || generation !== checkGeneration.current) return;
    setChecking(false);
    if (state === "none" && !healthUnknown && !accountAttention) { await reallySignOut(true); return; }
    setDeviceState(state);
    setConfirmSignOut(true);
  }

  async function reallySignOut(clearLocalData: boolean) {
    if (signOutBusy.current) return;
    const current = captureScope();
    signOutBusy.current = true;
    setSigningOut(true);
    setConfirmSignOut(false);
    try {
      // The auth operation checks again before clearing the shared cache.
      const result = await signOutUser({ clearLocalData });
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
    if (passwordAccount && !deletionPassword) {
      showToast({ tone: "info", title: "יש להזין את הסיסמה לאישור המחיקה" });
      return;
    }
    const current = captureScope();
    deleteBusy.current = true;
    setDeleting(true);
    setDeleteStep(0);
    try {
      const result = await deleteAccount(deletionPassword);
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
      if (current()) { setDeleting(false); setDeletionPassword(""); }
    }
  }

  return <>
    <GroupRow testId="account-signout" icon={<LogoutIcon />} title={signingOut || checking ? "מתנתקים…" : "התנתקות"}
      onClick={() => void openSignOut()} disabled={signingOut || checking || deleting} chevron={false} />
    <GroupRow testId="account-delete" icon={<TrashIcon />} title={deleting ? "מוחקים את החשבון…" : "מחיקת החשבון"}
      danger onClick={() => { setDeletionPassword(""); setDeleteStep(1); }} disabled={deleting || signingOut} chevron={false} />
    {deleting ? <p role="status" className="account-note">המחיקה מתבצעת. ממתינים לאישור השרת.</p> : null}

    <ConfirmDialog open={confirmSignOut} title="שינויים שעוד לא עלו לענן"
      body={<div className="account-sheet-stack">
        {outbox.length > 0 ? <p><NumRun>{num(outbox.length, 0)}</NumRun> שינויים של החשבון הזה עוד לא אושרו בשרת. הם נשמרים במכשיר הזה וזמינים לטיפול בהתחברות הבאה לאותו חשבון.</p>
          : healthUnknown ? <p>לא ניתן לוודא שאין שינויים שעוד לא עלו לענן (<NumericText>{outboxHealth.message ?? "אחסון לא קריא"}</NumericText>). הנתונים המקומיים לא יימחקו.</p>
            : trackerAttention ? <p>יש שינויים שעדיין ממתינים לאישור או דורשים טיפול. בדקו אותם במסך ״שינויים שעוד לא עלו לענן״. הנתונים המקומיים לא יימחקו.</p>
              : deviceState === "some" ? <p>לחשבון אחר במכשיר הזה יש שינויים שעוד לא אושרו. הם לא יימחקו.</p>
                : deviceState === "unknown" ? <p>לא ניתן לוודא את מצב השינויים המקומיים. הנתונים המקומיים לא יימחקו.</p>
                  : <p>יש שינויים שעוד לא עלו לענן. הנתונים המקומיים לא יימחקו.</p>}
      </div>}
      confirmLabel="התנתקות בכל זאת" tone="danger"
      onConfirm={() => void reallySignOut(false)} onCancel={() => { checkGeneration.current += 1; setConfirmSignOut(false); }} />
    <ConfirmDialog open={deleteStep === 1} title="למחוק את החשבון?"
      body="כל הרכבים, התדלוקים, הטיפולים והנתונים יימחקו לצמיתות. לא ניתן לשחזר. כדאי לשמור גיבוי קודם."
      confirmLabel="המשך למחיקה" onConfirm={() => setDeleteStep(2)} onCancel={() => setDeleteStep(0)} />
    <ConfirmDialog open={deleteStep === 2} title="אישור אחרון"
      body={<>
        <p>זו ההזדמנות האחרונה לבטל. למחוק את כל הנתונים לצמיתות?</p>
        {passwordAccount ? <label className="mt-4 flex flex-col gap-2">סיסמה לאישור המחיקה
          <input type="password" dir="ltr" autoComplete="current-password" value={deletionPassword}
            disabled={deleting} onChange={event => setDeletionPassword(event.currentTarget.value)}
            className="min-h-[48px] rounded-xl border border-line bg-surface px-3 text-[16px] text-ink"/>
        </label> : null}
      </>}
      confirmLabel="כן, מחקו הכול" onConfirm={() => void reallyDelete()}
      onCancel={() => { setDeletionPassword(""); setDeleteStep(0); }} />
  </>;
}
