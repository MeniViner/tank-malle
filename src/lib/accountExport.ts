import { collection, getDocsFromServer, type Firestore } from "firebase/firestore";
import { parseFillupDocument, toEpochMillis } from "./fillupSerializer";
import type { Vehicle } from "./types";
import type { TankObservation, TankPlan } from "./tank/types";
import type { ExportRow } from "./csv";
import { computeStats } from "./stats";

export interface AccountExport {
  rows: ExportRow[]; vehicles: Vehicle[]; observations: TankObservation[]; plans: TankPlan[];
}
/** Every vehicle, including the archive. A failed read never yields a partial backup. */
export async function loadAccountExport(db: Firestore, uid: string): Promise<AccountExport> {
  const result: AccountExport = { rows: [], vehicles: [], observations: [], plans: [] };
  const snapshot = await getDocsFromServer(collection(db, "users", uid, "vehicles"));
  for (const entry of snapshot.docs) {
    const vehicle = { ...entry.data(), id: entry.id, createdAt: toEpochMillis(entry.data().createdAt) ?? 0 } as Vehicle;
    result.vehicles.push(vehicle);
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

export function accountTotals(data: AccountExport) {
  return data.vehicles.reduce((total, vehicle) => {
    const stats = computeStats(data.rows.filter((row) => row.vehicle?.id === vehicle.id).map((row) => row.fillup), vehicle);
    return { fillupCount: total.fillupCount + stats.records.fillupCount, totalLiters: total.totalLiters + stats.records.totalLiters,
      totalCost: total.totalCost + stats.records.totalCost, totalKm: total.totalKm + stats.records.totalKm };
  }, { fillupCount: 0, totalLiters: 0, totalCost: 0, totalKm: 0 });
}
