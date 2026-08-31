import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import {
  hardBlock,
  odometerBounds,
  resolvePricePerLiter,
  softWarnings,
  type Fillup,
} from "../lib/stats";
import {
  consumption,
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
import type { Station } from "../lib/types";
import { Button } from "../components/Button";
import { Field, InfoStrip, SoftWarningBanner } from "../components/Field";
import { Card, Label, IconTile } from "../components/Card";
import { Toggle } from "../components/Segmented";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { DateTimePicker } from "../components/DateTimePicker";
import { ScreenHeader } from "../components/AppHeader";
import {
  CalendarIcon,
  CheckIcon,
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
  const [isFullTank, setIsFullTank] = useState(editing?.isFullTank ?? true);
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
      { date, odometer: odometerValue, liters: litersValue, pricePerLiter: priceValue },
      others,
      activeVehicle,
    );
  }, [odometer, liters, date, odometerValue, litersValue, priceValue, others, activeVehicle]);

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
        // The consumption this fill-up closes is only known after it lands in
        // the list, so compute it against the previous full tank here.
        const { prev } = odometerBounds(others, date);
        const kmPerLiter =
          prev && odometerValue > prev.odometer && litersValue > 0
            ? (odometerValue - prev.odometer) / litersValue
            : null;
        const formatted = consumption(kmPerLiter, settings.units);

        showToast({
          tone: "success",
          title: kmPerLiter
            ? `נשמר · ${formatted.value} ${formatted.unit} מאז התדלוק הקודם`
            : "התדלוק נשמר",
          detail: "אפשר לבטל תוך 5 שניות",
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
              <span className="text-[12px] text-muted">
                {resolved.source === "manual"
                  ? "מחיר ידני מהגדרות הרכב"
                  : resolved.source === "none"
                    ? "לא נמצא מחיר רשמי — הזינו ידנית"
                    : resolved.fromHistory
                      ? `${resolved.source === "adjusted" ? "מחיר רשמי + התאמה · " : "מחיר רשמי · "}${heMonthName(new Date(date).getMonth() + 1)}`
                      : resolved.source === "adjusted"
                        ? "מחיר רשמי אחרון + התאמה אישית"
                        : "המחיר הרשמי האחרון הידוע"}
              </span>
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

        {/* Full tank toggle — drives the whole segment model. */}
        <Card className="flex items-center gap-3 p-4">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-ink">מיכל מלא</span>
            <span className="text-[12.5px] leading-relaxed text-muted">
              כבו עבור תדלוק חלקי — הצריכה תחושב בתדלוק המלא הבא
            </span>
          </span>
          <Toggle checked={isFullTank} onChange={setIsFullTank} ariaLabel="מיכל מלא" />
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
        open={stationSheetOpen}
        onClose={() => setStationSheetOpen(false)}
        stations={pastStations}
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
  open,
  onClose,
  stations,
  nearby,
  geoStatus,
  onLocate,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  stations: Station[];
  nearby: GeoResult["nearby"];
  geoStatus: GeoResult["status"];
  onLocate: () => void;
  current: Station | null;
  onPick: (station: Station | null) => void;
}) {
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
            placeholder="חיפוש מתוך 1,250 תחנות…"
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
                nearby.map((entry) => (
                  <StationRow
                    key={`near-${entry.n}-${entry.lat}`}
                    label={entry.n}
                    meta={`${formatDistance(entry.distance)}${entry.a ? ` · ${entry.a}` : ""}`}
                    selected={current?.name === entry.n}
                    onClick={() => onPick(toStation(entry))}
                  />
                ))
              )}

              {stations.length > 0 ? (
                <>
                  <SheetGroupLabel>תחנות שתדלקתי בהן</SheetGroupLabel>
                  {stations.map((entry) => (
                    <StationRow
                      key={`past-${entry.name}`}
                      label={entry.name}
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

function StationRow({
  label,
  meta,
  selected,
  onClick,
}: {
  label: string;
  meta?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[54px] items-center gap-3 border-b border-line px-2 text-start transition-[background-color] duration-150 last:border-b-0 active:bg-surface-2"
    >
      <PinIcon size={17} className="flex-none text-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{label}</span>
        {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
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
