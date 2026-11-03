import { isTankUpdates, parseTankUpdates, type TankImport } from "../lib/import/tankUpdates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAccountScope } from "../components/account/useAccountScope";
import { ScreenHeader } from "../components/AppHeader";
import { Button, Spinner } from "../components/Button";
import { Label } from "../components/Card";
import { Num } from "../components/Num";
import { Money, NumericText, Quantity } from "../components/Fmt";
import { CarIcon, CheckIcon, ChevronDown, UploadIcon, WarningIcon } from "../components/icons";
import { dayMonthShort, fullDate, vehicleLabel } from "../lib/format";
import { ConfirmDialog } from "../components/Sheet";
import type { ImportBatch } from "../context/DataContext";
import type { Fillup, Vehicle } from "../lib/types";
import type { ImportPlan, ImportReport } from "../lib/import/plan";
import "../secondary-design.css";

/**
 * Import CSV or XLSX.
 *
 * "Silent support" means the FORMAT and the FIELD MAPPING are detected without
 * being asked about. It does not mean records appear without consent: nothing
 * is written until the user has seen exactly what will happen and confirmed it,
 * and the final report states what did happen — including anything that failed.
 *
 * The file is parsed entirely on this device. It is never uploaded.
 *
 * The parser and the spreadsheet reader are dynamically imported here so their
 * weight lands only on people who actually open this screen.
 */

type Stage = "choose" | "parsing" | "preview" | "importing" | "done";
type CompletedImport = Omit<ImportBatch, "importedAt">;
type UndoState = "available" | "busy" | "pending" | "done";

export function ImportData() {
  const { user } = useAuth();
  return <AccountImportData key={user?.uid ?? "signed-out"} />;
}

function AccountImportData() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const captureMount = useAccountScope(user?.uid);
  const {
    activeVehicles,
    activeVehicle,
    loadVehicleFillups,
    loadVehicleCatalog,
    importTankUpdates,
    addFillupBatch,
    listImportBatches,
    deleteImportBatch,
    captureAccountAction,
  } = useData();

  const [stage, setStage] = useState<Stage>("choose");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [tankImport, setTankImport] = useState<TankImport | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [resolvedTarget, setResolvedTarget] = useState<Vehicle | null>(null);
  const [targetVehicleId, setTargetVehicleId] = useState(activeVehicle?.id ?? "");
  const [backupSources, setBackupSources] = useState<{ id: string; label: string }[]>([]);
  const [backupSourceId, setBackupSourceId] = useState("");
  const [completedImport, setCompletedImport] = useState<CompletedImport | null>(null);
  const [undoState, setUndoState] = useState<UndoState>("available");
  const [undoCount, setUndoCount] = useState(0);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const sourceFile = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flowVersion = useRef(0);
  const importInFlight = useRef(false);
  const undoInFlight = useRef(false);
  const undoAcceptedBatchId = useRef<string | null>(null);

  const captureFlow = useCallback(() => {
    const accountCurrent = captureAccountAction();
    const mounted = captureMount();
    const version = flowVersion.current;
    return () => accountCurrent() && mounted() && version === flowVersion.current;
  }, [captureAccountAction, captureMount]);

  function chooseAnotherFile() {
    if (!captureFlow()() || importInFlight.current || undoInFlight.current) return;
    flowVersion.current += 1;
    setPlan(null);
    setTankImport(null);
    setReport(null);
    setCompletedImport(null);
    setUndoError(null);
    setConfirmUndo(false);
    setStage("choose");
  }

  const targetVehicle = useMemo(
    () => (resolvedTarget?.id === targetVehicleId ? resolvedTarget : activeVehicles.find((entry) => entry.id === targetVehicleId)) ?? null,
    [activeVehicles, targetVehicleId, resolvedTarget],
  );

  const onFile = useCallback(
    async (file: File, selectedSource?: string) => {
      if (importInFlight.current || !captureAccountAction()() || !captureMount()()) return;
      flowVersion.current += 1;
      const current = captureFlow();
      sourceFile.current = file;
      setBackupSources([]);
      setError(null);
      setReport(null);
      setPlan(null);
      setTankImport(null);
      setCompletedImport(null);
      setUndoState("available");
      setUndoCount(0);
      undoAcceptedBatchId.current = null;
      setUndoError(null);
      setConfirmUndo(false);
      setStage("parsing");
      setFileName(file.name);

      // Nothing can be imported without knowing which vehicle it belongs to.
      const vehicleId = targetVehicleId || activeVehicle?.id || "";
      if (!vehicleId) {
        setError("צריך לבחור רכב לפני הייבוא.");
        setStage("choose");
        return;
      }

      try {
        const [{ parseRows }, { planImport }] = await Promise.all([
          import("../lib/import/rows"),
          import("../lib/import/plan"),
        ]);
        if (!current()) return;

        let table: unknown[][];
        // Which cells were computed rather than typed; XLSX only.
        let formulaCells: boolean[][] = [];

        if (/\.xlsx?$/i.test(file.name)) {
          const { readWorkbook, canReadZip, UnsupportedArchiveError } = await import(
            "../lib/import/xlsx"
          );
          if (!current()) return;
          if (!canReadZip()) {
            setError(
              "הדפדפן הזה לא תומך בקריאת קובצי Excel. שמרו את הגיליון כ־CSV ונסו שוב.",
            );
            setStage("choose");
            return;
          }
          try {
            const bytes = await file.arrayBuffer();
            if (!current()) return;
            const sheet = await readWorkbook(bytes);
            if (!current()) return;
            table = sheet.rows;
            formulaCells = sheet.formulas;
          } catch (caught) {
            if (!current()) return;
            if (caught instanceof UnsupportedArchiveError) {
              setError("לא הצלחנו לקרוא את הקובץ. שמרו אותו כ־CSV ונסו שוב.");
              setStage("choose");
              return;
            }
            throw caught;
          }
        } else {
          const { parseCsv } = await import("../lib/import/csv");
          if (!current()) return;
          const text = await file.text();
          if (!current()) return;
          table = parseCsv(text);
        }

        const importVehicles = await loadVehicleCatalog();
        if (!current()) return;
        if (isTankUpdates(table)) {
          const parsedTank = parseTankUpdates(table);
          const resolvedId = parsedTank.vehicleIds.length === 1 && importVehicles.some((v) => v.id === parsedTank.vehicleIds[0]) ? parsedTank.vehicleIds[0] : vehicleId;
          setTargetVehicleId(resolvedId);
          setResolvedTarget(importVehicles.find((v) => v.id === resolvedId) ?? null);
          if (parsedTank.vehicleIds.length > 1) {
            const sourceId = selectedSource ?? (parsedTank.vehicleIds.includes(resolvedId) ? resolvedId : parsedTank.vehicleIds[0]);
            setBackupSourceId(sourceId);
            setBackupSources(parsedTank.vehicleIds.map((id, index) => {
              const sourceVehicle = importVehicles.find((v) => v.id === id);
              return { id, label: sourceVehicle ? vehicleLabel(sourceVehicle) : `רכב ${index + 1} בקובץ` };
            }));
            parsedTank.records = parsedTank.records.filter((r) => r.value.vehicleId === sourceId);
          }
          setTankImport(parsedTank);
          setStage("preview");
          return;
        }
        const parsed = parseRows(table, formulaCells);

        // A Tank Maleh export carries the id of the vehicle it came from. When
        // that vehicle still exists, it IS the target — asking the user to
        // re-pick it (and showing them the raw id to decide with) was noise.
        const matchedId = parsed.vehicleIds.find((id) =>
          importVehicles.some((entry) => entry.id === id),
        );
        const resolvedVehicleId = parsed.vehicleIds.length > 1 ? vehicleId : matchedId ?? vehicleId;

        if (parsed.vehicleIds.length > 1) {
          const sourceId = selectedSource ?? (parsed.vehicleIds.includes(resolvedVehicleId) ? resolvedVehicleId : parsed.vehicleIds[0]);
          setBackupSourceId(sourceId);
          setBackupSources(parsed.vehicleIds.map((id, index) => ({ id, label: parsed.rows.find((row) => row.sourceVehicleId === id)?.sourceVehicleLabel || `רכב ${index + 1} בקובץ` })));
          parsed.rows = parsed.rows.filter((row) => row.sourceVehicleId === sourceId);
          parsed.totalRows = parsed.rows.length + parsed.rejected.length;
          parsed.assumptions.push("הקובץ מכיל כמה רכבים. ייובאו רק הרשומות של רכב המקור שנבחר, לרכב היעד המוצג. לשאר הרכבים יש לבצע ייבוא נוסף.");
        }
        const existing = await loadVehicleFillups(resolvedVehicleId);
        if (!current()) return;
        const nextPlan = planImport(
          parsed,
          resolvedVehicleId,
          existing,
          importVehicles.find((entry) => entry.id === resolvedVehicleId)?.fuelType,
        );

        setTargetVehicleId(resolvedVehicleId);
        setResolvedTarget(importVehicles.find((v) => v.id === resolvedVehicleId) ?? null);
        setPlan(nextPlan);
        setStage("preview");
      } catch {
        if (!current()) return;
        setError("לא ניתן להכין את הייבוא. נדרשים קובץ CSV או Excel תקין וחיבור לשרת כדי לאמת את הרכב ולבדוק כפילויות.");
        setStage("choose");
      }
    },
    [targetVehicleId, activeVehicle, loadVehicleFillups, loadVehicleCatalog, captureAccountAction, captureMount, captureFlow],
  );

  async function runImport() {
    const current = captureFlow();
    if (!current() || importInFlight.current || (!tankImport && (!plan || plan.toImport.length === 0))) return;
    importInFlight.current = true;
    setStage("importing");
    let attempted = tankImport?.records.length ?? plan?.toImport.length ?? 0;
    let skippedDuplicates = plan?.duplicates.length ?? 0;
    const skippedInvalid = tankImport?.rejected.length ?? plan?.rejected.length ?? 0;

    async function finish(receipt: { settled: Promise<boolean> }, reportFor: (acknowledged: boolean | null) => ImportReport) {
      const acknowledged = await Promise.race([
        receipt.settled,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 6_000)),
      ]);
      if (!current()) return;
      setReport(reportFor(acknowledged));
      setStage("done");
      if (acknowledged === null) {
        // A later receipt belongs to this exact import, never to a replacement file/account.
        void receipt.settled.then(accepted => {
          if (current()) setReport(reportFor(accepted));
        }, () => {
          if (current()) setReport(reportFor(false));
        });
      }
    }

    try {
      if (tankImport) {
        const result = await importTankUpdates(targetVehicleId, tankImport.records);
        if (!current()) return;
        await finish(result.receipt, acknowledged => ({
          imported: acknowledged === true ? result.written : 0,
          queued: acknowledged === null ? result.written : 0,
          failed: acknowledged === false ? result.written : 0,
          failures: acknowledged === false ? [{ rowNumber: 0, reason: "השרת לא אישר את הייבוא. הנתונים נשמרו לתיקון בשינויים שעוד לא עלו לענן." }] : [],
          skippedDuplicates: result.duplicates,
          skippedInvalid: tankImport.rejected.length,
        }));
        return;
      }
      if (!plan) return;
      const batchId = `imp_${Date.now().toString(36)}`;
      const records: Omit<Fillup, "id" | "createdAt">[] = plan.toImport.map((row) => ({
        fillEndState: row.fillEndState,
        fillEndStateSource: row.fillEndStateSource,
        preFillLevel: row.preFillLevel,
        preFillLevelSource: row.preFillLevelSource,
        preFillLevelUncertainty: row.preFillLevelUncertainty,
        postFillLevel: row.postFillLevel,
        postFillLevelSource: row.postFillLevelSource,
        postFillLevelUncertainty: row.postFillLevelUncertainty,
        refuelReason: row.refuelReason,
        capacityLitersAtEntry: row.capacityLitersAtEntry,
        tankSchemaVersion: row.tankSchemaVersion,
        postedPricePerLiter: row.postedPricePerLiter,
        date: row.date,
        odometer: row.odometer,
        liters: row.liters,
        pricePerLiter: row.pricePerLiter,
        totalCost: row.totalCost,
        isFullTank: row.isFullTank,
        // Provenance, so a legacy assumption never masquerades as a user statement.
        fullTankSource: row.fullTankSource,
        continuityBreakBefore: row.continuityBreakBefore,
        station: row.station,
        notes: row.notes,
        fuelType: row.fuelType,
        importSource: plan.format,
        importBatchId: batchId,
        importRowHash: row.rowHash,
        schemaVersion: 2,
      }));

      const { fillupIdentityHash } = await import("../lib/import/rows");
      if (!current()) return;
      const existing = await loadVehicleFillups(plan.vehicleId);
      if (!current()) return;
      const hashes = new Set(existing.map(f => fillupIdentityHash(plan.vehicleId, f, targetVehicle?.fuelType)));
      const freshRecords = records.filter(record => !hashes.has(record.importRowHash!));
      skippedDuplicates = plan.duplicates.length + records.length - freshRecords.length;
      attempted = freshRecords.length;
      if (freshRecords.length === 0) {
        setReport({ imported: 0, queued: 0, failed: 0, failures: [], skippedDuplicates, skippedInvalid });
        setStage("done");
        return;
      }
      const metadata = {
        format: plan.format,
        fileName,
        recordCount: freshRecords.length,
        vehicleLabel: targetVehicle ? vehicleLabel(targetVehicle) : "",
      };
      const { written, receipt } = await addFillupBatch(plan.vehicleId, freshRecords, metadata);
      if (!current()) return;
      // Retain the actual id sent on every imported row. No replacement id is generated for Undo.
      setCompletedImport({ ...metadata, id: batchId, vehicleId: plan.vehicleId });
      await finish(receipt, acknowledged => ({
        imported: acknowledged === true ? written : 0,
        queued: acknowledged === null ? written : 0,
        skippedDuplicates,
        skippedInvalid,
        failed: acknowledged === false ? written : 0,
        failures: acknowledged === false ? [{ rowNumber: 0, reason: "השרת לא אישר את הייבוא. בדקו את השינויים שעוד לא עלו לענן לפני ניסיון נוסף." }] : [],
      }));
    } catch {
      if (!current()) return;
      setReport({ imported: 0, queued: 0, failed: attempted, skippedDuplicates, skippedInvalid,
        failures: [{ rowNumber: 0, reason: "לא ניתן לאשר שהייבוא הושלם. בדקו את השינויים שעוד לא עלו לענן לפני ניסיון נוסף." }] });
      setStage("done");
    } finally {
      importInFlight.current = false;
    }
  }

  async function undoCompletedImport() {
    const current = captureFlow();
    if (!current() || undoInFlight.current || !completedImport || !report?.imported || report.queued || report.failed
      || undoAcceptedBatchId.current === completedImport.id) return;
    const requested = completedImport;
    undoInFlight.current = true;
    setConfirmUndo(false);
    setUndoState("busy");
    setUndoError(null);
    try {
      // This exact pair was submitted by this flow and acknowledged by its original receipt.
      const result = await deleteImportBatch({ id: requested.id, vehicleId: requested.vehicleId });
      if (!current()) return;
      if (!result.ok) {
        setUndoError(result.reason ?? "ביטול הייבוא לא אושר. אפשר לבדוק את השינויים שעוד לא עלו לענן.");
        setUndoState("available");
      } else {
        undoAcceptedBatchId.current = requested.id;
        setUndoCount(result.deleted);
        setUndoState(result.pending ? "pending" : "done");
      }
    } catch {
      if (current()) {
        setUndoError("לא ניתן לאשר שביטול הייבוא הושלם. בדקו את החיבור ואת השינויים שעוד לא עלו לענן לפני ניסיון נוסף.");
        setUndoState("available");
      }
    } finally {
      undoInFlight.current = false;
    }
  }

  return (
    <main className="tm-secondary-page" data-testid="import-page">
      <ScreenHeader title="ייבוא נתונים" onBack={() => navigate(-1)} />
      <div className="tm-secondary-body">
        {stage === "choose" ? <>
          <h2 className="tm-secondary-title">מעבירים היסטוריה</h2>
          <p className="tm-secondary-copy">קובץ CSV או Excel, מטנק מלא או מאפליקציה אחרת. הקובץ נקרא רק במכשיר, והשמירה מתחילה רק אחרי האישור שלכם.</p>
          {activeVehicles.length === 0 ? <div className="tm-secondary-stack">
            <h3 className="tm-secondary-section-title">צריך רכב אחד לפחות</h3>
            <p className="tm-secondary-copy">בחרו רכב פעיל כדי לשייך אליו את ההיסטוריה.</p>
            <Button full onClick={() => navigate("/vehicle")}>לרכב שלי</Button>
          </div> : <VehiclePicker vehicles={activeVehicles} value={targetVehicleId || activeVehicle?.id || ""}
            onChange={value => { flowVersion.current += 1; setResolvedTarget(null); setTargetVehicleId(value); }} />}
          {error ? <ErrorNote text={error} /> : null}
          {/* Native label activation preserves the original Android file-picker gesture. */}
          <input id="import-file" ref={inputRef} type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="tm-secondary-file-input sr-only" disabled={activeVehicles.length === 0}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onFile(file); }} />
          <label htmlFor="import-file" aria-disabled={activeVehicles.length === 0} className="tm-secondary-file">
            <UploadIcon size={32} /><b>בחירת קובץ</b><span className="tm-secondary-note">CSV · Excel</span>
          </label>
          <ImportHistory listBatches={listImportBatches} deleteBatch={deleteImportBatch} captureAccountAction={captureAccountAction} />
        </> : null}
        {stage === "parsing" ? <div className="tm-secondary-loading" role="status">
          <Spinner /><p className="tm-secondary-copy tm-secondary-file-name">קוראים את <bdi dir="auto">{fileName}</bdi>…</p>
        </div> : null}
        {stage === "preview" && backupSources.length > 1 ? <div className="tm-secondary-group tm-secondary-stack pt-3">
          <label htmlFor="backup-source" className="tm-secondary-note font-semibold">רכב המקור בתוך הגיבוי</label>
          <select id="backup-source" className="min-h-11 rounded-xl border border-line bg-surface p-3 text-ink" value={backupSourceId}
            onChange={event => { if (sourceFile.current) void onFile(sourceFile.current, event.target.value); }}>
            {backupSources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <p className="tm-secondary-note">רכב היעד: <NumericText>{targetVehicle ? vehicleLabel(targetVehicle) : ""}</NumericText>. לבחירת יעד אחר חזרו לבחירת הקובץ.</p>
        </div> : null}
        {stage === "preview" && tankImport ? <>
          <h2 className="tm-secondary-title">עדכוני מיכל ונסיעות</h2>
          <p className="tm-secondary-copy"><Num>{tankImport.records.length}</Num> עדכונים לרכב <NumericText>{targetVehicle ? vehicleLabel(targetVehicle) : ""}</NumericText>. רשומות שכבר קיימות לא יוחלפו.</p>
          {tankImport.vehicleIds.length > 1 ? <p className="tm-secondary-note">הקובץ מכיל כמה רכבים. ייובאו רק עדכוני הרכב שנבחר.</p> : null}
          {tankImport.rejected.length ? <div className="tm-secondary-notice tm-secondary-notice-error"><div className="tm-secondary-stack">
            {tankImport.rejected.map(row => <p key={row.rowNumber}>שורה <Num>{row.rowNumber}</Num>: <NumericText>{row.reason}</NumericText></p>)}
          </div></div> : null}
          <div className="tm-secondary-bottom">
            <Button full disabled={!tankImport.records.length} onClick={() => void runImport()}>ייבוא <Num>{tankImport.records.length}</Num> עדכונים</Button>
            <button type="button" className="tm-secondary-link" onClick={chooseAnotherFile}>קובץ אחר</button>
          </div>
        </> : null}
        {stage === "preview" && plan ? <PreviewStep plan={plan} fileName={fileName}
          vehicleName={targetVehicle ? vehicleLabel(targetVehicle) : ""} onCancel={chooseAnotherFile} onConfirm={runImport} /> : null}
        {stage === "importing" ? <div className="tm-secondary-loading" role="status"><Spinner /><p className="tm-secondary-copy">מייבאים וממתינים לאישור השמירה…</p></div> : null}
        {stage === "done" && report ? <ReportStep report={report} plan={plan}
          canUndo={!!completedImport && report.imported > 0 && report.queued === 0 && report.failed === 0}
          undoState={undoState} undoCount={undoCount} undoError={undoError}
          onUndo={() => setConfirmUndo(true)} onDone={() => navigate("/history")}
          onRecovery={() => navigate("/settings/unsynced")} onAnother={chooseAnotherFile} /> : null}
      </div>
      <ConfirmDialog open={confirmUndo} title="לבטל את הייבוא?" tone="danger" confirmLabel="ביטול הייבוא"
        body={completedImport ? `יימחקו רק הרשומות מהייבוא של ${completedImport.fileName} אל ${completedImport.vehicleLabel || "הרכב"}. בייבוא הזה נשמרו ${completedImport.recordCount} רשומות. רשומות שהוזנו ידנית יישארו.` : ""}
        onConfirm={() => void undoCompletedImport()} onCancel={() => setConfirmUndo(false)} />
    </main>
  );
}

function VehiclePicker({ vehicles, value, onChange }: {
  vehicles: { id: string; make: string; model: string; year?: number | null; nickname?: string | null }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return <section className="tm-secondary-stack" aria-label="רכב היעד לייבוא">
    <Label>ייבוא לרכב</Label>
    <div className="tm-secondary-group">
      {vehicles.map(vehicle => <button key={vehicle.id} type="button" onClick={() => onChange(vehicle.id)}
        aria-pressed={value === vehicle.id} className="tm-import-vehicle">
        <CarIcon size={21} /><span><NumericText>{vehicleLabel(vehicle)}</NumericText></span>
        {value === vehicle.id ? <CheckIcon size={19} /> : null}
      </button>)}
    </div>
  </section>;
}

const FORMAT_NAMES: Record<string, string> = {
  "tank-maleh-v1": "ייצוא של טנק מלא",
  "tank-maleh-v2": "ייצוא של טנק מלא",
  "legacy-fuel-tracker": "יומן תדלוקים ישן",
  unknown: "מבנה כללי",
};

function PreviewStep({ plan, fileName, vehicleName, onCancel, onConfirm }: {
  plan: ImportPlan; fileName: string; vehicleName: string; onCancel: () => void; onConfirm: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const assumedFull = plan.toImport.filter(row => row.fullTankSource === "legacy-assumption").length;
  const previewRows = [
    ...plan.toImport.slice(0, 5).map(row => ({ row, duplicate: false })),
    ...plan.duplicates.slice(0, 3).map(row => ({ row, duplicate: true })),
  ];
  const hasDetails = plan.assumptions.length > 0 || plan.warnings.length > 0 || plan.dateRange !== null || plan.breakCount > 0;
  return <>
    <h2 className="tm-secondary-title">נמצאו <Num>{plan.totalRows}</Num> רשומות</h2>
    <div className="tm-secondary-stack">
      <bdi dir="auto" className="tm-secondary-file-name tm-secondary-note">{fileName}</bdi>
      <p className="tm-secondary-note">זוהה כ{FORMAT_NAMES[plan.format] ?? FORMAT_NAMES.unknown} · ייובא אל <NumericText>{vehicleName}</NumericText></p>
      {!plan.sameVehicle && plan.sourceVehicleIds.length > 0 && plan.vehicleLabels[0] ? <p className="tm-secondary-notice">
        הקובץ יוצא מ<NumericText>{plan.vehicleLabels[0]}</NumericText>
      </p> : null}
    </div>
    <div className="tm-import-stats">
      <StatRow label="שורות בקובץ" value={plan.totalRows} />
      <StatRow label="ייובאו" value={plan.toImport.length} tone="accent" />
      <StatRow label="כבר קיימות" value={plan.duplicates.length} />
      <StatRow label="לא תקינות" value={plan.rejected.length} tone="danger" />
    </div>
    {previewRows.length ? <section className="tm-secondary-stack" aria-label="תצוגה מקדימה של הרשומות">
      <div className="tm-secondary-group">
        {previewRows.map(({ row, duplicate }, index) => <div key={`${row.rowHash}-${index}`}
          className={`tm-secondary-row${duplicate ? " tm-import-duplicate" : ""}`}>
          <span className="tm-secondary-row-copy">
            <b><NumericText>{row.station?.name || dayMonthShort(row.date)}</NumericText></b>
            <small><NumericText>{dayMonthShort(row.date)}</NumericText> · <Num>{row.odometer.toLocaleString("he-IL")}</Num> ק״מ</small>
            <span className="tm-import-preview-money"><Quantity value={row.liters} digits={1} /> · <Money value={row.totalCost} /></span>
          </span>
          <span className="tm-secondary-row-value">{duplicate ? "כפול" : "חדש"}</span>
        </div>)}
      </div>
      {plan.toImport.length + plan.duplicates.length > previewRows.length ? <p className="tm-secondary-note">
        מוצגות <Num>{previewRows.length}</Num> מתוך <Num>{plan.toImport.length + plan.duplicates.length}</Num> רשומות תקינות.
      </p> : null}
    </section> : null}
    {assumedFull > 0 ? <div className="tm-secondary-notice"><WarningIcon size={20} /><p>
      ב־<Num>{assumedFull}</Num> רשומות לא צוין אם המיכל מולא עד הסוף. הן ייחשבו כתדלוק מלא, ואפשר לתקן אותן אחר כך.
    </p></div> : null}
    {plan.rejected.length > 0 ? <section className="tm-secondary-stack" aria-label="שורות שלא ייובאו">
      <h3 className="tm-secondary-section-title">שורות שלא ייובאו</h3>
      <div className="tm-secondary-group">
        {plan.rejected.slice(0, 8).map(entry => <div key={entry.rowNumber} className="tm-secondary-row">
          <span className="tm-secondary-row-value text-danger-ink">שורה <Num>{entry.rowNumber}</Num></span>
          <p className="tm-secondary-copy"><NumericText>{entry.reason}</NumericText></p>
        </div>)}
      </div>
      {plan.rejected.length > 8 ? <p className="tm-secondary-note">ועוד <Num>{plan.rejected.length - 8}</Num> שורות.</p> : null}
    </section> : null}
    {hasDetails ? <div className="tm-secondary-disclosure">
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}
        className="tm-secondary-link w-full justify-between">פרטים נוספים<ChevronDown size={18} className={detailsOpen ? "rotate-180" : ""} /></button>
      {detailsOpen ? <div className="tm-secondary-disclosure-content tm-secondary-note">
        {plan.dateRange ? <p>טווח תאריכים: <NumericText>{dayMonthShort(plan.dateRange.from)}</NumericText> עד <NumericText>{dayMonthShort(plan.dateRange.to)}</NumericText></p> : null}
        {plan.breakCount > 0 ? <p>נקודות התחלת תקופה חדשה · <Num>{plan.breakCount}</Num></p> : null}
        {plan.assumptions.map(text => <p key={text}><NumericText>{text}</NumericText></p>)}
        {plan.warnings.slice(0, 6).map(text => <p key={text}><NumericText>{text}</NumericText></p>)}
        {plan.warnings.length > 6 ? <details className="tm-secondary-disclosure">
          <summary>אזהרות נוספות · <Num>{plan.warnings.length - 6}</Num><ChevronDown size={18} /></summary>
          <div className="tm-secondary-disclosure-content">{plan.warnings.slice(6).map(text => <p key={text}><NumericText>{text}</NumericText></p>)}</div>
        </details> : null}
      </div> : null}
    </div> : null}
    <div className="tm-secondary-bottom">
      <Button full disabled={plan.toImport.length === 0} onClick={onConfirm}>
        {plan.toImport.length === 0 ? "אין מה לייבא" : <>ייבוא <Num>{plan.toImport.length}</Num> רשומות</>}
      </Button>
      <button type="button" className="tm-secondary-link" onClick={onCancel}>קובץ אחר</button>
    </div>
  </>;
}

function ReportStep({ report, plan, canUndo, undoState, undoCount, undoError, onUndo, onDone, onRecovery, onAnother }: {
  report: ImportReport; plan: ImportPlan | null; canUndo: boolean; undoState: UndoState; undoCount: number;
  undoError: string | null; onUndo: () => void; onDone: () => void; onRecovery: () => void; onAnother: () => void;
}) {
  const title = undoState === "done" ? "הייבוא בוטל" : report.failed > 0 ? "הייבוא לא הושלם"
    : report.queued > 0 ? "נשמר במכשיר" : report.skippedInvalid > 0 ? "הייבוא הסתיים חלקית"
    : report.imported > 0 ? "הייבוא הסתיים" : "לא נוספו רשומות";
  return <>
    <h2 className="tm-secondary-title tm-secondary-title-result" role="status">{title}</h2>
    {undoState === "done" ? <p className="tm-secondary-copy"><Num>{undoCount}</Num> רשומות מהייבוא נמחקו, והביטול אושר בשרת.</p> : <>
      <div className="tm-import-stats">
        <StatRow label="נשמרו ואושרו בשרת" value={report.imported} tone="accent" />
        {report.queued > 0 ? <StatRow label="נשמרו במכשיר, ממתינים לסנכרון" value={report.queued} /> : null}
        <StatRow label="כבר היו קיימות" value={report.skippedDuplicates} />
        <StatRow label="לא תקינות" value={report.skippedInvalid} tone="danger" />
        {report.failed > 0 ? <StatRow label="לא אושרו" value={report.failed} tone="danger" /> : null}
      </div>
      {report.queued > 0 ? <p className="tm-secondary-notice tm-secondary-notice-info">הרשומות שמורות במכשיר וממתינות לאישור השרת. ביטול הייבוא יהיה זמין אחרי האישור.</p> : null}
      {report.failures.length > 0 ? <ErrorNote text={report.failures.map(entry => entry.reason).join(" · ")} /> : null}
      {plan && plan.rejected.length > 0 ? <p className="tm-secondary-note">אפשר לתקן את השורות בקובץ ולייבא שוב. ייבוא חוזר לא ייצור כפילויות.</p> : null}
    </>}
    {undoError ? <ErrorNote text={undoError} /> : null}
    {undoState === "pending" ? <p role="status" className="tm-secondary-notice tm-secondary-notice-info">בקשת ביטול הייבוא ממתינה לאישור. עדיין אי אפשר לומר שהרשומות נמחקו.</p> : null}
    <div className="tm-secondary-bottom">
      <Button full variant="ink" onClick={onDone}>סיום</Button>
      {canUndo && (undoState === "available" || undoState === "busy") ? <Button full variant="line" loading={undoState === "busy"} onClick={onUndo}>ביטול הייבוא</Button> : null}
      {report.queued > 0 || report.failed > 0 || undoState === "pending" || undoError ? <button type="button" className="tm-secondary-link" onClick={onRecovery}>לשינויים שעוד לא עלו לענן</button> : null}
      <button type="button" className="tm-secondary-link" disabled={undoState === "busy"} onClick={onAnother}>ייבוא קובץ נוסף</button>
    </div>
  </>;
}

function StatRow({ label, value, tone }: { label: string; value: number; tone?: "accent" | "danger" }) {
  return <div className="tm-import-stat">
    <Num className={value > 0 && tone === "danger" ? "text-danger-ink" : value === 0 ? "text-muted" : "text-ink"}>{value}</Num>
    <span>{label}</span>
  </div>;
}

function ErrorNote({ text }: { text: string }) {
  return <div role="alert" className="tm-secondary-notice tm-secondary-notice-error">
    <WarningIcon size={19} /><p><NumericText>{text}</NumericText></p>
  </div>;
}

/** Existing batch-scoped rollback, with an explicit unavailable history and current-account UI. */
function ImportHistory({ listBatches, deleteBatch, captureAccountAction }: {
  listBatches: () => Promise<ImportBatch[]>;
  deleteBatch: (batch: ImportBatch) => Promise<{ deleted: number; ok: boolean; pending?: boolean; reason?: string }>;
  captureAccountAction: () => () => boolean;
}) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const captureMount = useAccountScope(user?.uid);
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const accountCurrent = captureAccountAction();
    const mounted = captureMount();
    const version = ++request.current;
    const current = () => accountCurrent() && mounted() && request.current === version;
    if (!current()) return;
    setLoading(true);
    setHistoryError(false);
    try {
      const result = await listBatches();
      if (current()) setBatches(result);
    } catch {
      if (current()) setHistoryError(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [listBatches, captureAccountAction, captureMount]);

  useEffect(() => {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(() => { void refresh(); }, { timeout: 2_000 });
      return () => { window.cancelIdleCallback?.(handle); request.current += 1; };
    }
    const timer = setTimeout(() => { void refresh(); }, 400);
    return () => { clearTimeout(timer); request.current += 1; };
  }, [refresh]);

  async function rollBack(batch: ImportBatch) {
    const accountCurrent = captureAccountAction();
    const mounted = captureMount();
    const current = () => accountCurrent() && mounted();
    if (!current() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setConfirming(null);
    try {
      const result = await deleteBatch(batch);
      if (!current()) return;
      if (!result.ok) showToast({ tone: "error", title: "ביטול הייבוא נכשל", detail: result.reason ?? "בדקו את החיבור ונסו שוב" });
      else if (result.pending) showToast({ tone: "info", title: "בקשת ביטול הייבוא ממתינה לאישור", detail: "אפשר לעקוב בשינויים שעוד לא עלו לענן" });
      else showToast({ tone: "success", title: `הייבוא בוטל · ${result.deleted} רשומות נמחקו` });
    } catch {
      if (current()) showToast({ tone: "error", title: "ביטול הייבוא לא אושר", detail: "בדקו את השינויים שעוד לא עלו לענן לפני ניסיון נוסף" });
    } finally {
      inFlight.current = false;
      if (current()) { setBusy(false); void refresh(); }
    }
  }

  return <section className="tm-secondary-stack" aria-label="ייבואים קודמים">
    <h3 className="tm-secondary-section-title">ייבואים קודמים</h3>
    {batches && batches.length >= 50 ? <p className="tm-secondary-note">מוצגים עד <Num>50</Num> ייבואים. הרשימה עשויה להיות חלקית.</p> : null}
    {loading ? <p role="status" className="tm-secondary-note">טוענים את הייבואים הקודמים…</p>
      : historyError ? <div className="tm-secondary-stack" data-testid="import-history-unavailable">
        <ErrorNote text="לא ניתן לטעון כרגע את הייבואים הקודמים. זה לא אומר שאין היסטוריה." />
        <button type="button" className="tm-secondary-link" onClick={() => void refresh()}>ניסיון נוסף</button>
      </div> : batches?.length === 0 ? <p className="tm-secondary-note">אחרי ייבוא הוא יופיע כאן, ואפשר יהיה לבטל אותו כולו.</p>
      : <div className="tm-secondary-group">{batches?.map(batch => <div key={batch.id} className="tm-secondary-row tm-import-history-row">
        <span className="tm-secondary-row-copy">
          <b><bdi dir="auto">{batch.fileName || FORMAT_NAMES[batch.format] || "ייבוא"}</bdi></b>
          <small><Num>{batch.recordCount}</Num> רשומות · <NumericText>{batch.vehicleLabel || "רכב"}</NumericText></small>
          <small><NumericText>{fullDate(batch.importedAt)}</NumericText></small>
        </span>
        <button type="button" disabled={busy} className="tm-secondary-link tm-secondary-link-danger" onClick={() => setConfirming(batch)}>ביטול הייבוא</button>
      </div>)}</div>}
    <ConfirmDialog open={confirming !== null} title="לבטל את הייבוא?" tone="danger" confirmLabel="ביטול הייבוא"
      body={confirming ? `יימחקו ${confirming.recordCount} רשומות שיובאו אל ${confirming.vehicleLabel || "הרכב"}. רשומות שהזנתם ידנית יישארו. אפשר לייבא את הקובץ שוב אחר כך.` : ""}
      onConfirm={() => confirming && void rollBack(confirming)} onCancel={() => setConfirming(null)} />
  </section>;
}
