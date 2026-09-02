import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import {
  FUEL_TYPE_SHORT,
  heMonthName,
  num,
  parseDecimal,
  price,
  relativeDate,
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
import { Button } from "../components/Button";
import { Field, InfoStrip, SoftWarningBanner } from "../components/Field";
import { Card, Label, IconTile } from "../components/Card";
import { Toggle } from "../components/Segmented";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { ConsumptionValue, Quantity } from "../components/Fmt";
import { DateTimePicker } from "../components/DateTimePicker";
import { ScreenHeader } from "../components/AppHeader";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDown,
  ChevronStart,
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
   * Full tank at the END of this fill-up.
   *
   * Not a question any more. Practically every manual entry is a full fill-up,
   * and the toggle plus its paragraph cost more attention than the rare
   * partial saved. New records are full; an EXISTING record keeps exactly what
   * it was stored with — an imported partial must not be silently promoted to
   * a full tank just because the screen no longer shows the switch.
   */
  const isFullTank = editing ? editing.isFullTank : true;
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
    continuityBreak,
    others,
    editing,
  ]);

  const isBackdated = date < Date.now() - 12 * 3600_000;

  const canSave =
    Number.isFinite(odometerValue) &&
    odometerValue > 0 &&
    Number.isFinite(litersValue) &&
    litersValue > 0 &&
    Number.isFinite(priceValue) &&
    priceValue > 0 &&
    !blockMessage &&
    !saving;

  /* ---------- save ---------- */

  async function save() {
    if (!canSave || !activeVehicle) return;
    setSaving(true);

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
      fullTankSource: editing?.fullTankSource ?? ("user" as const),
      continuityBreakBefore: continuityBreak,
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

        showToast({
          tone: "success",
          title,
          detail,
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
      <ScreenHeader
        title={isEdit ? "עריכת תדלוק" : "תדלוק חדש"}
        onBack={() => navigate(-1)}
        trailing={
          isEdit ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="מחיקת רשומה"
              className="flex size-[38px] items-center justify-center rounded-full text-danger"
            >
              <TrashIcon size={19} />
            </button>
          ) : (
            <span className="truncate rounded-pill bg-surface-2 px-[11px] py-1.5 text-[12.5px] font-semibold text-muted">
              {vehicleShort(activeVehicle)}
            </span>
          )
        }
      />

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 pb-40">
        {/* Pre-filled context: date, station, price. */}
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

        {/* What this entry will do to the calculation. One line, from the
            engine itself — not a description of a control that no longer
            exists. */}
        {draftEvaluation ? <DraftExplanation evaluation={draftEvaluation} /> : null}

        {/* Missing history. Never inferred from elapsed time or distance — a
            month without refuelling is a real thing, not evidence of a gap. */}
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-ink">
                היו תדלוקים שלא תיעדתי מאז הרשומה הקודמת
              </span>
              <span className="text-[12.5px] leading-relaxed text-muted">
                {continuityBreak
                  ? "מתחיל תקופת חישוב חדשה. הרשומות הישנות נשמרות — פשוט לא יחושב שום נתון שחוצה את הנקודה הזו."
                  : "סמנו רק אם באמת תדלקתם בלי לתעד. אחרת השאירו כבוי."}
              </span>
            </span>
            <Toggle
              checked={continuityBreak}
              onChange={setContinuityBreak}
              ariaLabel="היו תדלוקים שלא תיעדתי מאז הרשומה הקודמת"
            />
          </div>
        </Card>

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

        <Card className="flex flex-col gap-3 p-4">
          <Label>כמות וסכום</Label>
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

        <Field
          label="הערה"
          dir="rtl"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="לא חובה"
        />

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
  view,
  selected,
  onClick,
}: {
  label: string;
  meta?: string;
  /**
   * What to show for the price, already decided for the active vehicle's fuel
   * type. A regulated ceiling never reaches this — see `stationPriceView`.
   */
  view: StationPriceView;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[54px] items-center gap-3 border-b border-line px-2 py-2 text-start transition-[background-color] duration-150 last:border-b-0 active:bg-surface-2"
    >
      <PinIcon size={17} className="flex-none text-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{label}</span>
        {/* One short metadata line. Distance, then the price when there is a
            real one — never a nationwide ceiling dressed as this station's. */}
        <span className="truncate text-[12px] text-muted">
          {meta}
          {view.text ? (
            <>
              {meta ? " · " : ""}
              <Num className={`font-semibold ${view.stale ? "text-muted" : "text-ink"}`}>
                {view.text}
              </Num>
              {view.stale ? <span className="text-[11px] text-warning-ink"> · ישן</span> : null}
            </>
          ) : null}
        </span>
        {/* Provenance travels with the number, always. */}
        <span className="truncate text-[11.5px] text-muted/80">{view.detail}</span>
      </span>
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
          ? "יוצר נקודת התחלה לתקופה החדשה. הצריכה תחושב במילוי הבא עד מלא."
          : "יוצר נקודת התחלה. הצריכה תחושב במילוי הבא עד מלא."}
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

  return (
    <span className="rounded-[11px] bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
      הליטרים ייכללו בחישוב במילוי הבא עד מלא · במקטע הפתוח יהיו{" "}
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
    return { title: `נשמר · ${value} מאז המילוי הקודם עד מלא`, detail: undo };
  }

  if (evaluation.outcome === "baseline") {
    return {
      title: evaluation.startsNewPeriod
        ? "התחילה תקופת חישוב חדשה. הצריכה תחושב במילוי הבא עד מלא."
        : "נקודת התחלה נוצרה. הצריכה תחושב במילוי הבא עד מלא.",
      detail: undo,
    };
  }

  if (evaluation.outcome === "partialNoBaseline") {
    return {
      title: "התדלוק נשמר. עדיין אין נקודת התחלה לחישוב.",
      detail: undo,
    };
  }

  const liters = evaluation.openSegment.liters.toLocaleString("he-IL", {
    maximumFractionDigits: 1,
  });
  return {
    title: "התדלוק נשמר. הליטרים ייכללו בחישוב במילוי הבא עד מלא.",
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
