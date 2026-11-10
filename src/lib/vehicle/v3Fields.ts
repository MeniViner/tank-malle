/**
 * Design v3 vehicle fields: business-statement metadata (`biz`) and the EV
 * registry fields (`powertrain`, `battery`, `motorKw`).
 *
 * All optional; a vehicle stored before they existed reads as "no business
 * details" and "not known to be electric" — exactly the old behaviour. Every
 * reader still goes through these functions (defence in depth). The Firestore
 * rules validate the fields on every vehicle write that touches one of them,
 * including a patch that also changes `docs` (a write that would exceed the
 * expression budget is refused, never accepted unvalidated).
 * Mirrors `validVehicleV3` in firestore.rules.
 */

export interface VehicleBiz {
  /** Business name for the monthly statement header. */
  company?: string;
  /** Driver's name. */
  driver?: string;
  /** Business-use share, 0–100. Shown on the statement; never applied to stored amounts. */
  usagePct?: number;
}
export const BIZ_LIMITS = { company: 120, driver: 80 } as const;

/** 'ice' combustion, 'phev' plug-in hybrid (still has a tank), 'ev' battery-electric. */
export type Powertrain = 'ice' | 'phev' | 'ev';
export interface VehicleBattery {
  /** Usable/nominal battery capacity in kWh, when known. */
  kwh?: number | null;
  /** WLTP combined range in km, when known. */
  wltp?: number | null;
}
export const EV_LIMITS = { kwh: [0.1, 500], wltp: [1, 2000], motorKw: [1, 2000] } as const;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, [low, high]: readonly [number, number]): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

/** Bounded reader. Unknown keys or malformed values make the whole value unreadable (null). */
export function readBiz(value: unknown): VehicleBiz | null {
  if (!isObject(value) || Object.keys(value).some(key => !['company', 'driver', 'usagePct'].includes(key))) return null;
  const out: VehicleBiz = {};
  for (const key of ['company', 'driver'] as const) {
    const text = value[key];
    if (text === undefined || text === null) continue;
    if (typeof text !== 'string' || text.length > BIZ_LIMITS[key]) return null;
    out[key] = text;
  }
  if (value.usagePct !== undefined && value.usagePct !== null) {
    if (!bounded(value.usagePct, [0, 100])) return null;
    out.usagePct = value.usagePct;
  }
  return out;
}

export function readPowertrain(value: unknown): Powertrain | null {
  return value === 'ice' || value === 'phev' || value === 'ev' ? value : null;
}

export function readBattery(value: unknown): VehicleBattery | null {
  if (!isObject(value) || Object.keys(value).some(key => key !== 'kwh' && key !== 'wltp')) return null;
  const kwh = value.kwh ?? null, wltp = value.wltp ?? null;
  if ((kwh !== null && !bounded(kwh, EV_LIMITS.kwh)) || (wltp !== null && !bounded(wltp, EV_LIMITS.wltp))) return null;
  if (kwh === null && wltp === null) return null;
  return { kwh, wltp };
}

export function readMotorKw(value: unknown): number | null {
  return bounded(value, EV_LIMITS.motorKw) ? value : null;
}

/**
 * Normalise a business-details form into a stored value. Empty strings are
 * dropped; an entirely empty form clears the field (null). Throws on input the
 * rules would refuse, so the outbox never holds an unwritable patch.
 */
export function bizPatch(input: { company?: string | null; driver?: string | null; usagePct?: number | null }): VehicleBiz | null {
  const out: VehicleBiz = {};
  const company = input.company?.trim(), driver = input.driver?.trim();
  if (company) out.company = company;
  if (driver) out.driver = driver;
  if (input.usagePct !== undefined && input.usagePct !== null) out.usagePct = input.usagePct;
  if (readBiz(out) === null) throw new Error('פרטי העסק אינם תקינים: שם עד 120 תווים, נהג עד 80 תווים ושימוש עסקי בין 0 ל־100%.');
  return Object.keys(out).length ? out : null;
}

/** Anything with the v3 EV fields; a Vehicle satisfies it. */
export interface EvCandidate { powertrain?: unknown; fuelType?: unknown }

/**
 * Battery-electric: no tank, no engine displacement, no litres. Only an
 * explicit `powertrain: 'ev'` counts — a legacy `fuelType: 'other'` may be LPG
 * or a hybrid, and calling it electric would hide a real fuel tank.
 */
export function isEv(vehicle: EvCandidate | null | undefined): boolean {
  return readPowertrain(vehicle?.powertrain) === 'ev';
}

/** Rough km per kWh from the WLTP figures, for a reference line only. Never stored. */
export function wltpKmPerKwh(battery: VehicleBattery | null | undefined): number | null {
  if (!battery?.kwh || !battery.wltp) return null;
  return Math.round((battery.wltp / battery.kwh) * 10) / 10;
}

/**
 * Registry `koah_sus` (metric horsepower, PS) to kW, rounded to whole kW.
 * Same constant as the declared-consumption join (declaredCatalog.ts).
 * BYD Atto 3: 204 PS → 150 kW.
 */
export function horsepowerToKw(hp: unknown): number | null {
  const value = typeof hp === 'number' ? hp : typeof hp === 'string' ? Number.parseFloat(hp) : NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return readMotorKw(Math.round(value * 0.73549875));
}

/**
 * Powertrain from the registry's fuel/drive labels.
 *  - plate registry `sug_delek_nm`: "חשמל" (EV), "חשמל/בנזין" / "חשמל/דיזל" (plug-in), "בנזין"/"סולר"…
 *  - WLTP register `delek_nm` + `technologiat_hanaa_nm`: "רכב חשמלי" / "PLUG IN".
 * Ordinary hybrids ("HSD") are registered as petrol and stay unknown (null):
 * they have a tank and are treated exactly as before.
 */
export function powertrainFromRegistry(fuelLabel: unknown, technology?: unknown): Powertrain | null {
  const fuel = typeof fuelLabel === 'string' ? fuelLabel.trim() : '';
  const tech = typeof technology === 'string' ? technology.trim() : '';
  if (/plug\s*-?\s*in/i.test(tech) || /חשמל\s*\/\s*(בנזין|סולר|דיזל)|(בנזין|סולר|דיזל)\s*\/\s*חשמל/.test(fuel)) return 'phev';
  if (/רכב חשמלי|^BEV$/i.test(tech) || /^חשמל$/.test(fuel)) return 'ev';
  return null;
}

/** What a registry lookup + spec fetch learned about the drivetrain. */
export interface EvLookup {
  powertrain?: Powertrain | null;
  motorKw?: number | null;
  battery?: VehicleBattery | null;
}
type EvVehicleFields = { powertrain?: Powertrain | null; battery?: VehicleBattery | null; motorKw?: number | null };

/**
 * Fields to store for a newly created vehicle. Only what was actually found is
 * written; nothing is invented for a combustion car (no `powertrain: 'ice'`
 * guess — the registry does not distinguish a hybrid from plain petrol).
 */
export function evFieldsForCreation(found: EvLookup | null | undefined): EvVehicleFields {
  const powertrain = readPowertrain(found?.powertrain);
  const motorKw = readMotorKw(found?.motorKw);
  const battery = powertrain === 'ev' ? readBattery(found?.battery) : null;
  return { ...(powertrain ? { powertrain } : {}), ...(motorKw !== null ? { motorKw } : {}), ...(battery ? { battery } : {}) };
}

/**
 * Vehicle "refresh" (עדכון ממשרד התחבורה): the registry owns powertrain and
 * motor power, so a new answer replaces them. Battery figures may have been
 * typed by the owner, so a looked-up battery only fills a missing one (each of
 * kWh / range separately). Returns only keys whose stored value changes.
 */
export function evRefreshPatch(current: EvVehicleFields, found: EvLookup | null | undefined): EvVehicleFields {
  const patch: EvVehicleFields = {};
  const powertrain = readPowertrain(found?.powertrain);
  const motorKw = readMotorKw(found?.motorKw);
  if (powertrain && powertrain !== readPowertrain(current.powertrain)) patch.powertrain = powertrain;
  if (motorKw !== null && motorKw !== readMotorKw(current.motorKw)) patch.motorKw = motorKw;
  const looked = (powertrain ?? readPowertrain(current.powertrain)) === 'ev' ? readBattery(found?.battery) : null;
  if (looked) {
    const stored = readBattery(current.battery);
    const next = { kwh: stored?.kwh ?? looked.kwh ?? null, wltp: stored?.wltp ?? looked.wltp ?? null };
    if (next.kwh !== (stored?.kwh ?? null) || next.wltp !== (stored?.wltp ?? null)) patch.battery = next;
  }
  return patch;
}
