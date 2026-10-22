import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Card, IconTile, Label, Skeleton } from "../components/Card";
import { Button, Spinner } from "../components/Button";
import { Field } from "../components/Field";
import { Sheet, ConfirmDialog } from "../components/Sheet";
import {
  ArchiveIcon,
  CarIcon,
  PencilIcon,
  PlusIcon,
  RestoreIcon,
  TrashIcon,
} from "../components/icons";
import {
  FUEL_TYPE_LABELS,
  FUEL_TYPE_SHORT,
  formatPlate,
  parseDecimal,
  vehicleLabel,
} from "../lib/format";
import { LOOKUP_MESSAGES, lookupPlate } from "../lib/plateLookup";
import { fetchVehicleSpecs, type VehicleSpecs } from "../lib/vehicleSpecs";
import type { FuelType, Vehicle } from "../lib/types";

/** Vehicle management & archive (design 20). */
export function VehicleManager() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { vehicles, activeVehicle, setActiveVehicle, setVehicleArchived, deleteVehicle, updateVehicle, ready } =
    useData();

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState<string|null>(null);

  const active = useMemo(() => vehicles.filter((v) => !v.archived), [vehicles]);
  const archived = useMemo(() => vehicles.filter((v) => v.archived), [vehicles]);

  async function remove(vehicle: Vehicle) {
    setBusy(true);
    try {
      await deleteVehicle(vehicle.id);
      showToast({ tone: "success", title: "הרכב נמחק" });
    } catch {
      showToast({ tone: "error", title: "מחיקת הרכב נכשלה", detail: "נסו שוב בעוד רגע" });
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col pb-[104px] pt-safe">
      <ScreenHeader title="ניהול רכבים" onBack={() => navigate(-1)} />

      <div className="flex flex-col gap-4 px-5">
        {!ready && vehicles.length === 0 ? (
          <>
            <Skeleton className="h-[152px] rounded-card" />
            <Skeleton className="h-[152px] rounded-card" />
          </>
        ) : null}

        {active.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            isActive={vehicle.id === activeVehicle?.id}
            selecting={selecting!==null}
            onSelect={() => { if(selecting)return;setSelecting(vehicle.id);void setActiveVehicle(vehicle.id).catch(()=>showToast({tone:'error',title:'בחירת הרכב לא נשמרה'})).finally(()=>setSelecting(null)); }}
            onEdit={() => { setSaveError(null); setEditing(vehicle); }}
            onArchive={() => void setVehicleArchived(vehicle.id, true).catch(() => showToast({ tone: "error", title: "העברה לארכיון נכשלה" }))}
          />
        ))}

        {archived.length > 0 ? (
          <>
            <Label>ארכיון</Label>
            {archived.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                archived
                onRestore={vehicle.deletionPending ? undefined : () => void setVehicleArchived(vehicle.id, false).catch(() => showToast({ tone: "error", title: "שחזור הרכב נכשל" }))}
                onDelete={() => setConfirmDelete(vehicle)}
              />
            ))}
          </>
        ) : null}

        <button type="button" className="tm-text-action justify-start rounded-card bg-surface px-4 py-3" onClick={() => navigate("/vehicles/new")}>
          <PlusIcon size={19} /> הוספת רכב
        </button>
      </div>

      <EditVehicleSheet
        key={editing?.id ?? "closed"}
        vehicle={editing}
        onClose={() => { if (!busy) setEditing(null); }}
        saving={busy}
        error={saveError}
        onSave={async (patch) => {
          if (!editing || busy) return;
          setBusy(true); setSaveError(null);
          try {
            const receipt = await updateVehicle(editing.id, patch);
            const saved = await Promise.race([receipt.settled, new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))]);
            if (saved === false) throw new Error("server rejected");
            setEditing(null);
            showToast({ tone: saved ? "success" : "info", title: saved ? "פרטי הרכב עודכנו" : "השינוי נשמר במכשיר", detail: saved ? undefined : "ממתין לאישור מהשרת. אפשר לבדוק במסך פעולות שלא סונכרנו." });
          } catch { setSaveError("השינוי לא אושר בשרת. הפרטים נשארו בטופס; תקנו או נסו שוב."); }
          finally { setBusy(false); }
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="למחוק את הרכב?"
        body="כל התדלוקים של הרכב יימחקו לצמיתות. לא ניתן לשחזר."
        confirmLabel={busy ? "מוחק…" : "מחיקה"}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}

function VehicleCard({
  vehicle,
  isActive = false,
  archived = false,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  onSelect,
  selecting = false,
}: {
  vehicle: Vehicle;
  isActive?: boolean;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
  selecting?: boolean;
}) {
  return (
    <Card className={`flex flex-col gap-3 p-4 ${archived ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <IconTile tone={archived ? "muted" : "accent"}>
          <CarIcon size={18} />
        </IconTile>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15.5px] font-bold text-ink">
            {vehicleLabel(vehicle)}
          </span>
          <span className="truncate text-[14px] text-muted">
            {[
              vehicle.nickname ? `${vehicle.make} ${vehicle.model}` : null,
              FUEL_TYPE_SHORT[vehicle.fuelType],
              vehicle.tankLiters ? `מיכל ${vehicle.tankLiters} ל׳` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        {!archived&&!isActive?<button type="button" aria-label="בחירה ברכב" disabled={selecting||vehicle.deletionPending} onClick={onSelect} className="min-h-10 flex-none rounded-pill border border-line px-3 py-2 text-[12px] font-semibold text-accent">{vehicle.deletionPending?'מחיקה ממתינה':'בחירה'}</button>:<span
          className={`flex-none rounded-pill px-2.5 py-1 text-[12px] font-semibold ${
            archived
              ? "bg-surface-2 text-muted"
              : isActive
                ? "bg-accent-soft text-accent"
                : "border border-line text-muted"
          }`}
        >
          {vehicle.deletionPending ? "מחיקה ממתינה" : archived ? "בארכיון" : isActive ? "פעיל" : "זמין"}
        </span>}
      </div>

      {vehicle.plateNumber ? (
        <div
          dir="ltr"
          className="flex h-9 w-[128px] items-stretch overflow-hidden rounded-[6px] border-2 border-[#1B2A24] bg-[#F4CE2A]"
        >
          <span className="flex w-4 flex-none items-end justify-center bg-[#12408F] pb-0.5 text-[6px] font-bold text-white">
            IL
          </span>
          <span className="num flex flex-1 items-center justify-center text-[15px] font-bold text-[#16211C]">
            {formatPlate(vehicle.plateNumber)}
          </span>
        </div>
      ) : null}

      <div className="flex gap-5 border-t border-[var(--hairline)] pt-1">
        {archived ? (
          <>
            {!vehicle.deletionPending ? <CardAction icon={<RestoreIcon size={17} />} label="שחזור" onClick={onRestore} /> : null}
            <CardAction
              icon={<TrashIcon size={17} />}
              label="מחיקה"
              tone="danger"
              onClick={onDelete}
            />
          </>
        ) : (
          <>
            <CardAction icon={<PencilIcon size={17} />} label="עריכה" onClick={onEdit} />
            <CardAction
              icon={<ArchiveIcon size={17} />}
              label="העברה לארכיון"
              onClick={onArchive}
            />
          </>
        )}
      </div>
    </Card>
  );
}

function CardAction({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tm-text-action ${tone === "danger" ? "text-danger-ink" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Full editor — every stored field, including the plate number. */
function EditVehicleSheet({
  vehicle,
  onClose,
  onSave,
  saving,
  error,
}: {
  saving: boolean;
  error: string | null;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSave: (patch: Partial<Vehicle>) => Promise<void>;
}) {
  const { user } = useAuth();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [fuelType, setFuelType] = useState<FuelType>("95");
  const [nickname, setNickname] = useState("");
  const [tankLiters, setTankLiters] = useState("");
  const [declared, setDeclared] = useState("");
  /** Our class-based tank approximation, shown as a hint. Never auto-saved. */
  const [tankHint, setTankHint] = useState<number | null>(null);
  const [enrichedSpecs, setEnrichedSpecs] = useState<VehicleSpecs | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  // Re-seed whenever a different vehicle is opened.
  const [lastId, setLastId] = useState<string | null>(null);
  if (vehicle && vehicle.id !== lastId) {
    setLastId(vehicle.id);
    setMake(vehicle.make);
    setModel(vehicle.model);
    setYear(vehicle.year ? String(vehicle.year) : "");
    setPlate(vehicle.plateNumber ?? "");
    setFuelType(vehicle.fuelType);
    setNickname(vehicle.nickname ?? "");
    setTankLiters(vehicle.tankLiters ? String(vehicle.tankLiters) : "");
    setDeclared(vehicle.declaredKmPerLiter ? String(vehicle.declaredKmPerLiter) : "");
    setRefreshNote(null);
    setTankHint(null);
    setEnrichedSpecs(null);
  }

  const yearError = year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2100) ? "שנה בין 1900 ל־2100" : null;
  const tankError = tankLiters.trim() && (!(parseDecimal(tankLiters) > 0) || parseDecimal(tankLiters) > 500) ? "נפח מיכל בין 0 ל־500 ליטר (ללא אפס)" : null;
  const declaredError = declared.trim() && !(parseDecimal(declared) > 0) ? "הצריכה חייבת להיות מספר חיובי" : null;
  const valid = make.trim().length > 0 && make.length <= 60 && model.length <= 80 && nickname.length <= 60 && !yearError && !tankError && !declaredError;

  function applySpecs(specs: VehicleSpecs) {
    setEnrichedSpecs(specs);
    if (!tankLiters && specs.trustedTankLiters) setTankLiters(String(specs.trustedTankLiters));
    if (!declared && specs.declaredKmPerLiter && specs.declaredSource === 'exact-year') setDeclared(String(specs.declaredKmPerLiter));
    setTankHint(specs.suggestedTankLiters);
    setRefreshNote(specs.trustedTankLiters || specs.declaredKmPerLiter ? 'נמצאו נתוני מפרט. הפרטים שהזנת נשמרו.' : 'אין מפרט תואם במאגר. אפשר להזין את הנתונים ידנית.');
  }

  /** Re-run the plate lookup and refresh every registry-derived field. */
  async function refreshFromRegistry() {
    const digits = plate.replace(/\D/g, "");
    if (digits.length < 5) {
      setRefreshing(true);
      try {
        const specs = await fetchVehicleSpecs({ make, model, year: Number(year), fuelType, tozeretCd: vehicle?.tozeretCd, degemCd: vehicle?.degemCd });
        applySpecs(specs);
      } finally { setRefreshing(false); }
      return;
    }
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const outcome = await lookupPlate(digits, { uid: user?.uid ?? null });

      // An outage is not a verdict on whether the vehicle exists.
      if (outcome.status === "unavailable") {
        setRefreshNote(
          outcome.cached ? LOOKUP_MESSAGES.cachedFallback : LOOKUP_MESSAGES.unavailable,
        );
        if (!outcome.cached) return;
      } else if (outcome.status === "not-found") {
        setRefreshNote(LOOKUP_MESSAGES.notFound);
        return;
      }

      const found =
        outcome.status === "found" ? outcome.vehicle : outcome.cached!;

      if (found.make) setMake(found.make);
      if (found.model) setModel(found.model);
      if (found.year) setYear(String(found.year));
      if (found.fuelType) setFuelType(found.fuelType);

      const specs = await fetchVehicleSpecs({
        make: found.make, model: found.model, engineCc: found.engineVolume,
        tozeretCd: found.tozeretCd,
        degemCd: found.degemCd,
        year: found.year,
        fuelType: found.fuelType,
      });
      applySpecs(specs);
    } catch {
      setRefreshNote(LOOKUP_MESSAGES.unavailable);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Sheet
      open={vehicle !== null}
      onClose={onClose}
      title={<h2 className="text-[18px] font-semibold text-ink">עריכת רכב</h2>}
    >
      <div className="no-scrollbar flex max-h-[68vh] flex-col gap-3.5 overflow-y-auto">
        <Field
          label="מספר רכב"
          inputMode="numeric"
          value={plate}
          onChange={(event) => setPlate(event.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="31245678"
          hint={plate ? formatPlate(plate) : "משמש לאיתור אוטומטי בלבד"}
        />

        <button
          type="button"
          onClick={() => void refreshFromRegistry()}
          disabled={refreshing}
          className="flex min-h-[46px] items-center justify-center gap-2 rounded-pill bg-surface-2 text-[14px] font-semibold text-accent transition-[background-color,scale] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          {refreshing ? <Spinner size={17} /> : <RestoreIcon size={17} />}
          עדכון פרטים ממאגר משרד התחבורה
        </button>

        {refreshNote ? (
          <p className="text-[14px] text-muted">{refreshNote}</p>
        ) : null}

        <Field
          maxLength={60}
          label="יצרן"
          dir="rtl"
          value={make}
          onChange={(event) => setMake(event.target.value)}
        />
        <Field
          maxLength={80}
          label="דגם"
          dir="rtl"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
        <Field
          error={yearError}
          label="שנת ייצור"
          inputMode="numeric"
          value={year}
          onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold  text-muted">
            סוג דלק
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["95", "98", "diesel", "other"] as FuelType[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFuelType(option)}
                className={`min-h-[46px] rounded-[14px] border px-3 text-[14px] font-semibold transition-colors ${
                  fuelType === option
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-muted"
                }`}
              >
                {FUEL_TYPE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <Field
          maxLength={60}
          label="כינוי לרכב"
          dir="rtl"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="המאזדה של יעל"
        />
        <Field
          error={tankError}
          label="נפח מיכל"
          inputMode="decimal"
          suffix="ליטר"
          value={tankLiters}
          onChange={(event) => setTankLiters(event.target.value)}
          placeholder={tankHint ? String(tankHint) : "51"}
          hint={
            enrichedSpecs?.trustedTankLiters ? `מפרט יצרן · ${enrichedSpecs.trustedTankLiters} ליטר` : tankHint
              ? `הערכה לפי סוג הרכב: ${tankHint} ל׳ — אשרו או תקנו לפי המדריך למשתמש`
              : vehicle?.tankLiters && !vehicle.tankLitersSource
                ? "הערך הקיים נשמר בלי מקור ידוע — אשרו אותו כדי שנציג טווח נסיעה"
                : "מופיע במדריך למשתמש. משמש לחישוב טווח נסיעה"
          }
        />
        <Field
          error={declaredError}
          label={vehicle?.declaredSource === "co2-estimate" || (!enrichedSpecs?.consumptionIsOfficial && enrichedSpecs?.declaredKmPerLiter === parseDecimal(declared)) ? "צריכת ייחוס משוערת" : "צריכה מוצהרת"}
          inputMode="decimal"
          suffix="קמ״ל"
          value={declared}
          onChange={(event) => setDeclared(event.target.value)}
          placeholder="16.2"
          hint={vehicle?.declaredSource === "co2-estimate" || (!enrichedSpecs?.consumptionIsOfficial && enrichedSpecs?.declaredKmPerLiter === parseDecimal(declared)) ? "קירוב מנתוני CO₂. לתצרוכת מדויקת אפשר להזין נתון יצרן." : undefined}
        />

        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button
          full
          loading={saving}
          disabled={!valid || saving}
          onClick={() =>
            onSave({
              make: make.trim(),
              model: model.trim(),
              year: year ? Number.parseInt(year, 10) : null,
              plateNumber: plate.replace(/\D/g, "") || null,
              fuelType,
              nickname: nickname.trim() || null,
              // Saving this form IS the confirmation, which is what turns an
              // unknown-provenance value into one the range figure may use.
              // A blank field with a suggestion available keeps the suggestion
              // as an ESTIMATE — usable, labelled, and there to be confirmed.
              tankLiters: tankLiters ? parseDecimal(tankLiters) : (tankHint ?? null),
              tankLitersSource: tankLiters ? (enrichedSpecs?.trustedTankLiters === parseDecimal(tankLiters) ? "trusted" : vehicle?.tankLiters === parseDecimal(tankLiters) ? vehicle.tankLitersSource ?? "user" : "user") : tankHint ? "estimate" : null,
              tankSourceUrl: enrichedSpecs?.tankSourceUrl ?? vehicle?.tankSourceUrl ?? null,
              declaredSource: declared ? (enrichedSpecs?.declaredKmPerLiter === parseDecimal(declared) ? (enrichedSpecs.consumptionIsOfficial ? "exact-year" : "co2-estimate") : vehicle?.declaredKmPerLiter === parseDecimal(declared) ? vehicle.declaredSource ?? "user" : "user") : null,
              declaredKmPerLiter: declared ? parseDecimal(declared) : null,
              specSourceUrl: enrichedSpecs?.sourceUrl ?? vehicle?.specSourceUrl ?? null,
            })
          }
        >
          שמירת שינויים
        </Button>
      </div>
    </Sheet>
  );
}
