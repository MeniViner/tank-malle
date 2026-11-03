import { useState } from "react";
import { useVehicleData } from "../context/VehicleDataContext";
import { useData } from "../context/DataContext";
import { GroupRow } from "./DesignPrimitives";
import { ArchiveIcon } from "./icons";
import { CareTransfer } from "./maintenance/CareTransfer";

export function LegacyCareTransfer() {
  const [open, setOpen] = useState(false);
  const vehicleData = useVehicleData();
  const data = useData();
  if (!vehicleData.vehicleId) return null;
  return <>
    <GroupRow testId="account-legacy-backup" icon={<ArchiveIcon />} title="גיבוי וייצוא תחזוקה"
      subtitle="תאימות לגיבויי התחזוקה הקודמים · הרכב הפעיל" onClick={() => setOpen(true)} />
    {open ? <CareTransfer vehicleId={vehicleData.vehicleId} label={data.activeVehicle?.nickname ?? data.activeVehicle?.model ?? "הרכב הפעיל"}
      data={vehicleData.care.data} incomplete={vehicleData.incomplete} canImport={!vehicleData.incomplete}
      onSave={(name, record) => data.saveCareRecord(vehicleData.vehicleId, name, record)} onClose={() => setOpen(false)} /> : null}
  </>;
}
