import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "../context/DataContext";
import { useToast } from "../context/ToastContext";
import { ScreenHeader } from "../components/AppHeader";
import { Card, IconTile, Label } from "../components/Card";
import { Button } from "../components/Button";
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
import { FUEL_TYPE_SHORT, formatPlate, parseDecimal, vehicleLabel } from "../lib/format";
import type { Vehicle } from "../lib/types";

/** Vehicle management & archive (design 20). */
export function VehicleManager() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { vehicles, activeVehicle, setVehicleArchived, deleteVehicle, updateVehicle } =
    useData();

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);

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
        {active.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            isActive={vehicle.id === activeVehicle?.id}
            onEdit={() => setEditing(vehicle)}
            onArchive={() => void setVehicleArchived(vehicle.id, true)}
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
                onRestore={() => void setVehicleArchived(vehicle.id, false)}
                onDelete={() => setConfirmDelete(vehicle)}
              />
            ))}
          </>
        ) : null}

        <Button variant="secondary" full onClick={() => navigate("/vehicles/new")}>
          <PlusIcon size={19} />
          הוספת רכב
        </Button>
        <p className="pb-2 text-center text-[12.5px] text-muted">
          איתור אוטומטי לפי מספר רישוי
        </p>
      </div>

      <EditVehicleSheet
        vehicle={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (editing) void updateVehicle(editing.id, patch);
          setEditing(null);
          showToast({ tone: "success", title: "פרטי הרכב עודכנו" });
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
}: {
  vehicle: Vehicle;
  isActive?: boolean;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
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
          <span className="truncate text-[12.5px] text-muted">
            {[
              vehicle.nickname ? `${vehicle.make} ${vehicle.model}` : null,
              FUEL_TYPE_SHORT[vehicle.fuelType],
              vehicle.tankLiters ? `מיכל ${vehicle.tankLiters} ל׳` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        <span
          className={`flex-none rounded-pill px-2.5 py-1 text-[12px] font-semibold ${
            archived
              ? "bg-surface-2 text-muted"
              : isActive
                ? "bg-accent-soft text-accent"
                : "border border-line text-muted"
          }`}
        >
          {archived ? "בארכיון" : isActive ? "פעיל" : "זמין"}
        </span>
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

      <div className="flex gap-2">
        {archived ? (
          <>
            <CardAction icon={<RestoreIcon size={17} />} label="שחזור" onClick={onRestore} />
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
      className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-pill text-[13.5px] font-semibold ${
        tone === "danger" ? "bg-danger-soft text-danger-ink" : "bg-surface-2 text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EditVehicleSheet({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
  onSave: (patch: Partial<Vehicle>) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [tankLiters, setTankLiters] = useState("");
  const [declared, setDeclared] = useState("");

  // Re-seed whenever a different vehicle is opened.
  const [lastId, setLastId] = useState<string | null>(null);
  if (vehicle && vehicle.id !== lastId) {
    setLastId(vehicle.id);
    setNickname(vehicle.nickname ?? "");
    setTankLiters(vehicle.tankLiters ? String(vehicle.tankLiters) : "");
    setDeclared(vehicle.declaredKmPerLiter ? String(vehicle.declaredKmPerLiter) : "");
  }

  return (
    <Sheet
      open={vehicle !== null}
      onClose={onClose}
      title={<h2 className="text-[17px] font-bold text-ink">עריכת רכב</h2>}
    >
      <div className="flex flex-col gap-3.5">
        <Field
          label="כינוי לרכב"
          dir="rtl"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="המאזדה של יעל"
        />
        <Field
          label="נפח מיכל"
          inputMode="decimal"
          suffix="ליטר"
          value={tankLiters}
          onChange={(event) => setTankLiters(event.target.value)}
          placeholder="51"
        />
        <Field
          label="צריכה מוצהרת"
          inputMode="decimal"
          suffix="קמ״ל"
          value={declared}
          onChange={(event) => setDeclared(event.target.value)}
          placeholder="16.2"
        />

        <Button
          full
          onClick={() =>
            onSave({
              nickname: nickname.trim() || null,
              tankLiters: tankLiters ? parseDecimal(tankLiters) : null,
              declaredKmPerLiter: declared ? parseDecimal(declared) : null,
            })
          }
        >
          שמירת שינויים
        </Button>
      </div>
    </Sheet>
  );
}
