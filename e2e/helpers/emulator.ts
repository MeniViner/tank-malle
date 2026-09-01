/**
 * Emulator control for E2E tests.
 *
 * Everything here talks to the LOCAL emulators only. The project id is
 * `demo-tankmaleh`, which the Firebase emulators special-case: they refuse to
 * contact any real Google service, so a misconfigured test cannot reach
 * production even by accident.
 */

export const PROJECT_ID = "demo-tankmaleh";
export const AUTH_HOST = "http://127.0.0.1:9099";
export const FIRESTORE_HOST = "http://127.0.0.1:8080";

function assertLocal(url: string): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error(`refusing to talk to a non-local host: ${url}`);
  }
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  assertLocal(url);
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} → ${response.status}`);
  }
  return response;
}

/** Wipe every Firestore document. Called between specs. */
export async function clearFirestore(): Promise<void> {
  await call(
    `${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
}

/** Wipe every Auth account, so account ids do not leak between specs. */
export async function clearAuth(): Promise<void> {
  await call(`${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: "DELETE",
    headers: { Authorization: "Bearer owner" },
  });
}

export async function resetEmulators(): Promise<void> {
  await Promise.all([clearFirestore(), clearAuth()]);
}

export interface EmulatorAccount {
  localId: string;
  email: string;
}

/**
 * Every account currently in the Auth emulator.
 *
 * The project-level endpoints want an owner token; the emulator accepts the
 * literal string "owner" for it and validates nothing further.
 */
export async function listAccounts(): Promise<EmulatorAccount[]> {
  const response = await call(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer owner",
      },
      body: "{}",
    },
  );
  const payload = (await response.json()) as { userInfo?: EmulatorAccount[] };
  return payload.userInfo ?? [];
}

export async function uidForEmail(email: string): Promise<string | null> {
  const accounts = await listAccounts();
  return accounts.find((entry) => entry.email === email)?.localId ?? null;
}

/* ------------------------------------------------------------------ *
 * Firestore REST — used to seed and to assert server state directly
 * ------------------------------------------------------------------ */

const DOCS = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/**
 * The emulator treats "Bearer owner" as an admin credential, which bypasses
 * security rules. That is what these helpers want: seeding and assertions
 * should observe the true stored state, not a rules-filtered view of it. The
 * rules themselves are covered separately by `npm run test:rules`.
 */
const ADMIN = { Authorization: "Bearer owner" } as const;

type Primitive = string | number | boolean | null | Date;

function toValue(value: Primitive | Record<string, Primitive>): unknown {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  return { mapValue: { fields: toFields(value) } };
}

function toFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    fields[key] = toValue(value as Primitive);
  }
  return fields;
}

function fromValue(value: Record<string, unknown>): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return new Date(value.timestampValue as string).getTime();
  if ("nullValue" in value) return null;
  if ("mapValue" in value) {
    return fromFields(((value.mapValue as Record<string, unknown>).fields ?? {}) as Record<string, Record<string, unknown>>);
  }
  return undefined;
}

function fromFields(
  fields: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = fromValue(value);
  return out;
}

/** Write a document, bypassing rules (the REST admin path on the emulator). */
export async function setDocument(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await call(`${DOCS}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...ADMIN },
    body: JSON.stringify({ fields: toFields(data) }),
  });
}

export async function getDocument(
  path: string,
): Promise<Record<string, unknown> | null> {
  assertLocal(`${DOCS}/${path}`);
  const response = await fetch(`${DOCS}/${path}`, { headers: ADMIN });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  const payload = (await response.json()) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  return fromFields(payload.fields ?? {});
}

export async function listDocuments(
  collectionPath: string,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const url = `${DOCS}/${collectionPath}?pageSize=300`;
  assertLocal(url);
  const response = await fetch(url, { headers: ADMIN });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`LIST ${collectionPath} → ${response.status}`);
  const payload = (await response.json()) as {
    documents?: { name: string; fields?: Record<string, Record<string, unknown>> }[];
  };
  return (payload.documents ?? []).map((entry) => ({
    id: entry.name.split("/").pop() as string,
    data: fromFields(entry.fields ?? {}),
  }));
}

/* ------------------------------------------------------------------ *
 * Seeding
 *
 * Some scenarios need a dozen records before the thing under test even
 * starts. Driving that through the UI would make the suite slow and would
 * test the fill-up form over and over instead of the thing in question, so
 * those are written straight to Firestore. Anything the test is actually
 * asserting about still goes through the UI.
 * ------------------------------------------------------------------ */

export interface SeedVehicle {
  make: string;
  model: string;
  fuelType?: "95" | "98" | "diesel" | "other";
  year?: number;
  tankLiters?: number;
  declaredKmPerLiter?: number;
  priceAdjustment?: number;
  manualPricePerLiter?: number;
}

export async function seedVehicle(
  uid: string,
  vehicleId: string,
  vehicle: SeedVehicle,
): Promise<void> {
  await setDocument(`users/${uid}/vehicles/${vehicleId}`, {
    make: vehicle.make,
    model: vehicle.model,
    fuelType: vehicle.fuelType ?? "95",
    year: vehicle.year ?? null,
    archived: false,
    priceAdjustment: vehicle.priceAdjustment ?? 0,
    manualPricePerLiter: vehicle.manualPricePerLiter ?? null,
    tankLiters: vehicle.tankLiters ?? null,
    declaredKmPerLiter: vehicle.declaredKmPerLiter ?? null,
    createdAt: new Date(),
  });
}

/** Make a seeded vehicle the active one, as the settings document would. */
export async function setActiveVehicle(uid: string, vehicleId: string): Promise<void> {
  await setDocument(`users/${uid}`, {
    settings: { activeVehicleId: vehicleId, units: "kmPerLiter", onboardingDone: true },
  });
}

export interface SeedFillup {
  id: string;
  date: Date;
  odometer: number;
  liters: number;
  pricePerLiter?: number;
  totalCost?: number;
  isFullTank?: boolean;
  continuityBreakBefore?: boolean;
  stationName?: string;
  importBatchId?: string;
  importRowHash?: string;
  importSource?: string;
}

export async function seedFillups(
  uid: string,
  vehicleId: string,
  fillups: SeedFillup[],
): Promise<void> {
  for (const fillup of fillups) {
    const price = fillup.pricePerLiter ?? 7;
    await setDocument(`users/${uid}/vehicles/${vehicleId}/fillups/${fillup.id}`, {
      date: fillup.date,
      odometer: fillup.odometer,
      liters: fillup.liters,
      pricePerLiter: price,
      totalCost: fillup.totalCost ?? Math.round(fillup.liters * price * 100) / 100,
      isFullTank: fillup.isFullTank ?? true,
      continuityBreakBefore: fillup.continuityBreakBefore ?? false,
      createdAt: fillup.date,
      ...(fillup.stationName ? { station: { name: fillup.stationName } } : {}),
      ...(fillup.importBatchId ? { importBatchId: fillup.importBatchId } : {}),
      ...(fillup.importRowHash ? { importRowHash: fillup.importRowHash } : {}),
      ...(fillup.importSource ? { importSource: fillup.importSource } : {}),
    });
  }
}

/** Seed a peer benchmark document, for the Community comparison. */
export async function seedBenchmark(
  docId: string,
  entry: {
    modelKey: string;
    fuelType: string;
    avgKmPerLiter: number;
    segments?: number;
    avgPricePerLiter?: number;
    year?: number | null;
  },
): Promise<void> {
  await setDocument(`benchmarks/${docId}`, {
    modelKey: entry.modelKey,
    fuelType: entry.fuelType,
    year: entry.year ?? null,
    avgKmPerLiter: entry.avgKmPerLiter,
    segments: entry.segments ?? 4,
    avgPricePerLiter: entry.avgPricePerLiter ?? 7.2,
  });
}

/** The regulated maximum, as the admin editor would have written it. */
export async function seedRegulatedPrice(pricePerLiter: number): Promise<void> {
  const month = new Date();
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  await setDocument("appConfig/fuelPrices", {
    current: { pricePerLiter, updatedAt: new Date() },
    history: { [key]: pricePerLiter },
  });
}

/**
 * Wait for a document matching `match` to appear in a collection.
 *
 * A write that the UI has confirmed is queued locally, not necessarily
 * acknowledged by the server — which is the distinction the app itself is
 * careful about — so a REST read straight after a toast can legitimately miss
 * it. This polls instead of racing.
 */
export async function waitForDocument(
  collectionPath: string,
  match: (data: Record<string, unknown>) => boolean,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: { id: string; data: Record<string, unknown> }[] = [];

  while (Date.now() < deadline) {
    last = await listDocuments(collectionPath);
    const found = last.find((entry) => match(entry.data));
    if (found) return found.data;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `no document in ${collectionPath} matched within ${timeoutMs}ms (saw ${last.length})`,
  );
}
