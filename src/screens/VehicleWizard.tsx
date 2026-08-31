import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { lookupPlate } from "../lib/plateLookup";
import { fetchVehicleSpecs, type VehicleSpecs } from "../lib/vehicleSpecs";
import { FUEL_TYPE_LABELS, formatPlate, parseDecimal } from "../lib/format";
import type { FuelType, PlateLookupResult, Vehicle } from "../lib/types";
import { Button, Spinner } from "../components/Button";
import { Field } from "../components/Field";
import { Card, Label } from "../components/Card";
import { Num } from "../components/Num";
import { Sheet } from "../components/Sheet";
import { CarIcon, CheckIcon, ChevronStart, SearchIcon, WarningIcon } from "../components/icons";

type Step = "plate" | "confirm" | "extras";

interface CatalogEntry {
  make: string;
  models: { model: string; from: number | null; to: number | null }[];
}

interface Draft {
  make: string;
  model: string;
  year: string;
  fuelType: FuelType;
  plateNumber: string;
  category?: string;
  fromRegistry: boolean;
  tozeretCd?: number | null;
  degemCd?: number | null;
}

const EMPTY_DRAFT: Draft = {
  make: "",
  model: "",
  year: "",
  fuelType: "95",
  plateNumber: "",
  fromRegistry: false,
  tozeretCd: null,
  degemCd: null,
};

/**
 * First-vehicle wizard (designs 06–08).
 *
 * Three tiers, in order of effort: plate lookup against the national
 * registry, then a make/model/year picker from the static catalog, then a
 * fully manual entry. Nothing ever blocks creating a vehicle.
 */
export function VehicleWizard({ firstRun = false }: { firstRun?: boolean }) {
  const navigate = useNavigate();
  const { addVehicle, vehicles } = useData();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("plate");
  const [plate, setPlate] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [tankLiters, setTankLiters] = useState("");
  const [declaredKmPerLiter, setDeclaredKmPerLiter] = useState("");
  const [nickname, setNickname] = useState("");
  const [specs, setSpecs] = useState<VehicleSpecs | null>(null);
  const [loadingSpecs, setLoadingSpecs] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const canExit = !firstRun || vehicles.length > 0;

  async function runLookup() {
    setLookupError(null);
    setLooking(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result: PlateLookupResult = await lookupPlate(plate, controller.signal);
      if (result.found) {
        setDraft({
          make: result.make ?? "",
          model: result.model ?? "",
          year: result.year ? String(result.year) : "",
          fuelType: result.fuelType ?? "95",
          plateNumber: result.plateNumber,
          category: result.category,
          fromRegistry: true,
          tozeretCd: result.tozeretCd ?? null,
          degemCd: result.degemCd ?? null,
        });
        setStep("confirm");

        // Second hop: the certified CO₂ figure for this exact model, which
        // gives the manufacturer's declared consumption for free.
        setLoadingSpecs(true);
        fetchVehicleSpecs(
          {
            tozeretCd: result.tozeretCd,
            degemCd: result.degemCd,
            year: result.year,
            fuelType: result.fuelType ?? "95",
          },
          controller.signal,
        )
          .then((found) => {
            setSpecs(found);
            if (found.declaredKmPerLiter) {
              setDeclaredKmPerLiter(String(found.declaredKmPerLiter));
            }
            if (found.estimatedTankLiters) {
              setTankLiters(String(found.estimatedTankLiters));
            }
          })
          .catch(() => undefined)
          .finally(() => setLoadingSpecs(false));
      } else {
        setLookupError("הרכב לא נמצא במאגר. אפשר לבחור מהרשימה או להזין ידנית.");
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setLookupError("לא הצלחנו להתחבר למאגר. אפשר להמשיך בהזנה ידנית.");
    } finally {
      setLooking(false);
    }
  }

  function goManual() {
    setDraft({ ...EMPTY_DRAFT, plateNumber: plate.replace(/\D/g, "") });
    setStep("confirm");
  }

  async function save() {
    if (!draft.make.trim()) return;
    setSaving(true);
    try {
      const vehicle: Omit<Vehicle, "id" | "createdAt"> = {
        make: draft.make.trim(),
        model: draft.model.trim(),
        year: draft.year ? Number.parseInt(draft.year, 10) : null,
        plateNumber: draft.plateNumber || null,
        fuelType: draft.fuelType,
        tankLiters: tankLiters ? parseDecimal(tankLiters) : null,
        declaredKmPerLiter: declaredKmPerLiter ? parseDecimal(declaredKmPerLiter) : null,
        priceAdjustment: 0,
        manualPricePerLiter: null,
        nickname: nickname.trim() || null,
        archived: false,
        tozeretCd: draft.tozeretCd ?? null,
        degemCd: draft.degemCd ?? null,
      };
      await addVehicle(vehicle);
      showToast({ tone: "success", title: "הרכב נוסף", detail: "אפשר להתחיל לתעד תדלוקים" });
      navigate("/", { replace: true });
    } catch {
      showToast({ tone: "error", title: "שמירת הרכב נכשלה", detail: "נסו שוב בעוד רגע" });
    } finally {
      setSaving(false);
    }
  }

  const stepIndex = step === "plate" ? 1 : step === "confirm" ? 2 : 3;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg pt-safe">
      <header className="flex flex-none items-center justify-between px-5 pb-2 pt-3">
        <button
          type="button"
          onClick={() => {
            if (step === "extras") setStep("confirm");
            else if (step === "confirm") setStep("plate");
            else if (canExit) navigate(-1);
          }}
          disabled={step === "plate" && !canExit}
          aria-label="חזרה"
          className="flex size-[40px] items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card transition-[background-color,scale] duration-200 active:scale-[0.96] active:bg-surface-2 disabled:opacity-0"
        >
          <ChevronStart size={18} />
        </button>

        <Num className="rounded-pill bg-surface-2 px-3 py-1 text-[12.5px] font-semibold text-muted">
          {stepIndex} / 3
        </Num>
      </header>

      {step === "plate" ? (
        <PlateStep
          plate={plate}
          setPlate={setPlate}
          looking={looking}
          error={lookupError}
          onLookup={runLookup}
          onManual={goManual}
        />
      ) : step === "confirm" ? (
        <ConfirmStep draft={draft} setDraft={setDraft} onNext={() => setStep("extras")} />
      ) : (
        <ExtrasStep
          tankLiters={tankLiters}
          setTankLiters={setTankLiters}
          declaredKmPerLiter={declaredKmPerLiter}
          setDeclaredKmPerLiter={setDeclaredKmPerLiter}
          nickname={nickname}
          setNickname={setNickname}
          specs={specs}
          loadingSpecs={loadingSpecs}
          saving={saving}
          onSave={save}
        />
      )}
    </div>
  );
}

/* ---------------- step 1: plate ---------------- */

function PlateStep({
  plate,
  setPlate,
  looking,
  error,
  onLookup,
  onManual,
}: {
  plate: string;
  setPlate: (value: string) => void;
  looking: boolean;
  error: string | null;
  onLookup: () => void;
  onManual: () => void;
}) {
  const digits = plate.replace(/\D/g, "");

  return (
    <div className="flex flex-1 flex-col px-5 pb-8">
      <div className="flex flex-col gap-2 pt-2">
        <h1 className="text-[24px] font-bold text-ink">מה מספר הרכב?</h1>
        <p className="text-[14.5px] leading-relaxed text-muted">
          נאתר את פרטי הרכב אוטומטית ממאגר משרד התחבורה.
        </p>
      </div>

      {/* Israeli plate: yellow field with the blue IL strip on the leading edge. */}
      <div className="mt-7 flex justify-center">
        <div
          dir="ltr"
          className="flex h-[74px] w-[268px] items-stretch overflow-hidden rounded-[10px] border-[3px] border-[#1B2A24] bg-[#F4CE2A]"
        >
          <span className="flex w-[30px] flex-none flex-col items-center justify-end gap-1 bg-[#12408F] pb-2 text-[9px] font-bold text-white">
            <span className="text-[13px] leading-none">★</span>
            IL
          </span>
          <span
            className="num flex flex-1 items-center justify-center text-[30px] font-bold tracking-[0.06em] text-[#16211C]"
            role="textbox"
            aria-label="מספר רכב"
            aria-readonly="true"
          >
            {digits ? formatPlate(digits) : <span className="opacity-30">00-000-00</span>}
          </span>
        </div>
      </div>

      <p className="mt-3 text-center text-[12.5px] text-muted">
        המספר משמש לאיתור בלבד ונשמר רק בחשבון שלכם
      </p>

      {error ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-3.5 py-3 text-warning-ink">
          <WarningIcon size={17} className="mt-px flex-none" />
          <span className="text-[13px] leading-relaxed">{error}</span>
        </div>
      ) : null}

      <div className="flex-1" />

      <Keypad
        onDigit={(digit) => digits.length < 8 && setPlate(digits + digit)}
        onDelete={() => setPlate(digits.slice(0, -1))}
        onClear={() => setPlate("")}
      />

      <div className="mt-5 flex flex-col gap-2">
        <Button full onClick={onLookup} loading={looking} disabled={digits.length < 5}>
          <SearchIcon size={19} />
          אתר רכב
        </Button>
        <button
          type="button"
          onClick={onManual}
          className="min-h-[48px] text-[14px] font-semibold text-muted"
        >
          אין מספר רכב? הזנה ידנית
        </button>
      </div>
    </div>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Keypad({
  onDigit,
  onDelete,
  onClear,
}: {
  onDigit: (digit: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div dir="ltr" className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <Key key={key} onClick={() => onDigit(key)}>
          {key}
        </Key>
      ))}
      <Key onClick={onClear} muted>
        נקה
      </Key>
      <Key onClick={() => onDigit("0")}>0</Key>
      <Key onClick={onDelete} muted ariaLabel="מחיקת ספרה">
        ⌫
      </Key>
    </div>
  );
}

function Key({
  children,
  onClick,
  muted = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  muted?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`num min-h-[54px] rounded-[14px] border border-line text-[20px] font-semibold transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] active:bg-surface-2 ${
        muted ? "bg-surface-2 text-[15px] text-muted" : "bg-surface text-ink shadow-card"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- step 2: confirm ---------------- */

const FUEL_OPTIONS: FuelType[] = ["95", "98", "diesel", "other"];

function ConfirmStep({
  draft,
  setDraft,
  onNext,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  onNext: () => void;
}) {
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8">
      <div className="flex flex-col gap-2 pt-2">
        {draft.fromRegistry ? (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-success-soft px-3 py-1 text-[12.5px] font-semibold text-success-ink">
            <CheckIcon size={14} />
            נמצא במאגר משרד התחבורה
          </span>
        ) : null}
        <h1 className="text-[24px] font-bold text-ink">
          {draft.fromRegistry ? "זה הרכב שלך?" : "פרטי הרכב"}
        </h1>
      </div>

      {draft.plateNumber ? (
        <Card className="flex items-center gap-3 p-3.5">
          <span className="flex size-9 items-center justify-center rounded-tile bg-accent-soft text-accent">
            <CarIcon size={18} />
          </span>
          <Num className="text-[16px] font-bold text-ink">{formatPlate(draft.plateNumber)}</Num>
          {draft.category ? (
            <span className="ms-auto truncate text-[12.5px] text-muted">{draft.category}</span>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-col gap-3.5">
        <Field
          label="יצרן"
          dir="rtl"
          value={draft.make}
          onChange={(event) => setDraft({ ...draft, make: event.target.value })}
          placeholder="לדוגמה: מזדה"
        />
        <Field
          label="דגם"
          dir="rtl"
          value={draft.model}
          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          placeholder="לדוגמה: 3 אקטיב"
        />
        <Field
          label="שנת ייצור"
          inputMode="numeric"
          value={draft.year}
          maxLength={4}
          onChange={(event) =>
            setDraft({ ...draft, year: event.target.value.replace(/\D/g, "").slice(0, 4) })
          }
          placeholder="2018"
        />

        <div className="flex flex-col gap-1.5">
          <Label>סוג דלק</Label>
          <div className="grid grid-cols-2 gap-2">
            {FUEL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDraft({ ...draft, fuelType: option })}
                className={`min-h-[48px] rounded-[14px] border px-3 text-[14px] font-semibold transition-[background-color,border-color,color,scale] duration-200 active:scale-[0.96] ${
                  draft.fuelType === option
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-muted"
                }`}
              >
                {FUEL_TYPE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setCatalogOpen(true)}
        className="flex min-h-[52px] items-center justify-between rounded-[14px] bg-surface-2 px-4 text-start"
      >
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-ink">הרכב לא נמצא? חיפוש ידני</span>
          <span className="text-[12.5px] text-muted">בחירת יצרן ← דגם ← שנה</span>
        </span>
        <ChevronStart size={18} className="rotate-180 text-muted" />
      </button>

      <div className="flex-1" />

      <Button full onClick={onNext} disabled={!draft.make.trim()}>
        {draft.fromRegistry ? "כן, זה הרכב שלי" : "המשך"}
      </Button>

      <CatalogPicker
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onPick={(make, model, year) => {
          setDraft({
            ...draft,
            make,
            model,
            year: year ? String(year) : draft.year,
            fromRegistry: false,
          });
          setCatalogOpen(false);
        }}
      />
    </div>
  );
}

/* ---------------- tier 2: catalog picker ---------------- */

let catalogCache: CatalogEntry[] | null = null;

function CatalogPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (make: string, model: string, year: number | null) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(catalogCache);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [make, setMake] = useState<CatalogEntry | null>(null);
  const [model, setModel] = useState<CatalogEntry["models"][number] | null>(null);

  // Lazy-loaded on first open, then cached in-module for the session.
  useEffect(() => {
    if (!open || catalog || loading) return;
    setLoading(true);
    fetch("/vehicle-catalog.json")
      .then((response) => response.json())
      .then((payload: { makes: CatalogEntry[] }) => {
        catalogCache = payload.makes;
        setCatalog(payload.makes);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [open, catalog, loading]);

  useEffect(() => {
    if (!open) {
      setMake(null);
      setModel(null);
      setQuery("");
    }
  }, [open]);

  const makes = useMemo(() => {
    if (!catalog) return [];
    const term = query.trim();
    if (!term) return catalog;
    return catalog.filter((entry) => entry.make.includes(term));
  }, [catalog, query]);

  const models = useMemo(() => {
    if (!make) return [];
    const term = query.trim();
    if (!term) return make.models;
    return make.models.filter((entry) => entry.model.toLowerCase().includes(term.toLowerCase()));
  }, [make, query]);

  const years = useMemo(() => {
    if (!model?.from || !model?.to) return [];
    const list: number[] = [];
    for (let year = model.to; year >= model.from; year -= 1) list.push(year);
    return list;
  }, [model]);

  const title = model ? "בחירת שנה" : make ? "בחירת דגם" : "בחירת יצרן";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-ink">{title}</h2>
          {make ? (
            <button
              type="button"
              onClick={() => (model ? setModel(null) : setMake(null))}
              className="text-[13.5px] font-semibold text-accent"
            >
              חזרה
            </button>
          ) : null}
        </div>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-3">
        {!model ? (
          <div className="flex min-h-[46px] items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5">
            <SearchIcon size={17} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={make ? "חיפוש דגם…" : "חיפוש יצרן…"}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-10 text-muted">
            <Spinner size={26} />
          </div>
        ) : failed ? (
          <p className="py-8 text-center text-[14px] text-muted">
            לא הצלחנו לטעון את רשימת הדגמים. אפשר להזין את הפרטים ידנית.
          </p>
        ) : (
          <div className="no-scrollbar flex flex-col overflow-y-auto">
            {!make
              ? makes.map((entry) => (
                  <PickerRow
                    key={entry.make}
                    label={entry.make}
                    meta={`${entry.models.length} דגמים`}
                    onClick={() => {
                      setMake(entry);
                      setQuery("");
                    }}
                  />
                ))
              : !model
                ? models.map((entry) => (
                    <PickerRow
                      key={entry.model}
                      label={entry.model}
                      meta={entry.from ? `${entry.from}–${entry.to}` : undefined}
                      onClick={() => {
                        if (entry.from && entry.to && entry.from !== entry.to) setModel(entry);
                        else onPick(make.make, entry.model, entry.from);
                      }}
                    />
                  ))
                : years.map((year) => (
                    <PickerRow
                      key={year}
                      label={String(year)}
                      onClick={() => onPick(make.make, model.model, year)}
                    />
                  ))}

            {!loading && makes.length === 0 && !make ? (
              <p className="py-8 text-center text-[14px] text-muted">לא נמצאו יצרנים תואמים</p>
            ) : null}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PickerRow({
  label,
  meta,
  onClick,
}: {
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[50px] items-center justify-between gap-3 border-b border-line px-2 text-start last:border-b-0 active:bg-surface-2"
    >
      <span className="truncate text-[15px] font-semibold text-ink">{label}</span>
      {meta ? <Num className="flex-none text-[12.5px] text-muted">{meta}</Num> : null}
    </button>
  );
}

/* ---------------- step 3: optional extras ---------------- */

function ExtrasStep({
  tankLiters,
  setTankLiters,
  declaredKmPerLiter,
  setDeclaredKmPerLiter,
  nickname,
  setNickname,
  specs,
  loadingSpecs,
  saving,
  onSave,
}: {
  tankLiters: string;
  setTankLiters: (value: string) => void;
  declaredKmPerLiter: string;
  setDeclaredKmPerLiter: (value: string) => void;
  nickname: string;
  setNickname: (value: string) => void;
  specs: VehicleSpecs | null;
  loadingSpecs: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const autoFilled = Boolean(specs?.declaredKmPerLiter || specs?.estimatedTankLiters);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8">
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[24px] font-bold text-ink">עוד כמה פרטים</h1>
          <span className="rounded-pill bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-muted">
            רשות
          </span>
        </div>
        <p className="text-[14.5px] text-muted">
          {loadingSpecs
            ? "מושכים את נתוני היצרן…"
            : autoFilled
              ? "מילאנו מראש לפי נתוני היצרן. אפשר לשנות הכול."
              : "אפשר לדלג ולהשלים מאוחר יותר בהגדרות."}
        </p>
      </div>

      {loadingSpecs ? (
        <div className="flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-muted">
          <Spinner size={17} />
          <span className="text-[13px]">מאתרים נתוני צריכה רשמיים לדגם…</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5">
        <Field
          label="נפח מיכל"
          inputMode="decimal"
          suffix="ליטר"
          value={tankLiters}
          onChange={(event) => setTankLiters(event.target.value)}
          placeholder="51"
          hint={
            specs?.estimatedTankLiters && tankLiters === String(specs.estimatedTankLiters)
              ? "הערכה לפי סוג הרכב — כדאי לאמת במדריך למשתמש"
              : "משמש לחישוב טווח הנסיעה המשוער"
          }
        />
        <Field
          label="צריכה מוצהרת"
          inputMode="decimal"
          suffix="קמ״ל"
          value={declaredKmPerLiter}
          onChange={(event) => setDeclaredKmPerLiter(event.target.value)}
          placeholder="16.2"
          hint={
            specs?.consumptionIsOfficial &&
            declaredKmPerLiter === String(specs.declaredKmPerLiter)
              ? `לפי נתוני זיהום רשמיים (${specs.co2WltpGramsPerKm} גר׳ CO₂ לק״מ)`
              : "לפי נתוני היצרן — נשווה אליה את הצריכה בפועל"
          }
        />
        <Field
          label="כינוי לרכב"
          dir="rtl"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="המאזדה של יעל"
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2">
        <Button full onClick={onSave} loading={saving}>
          שמירת הרכב
        </Button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="min-h-[48px] text-[14px] font-semibold text-muted disabled:opacity-50"
        >
          אשלים מאוחר יותר
        </button>
      </div>
    </div>
  );
}
