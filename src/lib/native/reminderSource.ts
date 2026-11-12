import { collection, getDocsFromServer, limit, orderBy, query, startAfter, type DocumentData, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { toEpochMillis } from '../fillupSerializer';
import { EMPTY_CARE, type MaintenancePlan, type OdometerReading, type ServiceEvent } from '../maintenance/model';
import type { PushDigestInput } from '../push/digest';
import type { UserSettings, Vehicle } from '../types';
import { decodeVehicleRecord, validVehicleRecord, type NotificationState, type VehicleCollection } from '../vehicle/model';

function confirmed(snapshot: QuerySnapshot): QueryDocumentSnapshot<DocumentData>[] {
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) throw new Error('Reminder data is not synced yet.');
  return snapshot.docs;
}

export async function loadReminderInputs(uid: string, vehicles: Vehicle[], settings: UserSettings, today: string): Promise<PushDigestInput[]> {
  return Promise.all(vehicles.map(async vehicle => {
    const path = (name: string) => collection(db, 'users', uid, 'vehicles', vehicle.id, name);
    async function records<T>(name: VehicleCollection): Promise<T[]> {
      return confirmed(await getDocsFromServer(path(name)))
        .map(doc => decodeVehicleRecord(name, { ...doc.data(), id: doc.id }))
        .filter(row => validVehicleRecord(name, row)) as T[];
    }
    async function recent(name: 'fillups' | 'observations', field: 'date' | 'observedAt') {
      const source = path(name);
      const result: { id: string; time: number; odometer: number }[] = [];
      let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
      while (result.length < 10) {
        const batch = confirmed(await getDocsFromServer(query(source, orderBy(field, 'desc'),
          ...(cursor ? [startAfter(cursor)] : []), limit(24))));
        for (const doc of batch) {
          const row = doc.data();
          const time = toEpochMillis(row[field]);
          if (time !== null && Number.isFinite(row.odometer) && row.odometer > 0) {
            result.push({ id: doc.id, time, odometer: row.odometer });
          }
        }
        if (batch.length < 24) break;
        cursor = batch.at(-1);
      }
      return result.slice(0, 10);
    }

    const [maintenancePlans, states] = await Promise.all([
      records<MaintenancePlan>('maintenancePlans'), records<NotificationState>('notificationStates'),
    ]);
    const active = maintenancePlans.some(plan => plan.active);
    const hasMileage = maintenancePlans.some(plan => plan.active && plan.dueOdometer !== null);
    const [serviceEvents, odometerReadings, fillups, observations] = await Promise.all([
      active ? records<ServiceEvent>('serviceEvents') : [],
      hasMileage ? records<OdometerReading>('odometerReadings') : [],
      hasMileage ? recent('fillups', 'date') : [],
      hasMileage ? recent('observations', 'observedAt') : [],
    ]);
    return {
      vehicle, care: { ...EMPTY_CARE, maintenancePlans, serviceEvents, odometerReadings },
      fillups: fillups.map(({ id, time, odometer }) => ({ id, date: time, odometer })),
      observations: observations.map(({ id, time, odometer }) => ({ id, observedAt: time, odometer })),
      states, settings, today, nameVehicle: vehicles.length > 1,
    };
  }));
}
