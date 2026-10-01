/** One render/subscription generation, even when returning to the same vehicle. */
export interface TankInputScope {
  uid: string | null;
  vehicleId: string | null;
}
export type TankInputStatus = "loading" | "cached" | "ready" | "unavailable";
export interface ScopedTankInput<T> {
  scope: TankInputScope;
  records: T[];
  status: TankInputStatus;
}
/** Identity checks reject late A callbacks after A → B → A as well as account changes. */
export function readScopedTankInput<T>(
  snapshot: ScopedTankInput<T> | null,
  scope: TankInputScope,
): { records: T[]; status: TankInputStatus } {
  if (snapshot?.scope === scope) return snapshot;
  return { records: [], status: scope.uid && scope.vehicleId ? "loading" : "ready" };
}

export interface TankModelCarryover {
  scope: TankInputScope;
  level: number | null;
}
export function previousTankLevel(previous: TankModelCarryover | null, scope: TankInputScope): number | null {
  return previous?.scope === scope ? previous.level : null;
}
