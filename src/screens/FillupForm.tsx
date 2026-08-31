import { useEffect, useMemo, useRef, useState } from "react";
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
  toDateTimeLocal,
  vehicleShort,
} from "../lib/format";
import type { Station } from "../lib/types";
import { Button } from "../components/Button";
import { Field, InfoStrip, SoftWarningBanner } from "../components/Field";
import { Card, Label, IconTile } from "../components/Card";
import { Toggle } from "../components/Segmented";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import { Num } from "../components/Num";
import { ScreenHeader } from "../components/AppHeader";
import {
  CalendarIcon,
  CheckIcon,
  ChevronStart,
  PinIcon,
  TrashIcon,
} from "../components/icons";

/** Suggest a past station when the device is within this radius. */
const STATION_RADIUS_M = 300;

function distanceMeters(a: Station, b: { lat: number; lng: number }): number {
  if (a.lat === undefined || a.lng === undefined) return Number.POSITIVE_INFINITY;
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

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

  const pastStations = useMemo(() => {
    const map = new Map<string, Station>();
    for (const fillup of [...fillups].sort((a, b) => b.date - a.date)) {
      const name = fillup.station?.name?.trim();
      if (name && !map.has(name)) map.set(name, fillup.station as Station);
    }
    return [...map.values()];
  }, [fillups]);

  const geoRequested = useRef(false);
  useEffect(() => {
    if (isEdit || geoRequested.current || station || !navigator.geolocation) return;
    geoRequested.current = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const here = { lat: position.coords.latitude, lng: position.coords.longitude };
        let closest: Station | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        for (const candidate of pastStations) {
          const distance = distanceMeters(candidate, here);
          if (distance < closestDistance) {
            closestDistance = distance;
            closest = candidate;
          }
        }

        if (closest && closestDistance <= STATION_RADIUS_M) {
          setStation(closest);
          setStationAuto(true);
        }
      },
      () => {
        /* permission denied or unavailable — the field stays empty */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
    );
  }, [isEdit, station, pastStations]);

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
            className="flex min-h-[58px] w-full items-center gap-3 border-b border-line px-4 py-3 text-start active:bg-surface-2"
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
            className="flex min-h-[58px] w-full items-center gap-3 border-b border-line px-4 py-3 text-start active:bg-surface-2"
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
              className="num w-[86px] flex-none rounded-[10px] border border-line bg-surface px-2 py-2 text-center text-[16px] font-bold text-ink outline-none focus:border-accent"
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
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  stations: Station[];
  current: Station | null;
  onPick: (station: Station | null) => void;
}) {
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (open) setCustom("");
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">תחנת דלק</h2>}
    >
      <div className="flex max-h-[62vh] flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="שם תחנה חדשה…"
            className="min-h-[48px] min-w-0 flex-1 rounded-[14px] border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!custom.trim()}
            onClick={() => onPick({ name: custom.trim() })}
            className="min-h-[48px] flex-none rounded-[14px] bg-accent px-4 text-[14px] font-bold text-accent-contrast disabled:opacity-40"
          >
            שמירה
          </button>
        </div>

        <div className="no-scrollbar flex flex-col overflow-y-auto">
          {stations.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => onPick(entry)}
              className="flex min-h-[52px] items-center gap-3 border-b border-line px-2 text-start last:border-b-0 active:bg-surface-2"
            >
              <PinIcon size={17} className="flex-none text-muted" />
              <span className="flex-1 truncate text-[15px] font-semibold text-ink">
                {entry.name}
              </span>
              {current?.name === entry.name ? (
                <CheckIcon size={18} className="flex-none text-accent" />
              ) : null}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onPick(null)}
          className="min-h-[48px] rounded-pill bg-surface-2 text-[14.5px] font-semibold text-muted"
        >
          ללא מיקום
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- date picker ---------------- */

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
        <input
          type="datetime-local"
          dir="ltr"
          value={toDateTimeLocal(value)}
          max={toDateTimeLocal(Date.now())}
          onChange={(event) => {
            const next = new Date(event.target.value).getTime();
            if (Number.isFinite(next)) onChange(next);
          }}
          className="num min-h-[52px] rounded-[14px] border border-line bg-surface px-3.5 text-[16px] font-semibold outline-none focus:border-accent"
        />

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
            className="min-h-[46px] flex-1 rounded-pill bg-surface-2 text-[14px] font-semibold text-ink"
          >
            עכשיו
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[46px] flex-1 rounded-pill bg-accent text-[14px] font-bold text-accent-contrast"
          >
            אישור
          </button>
        </div>
      </div>
    </Sheet>
  );
}
