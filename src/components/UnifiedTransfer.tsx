import { useRef, useState } from "react";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { loadUnifiedBackup, readUnifiedBackup, backupPreview, restoreBackupDrafts, type UnifiedBackup } from "../lib/vehicle/backup";
import { downloadCareFile } from "../lib/maintenance/export";
import type { UserSettings } from "../lib/types";
import { Button } from "./Button";
import { GroupRow } from "./DesignPrimitives";
import { NumericText, NumRun } from "./Fmt";
import { DownloadIcon, UploadIcon } from "./icons";
import { Sheet } from "./Sheet";
import { useAccountScope } from "./account/useAccountScope";

const preferences = (raw: Record<string, unknown>): Partial<UserSettings> => {
  const out: Partial<UserSettings> = {};
  for (const key of ["quickEntry", "reminderNotifications", "issueNotifications", "syncNotifications", "priceNotifications", "shareBenchmarks"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  if ([1, 3, 7, 14].includes(Number(raw.reminderLeadDays)) && typeof raw.reminderLeadDays === "number") out.reminderLeadDays = raw.reminderLeadDays;
  if ([500, 1000, 2000].includes(Number(raw.reminderLeadKm)) && typeof raw.reminderLeadKm === "number") out.reminderLeadKm = raw.reminderLeadKm;
  if (["light", "dark", "system"].includes(String(raw.theme))) out.theme = raw.theme as UserSettings["theme"];
  if (["kmPerLiter", "litersPer100"].includes(String(raw.units))) out.units = raw.units as UserSettings["units"];
  if (typeof raw.accentColor === "string") out.accentColor = raw.accentColor;
  if (typeof raw.customAccent === "string" && /^#[0-9a-f]{6}$/i.test(raw.customAccent)) out.customAccent = raw.customAccent;
  return out;
};

/** The same full backup pipeline, scoped to the current account/sheet lifetime. */
export function UnifiedTransfer({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const data = useData();
  const captureScope = useAccountScope(user?.uid);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState<{ backup: UnifiedBackup; preview: ReturnType<typeof backupPreview> } | null>(null);
  const [restoreDrafts, setRestoreDrafts] = useState(false);
  const [restorePrefs, setRestorePrefs] = useState(false);
  const disabled = busy || !user || data.accountDeletionPending;

  async function exportBackup() {
    if (!user || busyRef.current || data.accountDeletionPending) return;
    const uid = user.uid;
    const current = captureScope();
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const backup = await loadUnifiedBackup(db, uid, data.outbox);
      if (!current()) return;
      downloadCareFile(JSON.stringify(backup, null, 2), "tank-maleh-account-v2.json", "application/json");
      setMessage("הגיבוי הוכן: כל הרכבים, הרשומות, ההעדפות, התראות, שינויים ממתינים וטיוטות. תמונות אינן כלולות.");
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "הגיבוי לא הושלם");
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }

  async function readFile(file: File) {
    if (!user || busyRef.current || data.accountDeletionPending) return;
    const uid = user.uid;
    const current = captureScope();
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 8_000_000) throw new Error("הקובץ גדול מדי.");
      const backup = readUnifiedBackup(await file.text());
      if (!current()) return;
      const existing = await loadUnifiedBackup(db, uid, data.outbox);
      if (!current()) return;
      setCandidate({ backup, preview: backupPreview(backup, existing.cloud.entries) });
      setRestoreDrafts(false);
      setRestorePrefs(false);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "הקובץ לא נקרא");
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }

  async function restore() {
    if (!user || !candidate || busyRef.current || data.accountDeletionPending) return;
    const uid = user.uid;
    const current = captureScope();
    busyRef.current = true;
    setBusy(true);
    setRestoring(true);
    setError("");
    setMessage("");
    try {
      const result = await data.importBackupEntries(candidate.preview.additions);
      if (!current()) return;
      if (restorePrefs) await data.updateSettings(preferences(candidate.backup.cloud.settings));
      if (!current()) return;
      const drafts = restoreDrafts ? restoreBackupDrafts(candidate.backup, uid) : null;
      setCandidate(null);
      setMessage("נוספו " + result.written + " רשומות באישור השרת."
        + (drafts ? " שוחזרו " + drafts.restored + " טיוטות; " + drafts.conflicts + " טיוטות קיימות לא הוחלפו." : "")
        + (restorePrefs ? " העדפות נשלחו לשמירה." : ""));
      onImported?.();
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "השחזור נעצר. ניתן לנסות שוב; רשומות שכבר נוספו לא יוכפלו.");
    } finally {
      busyRef.current = false;
      if (current()) { setBusy(false); setRestoring(false); }
    }
  }

  return <section className="account-sheet-stack" aria-label="גיבוי חשבון מלא">
    <p className="account-note">כל הרכבים, הרשומות וההעדפות בקובץ אחד. תמונות אינן כלולות.</p>
    <div className="tm-group">
      <GroupRow testId="backup-download" icon={<DownloadIcon />} title="הורדת גיבוי מלא"
        disabled={disabled} onClick={() => void exportBackup()} chevron={false} />
      <label className={"tm-group-row account-file-row" + (disabled ? " account-file-disabled" : "")}>
        <span className="tm-group-row-icon" aria-hidden="true"><UploadIcon /></span>
        <span className="tm-group-row-content"><span className="tm-group-row-title">{busy ? "טוענים…" : "שחזור מגיבוי מלא"}</span>
          <span className="tm-group-row-subtitle">תצוגה מקדימה לפני הוספה</span></span>
        <input data-testid="backup-file" type="file" accept=".json,application/json" aria-label="שחזור מגיבוי מלא, קובץ גיבוי מלא"
          disabled={disabled} className="sr-only" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readFile(file);
          }} />
      </label>
    </div>
    {restoring ? <p role="status" className="account-note">השחזור נמשך. ממתינים לאישור השרת.</p>
      : message ? <p role="status" className="account-note"><NumericText>{message}</NumericText></p> : null}
    {error ? <p role="alert" className="account-error"><NumericText>{error}</NumericText></p> : null}
    <Sheet open={!!candidate} title="מה ישוחזר?" onClose={() => setCandidate(null)}>
      {candidate ? <div className="account-sheet-stack">
        <p><NumRun>{candidate.preview.additions.length}</NumRun> רשומות חדשות · <NumRun>{candidate.preview.duplicates}</NumRun> זהות · <NumRun>{candidate.preview.conflicts.length}</NumRun> התנגשויות שלא יוחלפו.</p>
        <p className="account-note">מזהי הרכב והרשומות והקשרים ביניהם נשמרים. השחזור מוסיף רשומות חסרות בלבד. היסטוריה קיימת אינה מוחלפת.</p>
        <label className="account-checkbox-row"><input type="checkbox" checked={restorePrefs} disabled={busy} onChange={event => setRestorePrefs(event.target.checked)} /><span>שחזור העדפות אישיות</span></label>
        <label className="account-checkbox-row"><input type="checkbox" checked={restoreDrafts} disabled={busy} onChange={event => setRestoreDrafts(event.target.checked)} /><span>שחזור <NumRun>{candidate.backup.local.drafts.length}</NumRun> טיוטות במכשיר הזה</span></label>
        <p className="account-note"><NumRun>{candidate.backup.local.pendingOperations.length}</NumRun> שינויים ממתינים נשמרו בקובץ בנפרד. הם אינם משוחזרים אוטומטית לתור, כדי למנוע הפעלה חוזרת של מחיקות או כתיבות ישנות. בדקו אותם מול היומן והמסך ״שינויים שעוד לא עלו לענן״. תמונות אינן כלולות בגיבוי.</p>
        {error ? <p role="alert" className="account-error"><NumericText>{error}</NumericText></p> : null}
        <Button full loading={busy} disabled={busy || (!candidate.preview.additions.length && !restoreDrafts && !restorePrefs)} onClick={() => void restore()}>
          {busy ? "משחזרים…" : "הוספת הנתונים שנבחרו"}
        </Button>
      </div> : null}
    </Sheet>
  </section>;
}
