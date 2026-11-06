/**
 * Fill-up presentation composes the existing public resolver and adjustment
 * arithmetic. Private station keys never become public station identities.
 */
import type { StoredPriceRule } from "../context/DataContext";
import { percentPlain, price } from "./format";
import { discountedPrice, vehicleDiscount } from "./prices/discount";
import { officialPriceFor, officialPriceMoment, priceMonthLabel, type RegulatedPriceConfig } from "./prices/regulated";
import { applyPersonalRule } from "./prices/resolver";
import type { ResolvedPrice } from "./prices/types";
import { normaliseStationText } from "./stations";
import type { FuelPrices, FuelType, StationRef, Vehicle } from "./stats";

const NAME_PREFIX = "tmpp:v1:name:";
const RECEIPT_PREFIX = "tmpp:v1:receipt:";
const RULE_PREFIX = "tmpp.v1.";
const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const MAX_EXPIRY = 4_102_444_800_000;
const FUEL_TYPES: readonly string[] = ["95", "98", "diesel", "other"];
const UNKNOWN_NAMES = new Set([
  "לא ידוע", "לא ידועה", "תחנה לא ידועה", "תחנה לא ידוע", "ללא תחנה",
  "לא נבחרה תחנה", "תחנה", "unknown", "unknown station", "none", "n a",
]);

export interface PumpRuleScope {
  readonly kind: "catalog" | "name" | "receipt";
  readonly vehicleId: string;
  readonly fuelType: FuelType;
  /** Private identity only. Pass publicPriceStationId(station) to the resolver. */
  readonly stationId: string;
  readonly stationName: string | null;
  readonly ruleId: string;
}

export type PumpRuleScopeFailure = "invalid-scope" | "station-unavailable" | "identity-conflict" | "hash-unavailable";
export type PumpRuleScopeResult =
  | { ok: true; scope: PumpRuleScope }
  | { ok: false; reason: PumpRuleScopeFailure };
export type PumpRuleCreationResult =
  | { ok: true; scope: PumpRuleScope; rule: StoredPriceRule }
  | { ok: false; reason: "invalid-scope" | "invalid-price" | "difference-out-of-range" };

export interface LastPaidCandidate {
  vehicleId: string;
  /** Missing legacy fuel snapshots are not evidence for a new price prefill. */
  fuelType?: FuelType | null;
  station?: StationRef | null;
  date: number;
  pricePerLiter: number;
  id?: string;
}

export interface FillupPriceSuggestion {
  price: number | null;
  kind: "public" | "private-rule" | "vehicle-discount" | "last-paid" | "unknown";
  label: string;
  /** The genuine resolver result, returned unchanged and by identity. */
  publicResolved: ResolvedPrice;
  reference: ReturnType<typeof officialPriceFor> | null;
  rule: StoredPriceRule | null;
  lastPaid: LastPaidCandidate | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedId(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !value.includes("/") && value !== "." && value !== ".." &&
    !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function fuel(value: unknown): value is FuelType {
  return typeof value === "string" && FUEL_TYPES.includes(value);
}

function optionalText(value: unknown, max: number): boolean {
  return value == null || typeof value === "string" && value.length <= max;
}

function stationName(station: StationRef | null | undefined): string | null {
  const name = station?.name;
  return typeof name === "string" && name.trim().length > 0 && name.length <= 120 ? name.trim() : null;
}

export function reusableStationName(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 120) return null;
  const normalized = normaliseStationText(value);
  return normalized && !UNKNOWN_NAMES.has(normalized) ? normalized : null;
}

function privateKey(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && DIGEST.test(value.slice(prefix.length));
}

/** A private price-rule key is never a catalog identity, even in malformed input. */
export function publicPriceStationId(station: StationRef | null | undefined): string | null {
  const id = station?.stationId;
  return boundedId(id, 64) && !id.startsWith("tmpp:") ? id : null;
}

/** Decode before defaulting optional values in the UI's legacy rule mapper. */
export function decodeReusablePumpRule(id: string, raw: unknown): StoredPriceRule | null {
  if (!boundedId(id, 128) || id.startsWith("tmpp.") && !privateKey(id, RULE_PREFIX) || !record(raw)) return null;
  const required = ["vehicleId", "fuelType", "stationId", "discountPerLiter", "reviewed", "legacy", "fixedPricePerLiter", "expiresAt"];
  if (!required.every(key => Object.hasOwn(raw, key)) || !boundedId(raw.vehicleId, 64) || !fuel(raw.fuelType) ||
      !boundedId(raw.stationId, 64) || raw.reviewed !== true || raw.legacy !== false || raw.fixedPricePerLiter !== null ||
      typeof raw.discountPerLiter !== "number" || !Number.isFinite(raw.discountPerLiter) ||
      raw.discountPerLiter <= -50 || raw.discountPerLiter >= 50 ||
      !(raw.expiresAt === null || typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt) && raw.expiresAt > 0 && raw.expiresAt < MAX_EXPIRY) ||
      !optionalText(raw.stationName, 120) || !optionalText(raw.label, 80)) return null;
  if (raw.stationId.startsWith("tmpp:") &&
      (!privateKey(raw.stationId, NAME_PREFIX) || !reusableStationName(raw.stationName))) return null;
  return {
    id, vehicleId: raw.vehicleId, fuelType: raw.fuelType, stationId: raw.stationId,
    stationName: typeof raw.stationName === "string" ? raw.stationName : null,
    discountPerLiter: raw.discountPerLiter, fixedPricePerLiter: null,
    label: typeof raw.label === "string" ? raw.label : null,
    expiresAt: raw.expiresAt as number | null, legacy: false, reviewed: true,
  };
}

async function digest(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...hash)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function compatible(raw: unknown, scope: PumpRuleScope): boolean {
  return record(raw) && Object.hasOwn(raw, "vehicleId") && Object.hasOwn(raw, "fuelType") && Object.hasOwn(raw, "stationId") &&
    raw.vehicleId === scope.vehicleId && raw.fuelType === scope.fuelType && raw.stationId === scope.stationId &&
    (scope.kind !== "name" || reusableStationName(raw.stationName) === reusableStationName(scope.stationName));
}

function unoccupiedOrCompatible(scope: PumpRuleScope, occupied: ReadonlyMap<string, unknown>): boolean {
  if (occupied.has(scope.ruleId) && !compatible(occupied.get(scope.ruleId), scope)) return false;
  if (scope.kind === "name") {
    const name = reusableStationName(scope.stationName);
    // A colliding key in any raw rule is evidence against reusable identity,
    // even if that other rule is expired, malformed or scoped to another car.
    for (const raw of occupied.values()) {
      if (record(raw) && raw.stationId === scope.stationId && reusableStationName(raw.stationName) !== name) return false;
    }
  }
  return true;
}

export async function buildPumpRuleScope(input: {
  vehicleId: string;
  fuelType: FuelType;
  station: StationRef | null;
  receiptId?: string;
  occupiedRules: ReadonlyMap<string, unknown>;
}): Promise<PumpRuleScopeResult> {
  if (!boundedId(input.vehicleId, 64) || !fuel(input.fuelType)) return { ok: false, reason: "invalid-scope" };
  const name = stationName(input.station);
  const normalized = reusableStationName(name);
  const catalogId = publicPriceStationId(input.station);
  const unusableId = !!input.station?.stationId && !catalogId;
  const makeScope = async (kind: PumpRuleScope["kind"], id: string): Promise<PumpRuleScope> => ({
    kind, vehicleId: input.vehicleId, fuelType: input.fuelType, stationId: id, stationName: name,
    ruleId: RULE_PREFIX + await digest(["tank-maleh-personal-price-rule", "v1", input.vehicleId, input.fuelType, kind, id]),
  });
  try {
    const reusable = catalogId ? await makeScope("catalog", catalogId) : normalized && !unusableId
      ? await makeScope("name", NAME_PREFIX + await digest(["tank-maleh-private-station-name", "v1", normalized])) : null;
    if (reusable && unoccupiedOrCompatible(reusable, input.occupiedRules)) return { ok: true, scope: reusable };
    if (!boundedId(input.receiptId, 128)) return { ok: false, reason: reusable ? "identity-conflict" : "station-unavailable" };
    const receipt = await makeScope("receipt", RECEIPT_PREFIX + await digest(["tank-maleh-private-receipt", "v1", input.vehicleId, input.receiptId]));
    return unoccupiedOrCompatible(receipt, input.occupiedRules)
      ? { ok: true, scope: receipt }
      : { ok: false, reason: "identity-conflict" };
  } catch {
    return { ok: false, reason: "hash-unavailable" };
  }
}

function validScope(scope: PumpRuleScope): boolean {
  if (!boundedId(scope.vehicleId, 64) || !fuel(scope.fuelType) || !boundedId(scope.stationId, 64) ||
      !privateKey(scope.ruleId, RULE_PREFIX) || !(scope.stationName === null || typeof scope.stationName === "string" && scope.stationName.length <= 120)) return false;
  if (scope.kind === "catalog") return !scope.stationId.startsWith("tmpp:");
  if (scope.kind === "name") return privateKey(scope.stationId, NAME_PREFIX) && reusableStationName(scope.stationName) !== null;
  return scope.kind === "receipt" && privateKey(scope.stationId, RECEIPT_PREFIX);
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** A No answer records only a private difference; it never rewrites the receipt. */
export function createPumpPriceRule(input: {
  scope: PumpRuleScope;
  savedPaidPricePerLiter: number;
  typedPumpPrice: number;
}): PumpRuleCreationResult {
  if (!validScope(input.scope)) return { ok: false, reason: "invalid-scope" };
  if (!validPrice(input.savedPaidPricePerLiter) || !validPrice(input.typedPumpPrice)) return { ok: false, reason: "invalid-price" };
  const difference = input.typedPumpPrice - input.savedPaidPricePerLiter;
  if (difference <= -50 || difference >= 50) return { ok: false, reason: "difference-out-of-range" };
  return { ok: true, scope: input.scope, rule: {
    id: input.scope.ruleId, vehicleId: input.scope.vehicleId, fuelType: input.scope.fuelType,
    stationId: input.scope.stationId, stationName: input.scope.stationName,
    discountPerLiter: difference, fixedPricePerLiter: null,
    label: difference < 0 ? "התאמה אישית מהקבלה" : "הנחה אישית מהקבלה",
    expiresAt: null, legacy: false, reviewed: true,
  } };
}

function sameStation(left: StationRef | null | undefined, right: StationRef | null | undefined): boolean {
  const leftId = publicPriceStationId(left), rightId = publicPriceStationId(right);
  if (leftId || rightId) return leftId !== null && leftId === rightId;
  // A reserved/malformed stored id is not permission to reinterpret its label.
  if (left?.stationId || right?.stationId) return false;
  const leftName = reusableStationName(left?.name), rightName = reusableStationName(right?.name);
  return leftName !== null && leftName === rightName;
}

function mostRecentPaid(input: {
  lastPaid?: LastPaidCandidate | readonly LastPaidCandidate[] | null;
  vehicle: Vehicle;
  station: StationRef | null;
  date: number;
}): LastPaidCandidate | null {
  const candidates: readonly LastPaidCandidate[] = input.lastPaid == null ? [] :
    Array.isArray(input.lastPaid) ? input.lastPaid : [input.lastPaid as LastPaidCandidate];
  const eligible = candidates.filter(candidate => candidate.vehicleId === input.vehicle.id &&
    candidate.fuelType === input.vehicle.fuelType && Number.isFinite(candidate.date) && candidate.date > 0 && candidate.date < input.date &&
    validPrice(candidate.pricePerLiter) && sameStation(candidate.station, input.station))
    .sort((a, b) => b.date - a.date || (a.id ?? "").localeCompare(b.id ?? ""));
  const latest = eligible[0];
  // Equal-time receipts with different prices do not establish which was last.
  return latest && !eligible.some(other => other.date === latest.date && other.pricePerLiter !== latest.pricePerLiter) ? latest : null;
}

function selectedRule(scope: PumpRuleScope | null, rules: readonly StoredPriceRule[], now: number): StoredPriceRule | null {
  if (!scope || !validScope(scope) || scope.kind === "receipt") return null;
  const eligible = rules.flatMap(candidate => {
    const rule = decodeReusablePumpRule(candidate.id, candidate);
    return rule && compatible(rule, scope) && (rule.expiresAt === null || rule.expiresAt >= now) ? [candidate] : [];
  });
  const canonical = eligible.find(rule => rule.id === scope.ruleId);
  if (canonical) return canonical;
  if (!eligible.length || eligible.some(rule => rule.discountPerLiter !== eligible[0].discountPerLiter)) return null;
  return eligible.sort((a, b) => a.id.localeCompare(b.id))[0];
}

function referenceLabel(reference: NonNullable<FillupPriceSuggestion["reference"]>, date: number): string {
  const label = reference.isManual
    ? reference.fromHistory ? "מחיר שהוזן ידנית" : "מחיר אחרון שהוזן ידנית"
    : reference.isRegulated
      ? reference.fromHistory ? "מחיר מרבי מפוקח" : "מחיר מפוקח אחרון שידוע"
      : reference.fromHistory ? "מחיר שנשמר" : "מחיר אחרון שנשמר";
  if (typeof reference.effectiveFrom === "number" && Number.isFinite(reference.effectiveFrom)) {
    return `${label} · מ־${officialPriceMoment(reference.effectiveFrom)}`;
  }
  const month = priceMonthLabel(reference.effectiveMonth, date);
  return month ? `${label} · ${month}` : label;
}

function personalDifferenceLabel(value: number): string {
  return value === 0 ? "התאמה אישית ללא הפרש" :
    `${value < 0 ? "תוספת" : "הנחה"} אישית של ${price(Math.abs(value))} לליטר`;
}

export function suggestFillupPrice(input: {
  publicResolved: ResolvedPrice;
  date: number;
  now: number;
  vehicle: Vehicle;
  station: StationRef | null;
  config: RegulatedPriceConfig | FuelPrices | null;
  scope: PumpRuleScope | null;
  eligibleRules: readonly StoredPriceRule[];
  lastPaid?: LastPaidCandidate | readonly LastPaidCandidate[] | null;
}): FillupPriceSuggestion {
  const { publicResolved: resolved, vehicle, station, scope } = input;
  if (!Number.isFinite(input.date) || input.date <= 0 || !Number.isFinite(input.now) || input.now <= 0) {
    return { publicResolved: resolved, reference: null, rule: null, lastPaid: null, price: null, kind: "unknown", label: "הזינו את המחיר ששילמתם" };
  }
  const sourceMatches = resolved.fuelType === vehicle.fuelType && resolved.stationId === publicPriceStationId(station);
  const reference = sourceMatches && resolved.source === "regulated-max" ? officialPriceFor(input.config, vehicle.fuelType, input.date) : null;
  const common = { publicResolved: resolved, reference, rule: null, lastPaid: null };
  // A configured diesel/98 list price is not a regulated prefill. Preserve its
  // genuine public result for other surfaces; this receipt needs prior paid or
  // a real station observation. No 95 reference can enter either path.
  const usablePublic = sourceMatches && validPrice(resolved.price) && resolved.source !== "unknown" &&
    !(resolved.source === "regulated-max" && vehicle.fuelType !== "95");
  if (!usablePublic) {
    const lastPaid = mostRecentPaid(input);
    return lastPaid
      ? { ...common, price: lastPaid.pricePerLiter, kind: "last-paid", label: "המחיר ששילמת כאן לאחרונה", lastPaid }
      : { ...common, price: null, kind: "unknown", label: "הזינו את המחיר ששילמתם" };
  }
  const basePrice = resolved.price as number;
  const baseLabel = reference ? referenceLabel(reference, input.date) :
    resolved.source === "personal-history" ? "מחיר ששילמת בעבר" :
      resolved.source === "external-provider" ? "מחיר מהתחנה" : "מחיר מדיווח נהגים";
  if (resolved.source === "personal-history") return { ...common, price: basePrice, kind: "public", label: baseLabel };

  const scopeMatches = scope?.vehicleId === vehicle.id && scope.fuelType === vehicle.fuelType &&
    (scope.kind === "catalog" ? scope.stationId === publicPriceStationId(station) :
      scope.kind === "name" && !station?.stationId && reusableStationName(scope.stationName) === reusableStationName(station?.name));
  // The saved rule is the current personal setting, not a reconstruction of
  // past settings. Its explicit expiry still belongs to the transaction date.
  const rule = scopeMatches ? selectedRule(scope, input.eligibleRules, input.date) : null;
  if (rule) {
    // applyPersonalRule retains its existing arithmetic. The temporary input
    // uses the genuine public id; the private stored rule remains separate.
    const adjusted = applyPersonalRule(resolved, [{ ...rule, stationId: resolved.stationId }], input.date);
    return { ...common, price: adjusted.price, kind: "private-rule", label: `${baseLabel} · ${personalDifferenceLabel(rule.discountPerLiter)} (לפי ההגדרה הנוכחית)`, rule };
  }
  const discount = vehicleDiscount(vehicle);
  if (discount && discount.value > 0) {
    const detail = discount.kind === "percent" ? `${discount.value < 0.5 ? "פחות מ־1%" : percentPlain(discount.value)} הנחה אישית` : personalDifferenceLabel(discount.value);
    return { ...common, price: discountedPrice(basePrice, discount), kind: "vehicle-discount", label: `${baseLabel} · ${detail} (לפי ההגדרה הנוכחית)` };
  }
  return { ...common, price: basePrice, kind: "public", label: baseLabel };
}
