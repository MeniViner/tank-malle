import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useData, type FillupSubmission, type RecordDeletionSubmission } from "../context/DataContext";
import { useVehicleData } from "../context/VehicleDataContext";
import { useToast, type Toast } from "../context/ToastContext";
import { useStats } from "../hooks/useStats";
import { useAccountScope } from "../components/account/useAccountScope";
import { JournalEntryRow } from "../components/JournalEntryRow";
import { JournalEntrySheet, type JournalEntrySelection } from "../components/journal/EntrySheet";
import { SegmentSheet } from "../components/home/SegmentSheet";
import { Button } from "../components/Button";
import { GroupRow } from "../components/DesignPrimitives";
import { NumericText, NumRun } from "../components/Fmt";
import { PeriodPicker } from "../components/PeriodPicker";
import { ConfirmDialog, Sheet } from "../components/Sheet";
import { CoinIcon, GaugeIcon, InfoIcon, PlusIcon, PumpIcon, SearchIcon, WarningIcon, WrenchIcon } from "../components/icons";
import { heMonthName, int } from "../lib/format";
import { serviceMileageWarning } from "../lib/journal/presentation";
import { localDay, validDay } from "../lib/maintenance/model";
import { buildRange, rangeDates, type RangeKey } from "../lib/periods";
import { financialTotals } from "../lib/vehicle/financial";
import { vehicleDay, vehicleMoney } from "../lib/vehicle/format";
import type { LedgerRow } from "../lib/vehicle/derived";
import type { VehicleRecord } from "../lib/vehicle/model";
import type { Fillup } from "../lib/types";
import "../journal-design.css";

const KINDS = [
  ["all", "הכל"], ["fuel", "תדלוקים"], ["service", "טיפולים"],
  ["expense", "הוצאות"], ["odometer", "ק״מ ומחוון"],
] as const;
const RANGE_KEYS: Record<string, RangeKey> = {
  all: "all", month: "thisMonth", year: "ytd", "3m": "3m", "6m": "6m", "1y": "1y",
};
const LEGACY_KINDS = new Set(["issue", "tank"]);

export function History() {
  const vehicle = useVehicleData();
  return <HistorySession key={vehicle.scope} />;
}

function HistorySession() {
  const vehicle = useVehicleData(), data = useData(), stats = useStats();
  const { showToast } = useToast(), navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(50);
  const [selection, setSelection] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<JournalEntrySelection | null>(null);
  const [addOpen, setAddOpen] = useState(false), [coverageOpen, setCoverageOpen] = useState(false);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [periodNow, setPeriodNow] = useState(() => Date.now());
  const captureUi = useAccountScope(vehicle.scope), deleteBusy = useRef(false);
  const requestedKind = params.get("kind") ?? "all";
  const kind = KINDS.some(([value]) => value === requestedKind) || LEGACY_KINDS.has(requestedKind) ? requestedKind : "all";
  const requestedPeriod = params.get("period") ?? "all";
  const period = Object.hasOwn(RANGE_KEYS, requestedPeriod) ? requestedPeriod : "all";
  const requestedYear = params.get("year");
  const year = requestedYear && /^(19|20|21)\d{2}$/.test(requestedYear) ? requestedYear : null;
  const plan = params.get("plan");
  const rangeFrom = params.get("from"), rangeTo = params.get("to");
  const explicitRange = validDay(rangeFrom) && validDay(rangeTo) && rangeFrom <= rangeTo ? { from: rangeFrom, to: rangeTo } : null;
  const calendarRange = buildRange(RANGE_KEYS[period], periodNow);
  const from = explicitRange?.from ?? (year ? year + "-01-01" : period === "month" ? vehicle.today.slice(0, 7) + "-01"
    : period === "year" ? vehicle.today.slice(0, 4) + "-01-01" : calendarRange.from === null ? "1900-01-01" : localDay(new Date(calendarRange.from)));
  const to = explicitRange?.to ?? (year ? year + "-12-31" : vehicle.today);
  const rangeLabel = explicitRange ? vehicleDay(from) + " – " + vehicleDay(to) : year ? "שנת " + year
    : period === "all" ? "מתחילת הרישומים עד " + vehicleDay(to) : rangeDates(calendarRange);
  const flagged = useMemo(() => new Set(stats.anomalies.map(item => item.fillupId)), [stats.anomalies]);
  const search = query.trim().toLocaleLowerCase("he-IL");
  const rows = useMemo(() => vehicle.ledger.filter(row =>
    row.day >= from && row.day <= to &&
    (kind === "all" || row.kind === kind || kind === "odometer" && row.kind === "tank") &&
    (!plan || row.collection === "serviceEvents" && "completedPlanIds" in row.record && row.record.completedPlanIds.includes(plan)) &&
    (!params.has("flagged") || row.collection === "fillups" && flagged.has(row.id)) &&
    (row.title + " " + row.notes + " " + row.day).toLocaleLowerCase("he-IL").includes(search)),
  [vehicle.ledger, from, to, kind, plan, params, search, flagged]);
  const total = financialTotals(rows);
  const financialCount = rows.filter(row => row.financial).length;
  const fuelCount = rows.filter(row => row.kind === "fuel").length;
  const visibleKeys = new Set(rows.slice(0, limit).map(row => row.key));
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const month = row.day.slice(0, 7);
    const group = groups.get(month);
    if (group) group.push(row); else groups.set(month, [row]);
  }
  const pendingPaths = new Set(data.outbox.filter(operation => operation.status === "pending").map(operation => operation.path));
  const attentionPaths = new Set(data.outbox.filter(operation => operation.status === "failed" || operation.status === "conflict").map(operation => operation.path));
  const pathFor = (row: LedgerRow) => "users/" + vehicle.uid + "/vehicles/" + vehicle.vehicleId + "/" + row.key;
  const segmentValues = new Map(stats.segments.map(segment => [segment.endId, segment.kmPerLiter]));
  const routedKey = params.get("owner") === vehicle.uid && params.get("vehicle") === vehicle.vehicleId ? params.get("entry") : null;
  const selected = vehicle.ledger.find(row => row.key === (selection ?? routedKey)) ?? null;
  const filtered = kind !== "all" || period !== "all" || !!year || !!explicitRange || !!plan || params.has("flagged") || !!search;
  const periodFiltered = period !== "all" || !!year || !!explicitRange;
  const sourceError = !!data.fillupsError || !!data.malformedFillups.length || !!vehicle.care.errors.length || !!vehicle.care.malformed || !!vehicle.extraErrors.length;
  const loading = data.loadingFillups || vehicle.care.loading || data.observationsStatus === "loading";
  const needsAttention = data.outbox.some(operation => operation.vehicleId === vehicle.vehicleId);
  const periodFlagged = vehicle.ledger.filter(row => row.collection === "fillups" && row.day >= from && row.day <= to && flagged.has(row.id)).length;

  function closeEntry() {
    setSelection(null);
    if (params.has("entry")) {
      const next = new URLSearchParams(params);
      next.delete("entry"); next.delete("owner"); next.delete("vehicle");
      setParams(next, { replace: true });
    }
  }
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key); else next.set(key, value);
    if (key === "period") { next.delete("year"); next.delete("from"); next.delete("to"); }
    setPeriodNow(Date.now()); setParams(next); setLimit(50);
  }
  function clearFilters() {
    setQuery(""); setLimit(50); setPeriodNow(Date.now()); setParams({});
  }
  function editEntry(row: LedgerRow) {
    if (row.collection === "fillups") navigate("/fillup/" + encodeURIComponent(row.id));
    else if (row.collection !== "observations") {
      closeEntry();
      vehicle.edit({ collection: row.collection, record: row.record as VehicleRecord });
    }
  }
  function confirmRemoval(entry: JournalEntrySelection) {
    setError(""); setDeleting(entry); closeEntry();
  }
  async function removeSelected() {
    if (!deleting || deleteBusy.current) return;
    const entry = deleting, current = captureUi();
    const submitted: { current: RecordDeletionSubmission | FillupSubmission | null } = { current: null };
    deleteBusy.current = true; setBusy(true); setError("");
    try {
      const row = entry.row;
      if (row.collection === "observations") {
        if (!entry.observation) throw new Error("קריאת המקור אינה זמינה כרגע. פתחו את הרשומה שוב לאחר טעינת הנתונים.");
        await data.deleteObservation(row.id, { snapshot: entry.observation, onSubmitted: value => { submitted.current = value; } });
      } else if (row.collection === "fillups") {
        await data.deleteFillup(row.record as Fillup, { vehicleId: vehicle.vehicleId, onSubmitted: value => { submitted.current = value; } });
      } else {
        await data.deleteCareRecord(vehicle.vehicleId, row.collection, row.record as VehicleRecord,
          { onSubmitted: value => { submitted.current = value; } });
      }
      const submission = submitted.current;
      if (!submission) throw new Error("בקשת המחיקה לא נשמרה.");
      if (current()) setDeleting(null);
      observeDeletion(submission, showToast);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "בקשת המחיקה לא נשמרה.");
    } finally {
      deleteBusy.current = false;
      if (current()) setBusy(false);
    }
  }
  const openCare = (collection: "serviceEvents" | "vehicleExpenses" | "odometerReadings") => {
    setAddOpen(false); vehicle.edit({ collection });
  };
  return <main className="journal-page" data-testid="journal-page">
    <header className="journal-heading">
      <h1>יומן</h1>
      <button type="button" className="journal-add" data-testid="journal-add" aria-label="הוספה ליומן"
        aria-haspopup="dialog" aria-expanded={addOpen} onClick={() => setAddOpen(true)}><PlusIcon size={18} />הוספה</button>
    </header>
    <div className="journal-search">
      <SearchIcon size={20} />
      <input type="search" dir="rtl" aria-label="חיפוש ביומן" data-testid="journal-search" placeholder="חיפוש תחנה, טיפול או הערה"
        value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} />
    </div>
    <div className="journal-filters v3-fade-x" aria-label="סוג רשומה">
      <PeriodPicker variant="chip" value={explicitRange ? "selected-range" : year ? "selected-year" : period}
        onChange={value => change("period", value)} label="תקופת היומן" ariaLabel="תקופת היומן"
        options={[{ value: "all", label: "כל התקופה" }, { value: "month", label: "החודש" }, { value: "year", label: "השנה" },
          { value: "3m", label: "3 חודשים" }, { value: "6m", label: "6 חודשים" }, { value: "1y", label: "12 חודשים" },
          ...(year ? [{ value: "selected-year", label: "שנת " + year }] : []),
          ...(explicitRange ? [{ value: "selected-range", label: "התקופה שנבחרה" }] : [])]} />
      {KINDS.map(([value, label]) => <button type="button" key={value} data-testid={"journal-filter-" + value}
        className={"tm-chip" + (kind === value ? " tm-chip-selected" : "")} aria-pressed={kind === value}
        onClick={() => change("kind", value)}>{label}</button>)}
    </div>
    {periodFiltered || plan || params.has("flagged") || LEGACY_KINDS.has(kind) ? <div className="journal-active-filters" data-testid="journal-active-filters">
      <span>{periodFiltered ? <NumericText>{rangeLabel}</NumericText> : null}
        {plan ? <span> · טיפולים שקושרו לתזכורת</span> : null}
        {params.has("flagged") ? <span> · תדלוקים לבדיקה</span> : null}
        {LEGACY_KINDS.has(kind) ? <span> · {kind === "issue" ? "תקלות" : "סימוני מחוון"}</span> : null}</span>
      <button type="button" onClick={clearFilters}>ניקוי סינון</button>
    </div> : null}
    {periodFlagged > 0 && !params.has("flagged") ? <button type="button" className="journal-review journal-warning"
      onClick={() => { const next = new URLSearchParams(params); next.set("flagged", "1"); next.set("kind", "fuel"); setParams(next); setLimit(50); }}>
      <WarningIcon size={17} />תדלוקים שכדאי לבדוק <NumRun>{int(periodFlagged)}</NumRun>
    </button> : null}
    {vehicle.incomplete || sourceError ? <button type="button" className="journal-coverage" data-testid="journal-coverage"
      onClick={() => setCoverageOpen(true)}><InfoIcon size={17} /><span>{sourceError ? "חלק מהרשומות אינו זמין לקריאה" : "הנתונים עדיין חלקיים"}</span></button> : null}
    {needsAttention ? <Link data-history-unsynced className="journal-unsynced" to="/settings/unsynced">יש שינויים שעוד לא עלו לענן · בדיקה ותיקון ←</Link> : null}
    {rows.length ? <section className="journal-summary" aria-label="סיכום היומן המסונן" data-testid="journal-summary">
      <div className="journal-summary-main">
        <span className="journal-summary-label"><span>{total.unknown || vehicle.incomplete ? "סכום ידוע בתקופה" : "סך הכול בתקופה"}</span>
          <small data-testid="ledger-range"><NumRun>{int(rows.length)}</NumRun> {rows.length === 1 ? "רשומה" : "רשומות"} · <NumRun>{int(fuelCount)}</NumRun> {fuelCount === 1 ? "תדלוק" : "תדלוקים"} · <NumericText>{rangeLabel}</NumericText></small></span>
        <i className="journal-summary-leader" aria-hidden="true" />
        <strong data-testid="ledger-total"><NumRun align="trailing">{financialCount > total.unknown ? vehicleMoney(total.total) : "—"}</NumRun></strong>
      </div>
      {total.unknown > 0 ? <p><NumRun>{int(total.unknown)}</NumRun> {total.unknown === 1 ? "עלות חסרה" : "עלויות חסרות"}</p> : null}
      {total.excludedCount > 0 ? <p data-testid="ledger-excluded">כולל <NumRun>{vehicleMoney(total.excludedAgorot)}</NumRun> שלא בעלות הרכב · <NumRun>{int(total.excludedCount)}</NumRun> {total.excludedCount === 1 ? "הוצאה" : "הוצאות"}</p> : null}
      {rows.length > limit ? <p>מוצגות <NumRun>{int(limit)}</NumRun> מתוך <NumRun>{int(rows.length)}</NumRun> רשומות</p> : null}
      <button type="button" className="journal-summary-info" data-testid="journal-summary-info" aria-haspopup="dialog"
        onClick={() => setCoverageOpen(true)}>על מה הסכום מבוסס?</button>
    </section> : null}
    {!rows.length ? <section className="journal-empty" role={loading ? "status" : undefined}>
      <h2>{loading ? "טוענים את היומן" : filtered ? "לא נמצאו רשומות" : vehicle.incomplete ? "עדיין אין רשומות זמינות" : "אין כאן עדיין רשומות"}</h2>
      <p>{loading ? "הרשומות יופיעו בעוד רגע." : filtered ? "נסו חיפוש או סינון אחר."
        : vehicle.incomplete ? "טעינת היומן עוד לא הושלמה." : "אפשר להוסיף תדלוק, טיפול או הוצאה."}</p>
      {!loading ? <Button variant={filtered || vehicle.incomplete ? "line" : "primary"} size="sm"
        onClick={filtered ? clearFilters : vehicle.incomplete ? () => setCoverageOpen(true) : () => setAddOpen(true)}>
        {filtered ? "ניקוי סינון" : vehicle.incomplete ? "פרטי הנתונים" : "הוספת רשומה"}
      </Button> : null}
    </section> : null}
    {[...groups].map(([month, group]) => {
      const visible = group.filter(row => visibleKeys.has(row.key));
      if (!visible.length) return null;
      const sum = financialTotals(group), financial = group.filter(row => row.financial).length;
      const fills = group.filter(row => row.kind === "fuel").length;
      const label = heMonthName(Number(month.slice(5, 7))) + (month.slice(0, 4) === vehicle.today.slice(0, 4) ? "" : " " + month.slice(0, 4));
      return <section className="journal-month" data-testid={"journal-month-" + month} key={month}>
        <header className="journal-month-heading">
          <h2><NumericText>{label}</NumericText></h2>
          <span className="journal-month-summary">
            {financial > 0 ? <span data-testid={"journal-month-total-" + month}><NumRun align="trailing">{financial > sum.unknown ? vehicleMoney(sum.total) : "—"}</NumRun></span> : null}
            {financial > 0 && fills > 0 ? " · " : null}
            {fills > 0 ? <span><NumRun>{int(fills)}</NumRun> {fills === 1 ? "תדלוק" : "תדלוקים"}</span> : null}
          </span>
        </header>
        {sum.unknown > 0 ? <p className="journal-month-coverage" data-testid={"journal-month-coverage-" + month}>
          {financial > sum.unknown ? "סכום ידוע · " : ""}<NumRun>{int(sum.unknown)}</NumRun> {sum.unknown === 1 ? "עלות חסרה" : "עלויות חסרות"}
        </p> : null}
        <div data-testid={"journal-month-rows-" + month}>
          {visible.map(row => <JournalEntryRow key={row.key} row={row} units={data.settings.units}
            kmPerLiter={row.kind === "fuel" ? segmentValues.get(row.id) : undefined}
            pending={pendingPaths.has(pathFor(row))} attention={attentionPaths.has(pathFor(row))}
            flagged={row.kind === "fuel" ? flagged.has(row.id) : !!serviceMileageWarning(row, vehicle.mileage)}
            onOpen={() => setSelection(row.key)} />)}
        </div>
      </section>;
    })}
    {rows.length > limit ? <Button variant="line" onClick={() => setLimit(value => value + 50)}>הצגת רשומות נוספות</Button> : null}
    <Sheet open={addOpen} title="מה להוסיף?" onClose={() => setAddOpen(false)}>
      <div className="tm-group" data-testid="journal-add-menu">
        <GroupRow icon={<PumpIcon size={24} />} title="תדלוק" subtitle="סכום, ליטרים וקילומטראז׳" testId="journal-add-fuel"
          ariaLabel="הוספת תדלוק" onClick={() => { setAddOpen(false); navigate("/fillup/new"); }} />
        <GroupRow icon={<WrenchIcon size={24} />} title="טיפול" subtitle="מוסך, צמיגים או תיקון" testId="journal-add-service"
          ariaLabel="הוספת טיפול" onClick={() => openCare("serviceEvents")} />
        <GroupRow icon={<CoinIcon size={24} />} title="הוצאה" subtitle="ביטוח, טסט, חניה או החזר" testId="journal-add-expense"
          ariaLabel="הוספת הוצאה" onClick={() => openCare("vehicleExpenses")} />
        <GroupRow icon={<GaugeIcon size={24} />} title="עדכון ק״מ" subtitle="הקריאה בלוח הקילומטרים" testId="journal-add-odometer"
          ariaLabel="עדכון ק״מ" onClick={() => openCare("odometerReadings")} />
      </div>
    </Sheet>
    {selected ? <JournalEntrySheet key={selected.key} row={selected} stats={stats}
      pending={pendingPaths.has(pathFor(selected))} attention={attentionPaths.has(pathFor(selected))}
      onClose={closeEntry} onEdit={editEntry} onDelete={confirmRemoval}
      onSegment={endId => { closeEntry(); setSegmentId(endId); }} /> : null}
    {segmentId ? <SegmentSheet endId={segmentId} stats={stats} units={data.settings.units} onClose={() => setSegmentId(null)} /> : null}
    <ConfirmDialog open={!!deleting} title="מחיקת הרשומה?" confirmLabel={busy ? "מוחקים…" : "מחיקת הרשומה"}
      body={<><p><NumericText>{deleting?.row.title ?? ""}</NumericText></p><p>היומן, העלויות והתזכורות יחושבו מחדש. אחרי אישור המחיקה יהיה זמן קצר לביטול.</p>
        {error ? <p role="alert" className="journal-error" data-testid="journal-delete-error"><NumericText>{error}</NumericText></p> : null}</>}
      onCancel={() => { if (!busy) { setDeleting(null); setError(""); } }} onConfirm={() => void removeSelected()} />
    <Sheet open={coverageOpen} title="על אילו נתונים הסיכום מבוסס?" onClose={() => setCoverageOpen(false)}>
      <div className="journal-coverage-details">
        <p>הסכומים מבוססים על הרשומות שעוברות את הסינון הנוכחי, כולל החזרים. עלות שלא נרשמה נשארת חסרה; אפס שנרשם נשאר אפס.</p>
        {total.unknown > 0 ? <p data-testid="journal-info-unknown">{total.unknown === 1 ? "רשומה אחת" : <><NumRun>{int(total.unknown)}</NumRun> רשומות</>} בלי סכום — {total.unknown === 1 ? "היא לא נכללת" : "הן לא נכללות"} בסכום הידוע. אפשר לפתוח אותן ולהשלים.</p> : null}
        <p>הוצאות שסומנו ״לא בעלות הרכב״ מופיעות ביומן ובסכום שלו, אבל לא ב״כמה הרכב עולה לך״ ולא בממוצעים.</p>
        {vehicle.incomplete ? <p>חלק מהנתונים שמורים רק במכשיר, עדיין נטענים או ממתינים לאישור. הסכום הידוע אינו בהכרח הסכום הסופי.</p> : null}
        {sourceError ? <p role="alert">חלק מהרשומות אינו זמין לקריאה. ההיסטוריה המוצגת אינה מלאה.</p> : null}
        {needsAttention ? <Link className="home-text-action" to="/settings/unsynced">בדיקת השינויים שעוד לא עלו לענן</Link> : null}
      </div>
    </Sheet>
  </main>;
}

/** Provider lifetime, not the mounted Journal screen, governs a global Undo toast. */
function observeDeletion(
  submission: FillupSubmission | RecordDeletionSubmission,
  showToast: (toast: Omit<Toast, "id">) => number,
) {
  if (!submission.isCurrent()) return;
  void submission.receipt.settled.then(accepted => {
    if (!submission.isCurrent()) return;
    if (!accepted) {
      showToast({ tone: "info", title: "המחיקה דורשת בדיקה", detail: "הבקשה שמורה בשינויים שעוד לא עלו לענן" });
      return;
    }
    const recordDeletion = "canRestore" in submission ? submission : null;
    const deadline = recordDeletion ? recordDeletion.undoDeadline : Date.now() + 5000;
    const restore = submission.restoreDeleted;
    const canRestore = !!restore && deadline !== null && deadline > Date.now() && (!recordDeletion || recordDeletion.canRestore());
    let used = false;
    const restoreSelected = async () => {
      if (used || !submission.isCurrent() || Date.now() >= deadline! || recordDeletion && !recordDeletion.canRestore()) return;
      used = true;
      try {
        const receipt = await restore!();
        if (!submission.isCurrent()) return;
        const restored = await receipt.settled;
        if (submission.isCurrent()) showToast({ tone: restored ? "success" : "info", title: restored ? "הרשומה שוחזרה" : "השחזור דורש בדיקה" });
      } catch (reason) {
        if (!submission.isCurrent()) return;
        const retry = !!recordDeletion && recordDeletion.canRestore() && deadline !== null && Date.now() < deadline;
        if (retry) used = false;
        showToast({ tone: "error", title: reason instanceof Error ? reason.message : "השחזור לא נשמר",
          duration: retry ? deadline! - Date.now() : 5000, onUndo: retry ? restoreSelected : undefined });
      }
    };
    showToast({
      tone: "success", title: recordDeletion && deadline === null ? "הרשומה כבר אינה ביומן" : "הרשומה נמחקה",
      duration: canRestore ? deadline! - Date.now() : 5000,
      onUndo: canRestore ? restoreSelected : undefined,
    });
  });
}
