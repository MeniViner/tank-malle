import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useStats } from "../hooks/useStats";
import {
  evaluateDraft,
  hardBlock,
  odometerBounds,
  resolvePricePerLiter,
  softWarnings,
  type Fillup,
} from "../lib/stats";
import { capacityNote, resolveCapacity } from "../lib/tank/capacity";
import {
  num,
  price,
  relativeDate,
  shekel,
  time,
  timeAgo,
  vehicleShort,
} from "../lib/format";
import { parseNumberInput } from "../lib/numeric";
import {
  receiptConflict,
  receiptNumbers,
  suggestReceiptPrice,
  typeReceiptField,
  type ReceiptState,
} from "../lib/receipt";
import {
  fillupFromPayload,
  serializeFillup,
  serializeFillupPatch,
  validateFillupPayload,
  type FieldError,
  type FillupWrite,
} from "../lib/fillupSerializer";
import { OutboxStorageError, type OutboxOperation } from "../lib/outbox";
import {
  distanceMeters,
  formatDistance,
  loadStationCatalog,
  locateStations,
  searchStations,
  toStation,
  type GeoResult,
} from "../lib/stations";
import type { FuelPrices, FuelType, Station } from "../lib/types";
import { adaptLegacyConfig } from "../lib/prices/regulated";
import {
  resolveStationPrice,
  stationPriceView,
  type StationPriceView,
} from "../lib/prices/resolver";
import {
  BEST_VALUE_UNAVAILABLE,
  SORT_LABELS,
  bestValueBlocker,
  rankStations,
  type StationCandidate,
  type StationSort,
} from "../lib/prices/ranking";
import { TANK_SCHEMA_VERSION } from "../lib/tank/config";
import { TankStateSection } from "../components/TankStateSection";
import {
  EMPTY_TANK_DRAFT,
  draftFromFields,
  effectiveEndChoice,
  hasTankAnswer,
  resolveTankOutcome,
  withEndChoice,
  type TankEndChoice,
  type TankStateDraft,
} from "../lib/tank/draft";
import { Button } from "../components/Button";
import { Field, InfoStrip, SoftWarningBanner } from "../components/Field";
import { Card, Label, IconTile, Skeleton } from "../components/Card";
import { Toggle } from "../components/Segmented";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { StationBrandMark } from "../components/StationBrand";
import { ConsumptionValue, Quantity } from "../components/Fmt";
import { DateTimePicker } from "../components/DateTimePicker";
import {
  CalendarIcon,
  CarIcon,
  CheckIcon,
  ChevronDown,
  ChevronStart,
  CloseIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
  WarningIcon,
} from "../components/icons";

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
  const navigate = useNavigate();
  const { fillupId } = useParams();
  const [search] = useSearchParams();
  const opId = search.get("op");
  const { fillups, loadingFillups, fillupsError, malformedFillups, outbox } = useData();
  // Bumped when the user chooses to reload a record another device changed.
  const [reloads, setReloads] = useState(0);

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
      operation?.payload ? fillupFromPayload(operation.docId, operation.payload) : null;
    return (
      <FillupEditor
        key={opId ?? "new"}
        mode="new"
        initial={initial}
        operation={operation}
      />
    );
  }

  const editing = fillups.find((entry) => entry.id === fillupId) ?? null;
  if (editing) {
    return (
      <FillupEditor
        key={`${fillupId}:${reloads}`}
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
        key={`${fillupId}:malformed`}
        mode="edit"
        initial={malformedAsFillup(malformed.id, malformed.raw)}
        malformedReason={malformed.reason}
      />
    );
  }

  // A create that the server rejected: the record is not in the history, but
  // the user's input is in the outbox and can be corrected from here.
  const rejected =
    outbox.find((entry) => entry.docId === fillupId && entry.kind === "fillup.add") ?? null;
  if (rejected?.payload) {
    return (
      <FillupEditor
        key={`${fillupId}:op`}
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
}: {
  kind: "loading" | "not-found" | "failed";
  title?: string;
  body?: string;
  onBack?: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col gap-3 bg-bg px-5 pt-safe" data-edit-state={kind}>
      <header className="flex items-center justify-between py-3">
        <h1 className="text-[24px] font-bold text-ink">עריכת תדלוק</h1>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="סגירה"
            className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink"
          >
            <CloseIcon size={17} />
          </button>
        ) : null}
      </header>
      {kind === "loading" ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[120px] rounded-hero" />
          <Skeleton className="h-[180px] rounded-card" />
          <Skeleton className="h-[120px] rounded-card" />
        </div>
      ) : (
        <Card className="flex flex-col gap-2 p-5">
          <span className="text-[16px] font-bold text-ink">{title}</span>
          <span className="text-[13.5px] leading-relaxed text-muted">{body}</span>
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

/** The tank-state part of a stored record, for an untouched legacy edit. */
function storedTankFields(fillup: Fillup) {
  return {
    fillEndState: fillup.fillEndState,
    fillEndStateSource: fillup.fillEndStateSource,
    preFillLevel: fillup.preFillLevel,
    preFillLevelSource: fillup.preFillLevelSource,
    preFillLevelUncertainty: fillup.preFillLevelUncertainty,
    postFillLevel: fillup.postFillLevel,
    postFillLevelSource: fillup.postFillLevelSource,
    postFillLevelUncertainty: fillup.postFillLevelUncertainty,
    refuelReason: fillup.refuelReason,
    capacityLitersAtEntry: fillup.capacityLitersAtEntry,
    tankSchemaVersion: fillup.tankSchemaVersion,
  };
}

const END_CHOICES: { value: TankEndChoice; label: string; hint: string }[] = [
  { value: "full", label: "מילאתי מיכל מלא", hint: "סוגר מקטע צריכה" },
  { value: "partial", label: "תדלוק חלקי", hint: "הליטרים ייכללו בתדלוק המלא הבא" },
  { value: "unknown", label: "לא יודע", hint: "הצריכה לא תחושב מהרשומה הזו" },
];

function FillupEditor({
  mode,
  initial,
  operation = null,
  malformedReason = null,
  onReload,
}: {
  mode: "new" | "edit";
  /** The resolved record for an edit, or a prefilled draft for a new one. */
  initial: Fillup | null;
  /** The unsynced operation this editor corrects, when it does. */
  operation?: OutboxOperation | null;
  malformedReason?: string | null;
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    activeVehicle,
    fillups,
    prices,
    settings,
    addFillup,
    updateFillup,
    deleteFillup,
    restoreFillup,
    discardOperation,
  } = useData();

  // Whole-history statistics for this vehicle, used only for the best-value
  // station ranking — which needs a real measured consumption or nothing.
  const vehicleStats = useStats();

  const isEdit = mode === "edit";
  const editing = isEdit ? initial : null;
  const dateWasInvalid = editing !== null && !Number.isFinite(editing.date);

  const [date, setDate] = useState<number>(() =>
    initial && Number.isFinite(initial.date) ? initial.date : Date.now(),
  );
  // A record whose date could not be read is saved only once the user has
  // deliberately set one.
  const [dateConfirmed, setDateConfirmed] = useState(!dateWasInvalid);
  const [odometer, setOdometer] = useState(() =>
    initial && initial.odometer > 0 ? String(initial.odometer) : "",
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
  const [receipt, setReceipt] = useState<ReceiptState>(() => {
    if (!initial) return { liters: "", pricePerLiter: "", totalCost: "", authored: [] };
    const expected = initial.liters * initial.pricePerLiter;
    const totalIsOwn =
      initial.totalCost > 0 && Math.abs(initial.totalCost - expected) > Math.max(1, expected * 0.01);
    return {
      liters: initial.liters > 0 ? String(initial.liters) : "",
      pricePerLiter: initial.pricePerLiter > 0 ? String(initial.pricePerLiter) : "",
      totalCost: initial.totalCost > 0 ? String(Math.round(initial.totalCost * 100) / 100) : "",
      authored: [
        ...(initial.liters > 0 ? (["liters"] as const) : []),
        ...(initial.pricePerLiter > 0 ? (["pricePerLiter"] as const) : []),
        ...(totalIsOwn ? (["totalCost"] as const) : []),
      ],
    };
  });

  /**
   * Optional tank state. Loaded back only from a record written by THIS UI —
   * a legacy document's `isFullTank` is an assumption nobody made.
   */
  const [tankDraft, setTankDraft] = useState<TankStateDraft>(() =>
    initial ? draftFromFields(initial) : EMPTY_TANK_DRAFT,
  );

  /**
   * True when this record's tank state is something the user actually stated.
   * A legacy record that is merely opened and re-saved keeps its old fields.
   */
  const tankTouched =
    !isEdit ||
    editing?.tankSchemaVersion === TANK_SCHEMA_VERSION ||
    hasTankAnswer(tankDraft);

  const [continuityBreak, setContinuityBreak] = useState(
    initial?.continuityBreakBefore === true,
  );

  /**
   * Whether the price paid was also the price on the pump.
   *
   * On an edit the answer is reconstructed from what is STORED: a posted
   * price equal to the paid one was "same"; a different one was "different",
   * with that price — never "same" by default, which used to overwrite a
   * distinct pump price with the paid one on any re-save.
   */
  const [pumpAnswer, setPumpAnswer] = useState<PumpAnswer>(() => {
    if (initial?.postedPricePerLiter == null) return "unanswered";
    return Math.abs(initial.postedPricePerLiter - initial.pricePerLiter) < 1e-9 ? "same" : "different";
  });
  const [pumpPrice, setPumpPrice] = useState(() =>
    initial?.postedPricePerLiter != null ? String(initial.postedPricePerLiter) : "",
  );
  const [pumpTouched, setPumpTouched] = useState(false);
  const [station, setStation] = useState<Station | null>(initial?.station ?? null);
  const [stationAuto, setStationAuto] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [stationSheetOpen, setStationSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Fill-ups other than the one being edited — the basis for all validation.
  const others = useMemo(
    () => (editing ? fillups.filter((f) => f.id !== editing.id) : fillups),
    [fillups, editing],
  );

  /* ---------- concurrent edits ---------- */

  /**
   * The record as it was when this editor opened. If a later snapshot brings
   * a DIFFERENT version (another tab, another device), the user is told and
   * offered a reload; their typing is never overwritten underneath them.
   */
  const baseline = useMemo(
    () => (editing ? JSON.stringify(serializeFillupPatch(editing)) : null),
    // The editor is keyed on the record, so `editing` is the opening snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const live = editing ? fillups.find((entry) => entry.id === editing.id) ?? null : null;
  const changedElsewhere =
    baseline !== null && live !== null && JSON.stringify(serializeFillupPatch(live)) !== baseline;
  const deletedElsewhere = baseline !== null && live === null && !dateWasInvalid;

  /* ---------- price chain ---------- */

  const resolved = useMemo(
    () => resolvePricePerLiter(date, activeVehicle, prices),
    [date, activeVehicle, prices],
  );

  // A suggestion fills the price only while nobody has typed it, and never
  // moves a typed litres or total (see receipt.ts). Runs again when the date
  // moves to another month or a late price arrives.
  useEffect(() => {
    setReceipt((current) => suggestReceiptPrice(current, resolved.price));
  }, [resolved.price]);

  const { liters: litersValue, pricePerLiter: priceValue, totalCost: totalValue } =
    receiptNumbers(receipt);
  const conflict = receiptConflict(receipt);

  /* ---------- geolocation → station suggestion ---------- */

  const pastStations = useMemo(() => {
    const map = new Map<string, Station>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      const name = fillup.station?.name?.trim();
      if (name && !map.has(name)) map.set(name, fillup.station as Station);
    }
    return [...map.values()];
  }, [fillups]);

  const lastPaidByStation = useMemo(() => {
    const map = new Map<string, { price: number; observedAt: number }>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      const entry = { price: fillup.pricePerLiter, observedAt: fillup.date };
      const id = fillup.station?.stationId;
      const name = fillup.station?.name?.trim();
      if (id && !map.has(id)) map.set(id, entry);
      if (name && !map.has(name)) map.set(name, entry);
    }
    return map;
  }, [fillups]);

  const [geo, setGeo] = useState<GeoResult>({ status: "idle", position: null, nearby: [] });
  const geoRequested = useRef(false);

  const detectStation = useCallback(
    async (manual = false) => {
      if (!manual && geoRequested.current) return;
      geoRequested.current = true;
      setGeo((current) => ({ ...current, status: "locating" }));

      const result = await locateStations();
      setGeo(result);
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
      setStation(chosen);
      setStationAuto(true);
    },
    [pastStations],
  );

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

  /**
   * The ONE tank computation. The gauges display it, the payload stores its
   * fields, and the engine replays exactly those fields.
   */
  const tankOutcome = useMemo(
    () =>
      resolveTankOutcome({
        draft: tankDraft,
        litersAdded: Number.isFinite(litersValue) && litersValue > 0 ? litersValue : null,
        capacity,
      }),
    [tankDraft, litersValue, capacity],
  );
  const endChoice = effectiveEndChoice(tankDraft);

  /**
   * `isFullTank`, the compatibility projection. An untouched legacy record
   * keeps exactly what it was stored with.
   */
  const isFullTank = tankTouched
    ? tankOutcome.endState === "full"
    : (editing?.isFullTank ?? false);

  const warnings = useMemo(() => {
    if (!odometer || !receipt.liters) return [];
    return softWarnings(
      {
        date,
        odometer: odometerValue,
        liters: litersValue,
        pricePerLiter: priceValue,
        isFullTank,
        fillEndState: tankTouched ? tankOutcome.endState : undefined,
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
    tankTouched,
    tankOutcome.endState,
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
        fillEndState: tankTouched ? tankOutcome.endState : undefined,
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
    tankTouched,
    tankOutcome.endState,
    continuityBreak,
    others,
    editing,
  ]);

  const isBackdated = date < Date.now() - 12 * 3600_000;

  /** What the receipt shows: the typed total, else litres × price. */
  const totalDue =
    Number.isFinite(totalValue) && totalValue > 0
      ? totalValue
      : Number.isFinite(litersValue) && litersValue > 0 && Number.isFinite(priceValue)
        ? Math.round(litersValue * priceValue * 100) / 100
        : 0;

  /**
   * The document exactly as it will be written, built from the same
   * serializer every write goes through, and validated against the same
   * bounds the server enforces — so a doomed write never leaves the device.
   */
  const nextRecord = useMemo<FillupWrite | null>(() => {
    if (!activeVehicle) return null;
    if (!Number.isFinite(odometerValue) || !Number.isFinite(litersValue)) return null;
    if (!Number.isFinite(priceValue)) return null;

    const tankFields = tankTouched
      ? tankOutcome.fields
      : editing
        ? storedTankFields(editing)
        : {};

    return {
      date,
      odometer: odometerValue,
      liters: litersValue,
      pricePerLiter: priceValue,
      totalCost: Number.isFinite(totalValue)
        ? totalValue
        : Math.round(litersValue * priceValue * 100) / 100,
      isFullTank,
      // The boolean is a projection of the user's stated end state; the real
      // provenance lives in the tank fields. An edit keeps what was stored.
      fullTankSource: editing?.fullTankSource ?? "user",
      continuityBreakBefore: continuityBreak,
      ...tankFields,
      // Only ever set from an explicit answer; an untouched question on an
      // edit keeps the stored pump price exactly, including a distinct one.
      postedPricePerLiter:
        isEdit && !pumpTouched
          ? (editing?.postedPricePerLiter ?? null)
          : resolvePostedPrice(pumpAnswer, priceValue, pumpPrice),
      fuelType: activeVehicle.fuelType,
      station: station ?? null,
      notes: notes.trim() || null,
      // Import provenance and creation metadata travel unchanged.
      importSource: editing?.importSource,
      importBatchId: editing?.importBatchId,
      importRowHash: editing?.importRowHash,
      schemaVersion: editing?.schemaVersion,
      createdAt: editing?.createdAt ?? null,
    };
  }, [
    activeVehicle,
    odometerValue,
    litersValue,
    priceValue,
    totalValue,
    date,
    isFullTank,
    editing,
    continuityBreak,
    tankTouched,
    tankOutcome.fields,
    isEdit,
    pumpTouched,
    pumpAnswer,
    pumpPrice,
    station,
    notes,
  ]);

  const fieldErrors = useMemo<FieldError[]>(
    () => (nextRecord ? validateFillupPayload(serializeFillup(nextRecord)) : []),
    [nextRecord],
  );
  const errorFor = (field: FieldError["field"]) =>
    fieldErrors.find((entry) => entry.field === field)?.message ?? null;

  const canSave =
    nextRecord !== null &&
    odometerValue > 0 &&
    litersValue > 0 &&
    priceValue > 0 &&
    !blockMessage &&
    fieldErrors.length === 0 &&
    dateConfirmed &&
    !saving;

  const saveHint = useMemo(() => {
    if (blockMessage) return blockMessage;
    if (!dateConfirmed) return "לרשומה הזו לא היה תאריך קריא — בחרו תאריך ושעה";
    if (fieldErrors.length > 0) return fieldErrors[0].message;

    const missing: string[] = [];
    if (!(Number.isFinite(odometerValue) && odometerValue > 0)) missing.push("קילומטראז׳");
    if (!(Number.isFinite(litersValue) && litersValue > 0)) missing.push("ליטרים או סכום");
    if (!(Number.isFinite(priceValue) && priceValue > 0)) missing.push("מחיר לליטר");

    if (missing.length === 0) return "הכול מוכן — אפשר לשמור";
    if (missing.length === 1) return `מלאו ${missing[0]}`;
    return `מלאו ${missing.slice(0, -1).join(", ")} ו${missing[missing.length - 1]}`;
  }, [blockMessage, dateConfirmed, fieldErrors, odometerValue, litersValue, priceValue]);

  /* ---------- save ---------- */

  async function save() {
    setSubmitAttempted(true);
    if (!canSave || !activeVehicle || !nextRecord) return;
    setSaving(true);

    try {
      if (editing && !operation) {
        const previous: Fillup = { ...editing };
        await updateFillup(editing.id, nextRecord, previous);
        showToast({
          tone: "success",
          title: "התדלוק עודכן",
          detail: "נשמר במכשיר · יאושר מול השרת ברקע",
          undoLabel: "ביטול",
          // The Undo sends the previous record through the same serializer —
          // never the UI object with its `id`.
          onUndo: () => updateFillup(previous.id, previous, nextRecord as Fillup),
        });
      } else {
        const newId = await addFillup(nextRecord, {
          replaceOpId: operation?.opId ?? null,
          vehicleId: operation?.vehicleId ?? undefined,
        });
        const { title, detail } = savedMessage(
          evaluateDraft(
            {
              ...nextRecord,
              fillEndState: nextRecord.fillEndState ?? undefined,
              continuityBreakBefore: continuityBreak,
            },
            others,
          ),
          settings.units,
        );
        const tankSaved =
          tankTouched && (endChoice === "full" || tankDraft.beforeLevel !== null);

        showToast({
          tone: "success",
          title,
          detail: tankSaved ? `מצב המיכל נשמר — התחזית תשתפר · ${detail}` : detail,
          undoLabel: "ביטול",
          duration: 5000,
          onUndo: () => {
            const created = { ...(nextRecord as Fillup), id: newId };
            void deleteFillup(created);
          },
        });
      }
      navigate(operation ? "/settings/unsynced" : "/", { replace: true });
    } catch (error) {
      // Local storage refused to keep the record. The form stays open with
      // everything typed; there is no success to report.
      showToast({
        tone: "error",
        title: error instanceof OutboxStorageError ? error.message : "השמירה נכשלה",
        detail:
          error instanceof OutboxStorageError
            ? "פנו מקום באחסון הדפדפן או ייצאו את הרשומה, ונסו שוב"
            : "נסו שוב בעוד רגע",
        duration: 8000,
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    const snapshot: Fillup = { ...editing };
    setConfirmDelete(false);
    try {
      await deleteFillup(snapshot);
    } catch (error) {
      showToast({
        tone: "error",
        title: error instanceof OutboxStorageError ? error.message : "המחיקה נכשלה",
      });
      return;
    }
    showToast({
      tone: "success",
      title: "התדלוק נמחק",
      undoLabel: "שחזור",
      duration: 5000,
      onUndo: () => restoreFillup(snapshot),
    });
    navigate(-1);
  }

  const lastFillup = bounds.prev;
  const showErrors = submitAttempted;

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-bg pt-safe">
      <header className="flex flex-none items-start justify-between gap-3 px-5 pb-3 pt-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-[24px] font-bold leading-tight text-ink">
            {operation ? "תיקון תדלוק שלא סונכרן" : isEdit ? "עריכת תדלוק" : "תדלוק חדש"}
          </h1>
          <span className="flex w-fit max-w-full items-center gap-1.5 truncate rounded-pill border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted">
            <CarIcon size={13} />
            {vehicleShort(activeVehicle)}
          </span>
        </div>

        <div className="flex flex-none items-center gap-2">
          {isEdit && !dateWasInvalid ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="מחיקת רשומה"
              className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-danger transition-[background-color,scale] duration-200 active:scale-[0.96]"
            >
              <TrashIcon size={18} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="סגירה"
            className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition-[background-color,scale] duration-200 active:scale-[0.96] active:bg-surface-2"
          >
            <CloseIcon size={17} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-5 pb-40">
        {operation ? (
          <div className="flex flex-col gap-1 rounded-[14px] bg-warning-soft px-3.5 py-3 text-warning-ink">
            <span className="text-[13.5px] font-bold">
              הרשומה הזו נדחתה על ידי השרת ונשמרה במכשיר
            </span>
            {operation.error ? (
              <span className="text-[12.5px] leading-relaxed">
                {operation.error.message}
                {operation.error.code ? ` (${operation.error.code})` : ""}
              </span>
            ) : null}
            <span className="text-[12.5px] leading-relaxed">
              שמירה מכאן שולחת אותה מחדש עם אותו מזהה — בלי כפילות.
            </span>
          </div>
        ) : null}

        {malformedReason ? (
          <SoftWarningBanner message="הרשומה נקראה חלקית" detail={`${malformedReason}. השלימו את החסר ושמרו.`} />
        ) : null}

        {deletedElsewhere ? (
          <SoftWarningBanner
            message="הרשומה נמחקה במכשיר אחר"
            detail="שמירה תיצור אותה מחדש עם אותו מזהה."
          />
        ) : changedElsewhere ? (
          <div className="flex flex-col gap-2 rounded-[14px] bg-warning-soft px-3.5 py-3 text-warning-ink">
            <span className="text-[13.5px] font-bold">הרשומה השתנתה במכשיר אחר</span>
            <span className="text-[12.5px] leading-relaxed">
              מה שהקלדתם כאן נשמר. שמירה תדרוס את הגרסה החדשה; טעינה מחדש תציג אותה ותוותר על השינויים שכאן.
            </span>
            {onReload ? (
              <button
                type="button"
                onClick={onReload}
                className="w-fit min-h-[40px] rounded-pill border border-warning/40 bg-surface px-3 text-[12.5px] font-semibold text-warning-ink"
              >
                טעינת הגרסה החדשה
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A live receipt, on the same dark card the home screen uses. */}
        <div className="mt-1 flex flex-col rounded-hero bg-hero p-[18px_20px_15px] text-hero-ink shadow-raised">
          <span className="text-[12.5px] text-hero-muted">סה״כ לתשלום</span>
          <span className={`mt-0.5 flex items-baseline gap-1.5 ${totalDue > 0 ? "" : "text-hero-muted"}`}>
            <Num className="text-[40px] font-bold leading-none tracking-[-0.02em]">
              {shekel(totalDue, 2)}
            </Num>
          </span>

          <div className="mt-4 grid grid-cols-3 border-t border-hero-line pt-3">
            <ReceiptCell label="ליטרים" divided>
              {Number.isFinite(litersValue) && litersValue > 0 ? <Num>{num(litersValue, 1)}</Num> : "—"}
            </ReceiptCell>
            <ReceiptCell label="מחיר לליטר" divided>
              {Number.isFinite(priceValue) && priceValue > 0 ? <Num>{price(priceValue)}</Num> : "—"}
            </ReceiptCell>
            <ReceiptCell label="צריכה">
              {draftEvaluation?.outcome === "closedSegment" && draftEvaluation.segment ? (
                <ConsumptionValue
                  kmPerLiter={draftEvaluation.segment.kmPerLiter}
                  units={settings.units}
                  unitClassName="text-[11px] font-normal text-hero-muted"
                />
              ) : (
                "—"
              )}
            </ReceiptCell>
          </div>
        </div>

        <Eyebrow>פרטי התדלוק</Eyebrow>
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setDateSheetOpen(true)}
            className="flex min-h-[58px] w-full items-center gap-3 border-b border-line px-4 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2"
          >
            <IconTile>
              <CalendarIcon size={18} />
            </IconTile>
            <span className="flex flex-1 flex-col gap-0.5">
              <Label className="text-[12.5px]">תאריך ושעה</Label>
              <span className="text-[15px] font-semibold text-ink">
                {dateConfirmed ? (
                  <>
                    {relativeDate(date)} · <Num>{time(date)}</Num>
                  </>
                ) : (
                  <span className="text-danger-ink">יש לבחור תאריך</span>
                )}
              </span>
            </span>
            {isBackdated && dateConfirmed ? (
              <span className="flex-none rounded-pill bg-warning-soft px-2.5 py-1 text-[12px] font-semibold text-warning-ink">
                תאריך בעבר
              </span>
            ) : (
              <ChevronStart size={17} className="rotate-180 text-muted" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setStationSheetOpen(true)}
            className="flex min-h-[58px] w-full items-center gap-3 border-b border-line px-4 py-3 text-start transition-[background-color] duration-150 active:bg-surface-2"
          >
            <IconTile>
              <PinIcon size={18} />
            </IconTile>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Label className="text-[12.5px]">תחנה</Label>
              <span className="truncate text-[15px] font-semibold text-ink">
                {station?.name ?? "ללא מיקום"}
              </span>
              {stationAuto ? (
                <span className="text-[12px] text-accent">זוהה אוטומטית לפי מיקום</span>
              ) : null}
            </span>
            <span className="flex-none text-[13.5px] font-semibold text-accent">שינוי</span>
          </button>

          <div className="flex min-h-[58px] items-center gap-3 px-4 py-2.5">
            <IconTile>
              <span className="text-[17px] font-bold">₪</span>
            </IconTile>
            <span className="flex flex-1 flex-col gap-0.5">
              <Label className="text-[12.5px]">מחיר לליטר</Label>
              <span className="text-[12px] text-muted">
                {receipt.authored.includes("pricePerLiter")
                  ? "מחיר שהוזן ידנית לתדלוק הזה"
                  : resolved.label}
              </span>
              {priceParsed.ambiguous && priceParsed.interpretation ? (
                <span className="text-[12px] text-warning-ink">{priceParsed.interpretation}</span>
              ) : null}
            </span>
            <input
              dir="ltr"
              inputMode="decimal"
              aria-label="מחיר לליטר"
              aria-invalid={showErrors && errorFor("pricePerLiter") ? true : undefined}
              value={receipt.pricePerLiter}
              onChange={(event) =>
                setReceipt((current) => typeReceiptField(current, "pricePerLiter", event.target.value))
              }
              className="num min-h-[44px] w-[88px] flex-none rounded-[11px] border border-line bg-surface px-2 text-center text-[16px] font-bold text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
            />
          </div>
          {showErrors && errorFor("pricePerLiter") ? (
            <span className="block px-4 pb-3 text-[12.5px] font-semibold text-danger">
              {errorFor("pricePerLiter")}
            </span>
          ) : null}
        </Card>

        {station && Number.isFinite(priceValue) && priceValue > 0 ? (
          <PumpPriceQuestion
            paid={priceValue}
            answer={pumpAnswer}
            onAnswer={(value) => {
              setPumpTouched(true);
              setPumpAnswer(value);
            }}
            pumpPrice={pumpPrice}
            onPumpPrice={(value) => {
              setPumpTouched(true);
              setPumpPrice(value);
            }}
          />
        ) : null}

        <Eyebrow>קילומטראז׳</Eyebrow>
        <Card className="flex flex-col gap-3 p-4">
          <Field
            big
            label={isBackdated ? "קילומטראז׳ בתאריך זה" : "קילומטראז׳ נוכחי"}
            inputMode="decimal"
            suffix="ק״מ"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
            placeholder="0"
            error={blockMessage ?? (showErrors ? errorFor("odometer") : null)}
            hint={
              odometerParsed.interpretation ? (
                <>
                  {odometerParsed.interpretation}: <Num>{num(odometerValue, 0)}</Num>
                </>
              ) : lastFillup ? (
                <>
                  אחרון: <Num>{num(lastFillup.odometer, 0)}</Num> · {timeAgo(lastFillup.date)}
                </>
              ) : bounds.max !== null ? (
                <>
                  עד <Num>{num(bounds.max, 0)}</Num> לפי הרשומה הבאה
                </>
              ) : (
                "הקילומטראז׳ שמופיע בלוח המחוונים"
              )
            }
          />

          {warnings
            .filter((warning) => warning.field === "odometer")
            .map((warning) => (
              <SoftWarningBanner key={warning.field} message={warning.message} detail={warning.detail} />
            ))}
        </Card>

        <Eyebrow>כמות וסכום</Eyebrow>
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <Field
                big
                label="ליטרים"
                inputMode="decimal"
                value={receipt.liters}
                onChange={(event) =>
                  setReceipt((current) => typeReceiptField(current, "liters", event.target.value))
                }
                placeholder="0"
                error={showErrors ? errorFor("liters") : null}
                hint={litersParsed.ambiguous ? litersParsed.interpretation : undefined}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Field
                big
                label="סה״כ לתשלום"
                inputMode="decimal"
                value={receipt.totalCost}
                onChange={(event) =>
                  setReceipt((current) => typeReceiptField(current, "totalCost", event.target.value))
                }
                placeholder="0"
                error={showErrors ? errorFor("totalCost") : null}
              />
            </div>
          </div>

          <span className="text-[12.5px] text-muted">
            {receipt.authored.length >= 3
              ? "שלושת השדות הוזנו ידנית — אף אחד מהם לא ישתנה אוטומטית"
              : "שדה שלא הוזן ידנית מחושב מהשניים האחרים"}
          </span>

          {conflict ? (
            <SoftWarningBanner
              message="הליטרים, המחיר והסכום לא מסתדרים"
              detail={`${conflict.message}. נקו את השדה השגוי כדי שיחושב מחדש — שום ערך לא ישתנה מעצמו.`}
            />
          ) : null}

          {warnings
            .filter((warning) => warning.field !== "odometer")
            .map((warning) => (
              <SoftWarningBanner key={warning.field} message={warning.message} detail={warning.detail} />
            ))}
        </Card>

        {/* The end state is a visible, deliberate choice at form level — not
            a chip inside a collapsed section. Nothing is pre-selected: an
            untouched default must never be stored as a user statement. */}
        <Eyebrow>בסיום התדלוק</Eyebrow>
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            {END_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={endChoice === choice.value}
                onClick={() =>
                  setTankDraft((current) =>
                    withEndChoice(current, endChoice === choice.value ? null : choice.value),
                  )
                }
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-pill px-4 text-[13.5px] font-bold transition-[background-color,scale] duration-200 active:scale-[0.97] ${
                  endChoice === choice.value
                    ? "bg-accent text-accent-contrast"
                    : "border border-line bg-surface text-ink"
                }`}
              >
                {endChoice === choice.value ? <CheckIcon size={15} /> : null}
                {choice.label}
              </button>
            ))}
          </div>
          <span className="text-[12.5px] leading-relaxed text-muted">
            {endChoice === null
              ? isEdit && !tankTouched && editing?.isFullTank
                ? "ברשומה הישנה הזו סומן מיכל מלא בלי שנשאלתם. בחירה כאן תהפוך את זה להצהרה שלכם."
                : "בלי בחירה, הרשומה נשמרת עם מצב לא ידוע והצריכה לא תחושב ממנה."
              : END_CHOICES.find((choice) => choice.value === endChoice)?.hint}
          </span>
          {tankOutcome.state === "conflict" ||
          tankOutcome.state === "capacitySuspect" ||
          tankOutcome.state === "overCapacity" ? (
            <SoftWarningBanner message="הנתונים לא לגמרי מסתדרים" detail={tankOutcome.message ?? undefined} />
          ) : null}
        </Card>

        {/* Optional gauges: before / after. The financial record saves
            whether or not anybody opens this. */}
        <TankStateSection
          draft={tankDraft}
          onChange={setTankDraft}
          outcome={tankOutcome}
          capacity={capacity}
          capacityNote={capacityNote(capacity)}
          onReviewCapacity={() => navigate("/settings/vehicles")}
        />

        {draftEvaluation ? <DraftExplanation evaluation={draftEvaluation} /> : null}

        <Eyebrow>תיעוד</Eyebrow>
        <Card className="flex flex-col p-4">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[14.5px] font-semibold text-ink">
              היו תדלוקים שלא תיעדתי
            </span>
            <Toggle
              checked={continuityBreak}
              onChange={setContinuityBreak}
              ariaLabel="היו תדלוקים שלא תיעדתי מאז הרשומה הקודמת"
            />
          </div>
          {continuityBreak ? (
            <p className="pt-2.5 text-[12.5px] leading-relaxed text-muted">
              מתחיל תקופת חישוב חדשה. הרשומות הישנות נשמרות — פשוט לא יחושב שום נתון
              שחוצה את הנקודה הזו.
            </p>
          ) : null}
        </Card>

        <Eyebrow>הערה</Eyebrow>
        <Card className="p-4">
          <input
            aria-label="הערה"
            dir="rtl"
            value={notes}
            maxLength={500}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="לא חובה"
            className="min-h-[52px] w-full rounded-[14px] border border-line bg-bg px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
          />
          {showErrors && errorFor("notes") ? (
            <span className="block pt-2 text-[12.5px] font-semibold text-danger">{errorFor("notes")}</span>
          ) : null}
        </Card>

        {showErrors && errorFor("station") ? (
          <SoftWarningBanner message={errorFor("station")} />
        ) : null}

        {warnings.length > 0 ? (
          <InfoStrip>
            אזהרות רכות לא חוסמות שמירה — הרשומה תסומן כחריגה בהיסטוריה עד שתאושר.
          </InfoStrip>
        ) : null}

        {operation ? (
          <button
            type="button"
            onClick={() => {
              discardOperation(operation.opId);
              navigate("/settings/unsynced", { replace: true });
            }}
            className="min-h-[44px] text-[13px] font-semibold text-danger"
          >
            מחיקת הרשומה שלא סונכרנה
          </button>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-line bg-[color-mix(in_srgb,var(--surface)_95%,transparent)] p-4 pb-safe backdrop-blur-xl">
        <Button full onClick={save} disabled={!canSave} loading={saving}>
          {operation ? "שמירה ושליחה מחדש" : isEdit ? "שמירת שינויים" : "שמירת תדלוק"}
        </Button>
        <p
          className={`flex items-center justify-center gap-1.5 pt-2 text-center text-[12.5px] ${
            blockMessage || (fieldErrors.length > 0 && showErrors) ? "text-danger-ink" : "text-muted"
          }`}
        >
          {fieldErrors.length > 0 && showErrors ? <WarningIcon size={13} /> : null}
          {saveHint}
        </p>
      </div>

      <StationSheet
        fuelType={activeVehicle?.fuelType ?? "95"}
        kmPerLiter={vehicleStats.avgKmPerLiter}
        litersToBuy={Number.isFinite(litersValue) && litersValue > 0 ? litersValue : 40}
        prices={prices}
        open={stationSheetOpen}
        onClose={() => setStationSheetOpen(false)}
        stations={pastStations}
        lastPaid={lastPaidByStation}
        nearby={geo.nearby}
        geoStatus={geo.status}
        onLocate={() => void detectStation(true)}
        current={station}
        onPick={(next) => {
          setStation(next);
          setStationAuto(false);
          setStationSheetOpen(false);
        }}
      />

      <DateSheet
        open={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        value={date}
        bounds={bounds}
        onChange={(next) => {
          // A date change re-resolves the SUGGESTED price only; a price the
          // user typed for this fill-up is theirs and stays.
          setDate(next);
          setDateConfirmed(true);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="למחוק את התדלוק?"
        body="הרשומה תוסר והצריכה תחושב מחדש אוטומטית. אפשר לשחזר מיד לאחר המחיקה."
        confirmLabel="מחיקה"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </main>
  );
}

/* ---------------- station picker ---------------- */

function StationSheet({
  fuelType,
  kmPerLiter,
  litersToBuy,
  prices,
  open,
  onClose,
  stations,
  lastPaid,
  nearby,
  geoStatus,
  onLocate,
  current,
  onPick,
}: {
  /** The ACTIVE vehicle's fuel type. Every price shown is for this and only this. */
  fuelType: FuelType;
  /** Measured consumption, for the best-value ranking. Null until one exists. */
  kmPerLiter: number | null;
  litersToBuy: number;
  prices: FuelPrices | null;
  open: boolean;
  onClose: () => void;
  stations: Station[];
  /** Station id or name → the price this user last paid there. */
  lastPaid: Map<string, { price: number; observedAt: number }>;
  nearby: GeoResult["nearby"];
  geoStatus: GeoResult["status"];
  onLocate: () => void;
  current: Station | null;
  onPick: (station: Station | null) => void;
}) {
  const regulated = useMemo(() => adaptLegacyConfig(prices), [prices]);

  /**
   * The price to show on a station row, for THIS vehicle's fuel type.
   *
   * Everything goes through the one resolver, so a diesel vehicle can never be
   * shown a 95 figure. What the ROW shows is then decided by `stationPriceView`,
   * which deliberately drops the regulated ceiling: it is the same nationwide
   * number on every station and repeating it down the list said nothing about
   * any of them.
   */
  const resolveFor = useCallback(
    (stationId: string | null) => resolveStationPrice({ stationId, fuelType, regulated }),
    [fuelType, regulated],
  );

  const viewFor = useCallback(
    (stationId: string | null, name?: string | null) =>
      stationPriceView(
        resolveFor(stationId),
        (stationId ? lastPaid.get(stationId) : null) ??
          (name ? lastPaid.get(name.trim()) : null) ??
          null,
      ),
    [resolveFor, lastPaid],
  );

  const [sort, setSort] = useState<StationSort>("nearest");

  /**
   * Nearby stations, ordered.
   *
   * Every price is resolved for the ACTIVE vehicle's fuel type before ranking,
   * so no order can end up comparing diesel against petrol.
   */
  const nearbyCandidates: StationCandidate[] = useMemo(
    () =>
      nearby.map((entry) => ({
        station: entry,
        distanceMeters: entry.distance,
        price: resolveFor(entry.i ?? null),
      })),
    [nearby, resolveFor],
  );

  const blocker = useMemo(
    () => bestValueBlocker(nearbyCandidates, { fuelType, kmPerLiter, litersToBuy }),
    [nearbyCandidates, fuelType, kmPerLiter, litersToBuy],
  );

  const rankedNearby = useMemo(
    () =>
      rankStations(nearbyCandidates, sort === "bestValue" && blocker ? "nearest" : sort, {
        fuelType,
        kmPerLiter,
        litersToBuy,
      }),
    [nearbyCandidates, sort, blocker, fuelType, kmPerLiter, litersToBuy],
  );
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadStationCatalog>>>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    void loadStationCatalog().then(setCatalog);
  }, [open]);

  const matches = useMemo(
    () => searchStations(catalog, query),
    [catalog, query],
  );

  const trimmed = query.trim();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">תחנת דלק</h2>}
    >
      <div className="flex max-h-[64vh] flex-col gap-3">
        <div className="flex min-h-[48px] items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5">
          <SearchIcon size={17} className="text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש תחנה…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>

        <div className="no-scrollbar flex flex-col overflow-y-auto">
          {trimmed.length >= 2 ? (
            matches.length > 0 ? (
              matches.map((entry) => (
                <StationRow
                  key={`${entry.n}-${entry.lat}`}
                  label={entry.n}
                  meta={entry.a ?? undefined}
                  brand={entry.c}
                  view={viewFor(entry.i ?? null, entry.n)}
                  selected={current?.name === entry.n}
                  onClick={() => onPick(toStation(entry))}
                />
              ))
            ) : (
              <div className="flex flex-col gap-2 py-5">
                <p className="text-center text-[13.5px] text-muted">
                  לא נמצאה תחנה בשם הזה
                </p>
                <button
                  type="button"
                  onClick={() => onPick({ name: trimmed })}
                  className="min-h-[46px] rounded-pill bg-surface-2 text-[14px] font-semibold text-accent"
                >
                  שמירה בשם „{trimmed}״
                </button>
              </div>
            )
          ) : (
            <>
              {/* Nearby first — it is almost always what the user wants. */}
              <SheetGroupLabel>
                בקרבתי
                {geoStatus === "locating" ? " · מאתר…" : ""}
              </SheetGroupLabel>

              {geoStatus === "denied" || geoStatus === "unavailable" ? (
                <button
                  type="button"
                  onClick={onLocate}
                  className="mb-1 min-h-[46px] rounded-[14px] bg-surface-2 text-[13.5px] font-semibold text-accent"
                >
                  {geoStatus === "denied"
                    ? "הרשאת מיקום נדחתה — נסו שוב"
                    : "איתור מיקום אינו זמין — נסו שוב"}
                </button>
              ) : geoStatus === "none" ? (
                <p className="px-2 py-3 text-[13px] text-muted">
                  לא נמצאה תחנה במרחק של 400 מ׳ מכאן.
                </p>
              ) : nearby.length === 0 && geoStatus !== "locating" ? (
                <button
                  type="button"
                  onClick={onLocate}
                  className="mb-1 min-h-[46px] rounded-[14px] bg-surface-2 text-[13.5px] font-semibold text-accent"
                >
                  איתור תחנות בקרבת מקום
                </button>
              ) : (
                <>
                  {/* One control, not a four-pill rail that spilled sideways
                      over the first result on a 360px screen. */}
                  <SortControl value={sort} onChange={setSort} />

                  {sort === "bestValue" && blocker ? (
                    <p className="pb-2 text-[12px] leading-relaxed text-muted">
                      {BEST_VALUE_UNAVAILABLE[blocker]} מוצג לפי מרחק בינתיים.
                    </p>
                  ) : null}

                  {rankedNearby.map((entry) => (
                    <StationRow
                      key={`near-${entry.station.n}-${entry.station.lat}`}
                      label={entry.station.n}
                      meta={
                        entry.distanceMeters !== null
                          ? formatDistance(entry.distanceMeters)
                          : undefined
                      }
                      brand={entry.station.c}
                      view={viewFor(entry.station.i ?? null, entry.station.n)}
                      selected={current?.name === entry.station.n}
                      onClick={() => onPick(toStation(entry.station))}
                    />
                  ))}
                </>
              )}

              {stations.length > 0 ? (
                <>
                  <SheetGroupLabel>תחנות שתדלקתי בהן</SheetGroupLabel>
                  {stations.map((entry) => (
                    <StationRow
                      key={`past-${entry.name}`}
                      label={entry.name}
                      brand={entry.brand}
                      view={viewFor(entry.stationId ?? null, entry.name)}
                      selected={current?.name === entry.name}
                      onClick={() => onPick(entry)}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onPick(null)}
          className="min-h-[48px] flex-none rounded-pill bg-surface-2 text-[14.5px] font-semibold text-muted transition-[background-color,scale] duration-200 active:scale-[0.97]"
        >
          ללא מיקום
        </button>
      </div>
    </Sheet>
  );
}

function SheetGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1 pb-1 pt-2 text-[12px] font-semibold tracking-[0.02em] text-muted">
      {children}
    </span>
  );
}

/**
 * One compact sort control.
 *
 * The four pills it replaces were laid out in a horizontally scrolling rail
 * that, at 360px, ran under the first station row and looked like part of it.
 */
function SortControl({
  value,
  onChange,
}: {
  value: StationSort;
  onChange: (value: StationSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const options: StationSort[] = ["nearest", "cheapest", "freshest", "bestValue"];

  return (
    <div className="flex flex-col pb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[34px] w-fit items-center gap-1 rounded-pill bg-surface-2 px-3 text-[12.5px] font-semibold text-ink"
      >
        מיון: {SORT_LABELS[value]}
        <ChevronDown size={14} className="text-muted" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="מיון תחנות"
          className="mt-1.5 flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={value === option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex min-h-[42px] items-center justify-between px-3.5 text-[13.5px] transition-[background-color] duration-150 active:bg-surface-2 ${
                value === option ? "font-bold text-accent" : "text-ink"
              }`}
            >
              {SORT_LABELS[option]}
              {value === option ? <CheckIcon size={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StationRow({
  label,
  meta,
  brand,
  view,
  selected,
  onClick,
}: {
  label: string;
  meta?: string;
  /** Company from the register, for the brand badge. */
  brand?: string | null;
  /**
   * What to show for the price, already decided for the active vehicle's fuel
   * type — see `stationPriceView` for which figure wins.
   */
  view: StationPriceView;
  selected: boolean;
  onClick: () => void;
}) {
  // A figure someone actually observed at this station is the only one worth
  // colouring; the nationwide ceiling stays quiet so it cannot be mistaken
  // for one.
  const known = view.kind === "station" || view.kind === "personal";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[54px] items-center gap-3 border-b border-line px-2 py-2 text-start transition-[background-color] duration-150 last:border-b-0 active:bg-surface-2"
    >
      <StationBrandMark brand={brand} name={label} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{label}</span>
        {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
      </span>

      {view.text ? (
        <span className="flex flex-none flex-col items-end gap-0.5">
          <Num
            className={`text-[14.5px] font-bold ${
              view.stale ? "text-muted" : known ? "text-success-ink" : "text-ink"
            }`}
          >
            {view.text}
          </Num>
          {/* Three words at most: what kind of figure this is. */}
          <span
            className={`text-[10.5px] ${view.stale ? "text-warning-ink" : "text-muted"}`}
          >
            {view.stale ? `${view.detail} · ישן` : view.detail}
          </span>
        </span>
      ) : (
        <span className="flex-none text-[10.5px] text-muted">{view.detail}</span>
      )}

      {selected ? <CheckIcon size={18} className="flex-none text-accent" /> : null}
    </button>
  );
}

function DateSheet({
  open,
  onClose,
  value,
  bounds,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: number;
  bounds: ReturnType<typeof odometerBounds>;
  onChange: (value: number) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">תאריך ושעה</h2>}
    >
      <div className="flex flex-col gap-3">
        <DateTimePicker value={value} onChange={onChange} maxDate={Date.now()} />

        {bounds.min !== null || bounds.max !== null ? (
          <InfoStrip>
            טווח קילומטראז׳ מותר לתאריך זה:{" "}
            <Num>
              {bounds.min !== null ? num(bounds.min, 0) : "—"} –{" "}
              {bounds.max !== null ? num(bounds.max, 0) : "∞"}
            </Num>
          </InfoStrip>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(Date.now())}
            className="min-h-[46px] flex-1 rounded-pill bg-surface-2 text-[14px] font-semibold text-ink transition-[background-color,scale] duration-200 active:scale-[0.97]"
          >
            עכשיו
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[46px] flex-1 rounded-pill bg-accent text-[14px] font-bold text-accent-contrast transition-[filter,scale] duration-200 active:scale-[0.97] active:brightness-[0.97]"
          >
            אישור
          </button>
        </div>
      </div>
    </Sheet>
  );
}


function DraftExplanation({
  evaluation,
}: {
  evaluation: NonNullable<ReturnType<typeof evaluateDraft>>;
}) {
  const { settings } = useData();

  if (evaluation.outcome === "closedSegment" && evaluation.segment) {
    return (
      <span className="rounded-[11px] bg-success-soft px-3 py-2 text-[12.5px] leading-relaxed text-success-ink">
        סוגר מקטע צריכה:{" "}
        <ConsumptionValue
          kmPerLiter={evaluation.segment.kmPerLiter}
          units={settings.units}
          className="font-semibold"
        />
      </span>
    );
  }

  if (evaluation.outcome === "baseline") {
    return (
      <span className="rounded-[11px] bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
        {evaluation.startsNewPeriod
          ? "יוצר נקודת התחלה לתקופה החדשה. הצריכה תחושב בתדלוק הבא."
          : "יוצר נקודת התחלה. הצריכה תחושב בתדלוק הבא."}
      </span>
    );
  }

  if (evaluation.outcome === "partialNoBaseline") {
    return (
      <span className="rounded-[11px] bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
        עדיין אין נקודת התחלה, אז התדלוק הזה לא ייכנס לחישוב.
      </span>
    );
  }

  if (evaluation.outcome === "unknownRetained") {
    return (
      <span className="rounded-[11px] bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
        הצריכה לא תחושב מהתדלוק הזה — לא צוין אם המיכל התמלא. סימון{" "}
        <b className="text-ink">מילאתי מיכל מלא</b> במצב המיכל מספיק כדי לחשב אותה.
      </span>
    );
  }

  return (
    <span className="rounded-[11px] bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
      הליטרים ייכללו בחישוב בתדלוק הבא · במקטע הפתוח יהיו{" "}
      <Quantity value={evaluation.openSegment.liters} digits={1} className="font-semibold" />
    </span>
  );
}

/** Post-save toast copy, decided by the engine rather than by this screen. */
function savedMessage(
  evaluation: ReturnType<typeof evaluateDraft>,
  units: "kmPerLiter" | "litersPer100",
): { title: string; detail: string } {
  const undo = "אפשר לבטל תוך 5 שניות";

  if (evaluation.outcome === "closedSegment" && evaluation.segment) {
    const kmPerLiter = evaluation.segment.kmPerLiter;
    const value =
      units === "kmPerLiter"
        ? `${kmPerLiter.toLocaleString("he-IL", { maximumFractionDigits: 1 })} קמ״ל`
        : `${(100 / kmPerLiter).toLocaleString("he-IL", { maximumFractionDigits: 1 })} ל׳/100 ק״מ`;
    return { title: `נשמר · ${value} מאז התדלוק הקודם`, detail: undo };
  }

  if (evaluation.outcome === "baseline") {
    return {
      title: evaluation.startsNewPeriod
        ? "התחילה תקופת חישוב חדשה. הצריכה תחושב בתדלוק הבא."
        : "נקודת התחלה נוצרה. הצריכה תחושב בתדלוק הבא.",
      detail: undo,
    };
  }

  if (evaluation.outcome === "partialNoBaseline") {
    return {
      title: "התדלוק נשמר. עדיין אין נקודת התחלה לחישוב.",
      detail: undo,
    };
  }

  if (evaluation.outcome === "unknownRetained") {
    return {
      title: "התדלוק נשמר. הצריכה תחושב כשיסומן תדלוק מיכל מלא.",
      detail: undo,
    };
  }

  const liters = evaluation.openSegment.liters.toLocaleString("he-IL", {
    maximumFractionDigits: 1,
  });
  return {
    title: "התדלוק נשמר. הליטרים ייכללו בחישוב בתדלוק הבא.",
    detail: `נשמרו ${liters} ל׳ במקטע הפתוח · ${undo}`,
  };
}


/** Answers to "was this also the price on the pump?". */
type PumpAnswer = "unanswered" | "same" | "discount" | "different" | "unknown";

/**
 * Only a confirmed pump price is eligible to become public.
 *
 * "לא יודע" and no answer both yield null. A discount yields null too — the
 * paid price is then explicitly NOT the station's price, which is exactly the
 * distinction the question exists to draw.
 */
function resolvePostedPrice(
  answer: PumpAnswer,
  paid: number,
  typed: string,
): number | null {
  if (answer === "same") return Number.isFinite(paid) && paid > 0 ? paid : null;
  if (answer === "different") {
    const value = parseNumberInput(typed, "price").value;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

/**
 * One low-friction question, asked only when a station is named — there is no
 * point asking about the pump price at a station we cannot identify.
 *
 * Answering is optional. Skipping it simply means nothing is contributed.
 */
function PumpPriceQuestion({
  paid,
  answer,
  onAnswer,
  pumpPrice,
  onPumpPrice,
}: {
  paid: number;
  answer: PumpAnswer;
  onAnswer: (value: PumpAnswer) => void;
  pumpPrice: string;
  onPumpPrice: (value: string) => void;
}) {
  const options: { value: PumpAnswer; label: string }[] = [
    { value: "same", label: "כן" },
    { value: "discount", label: "לא, הייתה לי הנחה" },
    { value: "different", label: "מחיר המשאבה היה אחר" },
    { value: "unknown", label: "לא יודע" },
  ];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-ink">
          האם זה גם המחיר שהופיע במשאבה?
        </span>
        <span className="text-[12.5px] leading-relaxed text-muted">
          שילמתם <Num>{price(paid)}</Num> לליטר. התשובה עוזרת לנו לדעת מה המחיר
          הציבורי בתחנה — המחיר שלכם לא מתפרסם בלי אישור.
        </span>
      </span>

      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={answer === option.value}
            onClick={() => onAnswer(answer === option.value ? "unanswered" : option.value)}
            className={`min-h-[36px] rounded-pill px-3 text-[13px] font-semibold transition-[background-color,color] duration-200 ${
              answer === option.value
                ? "bg-accent text-accent-contrast"
                : "bg-surface-2 text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {answer === "different" ? (
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13.5px] text-ink">מה היה המחיר במשאבה?</span>
          <input
            dir="ltr"
            inputMode="decimal"
            aria-label="מחיר המשאבה"
            value={pumpPrice}
            onChange={(event) => onPumpPrice(event.target.value)}
            className="num min-h-[44px] w-[88px] flex-none rounded-[11px] border border-line bg-surface px-2 text-center text-[16px] font-bold text-ink outline-none focus:border-accent"
          />
        </label>
      ) : null}

      {answer === "discount" ? (
        <span className="text-[12.5px] leading-relaxed text-muted">
          נשמר כמחיר ששילמתם בלבד. הוא לא ידווח כמחיר התחנה.
        </span>
      ) : null}
    </Card>
  );
}

/** Small section label above each group, as in the form's design. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-0.5 pt-3 text-[11.5px] font-bold tracking-[0.01em] text-muted">
      {children}
    </p>
  );
}

/** One cell of the receipt's bottom row. */
function ReceiptCell({
  label,
  divided = false,
  children,
}: {
  label: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={divided ? "border-e border-hero-line pe-2.5 ps-2.5" : "pe-2.5 ps-2.5"}
    >
      <div className="text-[11px] font-semibold text-hero-muted">{label}</div>
      <div className="mt-[3px] text-[15px] font-bold">{children}</div>
    </div>
  );
}
