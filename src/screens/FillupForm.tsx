import "../fillup-design.css";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData, type FillupSubmission } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useAccountScope } from "../components/account/useAccountScope";
import { useAppUpdateBlocker } from "../hooks/useAppUpdateBlocker";
import { useStats } from "../hooks/useStats";
import { fillupDraftKey, readFillupDraft, writeFillupDraft, removeFillupDraft } from "../lib/fillupDraft";
import { RECEIPT_SOURCE, type ReceiptImport as ImportIdentity } from "../lib/import/receiptText";
import { evaluateDraft, hardBlock, odometerBounds, softWarnings, type Fillup } from "../lib/stats";
import { capacityNote, resolveCapacity } from "../lib/tank/capacity";
import { relativeDate, time, vehicleShort } from "../lib/format";
import { parseNumberInput } from "../lib/numeric";
import { clearReceiptPriceSuggestion, receiptConflict, receiptNumbers, suggestReceiptPrice, typeReceiptField, type ReceiptState } from "../lib/receipt";
import { fillupFromPayload, serializeFillupPatch, toEpochMillis, validateFillupInput, type FieldError, type FillupWrite } from "../lib/fillupSerializer";
import { OutboxStorageError, type OutboxOperation } from "../lib/outbox";
import { distanceMeters, locateStations, stationKey, toStation, type GeoResult } from "../lib/stations";
import type { FuelType, Station } from "../lib/types";
import { adaptLegacyConfig } from "../lib/prices/regulated";
import { resolveStationPrice } from "../lib/prices/resolver";
import { buildPumpRuleScope, createPumpPriceRule, publicPriceStationId, reusableStationName, suggestFillupPrice, type PumpRuleScope } from "../lib/fillupPricing";
import { effectiveEndChoice, hasTankAnswer, withEndChoice, type TankStateDraft } from "../lib/tank/draft";
import { Button } from "../components/Button";
import { Card, Skeleton } from "../components/Card";
import { ConfirmDialog } from "../components/Sheet";
import { NumericText, NumRun } from "../components/Fmt";
import { CameraIcon, ClockIcon, CloseIcon, PinIcon, TrashIcon } from "../components/icons";
import { FillupEssentials } from "../components/fillup/FillupEssentials";
import { FillupMore } from "../components/fillup/FillupMore";
import { FillupSaved, type PumpWriteState, type SavedFillupResult, type SavedWriteState } from "../components/fillup/FillupSaved";
import { StationSheet } from "../components/fillup/StationSheet";
import { DateSheet } from "../components/fillup/DateSheet";
import { savedFillupResult } from "../components/fillup/savedResult";
import { resolveEditedTank, selectTankDraft, selectTankOriginal } from "../components/fillup/tankEdit";
const ReceiptImport = lazy(() => import("../components/ReceiptImport").then(module => ({ default: module.ReceiptImport })));
const ScanWizard = lazy(() => import("../components/scan/ScanWizard").then(module => ({ default: module.ScanWizard })));
type PumpAnswer = "unanswered" | "same" | "discount" | "different" | "unknown";

/**
 * Add / edit fill-up (designs 10–13).
 *
 * The route component resolves WHAT is being edited before any field state
 * exists: a record still loading, a record that does not exist, a history
 * that failed to load and an unsynced operation being corrected are four
 * different screens, and none of them may silently become "a new record".
 * The editor itself is keyed on the record, so its state is created once
 * from a resolved record and never re-initialised underneath a typing user.
 */
export function FillupForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { fillupId } = useParams();
  const [search] = useSearchParams();
  const opId = search.get("op");
  const { activeVehicle, fillups, loadingFillups, fillupsError, malformedFillups, outbox, outboxReady } = useData();
  // Bumped when the user chooses to reload a record another device changed.
  const [reloads, setReloads] = useState(0);

  if (opId && !outboxReady) return <EditState kind="loading" />;

  if (!fillupId) {
    // A new record — possibly a corrected copy of an unsynced operation.
    const operation = opId ? outbox.find((entry) => entry.opId === opId) ?? null : null;
    if (opId && !operation) {
      return (
        <EditState
          kind="not-found"
          title="הפעולה כבר לא קיימת"
          body="ייתכן שהיא סונכרנה או נמחקה במכשיר אחר."
          onBack={() => navigate("/settings/unsynced", { replace: true })}
        />
      );
    }
    const initial =
      operation?.payload ? fillupFromPayload(operation.docId, { ...(operation.opType === "update" ? operation.beforeImage ?? {} : {}), ...operation.payload }) : null;
    return (
      <FillupEditor
        key={`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}:${opId ?? "new"}`}
        mode={operation?.opType === "update" ? "edit" : "new"}
        baseRecord={operation?.opType === "update" && operation.beforeImage ? fillupFromPayload(operation.docId, operation.beforeImage) : null}
        initial={initial}
        operation={operation}
      />
    );
  }

  // A failed UPDATE being corrected: the editor opens the REJECTED input,
  // not whatever the server holds under that id, and re-sends under the
  // same operation. The base version is the one the rejected edit was made
  // against, so the server's version check still applies to the re-send.
  const failedUpdate = opId
    ? outbox.find((entry) => entry.opId === opId && entry.docId === fillupId && (entry.kind === "fillup.update" || entry.kind === "fillup.add" && entry.opType === "update")) ?? null
    : null;
  if (opId && failedUpdate?.payload) {
    const base = failedUpdate.beforeImage ? fillupFromPayload(fillupId, failedUpdate.beforeImage) : null;
    const rejected = fillupFromPayload(fillupId, { ...(failedUpdate.beforeImage ?? {}), ...failedUpdate.payload });
    return (
      <FillupEditor
        key={`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}:${fillupId}:${opId}`}
        mode="edit"
        initial={rejected ?? base}
        baseRecord={base}
        operation={failedUpdate}
      />
    );
  }
  if (opId && !failedUpdate) {
    const anyOp = outbox.find((entry) => entry.opId === opId) ?? null;
    if (!anyOp) {
      return (
        <EditState
          kind="not-found"
          title="הפעולה כבר לא קיימת"
          body="ייתכן שהיא סונכרנה או נמחקה במכשיר אחר."
          onBack={() => navigate("/settings/unsynced", { replace: true })}
        />
      );
    }
  }

  const editing = fillups.find((entry) => entry.id === fillupId) ?? null;
  if (editing) {
    return (
      <FillupEditor
        key={`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}:${fillupId}:${reloads}`}
        mode="edit"
        initial={editing}
        onReload={() => setReloads((value) => value + 1)}
      />
    );
  }

  const malformed = malformedFillups.find((entry) => entry.id === fillupId) ?? null;
  if (malformed) {
    return (
      <FillupEditor
        key={`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}:${fillupId}:malformed`}
        mode="edit"
        initial={malformedAsFillup(malformed.id, malformed.raw)}
        malformedReason={malformed.reason}
      />
    );
  }

  // A create that the server rejected: the record is not in the history, but
  // the user's input is in the outbox and can be corrected from here.
  const rejected =
    outbox.find((entry) => entry.docId === fillupId && entry.vehicleId === activeVehicle?.id && entry.kind === "fillup.add" && entry.opType === "set") ?? null;
  if (rejected?.payload) {
    return (
      <FillupEditor
        key={`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}:${fillupId}:op`}
        mode="new"
        initial={fillupFromPayload(rejected.docId, rejected.payload)}
        operation={rejected}
      />
    );
  }

  if (loadingFillups) return <EditState kind="loading" />;
  if (fillupsError) {
    return (
      <EditState
        kind="failed"
        title="ההיסטוריה לא נטענה"
        body={fillupsError}
        onBack={() => navigate(-1)}
      />
    );
  }
  return (
    <EditState
      kind="not-found"
      title="הרשומה לא נמצאה"
      body="ייתכן שנמחקה, או שהיא שייכת לרכב אחר."
      onBack={() => navigate("/history", { replace: true })}
    />
  );
}

/** The four non-editing states of the route, each stated for what it is. */
function EditState({
  kind,
  title,
  body,
  onBack,
  action,
}: {
  kind: "loading" | "not-found" | "failed";
  title?: string;
  body?: string;
  onBack?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col gap-3 px-5 pt-safe" data-edit-state={kind}>
      <header className="flex items-center justify-between py-3">
        <h1 className="font-display text-[40px] font-normal text-ink">עריכת תדלוק</h1>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="סגירה"
            className="tm-icon-button"
          >
            <CloseIcon size={17} />
          </button>
        ) : null}
      </header>
      {kind === "loading" ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[120px] rounded-card" />
          <Skeleton className="h-[180px] rounded-card" />
          <Skeleton className="h-[120px] rounded-card" />
        </div>
      ) : (
        <Card className="flex flex-col gap-2 p-5">
          <span className="text-[16px] font-bold text-ink"><NumericText>{title ?? ""}</NumericText></span>
          <span className="text-[14px] leading-relaxed text-muted"><NumericText>{body ?? ""}</NumericText></span>
          {action ? (
            <Button onClick={action.onClick}><NumericText>{action.label}</NumericText></Button>
          ) : null}
        </Card>
      )}
    </main>
  );
}

/** A stored record this client could not read, rebuilt as far as it goes. */
function malformedAsFillup(id: string, raw: Record<string, unknown>): Fillup {
  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    id,
    // The date is exactly the field that could not be read; the editor asks
    // for it explicitly and refuses to save until it is set.
    date: Number.NaN,
    odometer: number(raw.odometer, 0),
    liters: number(raw.liters, 0),
    pricePerLiter: number(raw.pricePerLiter, 0),
    totalCost: number(raw.totalCost, 0),
    isFullTank: raw.isFullTank !== false,
    station: (raw.station as Station | null | undefined) ?? null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    continuityBreakBefore: raw.continuityBreakBefore === true,
    fullTankSource: raw.fullTankSource === "legacy-assumption" ? "legacy-assumption" : "user",
    postedPricePerLiter: typeof raw.postedPricePerLiter === "number" ? raw.postedPricePerLiter : null,
    fuelType: (raw.fuelType as Fillup["fuelType"]) ?? null,
  };
}

interface SavedSession {
  submission: FillupSubmission;
  result: SavedFillupResult;
  vehicleId: string;
  fuelType: FuelType;
  deadline: number;
  lock: { action: "idle" | "undo" | "pump"; transferred: boolean };
}

function FillupEditor({
  mode,
  initial,
  baseRecord = null,
  operation = null,
  malformedReason = null,
  onReload,
}: {
  mode: "new" | "edit";
  /** The resolved record for an edit, or a prefilled draft for a new one. */
  initial: Fillup | null;
  /**
   * For a failed update being corrected: the record as it was when the
   * rejected edit was made (the version base). Otherwise the edit's own
   * `initial` is the base.
   */
  baseRecord?: Fillup | null;
  /** The unsynced operation this editor corrects, when it does. */
  operation?: OutboxOperation | null;
  malformedReason?: string | null;
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const { showToast, dismissToast } = useToast();
  const {
    activeVehicle,
    fillups,
    prices,
    settings,
    addFillup,
    updateFillup,
    deleteFillup,
    discardOperation,
    setActiveVehicle,
    vehicles,
    loadingFillups, fillupsError, malformedFillups,
    rawPriceRules, eligiblePriceRules, priceRulesStatus, savePriceRule, fillupPriceKnown,
  } = useData();

  const { user } = useAuth();
  const captureUi = useAccountScope(`${user?.uid ?? "none"}:${activeVehicle?.id ?? "none"}`);
  const draftKey = fillupDraftKey(user?.uid ?? "none", activeVehicle?.id ?? "none", operation?.opId ?? initial?.id ?? "new");
  const [restoredDraft] = useState(() => readFillupDraft(draftKey));
  const draftCleared = useRef(false);
  const [scanOpen, setScanOpen] = useState(() => mode === "new" && !operation && !initial && settings.quickEntry === true);
  const [scanCompleted,setScanCompleted] = useState(false);
  const [importOpen,setImportOpen] = useState(false);
  const [receiptImport,setReceiptImport] = useState<ImportIdentity|null>(restoredDraft?.receiptImport ?? null);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);

  // An operation belongs to the vehicle it was journaled for. Editing it
  // under another active vehicle would write to the wrong subtree.
  const wrongVehicle =
    operation !== null && operation.vehicleId !== null && activeVehicle?.id !== operation.vehicleId
      ? operation.vehicleId
      : null;

  // Whole-history statistics for this vehicle, used only for the best-value
  // station ranking — which needs a real measured consumption or nothing.
  const vehicleStats = useStats();

  const isEdit = mode === "edit";
  // The displayed snapshot is separate from an update's CAS base. Keeping it
  // in the local draft preserves both measurements and metadata on reload.
  const [tankOriginal] = useState(() => selectTankOriginal({ initial, restored: restoredDraft, correctingOperation: operation !== null }));
  /**
   * The record as it was when this editor OPENED, captured once.
   *
   * `initial` is a prop that follows the live listener: if another device
   * writes while the form is open, the prop moves to the newer version. The
   * edit must stay based on what the user actually saw — otherwise its
   * version base would silently follow the other write and the server would
   * accept an overwrite nobody reviewed. The live record is compared against
   * this snapshot only to WARN (see `changedElsewhere`).
   */
  const [openedRecord] = useState(operation ? tankOriginal ?? initial : restoredDraft?.base ?? initial);
  const [openedOperationVersion] = useState(operation?.version);
  const [openedOperationPriceKnown] = useState(() => Object.hasOwn(operation?.payload ?? {}, "pricePerLiter") && typeof operation?.payload?.pricePerLiter === "number" && Number.isFinite(operation.payload.pricePerLiter) && operation.payload.pricePerLiter >= 0);
  const editing = isEdit ? openedRecord : null;
  /** The record an edit is based on: the opened snapshot, or the rejected edit's base. */
  const [editBase] = useState<Fillup | null>(() => restoredDraft?.base ?? baseRecord ?? editing);
  const [operationDateInvalid] = useState(() => operation !== null && toEpochMillis(Object.hasOwn(operation.payload ?? {}, "date")
    ? operation.payload?.date : operation.beforeImage?.date) === null);
  const dateWasInvalid = openedRecord !== null && !Number.isFinite(openedRecord.date) || operationDateInvalid;

  const [date, setDate] = useState<number>(() =>
    restoredDraft?.date ?? (initial && Number.isFinite(initial.date) ? initial.date : Date.now()),
  );
  // A record whose date could not be read is saved only once the user has
  // deliberately set one.
  const [dateConfirmed, setDateConfirmed] = useState(restoredDraft?.dateConfirmed ?? !dateWasInvalid);
  const [odometer, setOdometer] = useState(() =>
    restoredDraft?.odometer ?? (initial && initial.odometer > 0 ? String(initial.odometer) : ""),
  );

  /**
   * The receipt: litres, price, total, and WHO set each.
   *
   * On an existing record the litres and the price are the measured facts and
   * count as authored. The total counts as authored only when it DISAGREES
   * with litres × price — a receipt with a discount on it — so editing the
   * litres of an ordinary record recomputes its total instead of turning the
   * stored total into a conflict. On a new record the price arrives as a
   * suggestion and only ever fills the one field nobody has typed.
   */
  const originalPriceKnown = openedRecord !== null && (openedRecord.pricePerLiter > 0 || (operation
    ? openedOperationPriceKnown : fillupPriceKnown.get(openedRecord.id) === true));
  const priceInteracted = useRef(!!restoredDraft);
  const [receipt, setReceipt] = useState<ReceiptState>(() => {
    if (restoredDraft) return restoredDraft.receipt;
    if (!initial) return { liters: "", pricePerLiter: "", totalCost: "", authored: [] };
    const expected = initial.liters * initial.pricePerLiter;
    const knownTotal = !initial.totalCostUnknown && Number.isFinite(initial.totalCost) && initial.totalCost >= 0;
    const totalIsOwn = knownTotal && (initial.totalCost === 0 || Math.abs(initial.totalCost - expected) > Math.max(1, expected * 0.01));
    return {
      liters: initial.liters > 0 ? String(initial.liters) : "",
      pricePerLiter: originalPriceKnown ? String(initial.pricePerLiter) : "",
      totalCost: knownTotal ? String(initial.totalCost) : "",
      authored: [
        ...(initial.liters > 0 ? (["liters"] as const) : []),
        ...(originalPriceKnown ? (["pricePerLiter"] as const) : []),
        ...(totalIsOwn ? (["totalCost"] as const) : []),
      ],
    };
  });

  const [tankDraft, setTankDraft] = useState<TankStateDraft>(() =>
    selectTankDraft(tankOriginal, restoredDraft?.tankDraft),
  );

  const [continuityBreak, setContinuityBreak] = useState(
    restoredDraft?.continuityBreak ?? initial?.continuityBreakBefore === true,
  );

  /**
   * Whether the price paid was also the price on the pump.
   *
   * On an edit the answer is reconstructed from what is STORED: a posted
   * price equal to the paid one was "same"; a different one was "different",
   * with that price — never "same" by default, which used to overwrite a
   * distinct pump price with the paid one on any re-save.
   */
  const [pumpAnswer] = useState<PumpAnswer>(() => {
    if (restoredDraft) return restoredDraft.pumpAnswer;
    if (initial?.postedPricePerLiter == null) return "unanswered";
    return Math.abs(initial.postedPricePerLiter - initial.pricePerLiter) < 1e-9 ? "same" : "different";
  });
  const [pumpPrice] = useState(() =>
    restoredDraft?.pumpPrice ?? (initial?.postedPricePerLiter != null ? String(initial.postedPricePerLiter) : ""),
  );
  const [pumpTouched] = useState(restoredDraft?.pumpTouched ?? false);
  const [clearStoredPosted, setClearStoredPosted] = useState(() => (restoredDraft as { clearStoredPosted?: unknown } | null)?.clearStoredPosted === true);
  const [station, setStation] = useState<Station | null>(restoredDraft?.station ?? initial?.station ?? null);
  const [stationAuto, setStationAuto] = useState(restoredDraft?.stationAuto ?? false);
  const [notes, setNotes] = useState(restoredDraft?.notes ?? initial?.notes ?? "");

  const [stationSheetOpen, setStationSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  // The latest allowed date, sampled when the sheet is opened (an event), so
  // the render itself never reads the clock.
  const [dateSheetNow, setDateSheetNow] = useState(() => Date.now());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shaking, setShaking] = useState(false);
  const totalInput = useRef<HTMLInputElement>(null);
  const saveLock = useRef(false);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const committedSaved = useRef<SavedSession | null>(null);
  useLayoutEffect(() => { committedSaved.current = saved; }, [saved]);
  const [clock, setClock] = useState(0);
  const [writeState, setWriteState] = useState<SavedWriteState>("pending");
  const [undoBusy, setUndoBusy] = useState(false);
  const [pumpDifferent, setPumpDifferent] = useState(false);
  const [confirmedPumpPrice, setConfirmedPumpPrice] = useState("");
  const [pumpWriteState, setPumpWriteState] = useState<PumpWriteState>("idle");
  const [pumpError, setPumpError] = useState<string | null>(null);
  const [pumpScopeKind, setPumpScopeKind] = useState<PumpRuleScope["kind"] | null>(null);
  const historyComplete = !loadingFillups && !fillupsError && malformedFillups.length === 0;

  const draft = useMemo(() => ({ base: editBase, tankOriginal, receiptImport, date, dateConfirmed, odometer, receipt, tankDraft,
    continuityBreak, pumpAnswer, pumpPrice, pumpTouched, clearStoredPosted, station, stationAuto, notes }),
    [editBase, tankOriginal, receiptImport, date, dateConfirmed, odometer, receipt, tankDraft, continuityBreak, pumpAnswer, pumpPrice, pumpTouched, clearStoredPosted, station, stationAuto, notes]);
  const initialDraft = useRef(draft);
  const humanInput = odometer.trim() || receipt.liters.trim() || receipt.authored.length > 0 ||
    notes.trim() || hasTankAnswer(tankDraft) || pumpTouched || clearStoredPosted || date !== initialDraft.current.date ||
    continuityBreak !== initialDraft.current.continuityBreak ||
    (!stationAuto && JSON.stringify(station) !== JSON.stringify(initialDraft.current.station));
  const draftDirty = !!restoredDraft || (!!humanInput && JSON.stringify(draft) !== JSON.stringify(initialDraft.current));
  useAppUpdateBlocker((draftStorageFailed && draftDirty && !saved) || saving || pumpWriteState === "journaling");
  useEffect(() => {
    if (draftCleared.current) return;
    if (!draftDirty) { removeFillupDraft(draftKey); return; }
    setDraftStorageFailed(!writeFillupDraft(draftKey, draft));
  }, [draft, draftDirty, draftKey]);
  useEffect(() => {
    if (!draftStorageFailed || !draftDirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [draftStorageFailed, draftDirty]);
  function canLeaveDraft() {
    return !draftStorageFailed || !draftDirty || window.confirm("לא ניתן לשמור טיוטה במכשיר. לצאת ולאבד את הפרטים?");
  }

  // A recovered create can already be visible under the same document id.
  // Every form evaluates one candidate, never its listener copy a second time.
  const candidateId = openedRecord?.id ?? operation?.docId ?? null;
  const others = useMemo(
    () => (candidateId ? fillups.filter((f) => f.id !== candidateId) : fillups),
    [fillups, candidateId],
  );

  /* ---------- concurrent edits ---------- */

  /**
   * The record as it was when this editor opened. If a later snapshot brings
   * a DIFFERENT version (another tab, another device), the user is told and
   * offered a reload; their typing is never overwritten underneath them.
   */
  const comparisonBase = operation ? editBase : editing;
  const baseline = useMemo(
    () => (comparisonBase ? JSON.stringify(serializeFillupPatch(comparisonBase)) : null),
    // Both comparison bases are immutable opening snapshots in this keyed editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const live = comparisonBase ? fillups.find((entry) => entry.id === comparisonBase.id) ?? null : null;
  const changedElsewhere =
    baseline !== null && live !== null && JSON.stringify(serializeFillupPatch(live)) !== baseline;
  const deletedElsewhere = baseline !== null && live === null && !dateWasInvalid;

  /* ---------- price chain ---------- */

  const [priceScope, setPriceScope] = useState<PumpRuleScope | null>(null);
  useEffect(() => {
    let current = true;
    setPriceScope(null);
    if (activeVehicle && priceRulesStatus === "ready") {
      void buildPumpRuleScope({ vehicleId: activeVehicle.id, fuelType: activeVehicle.fuelType,
        station, occupiedRules: rawPriceRules }).then(result => {
          if (current) setPriceScope(result.ok ? result.scope : null);
        });
    }
    return () => { current = false; };
  }, [activeVehicle, station, rawPriceRules, priceRulesStatus]);
  const publicPrice = useMemo(() => resolveStationPrice({
    stationId: publicPriceStationId(station), fuelType: activeVehicle?.fuelType ?? "95",
    regulated: adaptLegacyConfig(prices), now: date,
  }), [station, activeVehicle?.fuelType, prices, date]);
  const resolved = useMemo(() => activeVehicle ? suggestFillupPrice({
    publicResolved: publicPrice, date, now: Date.now(), vehicle: activeVehicle, station,
    config: prices, scope: priceScope, eligibleRules: eligiblePriceRules,
    lastPaid: others.filter(fill => fill.pricePerLiter > 0 || fill.pricePerLiter === 0 && fillupPriceKnown.get(fill.id) === true)
      .map(fill => ({ ...fill, vehicleId: activeVehicle.id })),
  }) : { price: null, label: "בחרו רכב כדי להמשיך" },
  [publicPrice, date, activeVehicle, station, prices, priceScope, eligiblePriceRules, others, fillupPriceKnown]);

  useEffect(() => {
    if (!openedRecord || openedRecord.pricePerLiter !== 0 || !originalPriceKnown || priceInteracted.current) return;
    const current = fillups.find(fill => fill.id === openedRecord.id);
    if (!operation && current && current.pricePerLiter !== 0) return;
    setReceipt(current => current.pricePerLiter.trim() === "" && !current.authored.includes("pricePerLiter")
      ? { ...current, pricePerLiter: "0", authored: [...current.authored, "pricePerLiter"] } : current);
  }, [openedRecord, originalPriceKnown, fillups, operation]);

  // A suggestion fills the price only while nobody has typed it, and never
  // moves a typed litres or total (see receipt.ts). Runs again when the date
  // moves to a different effective price or a late price arrives.
  useEffect(() => {
    setReceipt(current => {
      // A normalized legacy zero is not evidence of a price. Await raw proof or explicit typing.
      if (openedRecord?.pricePerLiter === 0) return current;
      if (resolved.price === 0 && !current.authored.includes("pricePerLiter") &&
          !(current.authored.includes("liters") && current.authored.includes("totalCost"))) {
        return { ...current, pricePerLiter: "0",
          ...(!current.authored.includes("liters") ? { liters: "" } : {}),
          ...(!current.authored.includes("totalCost") ? { totalCost: "" } : {}) };
      }
      if (resolved.price !== null) return suggestReceiptPrice(current, resolved.price);
      return clearReceiptPriceSuggestion(current);
    });
  }, [resolved.price, openedRecord?.pricePerLiter]);

  const { liters: litersValue, pricePerLiter: priceValue, totalCost: totalValue } =
    receiptNumbers(receipt);
  const conflict = receiptConflict(receipt);

  /* ---------- geolocation → station suggestion ---------- */

  const pastStations = useMemo(() => {
    const map = new Map<string, Station>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      const name = fillup.station?.name?.trim();
      if (!name || !fillup.station) continue;
      const key = stationKey(fillup.station);
      if (!map.has(key)) map.set(key, fillup.station);
    }
    return [...map.values()];
  }, [fillups]);

  const lastPaidByStation = useMemo(() => {
    const map = new Map<string, { price: number; observedAt: number }>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      if (fillup.date > date || fillup.fuelType !== activeVehicle?.fuelType || !Number.isFinite(fillup.pricePerLiter) ||
          fillup.pricePerLiter < 0 || fillup.pricePerLiter === 0 && fillupPriceKnown.get(fillup.id) !== true) continue;
      const entry = { price: fillup.pricePerLiter, observedAt: fillup.date };
      const id = publicPriceStationId(fillup.station);
      const name = reusableStationName(fillup.station?.name);
      const key = id ? `id:${id}` : !fillup.station?.stationId && name ? `name:${name}` : null;
      if (key && !map.has(key)) map.set(key, entry);
    }
    return map;
  }, [fillups, date, activeVehicle?.fuelType, fillupPriceKnown]);

  const [geo, setGeo] = useState<GeoResult>({ status: "idle", position: null, nearby: [] });
  const geoRequested = useRef(false);
  const geoRequest = useRef(0);
  const stationSelection = useRef(0);

  const detectStation = useCallback(
    async (manual = false) => {
      if (!manual && geoRequested.current) return;
      geoRequested.current = true;
      const stillMounted = captureUi();
      const request = geoRequest.current + 1;
      geoRequest.current = request;
      const selection = stationSelection.current;
      setGeo((current) => ({ ...current, status: "locating" }));

      const result = await locateStations();
      if (!stillMounted() || request !== geoRequest.current) return;
      setGeo(result);
      if (selection !== stationSelection.current) return;
      if (result.status !== "ok" || result.position === null) return;

      const here = result.position;
      let bestPast: Station | null = null;
      let bestPastDistance = Number.POSITIVE_INFINITY;
      for (const candidate of pastStations) {
        if (candidate.lat === undefined || candidate.lng === undefined) continue;
        const distance = distanceMeters({ lat: candidate.lat, lng: candidate.lng }, here);
        if (distance < bestPastDistance) {
          bestPastDistance = distance;
          bestPast = candidate;
        }
      }

      const chosen =
        bestPast && bestPastDistance <= 300 ? bestPast : toStation(result.nearby[0]);
      if (!chosen) return;
      setStation(chosen);
      setStationAuto(true);
    },
    [pastStations, captureUi],
  );

  // Explicit proximity sorting refreshes location without choosing a station.
  // Invalidate an earlier automatic suggestion before requesting a fresh fix.
  const locateForOrdering = useCallback(async (): Promise<GeoResult | null> => {
    geoRequested.current = true;
    const stillMounted = captureUi();
    const request = geoRequest.current + 1;
    geoRequest.current = request;
    const selection = stationSelection.current;
    setGeo(current => ({ ...current, status: "locating" }));

    const result = await locateStations(400, { maximumAge: 0 });
    if (!stillMounted() || request !== geoRequest.current) return null;
    setGeo(current => result.position ? result : { ...current, status: result.status });
    if (selection !== stationSelection.current) return null;
    return result;
  }, [captureUi]);

  useEffect(() => {
    if (isEdit || station || operation) return;
    void detectStation();
  }, [isEdit, station, operation, detectStation]);

  /* ---------- validation ---------- */

  const odometerParsed = parseNumberInput(odometer, "odometer");
  const odometerValue = odometerParsed.value;
  const litersParsed = parseNumberInput(receipt.liters, "liters");
  const priceParsed = parseNumberInput(receipt.pricePerLiter, "price");

  const bounds = useMemo(() => odometerBounds(others, date), [others, date]);

  const blockMessage = useMemo(() => {
    if (!odometer) return null;
    return hardBlock({ date, odometer: odometerValue }, others);
  }, [odometer, odometerValue, date, others]);

  /**
   * Capacity, from the same ladder the rest of the app uses, with its
   * provenance. `capacityLitersAtEntry` records which revision every
   * derivation on this record was made against.
   */
  const capacity = useMemo(() => resolveCapacity(activeVehicle, fillups), [activeVehicle, fillups]);

  // New physical answers use the protected resolver. Untouched measurements
  // retain their provenance; a quantity edit updates only dependent evidence.
  const tankState = useMemo(
    () =>
      resolveEditedTank({
        original: tankOriginal,
        draft: tankDraft,
        litersAdded: Number.isFinite(litersValue) && litersValue > 0 ? litersValue : null,
        capacity,
      }),
    [tankOriginal, tankDraft, litersValue, capacity],
  );
  const tankOutcome = tankState.outcome;
  const endChoice = effectiveEndChoice(tankDraft);
  const isFullTank = tankState.isFullTank;
  const effectiveFillEndState = tankState.endState;

  const warnings = useMemo(() => {
    if (!odometer || !receipt.liters) return [];
    return softWarnings(
      {
        date,
        odometer: odometerValue,
        liters: litersValue,
        pricePerLiter: priceValue,
        isFullTank,
        fillEndState: effectiveFillEndState,
        continuityBreakBefore: continuityBreak,
      },
      others,
      activeVehicle,
      undefined,
      capacity,
    );
  }, [
    odometer,
    receipt.liters,
    date,
    odometerValue,
    litersValue,
    priceValue,
    isFullTank,
    effectiveFillEndState,
    continuityBreak,
    others,
    activeVehicle,
    capacity,
  ]);

  const draftEvaluation = useMemo(() => {
    if (!Number.isFinite(odometerValue) || !Number.isFinite(litersValue)) return null;
    return evaluateDraft(
      {
        date,
        odometer: odometerValue,
        liters: litersValue,
        pricePerLiter: priceValue,
        totalCost: Number.isFinite(totalValue) ? totalValue : undefined,
        isFullTank,
        fillEndState: effectiveFillEndState,
        continuityBreakBefore: continuityBreak,
      },
      others,
      editing?.id,
    );
  }, [
    date,
    odometerValue,
    litersValue,
    priceValue,
    totalValue,
    isFullTank,
    effectiveFillEndState,
    continuityBreak,
    others,
    editing,
  ]);

  /**
   * The document exactly as it will be written, built from the same
   * serializer every write goes through, and validated against the same
   * bounds the server enforces — so a doomed write never leaves the device.
   */
  const nextRecord = useMemo<FillupWrite | null>(() => {
    if (!activeVehicle) return null;
    if (!Number.isFinite(odometerValue) || !Number.isFinite(litersValue)) return null;
    if (!Number.isFinite(priceValue)) return null;

    return {
      date,
      odometer: odometerValue,
      liters: litersValue,
      pricePerLiter: priceValue,
      totalCost: totalValue,
      isFullTank,
      // The boolean is a projection of the user's stated end state; the real
      // provenance lives in the tank fields. An edit keeps what was stored.
      fullTankSource: openedRecord?.fullTankSource ?? "user",
      continuityBreakBefore: continuityBreak,
      ...tankState.fields,
      // Only ever set from an explicit answer; an untouched question on an
      // edit keeps the stored pump price exactly, including a distinct one.
      postedPricePerLiter: clearStoredPosted ? null : openedRecord?.postedPricePerLiter ?? null,
      fuelType: openedRecord?.fuelType ?? activeVehicle.fuelType,
      station: station ?? null,
      notes: notes.trim() || null,
      // Import provenance and creation metadata travel unchanged.
      importSource: openedRecord?.importSource ?? (receiptImport ? RECEIPT_SOURCE : undefined),
      importBatchId: openedRecord?.importBatchId ?? receiptImport?.textHash,
      importRowHash: openedRecord?.importRowHash ?? receiptImport?.hash,
      schemaVersion: openedRecord?.schemaVersion,
      createdAt: openedRecord?.createdAt ?? null,
    };
  }, [
    activeVehicle,
    receiptImport,
    odometerValue,
    litersValue,
    priceValue,
    totalValue,
    date,
    isFullTank,
    openedRecord,
    continuityBreak,
    tankState.fields,
    clearStoredPosted,
    station,
    notes,
  ]);

  const fieldErrors = useMemo<FieldError[]>(
    () => (nextRecord ? validateFillupInput({ ...nextRecord, notes }) : []),
    [nextRecord, notes],
  );
  const errorFor = (field: FieldError["field"]) =>
    fieldErrors.find((entry) => entry.field === field)?.message ?? null;

  const canSave =
    nextRecord !== null &&
    odometerValue > 0 &&
    litersValue > 0 &&
    priceValue >= 0 &&
    Number.isFinite(totalValue) && totalValue >= 0 &&
    !blockMessage &&
    fieldErrors.length === 0 &&
    dateConfirmed &&
    !saving;

  const visibleErrors: Partial<Record<FieldError["field"], string>> = {};
  if (submitAttempted) {
    for (const entry of fieldErrors) visibleErrors[entry.field] ??= entry.message;
    if (!Number.isFinite(totalValue) || totalValue < 0) visibleErrors.totalCost ??= "חסר סכום תקין";
    if (!Number.isFinite(litersValue) || litersValue <= 0) visibleErrors.liters ??= "חסרים ליטרים";
    if (!Number.isFinite(priceValue) || priceValue < 0) visibleErrors.pricePerLiter ??= "חסר מחיר לליטר";
    if (!Number.isFinite(odometerValue) || odometerValue <= 0) visibleErrors.odometer ??= "חסר קילומטראז׳";
  }

  useEffect(() => {
    if (!shaking) return;
    const timer = setTimeout(() => setShaking(false), 420);
    return () => clearTimeout(timer);
  }, [shaking]);
  useEffect(() => {
    if (!saved) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    const stillMounted = captureUi();
    void saved.submission.receipt.settled.then(accepted => {
      if (stillMounted() && saved.submission.isCurrent()) setWriteState(accepted ? "accepted" : "attention");
    });
    return () => clearInterval(timer);
  }, [saved, captureUi]);

  function clearDraft() {
    draftCleared.current = true;
    removeFillupDraft(draftKey);
  }
  function openDate() {
    setDateSheetNow(Date.now());
    setDateSheetOpen(true);
  }
  function chooseStation(next: Station | null) {
    stationSelection.current = stationSelection.current + 1;
    setStation(next);
    setStationAuto(false);
    setStationSheetOpen(false);
  }
  function attemptInvalidSave() {
    setSubmitAttempted(true);
    setShaking(true);
    if (errorFor("notes")) setMoreOpen(true);
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-testid="fillup-form"] [aria-invalid="true"]',
      );
      if (!dateConfirmed) document.querySelector<HTMLButtonElement>('[data-testid="fillup-date"]')?.focus();
      else (first ?? totalInput.current)?.focus();
    });
  }

  const undoSaved = useCallback(async (session: SavedSession, leaveSaved: boolean) => {
    if (Date.now() >= session.deadline || session.lock.action !== "idle" || !session.submission.isCurrent() || !session.submission.undoCreation) return;
    session.lock.action = "undo";
    const stillMounted = captureUi();
    if (stillMounted()) setUndoBusy(true);
    try {
      const receipt = await session.submission.undoCreation();
      if (!session.submission.isCurrent()) return;
      void receipt.settled.then(accepted => {
        if (!session.submission.isCurrent()) return;
        showToast({ tone: accepted ? "success" : "info", title: accepted ? "התדלוק בוטל" : "בקשת הביטול דורשת בדיקה",
          detail: accepted ? undefined : "הנתונים שמורים בשינויים שעוד לא עלו לענן" });
      });
      if (leaveSaved && stillMounted()) navigate("/", { replace: true });
    } catch (error) {
      if (!session.submission.isCurrent()) return;
      session.lock.action = "idle";
      if (stillMounted()) setUndoBusy(false);
      showToast({ tone: "error", title: error instanceof Error ? error.message : "הביטול לא נשמר", detail: "התדלוק נשאר כמו שנשמר" });
    }
  }, [captureUi, navigate, showToast]);

  const transferRemainingUndo = useCallback((session: SavedSession) => {
    if (!session.submission.isCurrent()) return;
    const remaining = session.deadline - Date.now();
    if (remaining > 0 && session.lock.action === "idle" && !session.lock.transferred) {
      session.lock.transferred = true;
      showToast({ tone: "info", title: "תדלוק חדש", duration: remaining,
        undoLabel: "ביטול", onUndo: () => undoSaved(session, false) });
    }
  }, [showToast, undoSaved]);
  useEffect(() => () => {
    // Browser Back has the same remaining Undo as Done. The provider guard
    // rejects account/vehicle changes; StrictMode's initial cleanup has no save.
    const session = committedSaved.current;
    if (session) transferRemainingUndo(session);
  }, [transferRemainingUndo]);

  function finishSaved() {
    if (!saved || !saved.submission.isCurrent()) return;
    transferRemainingUndo(saved);
    navigate("/", { replace: true });
  }

  async function save() {
    if (saveLock.current) return;
    if (!canSave || !activeVehicle || !nextRecord) { attemptInvalidSave(); return; }
    saveLock.current = true;
    setSubmitAttempted(true);
    setSaving(true);
    const stillMounted = captureUi();
    const vehicle = { ...activeVehicle };
    const history = others.map(fill => ({ ...fill, station: fill.station ? { ...fill.station } : null }));
    const submitted: { current: FillupSubmission | null; at: number } = { current: null, at: 0 };
    const onSubmitted = (entry: FillupSubmission) => { submitted.current = entry; submitted.at = Date.now(); };
    try {
      if (editing && (!operation || operation.opType === "update" || operation.kind === "fillup.update")) {
        const previous: Fillup = { ...(editBase ?? editing), station: (editBase ?? editing).station ? { ...(editBase ?? editing).station! } : null };
        await updateFillup(editing.id, nextRecord, previous, {
          replaceOpId: operation?.opId ?? null, replaceVersion: openedOperationVersion, vehicleId: operation?.vehicleId ?? vehicle.id, onSubmitted,
        });
        const submission = submitted.current;
        clearDraft();
        if (!stillMounted() || !submission?.isCurrent()) return;
        const undoDeadline = Date.now() + 5000;
        let undoUsed = false;
        const undoEdit = !submission.undoEdit ? undefined : async () => {
          if (!submission.isCurrent()) return;
          undoUsed = true;
          try {
            const receipt = await submission.undoEdit!();
            if (!(await receipt.settled) && submission.isCurrent()) {
              showToast({ tone: "error", title: "הביטול לא אושר", detail: "הבקשה נשמרה לבדיקה" });
            }
          }
          catch (error) { if (submission.isCurrent()) showToast({ tone: "error", title: error instanceof Error ? error.message : "הביטול לא נשמר" }); }
        };
        // Keep Undo available during handoff without claiming a server receipt.
        const undoToast = undoEdit ? showToast({ tone: "info", title: "עריכת תדלוק", duration: 5000,
          undoLabel: "ביטול", onUndo: undoEdit }) : undefined;
        void submission.receipt.settled.then(accepted => {
          if (!submission.isCurrent() || undoUsed) return;
          if (!accepted) {
            showToast({ tone: "error", title: "שמירת התדלוק דורשת בדיקה", detail: "אפשר לבדוק בשינויים שעוד לא עלו לענן." });
            return;
          }
          if (undoToast !== undefined) dismissToast(undoToast);
          const remaining = undoDeadline - Date.now();
          showToast({ tone: "success", title: "התדלוק עודכן", duration: remaining > 0 ? remaining : 5000,
            undoLabel: remaining > 0 && undoEdit ? "ביטול" : undefined,
            onUndo: remaining > 0 ? undoEdit : undefined });
        });
        navigate(operation ? "/settings/unsynced" : "/", { replace: true });
      } else {
        await addFillup(nextRecord, { replaceOpId: operation?.opId ?? null, replaceVersion: openedOperationVersion,
          vehicleId: operation?.vehicleId ?? vehicle.id, onSubmitted });
        const submission = submitted.current;
        clearDraft();
        if (!stillMounted() || !submission?.isCurrent()) return;
        const session: SavedSession = {
          submission, result: savedFillupResult(submission.written, history, vehicle, prices, historyComplete),
          vehicleId: vehicle.id, fuelType: submission.written.fuelType ?? vehicle.fuelType,
          deadline: submitted.at + 5000, lock: { action: "idle", transferred: false },
        };
        if (operation) {
          if (submission.undoCreation) showToast({ tone: "info", title: "שליחה מחדש",
            duration: Math.max(1, session.deadline - Date.now()),
            undoLabel: "ביטול", onUndo: () => undoSaved(session, false) });
          navigate("/settings/unsynced", { replace: true });
        } else {
          setClock(Date.now());
          setWriteState("pending");
          setSaved(session);
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    } catch (error) {
      if (!stillMounted()) return;
      showToast({ tone: "error", title: error instanceof Error ? error.message : "השמירה נכשלה",
        detail: error instanceof OutboxStorageError ? "הפרטים נשארו בטופס. פנו מקום ונסו שוב." : "הפרטים נשארו בטופס", duration: 8000 });
    } finally {
      saveLock.current = false;
      if (stillMounted()) setSaving(false);
    }
  }

  async function remove() {
    if (!editing || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setConfirmDelete(false);
    const stillMounted = captureUi();
    const snapshot: Fillup = { ...editing, station: editing.station ? { ...editing.station } : null };
    const submitted: { current: FillupSubmission | null } = { current: null };
    try {
      await deleteFillup(snapshot, { vehicleId: activeVehicle?.id, onSubmitted: entry => { submitted.current = entry; } });
      const submission = submitted.current;
      clearDraft();
      if (!stillMounted() || !submission?.isCurrent()) return;
      void submission.receipt.settled.then(accepted => {
        if (!submission.isCurrent()) return;
        showToast({ tone: accepted ? "success" : "info", title: accepted ? "התדלוק נמחק" : "המחיקה דורשת בדיקה",
          detail: accepted ? undefined : "בקשת המחיקה שמורה במכשיר", duration: 5000,
          undoLabel: accepted && submission.restoreDeleted ? "שחזור" : undefined,
          onUndo: accepted && submission.restoreDeleted ? async () => {
            if (!submission.isCurrent()) return;
            try {
              const receipt = await submission.restoreDeleted!();
              if (!submission.isCurrent()) return;
              const restored = await receipt.settled;
              if (submission.isCurrent()) showToast({ tone: restored ? "success" : "info", title: restored ? "התדלוק שוחזר" : "בקשת השחזור דורשת בדיקה" });
            } catch (error) { if (submission.isCurrent()) showToast({ tone: "error", title: error instanceof Error ? error.message : "השחזור לא נשמר" }); }
          } : undefined,
        });
      });
      navigate("/history", { replace: true });
    } catch (error) {
      if (stillMounted()) showToast({ tone: "error", title: error instanceof Error ? error.message : "המחיקה לא נשמרה" });
    } finally {
      saveLock.current = false;
      if (stillMounted()) setSaving(false);
    }
  }

  function confirmationAllowed(session: SavedSession) {
    return session.submission.isCurrent() && Date.now() >= session.deadline &&
      writeState === "accepted" && session.lock.action === "idle";
  }
  async function confirmSamePrice() {
    if (!saved || !confirmationAllowed(saved)) return;
    saved.lock.action = "pump";
    const stillMounted = captureUi();
    setPumpError(null);
    setPumpWriteState("journaling");
    const submitted: { current: FillupSubmission | null } = { current: null };
    try {
      const previous = { ...saved.submission.written };
      await updateFillup(previous.id, { ...previous, postedPricePerLiter: previous.pricePerLiter }, previous, {
        vehicleId: saved.vehicleId, onSubmitted: entry => { submitted.current = entry; },
      });
      const mutation = submitted.current;
      if (!stillMounted() || !saved.submission.isCurrent()) return;
      if (!mutation) throw new Error("האישור לא נרשם. נסו שוב.");
      setPumpWriteState("pending");
      const accepted = await mutation.receipt.settled;
      if (stillMounted() && saved.submission.isCurrent()) setPumpWriteState(accepted ? "accepted" : "attention");
    } catch (error) {
      if (!stillMounted() || !saved.submission.isCurrent()) return;
      saved.lock.action = "idle";
      setPumpWriteState("idle");
      setPumpError(error instanceof Error ? error.message : "האישור לא נשמר");
    }
  }
  function showDifferentPrice() {
    if (!saved || !confirmationAllowed(saved)) return;
    setPumpDifferent(true);
    setPumpError(null);
  }
  async function confirmDifferentPrice() {
    if (!saved || !confirmationAllowed(saved) || priceRulesStatus !== "ready") return;
    const typed = parseNumberInput(confirmedPumpPrice, "price").value;
    if (!Number.isFinite(typed)) { setPumpError("הזינו את המחיר שהיה במשאבה"); return; }
    saved.lock.action = "pump";
    const stillMounted = captureUi();
    const raw = rawPriceRules;
    setPumpError(null);
    setPumpWriteState("journaling");
    try {
      const scoped = await buildPumpRuleScope({ vehicleId: saved.vehicleId, fuelType: saved.fuelType,
        station: saved.submission.written.station ?? null, receiptId: saved.submission.written.id,
        occupiedRules: raw });
      if (!saved.submission.isCurrent()) return;
      if (!scoped.ok) throw new Error(scoped.reason === "hash-unavailable"
        ? "לא ניתן לזהות את התחנה כרגע. המחיר שהקלדתם נשאר כאן."
        : "ההתאמה לא נרשמה כדי לא להחליף כלל אחר. המחיר נשאר כאן.");
      const created = createPumpPriceRule({ scope: scoped.scope, savedPaidPricePerLiter: saved.submission.written.pricePerLiter, typedPumpPrice: typed });
      if (!created.ok) throw new Error(created.reason === "difference-out-of-range" ? "ההפרש גדול מדי. בדקו את מחיר המשאבה." : "הזינו מחיר משאבה תקין");
      const receipt = await savePriceRule(created.rule, { expected: raw.get(created.rule.id) ?? null });
      if (!saved.submission.isCurrent()) return;
      if (stillMounted()) {
        setPumpScopeKind(created.scope.kind);
        setPumpWriteState("pending");
      }
      const accepted = await receipt.settled;
      if (stillMounted() && saved.submission.isCurrent()) setPumpWriteState(accepted ? "accepted" : "attention");
    } catch (error) {
      if (!saved.submission.isCurrent()) return;
      saved.lock.action = "idle";
      if (stillMounted()) {
        setPumpWriteState("idle");
        setPumpError(error instanceof Error ? error.message : "ההתאמה לא נשמרה");
      } else showToast({ tone: "error", title: "ההתאמה לא נשמרה", detail: error instanceof Error ? error.message : undefined });
    }
  }

  if (wrongVehicle) {
    const owner = vehicles.find(entry => entry.id === wrongVehicle);
    return <EditState kind="not-found" title="הפעולה שייכת לרכב אחר"
      body={owner ? `יש לעבור ל${owner.make} ${owner.model} כדי לתקן אותה.` : "הרכב אינו זמין במכשיר הזה."}
      onBack={() => navigate("/settings/unsynced", { replace: true })}
      action={owner ? { label: `מעבר ל${owner.make} ${owner.model}`, onClick: () => void setActiveVehicle(owner.id) } : undefined} />;
  }
  if (!activeVehicle) return <EditState kind="not-found" title="בחרו רכב לתדלוק"
    onBack={() => navigate("/vehicle", { replace: true })} action={{ label: "לבחירת רכב", onClick: () => navigate("/vehicle") }} />;
  if (saved) return <FillupSaved result={saved.result} units={settings.units} deadline={saved.deadline}
    secondsLeft={Math.max(0, Math.ceil((saved.deadline - clock) / 1000))} writeState={writeState}
    undoBusy={undoBusy} onUndo={() => void undoSaved(saved, true)} onDone={finishSaved}
    onReviewWrite={() => navigate("/settings/unsynced")} canConfirm={writeState === "accepted" && clock >= saved.deadline && saved.lock.action === "idle"}
    pumpDifferent={pumpDifferent} pumpPrice={confirmedPumpPrice} onPumpPrice={value => { setConfirmedPumpPrice(value); setPumpError(null); }}
    onSamePrice={() => void confirmSamePrice()} onDifferentPrice={showDifferentPrice} onSavePumpPrice={() => void confirmDifferentPrice()}
    pumpWriteState={pumpWriteState} pumpError={pumpError} pumpScopeKind={pumpScopeKind} ruleStatus={priceRulesStatus} />;

  return <main className="fillup-form" data-testid="fillup-form">
    <header className="fillup-header">
      <button type="button" className="tm-icon-button" aria-label="סגירה" onClick={() => { if (canLeaveDraft()) navigate(-1); }}><CloseIcon size={20} /></button>
      <h1>{operation ? "תיקון תדלוק" : isEdit ? "עריכת תדלוק" : "תדלוק חדש"}</h1>
      <button type="button" className="tm-icon-button" aria-label="צילום המשאבה ולוח הקילומטרים" data-testid="fillup-camera" onClick={() => setScanOpen(true)}><CameraIcon size={21} /></button>
    </header>
    <div className="fillup-content" data-testid="fillup-scroll">
      <div className="fillup-chips fillup-context-chips">
        <button type="button" className="tm-chip" data-testid="fillup-date" onClick={openDate}
          aria-invalid={submitAttempted && !dateConfirmed ? true : undefined}
          aria-describedby={submitAttempted && !dateConfirmed ? "fillup-date-error" : undefined}>
          <ClockIcon size={16} />{dateConfirmed ? <><NumericText>{relativeDate(date)}</NumericText>, <NumRun>{time(date)}</NumRun></> : "בחירת תאריך"}
        </button>
        <button type="button" className="tm-chip" data-testid="fillup-station" onClick={() => setStationSheetOpen(true)}
          aria-invalid={visibleErrors.station ? true : undefined}
          aria-describedby={visibleErrors.station ? "fillup-station-error" : undefined}>
          <PinIcon size={16} /><span><NumericText>{station?.name ?? "בחירת תחנה"}</NumericText>{stationAuto ? <small> · לפי מיקום</small> : null}</span>
        </button>
      </div>
      {restoredDraft || draftStorageFailed ? <div className="fillup-draft-status" role="status" data-testid="fillup-draft-status"
        data-draft-state={draftStorageFailed ? "failed" : "restored"}>
        <span>{draftStorageFailed ? "הטיוטה לא נשמרה במכשיר. השאירו את הטופס פתוח." : "הטיוטה שלכם שוחזרה"}</span>
        <button type="button" onClick={() => {
          if (window.confirm("למחוק את הטיוטה ולהתחיל מחדש?")) { clearDraft(); window.location.reload(); }
        }}>מחיקת טיוטה</button>
      </div> : null}
      {operation ? <div className="fillup-warning" data-testid="fillup-recovered-operation">
        <span><b>שמירה שדורשת בדיקה</b>{operation.error ? <span className="block"><NumericText>{operation.error.message}</NumericText></span> : null}
          <small>הפרטים שמורים במכשיר. שליחה מחדש לא תוסיף תדלוק כפול.</small></span>
      </div> : null}
      {malformedReason ? <div className="fillup-warning"><NumericText>{`הרשומה נקראה חלקית: ${malformedReason}`}</NumericText></div> : null}
      {deletedElsewhere ? <div className="fillup-warning">הרשומה נמחקה במכשיר אחר. שמירה תישאר במכשיר לבדיקה.</div>
        : changedElsewhere ? <div className="fillup-warning fillup-concurrent-warning">
          <b>הרשומה השתנתה במכשיר אחר</b><span>מה שהקלדתם נשאר כאן. השמירה תיבדק מול הגרסה שפתחתם.</span>
          {onReload ? <button type="button" className="tm-chip" onClick={() => { clearDraft(); onReload(); }}>טעינת הגרסה החדשה</button> : null}
        </div> : null}
      {scanCompleted ? <p role="status" className="fillup-small-status">הצילום הועבר לטופס. בדקו את הספרות לפני השמירה.</p> : null}
      {receiptImport ? <p role="status" className="fillup-small-status">הקבלה הועברה לבדיקה. השלימו קילומטראז׳ ובחרו מצב מיכל.</p> : null}
      <FillupEssentials receipt={receipt} onReceiptChange={(field, value) => { if (field === "pricePerLiter") priceInteracted.current = true; setReceipt(current => typeReceiptField(current, field, value)); }}
        odometer={odometer} odometerValue={odometerValue} onOdometerChange={setOdometer} bounds={bounds}
        errors={visibleErrors} odometerError={blockMessage} priceCaption={<NumericText>{resolved.label}</NumericText>} priceValue={priceValue}
        conflict={conflict} receiptBlocked={fieldErrors.some(error => ["totalCost", "pricePerLiter", "liters"].includes(error.field))} warnings={warnings} evaluation={draftEvaluation} units={settings.units} endChoice={endChoice}
        onEndChoice={choice => setTankDraft(current => withEndChoice(current, choice))}
        shaking={shaking} totalRef={totalInput} autoFocus={!scanOpen && !isEdit} historyComplete={historyComplete} />
      {(odometerParsed.ambiguous && odometerParsed.interpretation) || (litersParsed.ambiguous && litersParsed.interpretation) || (priceParsed.ambiguous && priceParsed.interpretation)
        ? <p className="fillup-small-status"><NumericText>{[odometerParsed.interpretation, litersParsed.interpretation, priceParsed.interpretation].filter(Boolean).join(" · ")}</NumericText></p> : null}
      <FillupMore open={moreOpen} onOpenChange={setMoreOpen}
        tankDraft={tankDraft} onTankChange={setTankDraft} outcome={tankOutcome} capacity={capacity}
        capacityNote={capacityNote(capacity) ?? null} onReviewCapacity={() => { if (canLeaveDraft()) navigate("/vehicle?tab=details"); }}
        continuityBreak={continuityBreak} onContinuityChange={setContinuityBreak} notes={notes} onNotesChange={setNotes}
        notesError={visibleErrors.notes} legacyEndState={tankOriginal !== null && tankState.preserved}
        storedPostedPrice={openedRecord?.postedPricePerLiter ?? null} clearStoredPosted={clearStoredPosted}
        onClearStoredPosted={setClearStoredPosted} postedPriceError={visibleErrors.postedPricePerLiter} />
      {!isEdit && !operation ? <button type="button" className="fillup-text-action" data-testid="fillup-import-receipt" onClick={() => setImportOpen(true)}>ייבוא קבלה מקובץ או טקסט</button> : null}
      {isEdit && !dateWasInvalid ? <Button full variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving} data-testid="fillup-delete">
        <TrashIcon size={18} />מחיקת התדלוק
      </Button> : null}
      {operation ? <button type="button" className="fillup-text-action fillup-danger-action" onClick={async () => {
        const stillMounted = captureUi();
        try { await discardOperation(operation.opId); if (stillMounted()) { clearDraft(); navigate("/settings/unsynced", { replace: true }); } }
        catch (error) { if (stillMounted()) showToast({ tone: "error", title: error instanceof Error ? error.message : "הפעולה לא הוסרה" }); }
      }}>הסרת הפעולה מהרשימה המקומית</button> : null}
      {visibleErrors.station ? <p id="fillup-station-error" className="fillup-error" role="alert"><NumericText>{visibleErrors.station}</NumericText></p> : null}
      {submitAttempted && !dateConfirmed ? <p id="fillup-date-error" className="fillup-error" role="alert">בחרו תאריך ושעה לפני השמירה</p> : null}
      <p className="sr-only">{vehicleShort(activeVehicle)}</p>
    </div>
    <footer className="fillup-bottom-bar">
      <Button full onClick={() => void save()} loading={saving} data-testid="fillup-save">
        {operation ? "שמירה ושליחה מחדש" : isEdit ? "שמירת שינויים" : "שמירת תדלוק"}
      </Button>
    </footer>
    <StationSheet fuelType={activeVehicle.fuelType} kmPerLiter={vehicleStats.avgKmPerLiter}
      litersToBuy={Number.isFinite(litersValue) && litersValue > 0 ? litersValue : 40} prices={prices}
      open={stationSheetOpen} onClose={() => setStationSheetOpen(false)} stations={pastStations} lastPaid={lastPaidByStation}
      nearby={geo.nearby} geoStatus={geo.status} onLocate={locateForOrdering} current={station} onPick={chooseStation} />
    <DateSheet open={dateSheetOpen} onClose={() => setDateSheetOpen(false)} value={date} maxDate={dateSheetNow} bounds={bounds}
      onChange={next => { setDate(next); setDateConfirmed(true); }} />
    <ConfirmDialog open={confirmDelete} title="למחוק את התדלוק?" body="אחרי שהמחיקה תאושר, אפשר יהיה לשחזר מיד."
      confirmLabel="מחיקה" onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />
    {importOpen ? <Suspense fallback={<p role="status">טוענים ייבוא קבלה…</p>}><ReceiptImport fillups={fillups}
      hasAuthored={receipt.authored.length > 0 || date !== initialDraft.current.date} onClose={() => setImportOpen(false)}
      onApply={(candidate, identity) => {
        setReceipt(previous => typeReceiptField(typeReceiptField(previous, "totalCost", candidate.total), "liters", candidate.liters));
        setDate(new Date(`${candidate.day}T${candidate.time}:00`).getTime()); setDateConfirmed(true);
        setReceiptImport(identity); setImportOpen(false);
      }} /></Suspense> : null}
    {scanOpen ? <Suspense fallback={<p role="status">טוענים מצלמה…</p>}><ScanWizard
      initial={{ total: receipt.totalCost, liters: receipt.liters, odometer }} onClose={() => setScanOpen(false)}
      context={{ lastOdometer: bounds.min, tankCapacity: capacity.liters }}
      protectedFields={[
        ...(receipt.authored.includes("totalCost") ? ["total" as const] : []),
        ...(receipt.authored.includes("liters") ? ["liters" as const] : []),
        ...(odometer.trim() ? ["odometer" as const] : []),
      ]}
      onApply={(scan, acceptedFields) => {
        setScanCompleted(acceptedFields.length > 0);
        setReceipt(previous => {
          let next = previous;
          if (acceptedFields.includes("total")) next = typeReceiptField(next, "totalCost", scan.total);
          if (acceptedFields.includes("liters")) next = typeReceiptField(next, "liters", scan.liters);
          return next;
        });
        if (acceptedFields.includes("odometer")) setOdometer(scan.odometer);
        setScanOpen(false);
      }} /></Suspense> : null}
  </main>;
}
