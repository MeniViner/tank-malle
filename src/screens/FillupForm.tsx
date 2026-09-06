import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { useStats } from "../hooks/useStats";
import {
  evaluateDraft,
  hardBlock,
  isTankCapacityTrusted,
  odometerBounds,
  resolvePricePerLiter,
  softWarnings,
  type Fillup,
} from "../lib/stats";
import {
  FUEL_TYPE_SHORT,
  heMonthName,
  num,
  parseDecimal,
  price,
  relativeDate,
  shekel,
  time,
  timeAgo,
  vehicleShort,
} from "../lib/format";
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
import type { FillEndState, FillEndStateSource, LevelSource } from "../lib/tank/types";
import { GAUGE_SD_BY_SOURCE } from "../lib/tank/config";
import { TankStateSection } from "../components/TankStateSection";
import {
  EMPTY_TANK_DRAFT,
  hasTankAnswer,
  type TankStateDraft,
} from "../lib/tank/draft";
import { Button } from "../components/Button";
import { Field, InfoStrip, SoftWarningBanner } from "../components/Field";
import { Card, Label, IconTile } from "../components/Card";
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
} from "../components/icons";

/**
 * Add / edit fill-up (designs 10–13).
 *
 * Opens fully pre-filled: date = now, price from the price chain, station from
 * geolocation, full tank on. The user normally types only odometer and liters.
 * Every pre-filled value stays editable — auto-fill is a starting point, never
 * a lock.
 */
export function FillupForm() {
  const navigate = useNavigate();
  const { fillupId } = useParams();
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
  } = useData();

  // Whole-history statistics for this vehicle, used only for the best-value
  // station ranking — which needs a real measured consumption or nothing.
  const vehicleStats = useStats();

  const editing = fillupId ? fillups.find((f) => f.id === fillupId) ?? null : null;
  const isEdit = Boolean(fillupId);

  const [date, setDate] = useState<number>(() => editing?.date ?? Date.now());
  const [odometer, setOdometer] = useState(() =>
    editing ? String(editing.odometer) : "",
  );
  const [liters, setLiters] = useState(() => (editing ? String(editing.liters) : ""));
  const [total, setTotal] = useState(() =>
    editing ? String(Math.round(editing.totalCost * 100) / 100) : "",
  );
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  /**
   * Optional tank state.
   *
   * An existing record is loaded back only when it was written by THIS UI —
   * a legacy document's `isFullTank` is an assumption nobody made, and
   * pre-selecting "מילאתי עד מלא" from it would turn that assumption into a
   * confirmation the moment the record was opened.
   */
  const [tankDraft, setTankDraft] = useState<TankStateDraft>(() =>
    editing?.tankSchemaVersion === TANK_SCHEMA_VERSION
      ? {
          beforeLevel: editing.preFillLevel ?? null,
          afterLevelOverride:
            editing.postFillLevelSource === "user-correction"
              ? (editing.postFillLevel ?? null)
              : null,
          confirmedFull:
            editing.fillEndState === "full" &&
            editing.fillEndStateSource === "user-confirmed",
          reason: editing.refuelReason ?? null,
        }
      : EMPTY_TANK_DRAFT,
  );

  /**
   * True when this record's tank state is something the user actually stated.
   *
   * A legacy record that is merely opened and re-saved keeps its old fields
   * untouched; only an actual interaction moves it onto the new schema.
   */
  const tankTouched =
    !isEdit ||
    editing?.tankSchemaVersion === TANK_SCHEMA_VERSION ||
    hasTankAnswer(tankDraft);

  /**
   * End state of the tank, and what backs the claim.
   *
   * Only the explicit chip produces `full`. Everything else is `partial` when
   * the level is derivable and `unknown` when nobody said — which is a real
   * answer, and the one the old form could not express.
   */
  const tankState = resolveTankState(tankDraft);

  /**
   * `isFullTank`, the compatibility projection.
   *
   * An untouched legacy record keeps exactly what it was stored with, so an
   * imported partial is never promoted and an old full is never demoted.
   */
  const isFullTank = tankTouched ? tankState.endState === "full" : (editing?.isFullTank ?? false);
  const [continuityBreak, setContinuityBreak] = useState(
    editing?.continuityBreakBefore === true,
  );
  /**
   * Whether the price paid was also the price on the pump.
   *
   * Never assumed. totalCost / liters is what this person paid, which may
   * include a discount that is theirs and nobody else's — publishing it as the
   * station's posted price would both corrupt a shared figure and leak a
   * private arrangement.
   */
  const [pumpAnswer, setPumpAnswer] = useState<PumpAnswer>(
    editing?.postedPricePerLiter != null ? "same" : "unanswered",
  );
  const [pumpPrice, setPumpPrice] = useState(() =>
    editing?.postedPricePerLiter != null ? String(editing.postedPricePerLiter) : "",
  );
  const [station, setStation] = useState<Station | null>(editing?.station ?? null);
  const [stationAuto, setStationAuto] = useState(false);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const [stationSheetOpen, setStationSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fill-ups other than the one being edited — the basis for all validation.
  const others = useMemo(
    () => (editing ? fillups.filter((f) => f.id !== editing.id) : fillups),
    [fillups, editing],
  );

  /* ---------- price chain ---------- */

  const resolved = useMemo(
    () => resolvePricePerLiter(date, activeVehicle, prices),
    [date, activeVehicle, prices],
  );

  // Re-resolve when the date moves to another month, unless the user has
  // overridden the price for this specific fill-up.
  useEffect(() => {
    if (priceTouched) return;
    if (editing && pricePerLiter === "") {
      setPricePerLiter(String(editing.pricePerLiter));
      return;
    }
    if (!editing && resolved.price !== null) setPricePerLiter(String(resolved.price));
  }, [resolved.price, priceTouched, editing, pricePerLiter]);

  const priceValue = parseDecimal(pricePerLiter);

  /* ---------- geolocation → station suggestion ---------- */

  // Stations the user has actually used, most recent first. These win over a
  // catalog match at the same spot because they carry the name the user
  // recognises.
  const pastStations = useMemo(() => {
    const map = new Map<string, Station>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      const name = fillup.station?.name?.trim();
      if (name && !map.has(name)) map.set(name, fillup.station as Station);
    }
    return [...map.values()];
  }, [fillups]);

  /**
   * What this driver last paid at each station, keyed by station id AND by
   * name (legacy records carry no id). Their own receipt is real knowledge
   * about a station; the nationwide regulated ceiling is not.
   */
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

      // Prefer a previously used station within range — same place, familiar
      // name — and otherwise take the nearest one from the public register.
      const here = result.position;
      let bestPast: Station | null = null;
      let bestPastDistance = Number.POSITIVE_INFINITY;
      for (const candidate of pastStations) {
        if (candidate.lat === undefined || candidate.lng === undefined) continue;
        const distance = distanceMeters(
          { lat: candidate.lat, lng: candidate.lng },
          here,
        );
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
    if (isEdit || station) return;
    void detectStation();
  }, [isEdit, station, detectStation]);

  /* ---------- paired liters ⇄ total ---------- */

  function onLitersChange(value: string) {
    setLiters(value);
    const parsed = parseDecimal(value);
    if (Number.isFinite(parsed) && Number.isFinite(priceValue) && priceValue > 0) {
      setTotal((Math.round(parsed * priceValue * 100) / 100).toFixed(2));
    }
  }

  function onTotalChange(value: string) {
    setTotal(value);
    const parsed = parseDecimal(value);
    if (Number.isFinite(parsed) && Number.isFinite(priceValue) && priceValue > 0) {
      setLiters((Math.round((parsed / priceValue) * 100) / 100).toFixed(2));
    }
  }

  function onPriceChange(value: string) {
    setPricePerLiter(value);
    setPriceTouched(true);
    const parsedPrice = parseDecimal(value);
    const parsedLiters = parseDecimal(liters);
    if (Number.isFinite(parsedPrice) && parsedPrice > 0 && Number.isFinite(parsedLiters)) {
      setTotal((Math.round(parsedLiters * parsedPrice * 100) / 100).toFixed(2));
    }
  }

  /* ---------- validation ---------- */

  const odometerValue = parseDecimal(odometer);
  const litersValue = parseDecimal(liters);
  const totalValue = parseDecimal(total);

  const bounds = useMemo(() => odometerBounds(others, date), [others, date]);

  const blockMessage = useMemo(() => {
    if (!odometer) return null;
    return hardBlock({ date, odometer: odometerValue }, others);
  }, [odometer, odometerValue, date, others]);

  const warnings = useMemo(() => {
    if (!odometer || !liters) return [];
    return softWarnings(
      {
        date,
        odometer: odometerValue,
        liters: litersValue,
        pricePerLiter: priceValue,
        isFullTank,
        fillEndState: tankTouched ? tankState.endState : undefined,
        continuityBreakBefore: continuityBreak,
      },
      others,
      activeVehicle,
    );
  }, [
    odometer,
    liters,
    date,
    odometerValue,
    litersValue,
    priceValue,
    isFullTank,
    tankTouched,
    tankState.endState,
    continuityBreak,
    others,
    activeVehicle,
  ]);

  /**
   * What this draft will actually do, from the central engine — the same one
   * that produces every other consumption number in the app. Drives both the
   * live explanation under the toggle and the post-save message.
   */
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
        fillEndState: tankTouched ? tankState.endState : undefined,
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
    tankState.endState,
    continuityBreak,
    others,
    editing,
  ]);

  /**
   * Capacity, but only when it is one the user confirmed.
   *
   * A class-based guess must never reach the gauge: it would turn "about a
   * quarter" into a confident litre figure derived from a number nobody checked.
   */
  const trustedCapacity = isTankCapacityTrusted(activeVehicle)
    ? (activeVehicle?.tankLiters ?? null)
    : null;

  const isBackdated = date < Date.now() - 12 * 3600_000;

  /** What the receipt shows: the typed total, else litres × price. */
  const totalDue = Number.isFinite(totalValue) && totalValue > 0
    ? totalValue
    : Number.isFinite(litersValue) && litersValue > 0 && Number.isFinite(priceValue)
      ? Math.round(litersValue * priceValue * 100) / 100
      : 0;

  const canSave =
    Number.isFinite(odometerValue) &&
    odometerValue > 0 &&
    Number.isFinite(litersValue) &&
    litersValue > 0 &&
    Number.isFinite(priceValue) &&
    priceValue > 0 &&
    !blockMessage &&
    !saving;

  /**
   * The line under the save button says what is ACTUALLY missing.
   *
   * "מלאו קילומטראז׳ וליטרים או סכום" was printed whatever the state, so it
   * asked for the field you had just filled and stayed on screen while the
   * real blocker — an odometer below the previous record — went unnamed.
   */
  const saveHint = useMemo(() => {
    if (blockMessage) return blockMessage;

    const missing: string[] = [];
    if (!(Number.isFinite(odometerValue) && odometerValue > 0)) missing.push("קילומטראז׳");
    if (!(Number.isFinite(litersValue) && litersValue > 0)) missing.push("ליטרים או סכום");
    if (!(Number.isFinite(priceValue) && priceValue > 0)) missing.push("מחיר לליטר");

    if (missing.length === 0) return "הכול מוכן — אפשר לשמור";
    if (missing.length === 1) return `מלאו ${missing[0]}`;
    return `מלאו ${missing.slice(0, -1).join(", ")} ו${missing[missing.length - 1]}`;
  }, [blockMessage, odometerValue, litersValue, priceValue]);

  /* ---------- save ---------- */

  async function save() {
    if (!canSave || !activeVehicle) return;
    setSaving(true);

    // Written only when the user actually interacted. An untouched legacy
    // record keeps its original fields and stays off the new schema.
    const tankFields = tankTouched
      ? buildTankFields(tankDraft, tankState, litersValue, trustedCapacity)
      : {};

    const payload = {
      date,
      odometer: odometerValue,
      liters: litersValue,
      pricePerLiter: priceValue,
      totalCost: Number.isFinite(totalValue)
        ? totalValue
        : Math.round(litersValue * priceValue * 100) / 100,
      isFullTank,
      // Provenance is preserved on an edit: a record imported under the legacy
      // full-tank assumption does not become a user statement by being opened.
      // On a NEW record "user" now requires an actual confirmation — the old
      // form stamped it on every save, which is what made the flag useless.
      fullTankSource: editing?.fullTankSource ??
        (tankDraft.confirmedFull ? ("user" as const) : ("legacy-assumption" as const)),
      continuityBreakBefore: continuityBreak,
      ...tankFields,
      // Only ever set from an explicit answer. "לא יודע" and no answer both
      // leave it null, so nothing unverified can reach a public aggregate.
      postedPricePerLiter: resolvePostedPrice(pumpAnswer, priceValue, pumpPrice),
      fuelType: activeVehicle.fuelType,
      station: station ?? null,
      notes: notes.trim() || null,
    };

    try {
      if (editing) {
        const previous: Fillup = { ...editing };
        await updateFillup(editing.id, payload);
        showToast({
          tone: "success",
          title: "התדלוק עודכן",
          undoLabel: "ביטול",
          onUndo: () => updateFillup(previous.id, previous),
        });
      } else {
        const newId = await addFillup(payload);
        // What this record did is decided by the central segment engine, not by
        // an approximation local to this screen. A partial fill-up never gets a
        // consumption headline, because it does not close a segment.
        const { title, detail } = savedMessage(
          evaluateDraft(
            { ...payload, continuityBreakBefore: continuityBreak },
            others,
          ),
          settings.units,
        );

        // One short, plain line — no coefficients, no confidence scores and no
        // claim that anything "learned" this from you.
        const tankSaved =
          tankTouched && (tankDraft.confirmedFull || tankDraft.beforeLevel !== null);

        showToast({
          tone: "success",
          title,
          detail: tankSaved ? `מצב המיכל נשמר — התחזית תשתפר · ${detail}` : detail,
          undoLabel: "ביטול",
          duration: 5000,
          onUndo: () => deleteFillup(newId),
        });
      }
      navigate("/", { replace: true });
    } catch {
      showToast({ tone: "error", title: "השמירה נכשלה", detail: "נסו שוב בעוד רגע" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    const snapshot: Fillup = { ...editing };
    setConfirmDelete(false);
    await deleteFillup(editing.id);
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

  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-bg pt-safe">
      {/* The title leads and the vehicle sits under it as a quiet tag, rather
          than a centred title with the car floating opposite it. */}
      <header className="flex flex-none items-start justify-between gap-3 px-5 pb-3 pt-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-[24px] font-bold leading-tight text-ink">
            {isEdit ? "עריכת תדלוק" : "תדלוק חדש"}
          </h1>
          <span className="flex w-fit max-w-full items-center gap-1.5 truncate rounded-pill border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted">
            <CarIcon size={13} />
            {vehicleShort(activeVehicle)}
          </span>
        </div>

        <div className="flex flex-none items-center gap-2">
          {isEdit ? (
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
        {/* A live receipt, on the same dark card the home screen uses. It adds
            up while you type, so the number you are about to be charged is on
            screen before you save it. */}
        <div className="mt-1 flex flex-col rounded-hero bg-hero p-[18px_20px_15px] text-hero-ink shadow-raised">
          <span className="text-[12.5px] text-hero-muted">סה״כ לתשלום</span>
          <span
            className={`mt-0.5 flex items-baseline gap-1.5 ${
              totalDue > 0 ? "" : "text-hero-muted"
            }`}
          >
            <Num className="text-[40px] font-bold leading-none tracking-[-0.02em]">
              {shekel(totalDue, 2)}
            </Num>
          </span>

          <div className="mt-4 grid grid-cols-3 border-t border-hero-line pt-3">
            <ReceiptCell label="ליטרים" divided>
              {Number.isFinite(litersValue) && litersValue > 0 ? (
                <Num>{num(litersValue, 1)}</Num>
              ) : (
                "—"
              )}
            </ReceiptCell>
            <ReceiptCell label="מחיר לליטר" divided>
              {Number.isFinite(priceValue) && priceValue > 0 ? (
                <Num>{price(priceValue)}</Num>
              ) : (
                "—"
              )}
            </ReceiptCell>
            {/* From the engine, never from (distance ÷ litres) on the spot:
                that ignores partials and open segments, and prints a four-digit
                "consumption" the moment an odometer is mistyped. */}
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

        {/* Pre-filled context: date, station, price. */}
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
                {relativeDate(date)} · <Num>{time(date)}</Num>
              </span>
            </span>
            {isBackdated ? (
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
              {/* What this number IS, stated every time. A legacy vehicle-wide
                  override used to set the price silently and permanently. */}
              <span className="text-[12px] text-muted">{priceSourceText(resolved, date)}</span>
            </span>
            <input
              dir="ltr"
              inputMode="decimal"
              aria-label="מחיר לליטר"
              value={pricePerLiter}
              onChange={(event) => onPriceChange(event.target.value)}
              className="num min-h-[44px] w-[88px] flex-none rounded-[11px] border border-line bg-surface px-2 text-center text-[16px] font-bold text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
            />
          </div>
        </Card>

        {station && Number.isFinite(priceValue) && priceValue > 0 ? (
          <PumpPriceQuestion
            paid={priceValue}
            answer={pumpAnswer}
            onAnswer={setPumpAnswer}
            pumpPrice={pumpPrice}
            onPumpPrice={setPumpPrice}
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
            error={blockMessage}
            hint={
              lastFillup ? (
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
              <SoftWarningBanner
                key={warning.field}
                message={warning.message}
                detail={warning.detail}
              />
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
                value={liters}
                onChange={(event) => onLitersChange(event.target.value)}
                placeholder="0"
              />
            </div>
            <div className="min-w-0 flex-1">
              <Field
                big
                label="סה״כ לתשלום"
                inputMode="decimal"
                value={total}
                onChange={(event) => onTotalChange(event.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <span className="text-[12.5px] text-muted">
            עדכון של שדה אחד מחשב את השני לפי{" "}
            <Num>{Number.isFinite(priceValue) ? price(priceValue) : "—"}</Num> לליטר
          </span>

          {warnings
            .filter((warning) => warning.field !== "odometer")
            .map((warning) => (
              <SoftWarningBanner
                key={warning.field}
                message={warning.message}
                detail={warning.detail}
              />
            ))}
        </Card>

        {/* Optional, collapsed, and skippable. The financial record saves
            whether or not anybody opens it.

            No eyebrow above it: the row already says "מצב המיכל", and a
            heading repeating the control underneath it says the same thing
            twice. */}
        <TankStateSection
          draft={tankDraft}
          onChange={setTankDraft}
          litersAdded={Number.isFinite(litersValue) ? litersValue : 0}
          capacityLiters={trustedCapacity}
          onReviewCapacity={() => navigate("/settings/vehicles")}
        />

        {/* What this entry will do to the calculation. One line, from the
            engine itself — not a description of a control that no longer
            exists. */}
        {draftEvaluation ? <DraftExplanation evaluation={draftEvaluation} /> : null}

        {/* Missing history. Never inferred from elapsed time or distance — a
            month without refuelling is a real thing, not evidence of a gap. */}
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
          {/* Off is the normal state and needs no paragraph; the consequence
              is worth spelling out only once it is actually on. */}
          {continuityBreak ? (
            <p className="pt-2.5 text-[12.5px] leading-relaxed text-muted">
              מתחיל תקופת חישוב חדשה. הרשומות הישנות נשמרות — פשוט לא יחושב שום נתון
              שחוצה את הנקודה הזו.
            </p>
          ) : null}
        </Card>

        <Eyebrow>הערה</Eyebrow>
        <Card className="p-4">
          {/* The eyebrow above is the label, so the field carries only an
              accessible name — a second visible "הערה" said it twice. */}
          <input
            aria-label="הערה"
            dir="rtl"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="לא חובה"
            className="min-h-[52px] w-full rounded-[14px] border border-line bg-bg px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]"
          />
        </Card>

        {warnings.length > 0 ? (
          <InfoStrip>
            אזהרות רכות לא חוסמות שמירה — הרשומה תסומן כחריגה בהיסטוריה עד שתאושר.
          </InfoStrip>
        ) : null}
      </div>

      {/* Primary action pinned to the thumb zone. */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-line bg-[color-mix(in_srgb,var(--surface)_95%,transparent)] p-4 pb-safe backdrop-blur-xl">
        <Button full onClick={save} disabled={!canSave} loading={saving}>
          {isEdit ? "שמירת שינויים" : "שמירת תדלוק"}
        </Button>
        <p
          className={`pt-2 text-center text-[12.5px] ${
            blockMessage ? "text-danger-ink" : "text-muted"
          }`}
        >
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
          setDate(next);
          setPriceTouched(false);
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


/**
 * Live explanation of what the current draft will produce, straight from the
 * segment engine. No consumption figure is ever shown for a draft that does
 * not close a segment.
 */
/**
 * What the tank draft actually claims.
 *
 * `full` requires the explicit chip and nothing else — a suggestion nobody
 * touched, or an after-level that happens to land on 100%, is not a
 * confirmation. `unknown` is a real answer and the one the previous form had
 * no way to express, so it stopped being able to tell "I filled up" from
 * "I did not say".
 */
function resolveTankState(draft: TankStateDraft): {
  endState: FillEndState;
  endStateSource: FillEndStateSource;
} {
  if (draft.confirmedFull) {
    return { endState: "full", endStateSource: "user-confirmed" };
  }
  if (draft.afterLevelOverride !== null) {
    return { endState: "partial", endStateSource: "user-confirmed" };
  }
  if (draft.beforeLevel !== null) {
    // The end state follows from a stated before-level plus the pump reading.
    return { endState: "partial", endStateSource: "gauge-estimate" };
  }
  return { endState: "unknown", endStateSource: "unknown" };
}

/**
 * The optional tank fields to store, with the uncertainty each source earns.
 *
 * A derived value is stored as derived. A direct reading keeps the resolution
 * of the control that produced it, which is coarse — someone dragging to "about
 * a quarter" has not measured 0.250000 of anything.
 */
function buildTankFields(
  draft: TankStateDraft,
  state: ReturnType<typeof resolveTankState>,
  litersAdded: number,
  capacityLiters: number | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    fillEndState: state.endState,
    fillEndStateSource: state.endStateSource,
    refuelReason: draft.reason,
    // The revision every derivation on this record was made against, so a
    // later capacity change cannot retroactively rewrite what was measured.
    capacityLitersAtEntry: capacityLiters,
    tankSchemaVersion: TANK_SCHEMA_VERSION,
    preFillLevel: null,
    preFillLevelSource: null,
    preFillLevelUncertainty: null,
    postFillLevel: null,
    postFillLevelSource: null,
    postFillLevelUncertainty: null,
  };

  if (draft.beforeLevel !== null) {
    fields.preFillLevel = draft.beforeLevel;
    fields.preFillLevelSource = "direct-gauge" satisfies LevelSource;
    fields.preFillLevelUncertainty = GAUGE_SD_BY_SOURCE["direct-gauge"];
  }

  if (draft.afterLevelOverride !== null) {
    // A correction the user made outranks the calculated value, and replaces
    // it — the calculated number is reproducible from the inputs, so keeping
    // a second copy of it would only be a way to disagree with itself later.
    fields.postFillLevel = draft.afterLevelOverride;
    fields.postFillLevelSource = "user-correction" satisfies LevelSource;
    fields.postFillLevelUncertainty = GAUGE_SD_BY_SOURCE["user-correction"];
  } else if (draft.beforeLevel !== null && capacityLiters && capacityLiters > 0) {
    fields.postFillLevel = Math.min(
      1,
      draft.beforeLevel + (Number.isFinite(litersAdded) ? litersAdded : 0) / capacityLiters,
    );
    fields.postFillLevelSource = "derived-after-partial" satisfies LevelSource;
    fields.postFillLevelUncertainty = GAUGE_SD_BY_SOURCE["derived-after-partial"];
  }

  return fields;
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
        <b className="text-ink">מילאתי עד מלא</b> במצב המיכל מספיק כדי לחשב אותה.
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
      title: "התדלוק נשמר. הצריכה תחושב כשיסומן תדלוק עד מלא.",
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


/**
 * Name the source of the suggested price.
 *
 * The regulated maximum applies to 95-octane self-service only, so a diesel or
 * 98 vehicle is told there is no official figure rather than being handed the
 * 95 one. A legacy vehicle-wide override is named as such every time it is
 * used, so it cannot go on quietly setting prices after being forgotten.
 */
function priceSourceText(
  resolved: ReturnType<typeof resolvePricePerLiter>,
  date: number,
): string {
  switch (resolved.source) {
    case "legacyManual":
      return "מחיר קבוע שהוגדר ברכב · ניתן לשינוי בהגדרות הרכב";
    case "unsupportedFuelType":
      return `אין מחיר מרבי מפוקח ל${FUEL_TYPE_SHORT[resolved.fuelType] ?? "סוג דלק זה"} — הזינו את המחיר ששילמתם`;
    case "none":
      return "לא הוזן מחיר מרבי מפוקח — הזינו את המחיר ששילמתם";
    case "legacyAdjusted":
      return resolved.fromHistory
        ? `מחיר מרבי מפוקח + התאמה קבועה · ${heMonthName(new Date(date).getMonth() + 1)}`
        : "מחיר מרבי מפוקח אחרון + התאמה קבועה";
    case "regulatedMax":
      return resolved.fromHistory
        ? `מחיר מרבי מפוקח לבנזין 95 · ${heMonthName(new Date(date).getMonth() + 1)}`
        : "המחיר המרבי המפוקח האחרון הידוע";
  }
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
    const value = parseDecimal(typed);
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
