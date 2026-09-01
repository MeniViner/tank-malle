import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Button, Spinner } from "../components/Button";
import { Card, IconTile, Label } from "../components/Card";
import { Num } from "../components/Num";
import { Money, Quantity } from "../components/Fmt";
import { CarIcon, CheckIcon, WarningIcon } from "../components/icons";
import { dayMonthShort, fullDate, vehicleLabel } from "../lib/format";
import { ConfirmDialog } from "../components/Sheet";
import type { ImportBatch } from "../context/DataContext";
import type { Fillup } from "../lib/types";
import type { ImportPlan, ImportReport } from "../lib/import/plan";

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

export function ImportData() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    activeVehicles,
    activeVehicle,
    fillups,
    addFillupBatch,
    listImportBatches,
    deleteImportBatch,
  } = useData();

  const [stage, setStage] = useState<Stage>("choose");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [targetVehicleId, setTargetVehicleId] = useState(activeVehicle?.id ?? "");

  const inputRef = useRef<HTMLInputElement>(null);

  const targetVehicle = useMemo(
    () => activeVehicles.find((entry) => entry.id === targetVehicleId) ?? null,
    [activeVehicles, targetVehicleId],
  );

  const onFile = useCallback(
    async (file: File) => {
      setError(null);
      setReport(null);
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

        let table: unknown[][];
        // Which cells were computed rather than typed; XLSX only.
        let formulaCells: boolean[][] = [];

        if (/\.xlsx?$/i.test(file.name)) {
          const { readWorkbook, canReadZip, UnsupportedArchiveError } = await import(
            "../lib/import/xlsx"
          );
          if (!canReadZip()) {
            setError(
              "הדפדפן הזה לא תומך בקריאת קובצי Excel. שמרו את הגיליון כ־CSV ונסו שוב.",
            );
            setStage("choose");
            return;
          }
          try {
            const sheet = await readWorkbook(await file.arrayBuffer());
            table = sheet.rows;
            formulaCells = sheet.formulas;
          } catch (caught) {
            if (caught instanceof UnsupportedArchiveError) {
              setError("לא הצלחנו לקרוא את הקובץ. שמרו אותו כ־CSV ונסו שוב.");
              setStage("choose");
              return;
            }
            throw caught;
          }
        } else {
          const { parseCsv } = await import("../lib/import/csv");
          table = parseCsv(await file.text());
        }

        const parsed = parseRows(table, formulaCells);
        const nextPlan = planImport(
          parsed,
          vehicleId,
          fillups,
          activeVehicles.find((entry) => entry.id === vehicleId)?.fuelType,
        );

        setTargetVehicleId(vehicleId);
        setPlan(nextPlan);
        setStage("preview");
      } catch {
        setError("הקובץ לא נקרא. ודאו שזה קובץ CSV או XLSX תקין.");
        setStage("choose");
      }
    },
    [targetVehicleId, activeVehicle, fillups, activeVehicles],
  );

  async function runImport() {
    if (!plan || plan.toImport.length === 0) return;
    setStage("importing");

    const batchId = `imp_${Date.now().toString(36)}`;
    const records: Omit<Fillup, "id" | "createdAt">[] = plan.toImport.map((row) => ({
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

    try {
      const { written, receipt } = await addFillupBatch(plan.vehicleId, records, {
        format: plan.format,
        fileName,
        recordCount: records.length,
        vehicleLabel: targetVehicle ? vehicleLabel(targetVehicle) : "",
      });

      // The records are in the local cache immediately; whether the SERVER has
      // taken them is a separate question, and the report answers it honestly.
      const acknowledged = await Promise.race([
        receipt.settled,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
      ]);

      setReport({
        imported: acknowledged === true ? written : 0,
        queued: acknowledged === true ? 0 : written,
        skippedDuplicates: plan.duplicates.length,
        skippedInvalid: plan.rejected.length,
        failed: acknowledged === false ? written : 0,
        failures:
          acknowledged === false
            ? [{ rowNumber: 0, reason: "השרת דחה את הכתיבה" }]
            : [],
      });
      setStage("done");
    } catch {
      setReport({
        imported: 0,
        queued: 0,
        skippedDuplicates: plan.duplicates.length,
        skippedInvalid: plan.rejected.length,
        failed: plan.toImport.length,
        failures: [{ rowNumber: 0, reason: "הייבוא נכשל" }],
      });
      setStage("done");
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-bg pt-safe">
      <ScreenHeader title="ייבוא נתונים" onBack={() => navigate(-1)} />

      <div className="flex flex-col gap-3 px-5 pb-10">
        {stage === "choose" || stage === "parsing" ? (
          <>
            <Card className="flex flex-col gap-2 p-4">
              <Label>איך זה עובד</Label>
              <p className="text-[13.5px] leading-relaxed text-muted">
                בחרו קובץ CSV או XLSX. אנחנו מזהים את המבנה לבד — גם את הפורמט של
                האפליקציה וגם של יומני תדלוק ישנים — ומראים לכם בדיוק מה ייובא לפני
                שנשמר משהו.
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted">
                הקובץ נקרא במכשיר שלכם בלבד ואינו נשלח לשום שרת.
              </p>
            </Card>

            {activeVehicles.length === 0 ? (
              <Card className="flex flex-col gap-3 p-4">
                <span className="text-[14px] font-semibold text-ink">
                  צריך רכב אחד לפחות
                </span>
                <span className="text-[13px] leading-relaxed text-muted">
                  הנתונים מיובאים לרכב מסוים. הוסיפו רכב ואז חזרו לכאן.
                </span>
                <Button full onClick={() => navigate("/vehicles/new")}>
                  הוספת רכב
                </Button>
              </Card>
            ) : (
              <VehiclePicker
                vehicles={activeVehicles}
                value={targetVehicleId || activeVehicle?.id || ""}
                onChange={setTargetVehicleId}
              />
            )}

            {error ? <ErrorNote text={error} /> : null}

            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so choosing the same file twice still fires.
                event.target.value = "";
                if (file) void onFile(file);
              }}
            />

            <Button
              full
              loading={stage === "parsing"}
              disabled={activeVehicles.length === 0}
              onClick={() => inputRef.current?.click()}
            >
              בחירת קובץ
            </Button>

            <ImportHistory
              listBatches={listImportBatches}
              deleteBatch={deleteImportBatch}
            />
          </>
        ) : null}

        {stage === "preview" && plan ? (
          <PreviewStep
            plan={plan}
            fileName={fileName}
            vehicleName={targetVehicle ? vehicleLabel(targetVehicle) : ""}
            onCancel={() => {
              setPlan(null);
              setStage("choose");
            }}
            onConfirm={runImport}
          />
        ) : null}

        {stage === "importing" ? (
          <Card className="flex flex-col items-center gap-3 p-8">
            <Spinner />
            <span className="text-[14px] text-muted">מייבא…</span>
          </Card>
        ) : null}

        {stage === "done" && report ? (
          <ReportStep
            report={report}
            plan={plan}
            onDone={() => {
              showToast({ tone: "success", title: "הייבוא הסתיים" });
              navigate("/history");
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

function VehiclePicker({
  vehicles,
  value,
  onChange,
}: {
  vehicles: { id: string; make: string; model: string; year?: number | null; nickname?: string | null }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <Label>ייבוא לרכב</Label>
      {/* The vehicle column in a legacy file is import metadata, not a
          make/model, so a vehicle is never created from it. */}
      <div className="flex flex-col gap-1.5">
        {vehicles.map((vehicle) => (
          <button
            key={vehicle.id}
            type="button"
            onClick={() => onChange(vehicle.id)}
            aria-pressed={value === vehicle.id}
            className={`flex min-h-[48px] items-center gap-3 rounded-[12px] px-3 text-start transition-[background-color] duration-150 ${
              value === vehicle.id ? "bg-accent-soft" : "bg-surface-2"
            }`}
          >
            <IconTile tone={value === vehicle.id ? "accent" : "muted"}>
              <CarIcon size={17} />
            </IconTile>
            <span className="flex-1 truncate text-[14.5px] font-semibold text-ink">
              {vehicleLabel(vehicle)}
            </span>
            {value === vehicle.id ? (
              <CheckIcon size={18} className="flex-none text-accent" />
            ) : null}
          </button>
        ))}
      </div>
    </Card>
  );
}

const FORMAT_NAMES: Record<string, string> = {
  "tank-maleh-v1": "ייצוא של טנק מלא",
  "tank-maleh-v2": "ייצוא של טנק מלא",
  "legacy-fuel-tracker": "יומן תדלוקים ישן",
  unknown: "מבנה כללי",
};

function PreviewStep({
  plan,
  fileName,
  vehicleName,
  onCancel,
  onConfirm,
}: {
  plan: ImportPlan;
  fileName: string;
  vehicleName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const nothingToDo = plan.toImport.length === 0;

  return (
    <>
      <Card className="flex flex-col gap-1 p-4">
        <Label>הקובץ שנבחר</Label>
        <span className="truncate text-[14.5px] font-semibold text-ink">{fileName}</span>
        <span className="text-[12.5px] text-muted">
          זוהה כ{FORMAT_NAMES[plan.format] ?? FORMAT_NAMES.unknown} · ייובא אל{" "}
          {vehicleName}
        </span>
      </Card>

      <Card className="flex flex-col gap-2.5 p-4">
        <Label>מה יקרה</Label>
        <StatRow label="רשומות שנקראו" value={plan.parsed} />
        <StatRow label="ייובאו" value={plan.toImport.length} tone="accent" />
        <StatRow label="כבר קיימות — יידלגו" value={plan.duplicates.length} />
        <StatRow label="לא ניתנות לייבוא" value={plan.rejected.length} tone="danger" />
        <StatRow label="נקודות התחלת תקופה חדשה" value={plan.breakCount} />
        {plan.dateRange ? (
          <div className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="text-muted">טווח תאריכים</span>
            <span className="text-ink">
              {dayMonthShort(plan.dateRange.from)} – {dayMonthShort(plan.dateRange.to)}
            </span>
          </div>
        ) : null}
      </Card>

      {plan.assumptions.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <Label>הנחות שנעשו</Label>
          {plan.assumptions.map((text) => (
            <span key={text} className="text-[12.5px] leading-relaxed text-muted">
              • {text}
            </span>
          ))}
        </Card>
      ) : null}

      {plan.vehicleLabels.length > 0 ? (
        <Card className="flex flex-col gap-1 p-4">
          <Label>עמודת הרכב בקובץ</Label>
          <span className="text-[12.5px] leading-relaxed text-muted">
            בקובץ מופיע “{plan.vehicleLabels.join("”, “")}”. זהו מידע טכני של הייצוא ולא
            יצירת רכב חדש — הרשומות ייובאו לרכב שבחרתם.
          </span>
        </Card>
      ) : null}

      {plan.rejected.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <Label>שורות שלא ייובאו</Label>
          {plan.rejected.slice(0, 8).map((entry) => (
            <span key={entry.rowNumber} className="text-[12.5px] text-muted">
              שורה <Num>{entry.rowNumber}</Num>: {entry.reason}
            </span>
          ))}
          {plan.rejected.length > 8 ? (
            <span className="text-[12.5px] text-muted">
              ועוד <Num>{plan.rejected.length - 8}</Num> שורות.
            </span>
          ) : null}
        </Card>
      ) : null}

      {plan.warnings.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <Label>אזהרות</Label>
          {plan.warnings.slice(0, 6).map((text) => (
            <span key={text} className="text-[12.5px] text-muted">
              • {text}
            </span>
          ))}
        </Card>
      ) : null}

      {plan.toImport.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <Label>דוגמה מהשורות הראשונות</Label>
          {plan.toImport.slice(0, 3).map((row) => (
            <div key={row.rowHash} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-muted">
                {dayMonthShort(row.date)} · <Num>{row.odometer.toLocaleString("he-IL")}</Num>{" "}
                ק״מ
              </span>
              <span className="text-[12.5px] text-ink">
                <Quantity value={row.liters} digits={2} /> · <Money value={row.totalCost} />
              </span>
            </div>
          ))}
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Button variant="ghost" full onClick={onCancel}>
          ביטול
        </Button>
        <Button full disabled={nothingToDo} onClick={onConfirm}>
          {nothingToDo ? "אין מה לייבא" : `ייבוא ${plan.toImport.length} רשומות`}
        </Button>
      </div>
    </>
  );
}

function ReportStep({
  report,
  plan,
  onDone,
}: {
  report: ImportReport;
  plan: ImportPlan | null;
  onDone: () => void;
}) {
  const clean = report.failed === 0 && report.skippedInvalid === 0;

  return (
    <>
      <Card className="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2">
          {clean ? (
            <CheckIcon size={20} className="text-success-ink" />
          ) : (
            <WarningIcon size={20} className="text-warning-ink" />
          )}
          <span className="text-[16px] font-bold text-ink">
            {clean ? "הייבוא הסתיים" : "הייבוא הסתיים חלקית"}
          </span>
        </span>

        <div className="flex flex-col gap-2">
          <StatRow label="נשמרו ואושרו בשרת" value={report.imported} tone="accent" />
          {report.queued > 0 ? (
            <StatRow label="נשמרו במכשיר, ממתינים לסנכרון" value={report.queued} />
          ) : null}
          <StatRow label="דילגנו — כבר היו קיימות" value={report.skippedDuplicates} />
          <StatRow label="לא ניתנות לייבוא" value={report.skippedInvalid} tone="danger" />
          {report.failed > 0 ? (
            <StatRow label="נכשלו" value={report.failed} tone="danger" />
          ) : null}
        </div>

        {report.queued > 0 ? (
          <span className="text-[12.5px] leading-relaxed text-muted">
            הרשומות כבר מופיעות באפליקציה. הסנכרון לשרת יושלם כשיהיה חיבור — אפשר לעקוב
            אחרי מצב הסנכרון בראש המסך.
          </span>
        ) : null}

        {report.failures.length > 0 ? (
          <span className="text-[12.5px] leading-relaxed text-danger-ink">
            {report.failures.map((entry) => entry.reason).join(" · ")}
          </span>
        ) : null}

        {plan && plan.rejected.length > 0 ? (
          <span className="text-[12.5px] leading-relaxed text-muted">
            השורות שלא ניתנות לייבוא נותרו בקובץ המקורי — אפשר לתקן אותן ולייבא שוב.
            ייבוא חוזר לא ייצור כפילויות.
          </span>
        ) : null}
      </Card>

      <Button full onClick={onDone}>
        סיום
      </Button>
    </>
  );
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13.5px]">
      <span className="text-muted">{label}</span>
      <Num
        className={`font-bold ${
          value === 0
            ? "text-muted"
            : tone === "accent"
              ? "text-accent"
              : tone === "danger"
                ? "text-danger-ink"
                : "text-ink"
        }`}
      >
        {value}
      </Num>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] bg-danger-soft px-3.5 py-3 text-danger-ink">
      <WarningIcon size={17} className="mt-px flex-none" />
      <span className="text-[13px] leading-relaxed">{text}</span>
    </div>
  );
}


/**
 * Import history, with a rollback per batch.
 *
 * A five-second undo is not a rollback — a mistake in an import is usually
 * noticed minutes later, on the History screen, not in the moment. Every
 * imported record carries its `importBatchId`, so the whole batch stays
 * reversible for as long as it exists.
 */
function ImportHistory({
  listBatches,
  deleteBatch,
}: {
  listBatches: () => Promise<ImportBatch[]>;
  deleteBatch: (batch: ImportBatch) => Promise<{
    deleted: number;
    ok: boolean;
    pending?: boolean;
    reason?: string;
  }>;
}) {
  const { showToast } = useToast();
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [confirming, setConfirming] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listBatches()
      .then(setBatches)
      .catch(() => setBatches([]));
  }, [listBatches]);

  useEffect(refresh, [refresh]);

  async function rollBack(batch: ImportBatch) {
    setBusy(true);
    setConfirming(null);
    try {
      const result = await deleteBatch(batch);

      if (!result.ok) {
        showToast({
          tone: "error",
          title: "ביטול הייבוא נכשל",
          detail: result.reason ?? "נסו שוב בעוד רגע",
        });
      } else if (result.pending) {
        // Locally applied, not yet acknowledged. Saying "deleted" here would be
        // the same lie the write states exist to prevent.
        showToast({
          tone: "info",
          title: `${result.deleted} רשומות הוסרו במכשיר`,
          detail: "המחיקה תסונכרן לשרת כשיהיה חיבור",
        });
      } else {
        showToast({
          tone: "success",
          title: `הייבוא בוטל · ${result.deleted} רשומות נמחקו`,
        });
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (batches === null) return null;
  if (batches.length === 0) {
    return (
      <Card className="flex flex-col gap-1 p-4">
        <Label>ייבואים קודמים</Label>
        <span className="text-[12.5px] leading-relaxed text-muted">
          עוד לא ביצעתם ייבוא. אחרי ייבוא הוא יופיע כאן, ותוכלו לבטל אותו כולו אם
          ייבאתם לרכב הלא נכון או בטעות.
        </span>
      </Card>
    );
  }

  return (
    <>
      <Card className="flex flex-col gap-3 p-4">
        <Label>ייבואים קודמים</Label>
        {batches.map((batch) => (
          <div key={batch.id} className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-semibold text-ink">
                  {batch.fileName || FORMAT_NAMES[batch.format] || "ייבוא"}
                </span>
                <span className="text-[12px] text-muted">
                  <Num>{batch.recordCount}</Num> רשומות · {batch.vehicleLabel || "רכב"}
                </span>
                <span className="text-[11.5px] text-muted/80">
                  {fullDate(batch.importedAt)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(batch)}
                className="min-h-[36px] flex-none rounded-pill bg-danger-soft px-3 text-[12.5px] font-semibold text-danger-ink disabled:opacity-50"
              >
                ביטול הייבוא
              </button>
            </div>
          </div>
        ))}
        <span className="text-[11.5px] leading-relaxed text-muted">
          ביטול מוחק רק את הרשומות שהגיעו מאותו ייבוא. רשומות שהזנתם ידנית לא ייגעו,
          גם אם הן באותו תאריך ובאותה תחנה.
        </span>
      </Card>

      <ConfirmDialog
        open={confirming !== null}
        title="לבטל את הייבוא?"
        body={
          confirming
            ? `יימחקו ${confirming.recordCount} רשומות שיובאו אל ${confirming.vehicleLabel || "הרכב"}. רשומות שהזנתם ידנית יישארו. אפשר לייבא את הקובץ שוב אחר כך.`
            : ""
        }
        confirmLabel="ביטול הייבוא"
        tone="danger"
        onConfirm={() => confirming && void rollBack(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
