import { mileageEvidence, buildLedger, periodSummary } from "./vehicle/derived";
import { EMPTY_EXTRA } from "./vehicle/model";
import { VEHICLE_COLLECTIONS, decodeVehicleRecord, validVehicleRecord } from "./vehicle/model";
import { localDay } from "./maintenance/model";
import { type CareData } from "./maintenance/model";
import { careCosts } from "./maintenance/costs";
import { collection, getDocsFromServer, type Firestore } from "firebase/firestore";
import { parseFillupDocument, toEpochMillis } from "./fillupSerializer";
import type { Vehicle } from "./types";
import type { TankObservation, TankPlan } from "./tank/types";
import type { ExportRow } from "./csv";
import { computeStats } from "./stats";

export interface AccountExport {
  vehicleCare?: Record<string,CareData>; rows: ExportRow[]; vehicles: Vehicle[]; observations: TankObservation[]; plans: TankPlan[];
}
/** Every vehicle, including the archive. A failed read never yields a partial backup. */
export async function loadAccountExport(db: Firestore, uid: string): Promise<AccountExport> {
  const result: AccountExport = { vehicleCare: {}, rows: [], vehicles: [], observations: [], plans: [] };
  const snapshot = await getDocsFromServer(collection(db, "users", uid, "vehicles"));
  for (const entry of snapshot.docs) {
    const vehicle = { ...entry.data(), id: entry.id, createdAt: toEpochMillis(entry.data().createdAt) ?? 0 } as Vehicle;
    result.vehicles.push(vehicle);
    const records:Record<string,unknown[]>={};
    for(const name of VEHICLE_COLLECTIONS){const rows=await getDocsFromServer(collection(entry.ref,name));records[name]=rows.docs.map(d=>decodeVehicleRecord(name,{...d.data(),id:d.id}));if(records[name].some(r=>!validVehicleRecord(name,r)))throw new Error("רשומת רכב לא ניתנת לקריאה בגרסה זו. הסיכום אינו מלא.");}
    result.vehicleCare![vehicle.id]=records as unknown as CareData;
    const [fillups, observations, plans] = await Promise.all([
      getDocsFromServer(collection(entry.ref, "fillups")), getDocsFromServer(collection(entry.ref, "observations")), getDocsFromServer(collection(entry.ref, "tankPlans")),
    ]);
    for (const doc of fillups.docs) {
      const parsed = parseFillupDocument(doc.id, doc.data());
      if (!parsed.ok) throw new Error("יש רשומת תדלוק שלא ניתן לקרוא. בדקו את ההיסטוריה לפני הייצוא.");
      result.rows.push({ vehicle, fillup: parsed.fillup });
    }
    for (const doc of observations.docs) {
      const data = doc.data(); const observedAt = toEpochMillis(data.observedAt);
      if (observedAt === null) throw new Error("עדכון מיכל עם תאריך לא תקין");
      result.observations.push({ ...data, id: doc.id, vehicleId: vehicle.id, observedAt, recordedAt: toEpochMillis(data.recordedAt) ?? observedAt } as TankObservation);
    }
    for (const doc of plans.docs) {
      const data = doc.data(); const date = toEpochMillis(data.date);
      if (date === null) throw new Error("נסיעה עם תאריך לא תקין");
      result.plans.push({ ...data, id: doc.id, vehicleId: vehicle.id, date, createdAt: toEpochMillis(data.createdAt) ?? undefined } as TankPlan);
    }
  }
  return result;
}

export function accountTotals(data: AccountExport, today = localDay()) {
  return data.vehicles.reduce((total, vehicle) => {
    const stats = computeStats(data.rows.filter((row) => row.vehicle?.id === vehicle.id).map((row) => row.fillup), vehicle);
    const costs=data.vehicleCare?.[vehicle.id] ? careCosts(data.vehicleCare[vehicle.id],data.rows.filter(row=>row.vehicle?.id===vehicle.id).map(row=>row.fillup),'1900-01-01',today,false) : null;
    const covered=data.vehicleCare?.[vehicle.id]?periodSummary(buildLedger(data.rows.filter(row=>row.vehicle?.id===vehicle.id).map(row=>row.fillup),data.observations.filter(o=>o.vehicleId===vehicle.id),data.vehicleCare[vehicle.id],EMPTY_EXTRA),mileageEvidence(data.rows.filter(row=>row.vehicle?.id===vehicle.id).map(row=>row.fillup),data.observations.filter(o=>o.vehicleId===vehicle.id),data.vehicleCare[vehicle.id]),'1900-01-01',today):null;
    return { unknownFuelCosts:total.unknownFuelCosts+data.rows.filter(row=>row.vehicle?.id===vehicle.id&&row.fillup.totalCostUnknown).length,distanceUnknown:total.distanceUnknown+(covered?.distance===null?1:0), fuelCost:total.fuelCost+stats.records.totalCost, unknownCosts:total.unknownCosts+(costs?.unknown??0), fillupCount: total.fillupCount + stats.records.fillupCount, totalLiters: total.totalLiters + stats.records.totalLiters,
      totalCost: total.totalCost + (costs?costs.total/100:stats.records.totalCost), totalKm: total.totalKm + (covered?covered.distance??0:stats.records.totalKm) };
  }, { unknownFuelCosts:0,distanceUnknown:0, fuelCost:0, unknownCosts:0, fillupCount: 0, totalLiters: 0, totalCost: 0, totalKm: 0 });
}
