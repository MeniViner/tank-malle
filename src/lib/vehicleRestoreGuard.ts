import type { DocumentReference, Transaction } from 'firebase/firestore';

function assertCurrent(stillCurrent: () => boolean): void {
  if (!stillCurrent()) throw Object.assign(new Error('הרכב או החשבון התחלפו — הפעולה נשמרה לבדיקה'), { code: 'scope-changed' });
}

/** Read the actual parent in the restoring transaction, before any child write. */
export async function requireRestorableVehicle(
  transaction: Transaction,
  child: DocumentReference,
  stillCurrent: () => boolean,
): Promise<void> {
  assertCurrent(stillCurrent);
  const parts = child.path.split('/');
  const vehicle = child.parent.parent;
  if (parts.length !== 6 || parts[0] !== 'users' || parts[2] !== 'vehicles' ||
      !vehicle || vehicle.path !== parts.slice(0, 4).join('/')) {
    throw Object.assign(new Error('לא ניתן לאמת את הרכב של הרשומה'), { code: 'vehicle-unverified' });
  }
  const snapshot = await transaction.get(vehicle);
  assertCurrent(stillCurrent);
  if (!snapshot.exists() || snapshot.data().deletionPending === true) {
    throw Object.assign(new Error('הרכב נמחק או ממתין למחיקה — בקשת השחזור נשמרה לבדיקה'), { code: 'vehicle-unavailable' });
  }
}
