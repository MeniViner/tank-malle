import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";
import { loadAccountExport } from "../../lib/accountExport";
import { downloadAllVehiclesCsv, downloadFillupsCsv, downloadTankUpdatesCsv } from "../../lib/csv";
import { db } from "../../lib/firebase";
import { num } from "../../lib/format";
import { ChoiceList } from "../ChoiceList";
import { GroupRow } from "../DesignPrimitives";
import { NumRun } from "../Fmt";
import { ArchiveIcon, CloudOffIcon, DownloadIcon, UploadIcon } from "../icons";
import { LegacyCareTransfer } from "../LegacyCareTransfer";
import { Sheet } from "../Sheet";
import { UnifiedTransfer } from "../UnifiedTransfer";
import { useAccountScope } from "./useAccountScope";

const SCOPES = [
  { value: "account", label: "כל הרכבים, כולל הארכיון" },
  { value: "active", label: "הרכב הפעיל" },
] as const;

export function AccountData({ onImported }: { onImported: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeVehicle, fillups, observations, plans, outbox, writes, outboxHealth, accountDeletionPending } = useData();
  const { showToast } = useToast();
  const captureScope = useAccountScope(user?.uid);
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<"export" | "backup" | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"account" | "active">("account");
  const healthUnknown = outboxHealth.state !== "ok";
  const needsAttention = outbox.length > 0 || writes.pending.length > 0 || writes.failed.length > 0 || healthUnknown;
  const scopeLabel = SCOPES.find(option => option.value === exportScope)?.label;

  async function exportAll(kind: "fillups" | "tank") {
    if (!user || exportingRef.current || accountDeletionPending) return;
    const uid = user.uid;
    const current = captureScope();
    exportingRef.current = true;
    setExporting(true);
    setError("");
    try {
      // Each explicit download reads a fresh, complete account snapshot. The
      // summary's cached snapshot is never treated as an export guarantee.
      const data = await loadAccountExport(db, uid);
      if (!current()) return;
      const hasData = kind === "fillups" ? data.rows.length : data.observations.length + data.plans.length;
      if (!hasData) {
        showToast({ tone: "info", title: "אין עדיין נתונים מהסוג הזה לייצוא" });
        return;
      }
      if (kind === "fillups") downloadAllVehiclesCsv(data.rows);
      else downloadTankUpdatesCsv(data.observations, data.plans);
      showToast({ tone: "success", title: "הקובץ הוכן להורדה", detail: "כולל רכבים בארכיון. בדקו שהקובץ נשמר בהורדות הדפדפן." });
    } catch {
      if (current()) setError("הייצוא לא הושלם. בדקו את החיבור ונסו שוב.");
    } finally {
      exportingRef.current = false;
      if (current()) setExporting(false);
    }
  }

  function exportSelected(kind: "fillups" | "tank") {
    if (accountDeletionPending) return;
    if (exportScope === "account") { void exportAll(kind); return; }
    if (!activeVehicle || exportingRef.current) return;
    setError("");
    if (kind === "fillups" ? !fillups.length : !observations.length && !plans.length) {
      showToast({ tone: "info", title: "אין עדיין נתונים מהסוג הזה לייצוא" });
      return;
    }
    if (kind === "fillups") downloadFillupsCsv(fillups, activeVehicle);
    else downloadTankUpdatesCsv(observations, plans);
    showToast({ tone: "success", title: "הקובץ הוכן להורדה" });
  }

  return <section className="account-section" aria-labelledby="account-data-heading">
    <h2 id="account-data-heading" className="account-section-title">הנתונים שלי</h2>
    <div className="tm-group">
      <GroupRow testId="account-export" icon={<DownloadIcon />} title="ייצוא ל-Excel" onClick={() => setSheet("export")} />
      <GroupRow testId="account-backup" icon={<ArchiveIcon />} title="גיבוי" subtitle="שמירת עותק של כל הנתונים" onClick={() => setSheet("backup")} />
      <GroupRow testId="account-import" icon={<UploadIcon />} title="ייבוא נתונים" onClick={() => navigate("/settings/import")} />
      {needsAttention ? <GroupRow testId="account-unsynced" icon={<CloudOffIcon />} title="שינויים שעוד לא עלו לענן"
        value={outbox.length > 0 ? <span data-testid="account-unsynced-count"><NumRun>{num(outbox.length, 0)}</NumRun></span> : undefined}
        subtitle={healthUnknown ? "מצב האחסון לא ידוע" : writes.failed.length > 0 ? "יש שינויים שדורשים טיפול" : undefined}
        onClick={() => navigate("/settings/unsynced")} /> : null}
    </div>

    <Sheet open={sheet === "export"} onClose={() => setSheet(null)} title="ייצוא נתונים">
      <div className="account-sheet-stack">
        <div className="tm-group">
          <GroupRow testId="account-export-scope" title="היקף הייצוא" value={scopeLabel} onClick={() => setScopeOpen(true)} disabled={exporting} />
          <GroupRow testId="account-export-fillups" icon={<DownloadIcon />} title="ייצוא תדלוקים"
            subtitle={exporting ? "טוענים נתונים מכל הרכבים…" : `CSV · ${scopeLabel}`}
            disabled={exporting || (exportScope === "active" && !activeVehicle)} onClick={() => exportSelected("fillups")} />
          <GroupRow testId="account-export-tank" icon={<DownloadIcon />} title="ייצוא עדכוני מיכל ונסיעות"
            subtitle={exporting ? "טוענים נתונים מכל הרכבים…" : `CSV נפרד · ${scopeLabel}`}
            disabled={exporting || (exportScope === "active" && !activeVehicle)} onClick={() => exportSelected("tank")} />
        </div>
        <p className="account-note">כל קובץ יורד בנפרד ונפתח ב-Excel. בייצוא של כל החשבון נדרש חיבור לשרת.</p>
        {error ? <p role="alert" className="account-error">{error}</p> : null}
      </div>
    </Sheet>
    <Sheet open={scopeOpen} onClose={() => setScopeOpen(false)} title="היקף הייצוא">
      <ChoiceList value={exportScope} options={SCOPES} ariaLabel="היקף הייצוא"
        onChange={scope => { setExportScope(scope); setScopeOpen(false); }} />
    </Sheet>
    <Sheet open={sheet === "backup"} onClose={() => setSheet(null)} title="גיבוי">
      <div className="account-sheet-stack">
        <UnifiedTransfer onImported={onImported} />
        <div className="tm-group"><LegacyCareTransfer key={activeVehicle?.id ?? "none"} /></div>
      </div>
    </Sheet>
  </section>;
}
