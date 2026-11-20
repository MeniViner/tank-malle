/**
 * Demo mode: a sample car with a year of history, for someone who has not added a car yet
 * (or has none), so they can see what the app shows.
 *
 * Nothing here reaches the account. The sample lives only in this device's localStorage, under
 * the signed-in account's key; changes made while exploring stay there, and leaving the demo
 * (or signing out) deletes it. The data layer swaps it in for the account's vehicles and
 * fill-ups while it is active (see `DemoDataLayer` in DataContext).
 */
import type { Fillup, Vehicle } from "../stats";
import type { TankObservation, TankPlan, TankPreferences } from "../tank/types";
import { DEFAULT_TANK_PREFERENCES } from "../tank/types";
import { TANK_SCHEMA_VERSION } from "../tank/config";

export type DemoKind = "fuel" | "ev";

export interface DemoState {
  version: 1;
  kind: DemoKind;
  activeVehicleId: string;
  vehicles: Vehicle[];
  fillups: Record<string, Fillup[]>;
  observations: Record<string, TankObservation[]>;
  plans: Record<string, TankPlan[]>;
  prefs: Record<string, TankPreferences>;
  /** Care and vehicle records by vehicle, then by collection (serviceEvents, vehicleExpenses, ...). */
  care?: Record<string, Record<string, unknown[]>>;
}

export const DEMO_FUEL_ID = "demo-fuel";
export const DEMO_EV_ID = "demo-ev";
const DAY = 86_400_000;

const key = (uid: string) => `tm.demo.${uid}`;
const listeners = new Set<() => void>();
const cache = new Map<string, DemoState | null>();

export function isDemoVehicleId(id: string | null | undefined): boolean {
  return id === DEMO_FUEL_ID || id === DEMO_EV_ID;
}

export function readDemo(uid: string | null | undefined): DemoState | null {
  if (!uid) return null;
  if (cache.has(uid)) return cache.get(uid) ?? null;
  let state: DemoState | null = null;
  try {
    const raw = localStorage.getItem(key(uid));
    const parsed = raw ? JSON.parse(raw) as DemoState : null;
    state = parsed && parsed.version === 1 && Array.isArray(parsed.vehicles) ? parsed : null;
  } catch { state = null; }
  cache.set(uid, state);
  return state;
}

export function writeDemo(uid: string, state: DemoState | null): void {
  cache.set(uid, state);
  try {
    if (state) localStorage.setItem(key(uid), JSON.stringify(state));
    else localStorage.removeItem(key(uid));
  } catch { /* the in-memory copy still serves this session */ }
  for (const listener of listeners) listener();
}

export function updateDemo(uid: string, change: (state: DemoState) => DemoState): DemoState | null {
  const current = readDemo(uid);
  if (!current) return null;
  const next = change(current);
  writeDemo(uid, next);
  return next;
}

export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("tm.demo.")) { cache.clear(); listener(); }
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function startDemo(uid: string, kind: DemoKind, now = Date.now()): DemoState {
  const state = buildDemo(kind, now);
  writeDemo(uid, state);
  return state;
}

export function exitDemo(uid: string): void {
  writeDemo(uid, null);
}

/* ------------------------------------------------------------------ *
 * The sample data
 * ------------------------------------------------------------------ */

/** A small deterministic generator, so every demo looks the same and tests can rely on it. */
function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
}

const STATIONS = [
  { name: "פז · צומת גלילות", brand: "פז", stationId: "demo-paz-glilot", lat: 32.1489, lng: 34.8057 },
  { name: "דלק · רמת החייל", brand: "דלק", stationId: "demo-delek-ramat-hahayal", lat: 32.1118, lng: 34.8394 },
  { name: "סונול · הרצליה פיתוח", brand: "סונול", stationId: "demo-sonol-herzliya", lat: 32.1624, lng: 34.8091 },
  { name: "Ten · כפר סבא", brand: "Ten", stationId: "demo-ten-kfar-saba", lat: 32.1781, lng: 34.9065 },
];
const CHARGERS = [
  { name: "טעינה ביתית", brand: null, stationId: null },
  { name: "טעינה ביתית", brand: null, stationId: null },
  { name: "טעינה ביתית", brand: null, stationId: null },
  { name: "עמדת טעינה מהירה · גלילות", brand: "Electra", stationId: "demo-charge-glilot", lat: 32.1489, lng: 34.8057 },
];

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Self-service 95 over the last year, roughly as it moved. */
function fuelPrice(date: number, now: number): number {
  const monthsAgo = (now - date) / (30 * DAY);
  return round(7.62 - monthsAgo * 0.02 + Math.sin(monthsAgo / 2) * 0.12, 2);
}

function demoVehicles(now: number): Vehicle[] {
  const createdAt = now - 380 * DAY;
  const fuel: Vehicle = {
    id: DEMO_FUEL_ID, make: "טויוטה", model: "קורולה", year: 2022, plateNumber: "1234567",
    nickname: null, fuelType: "95", tankLiters: 50, tankLitersSource: "user",
    declaredKmPerLiter: 15.6, declaredSource: "user", priceAdjustment: 0, archived: false, createdAt,
    powertrain: "ice",
  };
  const ev: Vehicle = {
    id: DEMO_EV_ID, make: "BYD", model: "Atto 3", year: 2023, plateNumber: "12345678",
    nickname: null, fuelType: "other", tankLiters: null, tankLitersSource: null,
    declaredKmPerLiter: null, declaredSource: null, priceAdjustment: 0, archived: false, createdAt,
    powertrain: "ev", battery: { kwh: 60.5, wltp: 420 }, motorKw: 150,
  };
  return [fuel, ev];
}

function fuelFillups(now: number): Fillup[] {
  const next = random(17);
  const list: Fillup[] = [];
  let date = now - 365 * DAY;
  let odometer = 41_200;
  let index = 0;
  while (date < now - 3 * DAY) {
    const km = 420 + Math.round(next() * 230);
    const kmPerLiter = 14.2 + next() * 2.4;
    const partial = index > 2 && next() < 0.12;
    const liters = round(partial ? 18 + next() * 8 : km / kmPerLiter, 2);
    const pricePerLiter = fuelPrice(date, now);
    const station = STATIONS[Math.floor(next() * STATIONS.length)];
    odometer += km;
    list.push({
      id: `demo-f-${index}`, date: date + Math.round(next() * 10) * 3_600_000 + 7 * 3_600_000, odometer, liters, pricePerLiter,
      totalCost: round(liters * pricePerLiter, 2), isFullTank: !partial, station: { ...station },
      notes: null, createdAt: date, continuityBreakBefore: false, fullTankSource: "user", fuelType: "95",
      fillEndState: partial ? "partial" : "full", fillEndStateSource: "user-confirmed", tankSchemaVersion: TANK_SCHEMA_VERSION,
      capacityLitersAtEntry: 50, version: 1, schemaVersion: 2,
    });
    date += (7 + Math.round(next() * 6)) * DAY;
    index += 1;
  }
  return list;
}

function evCharges(now: number): Fillup[] {
  const next = random(29);
  const list: Fillup[] = [];
  let date = now - 365 * DAY;
  let odometer = 18_600;
  let index = 0;
  while (date < now - 2 * DAY) {
    const charger = CHARGERS[Math.floor(next() * CHARGERS.length)];
    const fast = charger.stationId !== null;
    const km = 160 + Math.round(next() * 140);
    const kwh = round(km * (0.15 + next() * 0.03), 1);
    const pricePerLiter = fast ? 1.79 : 0.64;
    odometer += km;
    list.push({
      id: `demo-e-${index}`, date: date + (fast ? 13 : 22) * 3_600_000, odometer, liters: kwh, pricePerLiter,
      totalCost: round(kwh * pricePerLiter, 2), isFullTank: true, station: { ...charger },
      notes: null, createdAt: date, continuityBreakBefore: false, fullTankSource: "user", fuelType: "other",
      fillEndState: "full", fillEndStateSource: "user-confirmed", tankSchemaVersion: TANK_SCHEMA_VERSION,
      version: 1, schemaVersion: 2,
    });
    date += (4 + Math.round(next() * 4)) * DAY;
    index += 1;
  }
  return list;
}

function day(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function demoCare(odometer: number, now: number, ev: boolean): Record<string, unknown[]> {
  const base = { schemaVersion: 1, version: 1, notes: "" };
  return {
    serviceEvents: [{ ...base, id: "demo-s-0", day: day(now - 130 * DAY), title: "טיפול תקופתי", jobs: ev ? ["periodic", "tires"] : ["periodic", "oil"],
      odometer: odometer - 5_200, costAgorot: ev ? 62_000 : 118_000, garage: "מוסך לדוגמה", completedPlanIds: [] }],
    maintenancePlans: [{ ...base, id: "demo-m-0", title: "טיפול תקופתי", job: "periodic", dueDay: day(now + 50 * DAY), dueOdometer: odometer + 9_800,
      intervalMonths: 12, intervalKm: 15_000, basis: "completion", source: "manufacturer", active: true }],
    vehicleExpenses: [
      { ...base, id: "demo-x-0", day: day(now - 240 * DAY), category: "insurance", title: "ביטוח חובה ומקיף", costAgorot: ev ? 520_000 : 460_000 },
      { ...base, id: "demo-x-1", day: day(now - 60 * DAY), category: "registration", title: "אגרת רישוי וטסט", costAgorot: ev ? 98_000 : 145_000 },
      { ...base, id: "demo-x-2", day: day(now - 20 * DAY), category: "wash", title: "שטיפה", costAgorot: 6_000 },
    ],
    odometerReadings: [], vehicleIssues: [], notificationStates: [],
  };
}

export function buildDemo(kind: DemoKind, now = Date.now()): DemoState {
  const vehicles = demoVehicles(now);
  const fuel = fuelFillups(now);
  const ev = evCharges(now);
  const last = fuel[fuel.length - 1];
  const gauge: TankObservation = {
    id: "demo-o-0", vehicleId: DEMO_FUEL_ID, observedAt: now - 3_600_000, recordedAt: now - 3_600_000, kind: "both",
    odometer: last.odometer + Math.round((now - last.date) / DAY * 45), level: 0.55, levelUncertainty: 0.12,
    levelSource: "direct-gauge", confirmed: true, phase: "standalone", schemaVersion: 1,
  };
  return {
    version: 1, kind, activeVehicleId: kind === "ev" ? DEMO_EV_ID : DEMO_FUEL_ID, vehicles,
    fillups: { [DEMO_FUEL_ID]: fuel, [DEMO_EV_ID]: ev },
    observations: { [DEMO_FUEL_ID]: [gauge], [DEMO_EV_ID]: [] },
    plans: { [DEMO_FUEL_ID]: [], [DEMO_EV_ID]: [] },
    prefs: { [DEMO_FUEL_ID]: { ...DEFAULT_TANK_PREFERENCES }, [DEMO_EV_ID]: { ...DEFAULT_TANK_PREFERENCES } },
    care: { [DEMO_FUEL_ID]: demoCare(gauge.odometer ?? last.odometer, now, false), [DEMO_EV_ID]: demoCare(ev[ev.length - 1].odometer, now, true) },
  };
}
