import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { reauthenticateWithPopup, type User } from "firebase/auth";
import { db, googleProvider } from "../lib/firebase";
import { clearCache, pruneOldCaches, readCache, writeCache } from "../lib/cache";
import {
  EMPTY_WRITE_STATUS,
  WriteTracker,
  describeError,
  type MutationKind,
  type MutationReceipt,
  type WriteStatus,
} from "../lib/writes";
import {
  Outbox,
  OutboxStorageError,
  outboxKey,
  reconcileWithServer,
  type OutboxKind,
  type OutboxOperation,
  type OutboxPayload,
} from "../lib/outbox";
import {
  SERVER_TIMESTAMP,
  fillupPayloadMatches,
  parseFillupDocument,
  serializeFillup,
  serializeFillupPatch,
  toEpochMillis,
  type FillupWrite,
} from "../lib/fillupSerializer";
import { APP_VERSION } from "../lib/version";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import {
  DEFAULT_SETTINGS,
  type Fillup,
  type FuelType,
  type UserSettings,
  type Vehicle,
} from "../lib/types";
import {
  normalizePriceDocument,
  type RegulatedPriceConfig,
} from "../lib/prices/regulated";
import {
  DEFAULT_TANK_PREFERENCES,
  type TankObservation,
  type TankPlan,
  type TankPreferences,
} from "../lib/tank/types";

interface DataContextValue {
  ready: boolean;
  settings: UserSettings;
  vehicles: Vehicle[];
  activeVehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  fillups: Fillup[];
  prices: RegulatedPriceConfig | null;
  /** True while the initial fill-up snapshot is still loading. */
  loadingFillups: boolean;
  /** True when the current view came from the local cache, not the server. */
  fromCache: boolean;
  /** Firestore is serving from cache because the network is unavailable. */
  offline: boolean;
  /**
   * Truthful write state. `pending` are writes the local cache accepted but
   * the server has not acknowledged; `failed` are writes the server rejected
   * permanently and which the user must be told about.
   */
  writes: WriteStatus;
  /** Drop a failure the user has acknowledged. */
  dismissWriteFailure: (id: string) => void;
  /**
   * The durable outbox: every unacknowledged or rejected write for this
   * account, with its complete payload. Survives reloads and sign-outs.
   */
  outbox: OutboxOperation[];
  /** Fill-up ids the local SDK has written but the server has not acknowledged. */
  pendingFillupIds: ReadonlySet<string>;
  /** Set when the fill-up listener failed; distinct from an empty history. */
  fillupsError: string | null;
  /** Stored records this client could not read (e.g. an unreadable date). */
  malformedFillups: { id: string; reason: string; raw: Record<string, unknown> }[];
  /** Re-submit a failed or conflicted operation. Idempotent by document id. */
  retryOperation: (opId: string) => Promise<void>;
  /** Resolve a conflict explicitly: keep the server's version or overwrite it. */
  resolveConflict: (opId: string, choice: "keep-server" | "overwrite") => Promise<void>;
  /** Drop an operation the user explicitly gave up on. */
  discardOperation: (opId: string) => void;

  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setActiveVehicle: (vehicleId: string) => Promise<void>;

  addVehicle: (vehicle: Omit<Vehicle, "id" | "createdAt">) => Promise<string>;
  updateVehicle: (vehicleId: string, patch: Partial<Vehicle>) => Promise<void>;
  setVehicleArchived: (vehicleId: string, archived: boolean) => Promise<void>;
  deleteVehicle: (vehicleId: string) => Promise<void>;

  /**
   * Create a fill-up. The payload is written to the outbox BEFORE Firestore
   * sees it; a storage failure throws and nothing is submitted. `replaceOpId`
   * re-submits an edited copy of a failed operation under the same op id.
   */
  addFillup: (
    fillup: FillupWrite,
    options?: { replaceOpId?: string | null; vehicleId?: string },
  ) => Promise<string>;
  /**
   * Replace a record's fields. `previous` is the before-image: kept in the
   * outbox so a retry can detect that the server moved on in the meantime.
   */
  updateFillup: (fillupId: string, next: FillupWrite, previous?: Fillup | null) => Promise<void>;
  deleteFillup: (fillup: Fillup) => Promise<void>;
  /** Re-create a deleted record with its original id and creation metadata, for Undo. */
  restoreFillup: (fillup: Fillup) => Promise<void>;
  /** Write many fill-ups at once, for an import batch. */
  addFillupBatch: (
    vehicleId: string,
    fillups: Omit<Fillup, "id" | "createdAt">[],
    meta: ImportBatchMeta,
  ) => Promise<{ written: number; receipt: MutationReceipt }>;
  /** Completed imports, newest first. Read on demand, not kept in a listener. */
  listImportBatches: () => Promise<ImportBatch[]>;
  /** The user's explicit personal pricing rules. */
  priceRules: StoredPriceRule[];
  savePriceRule: (rule: StoredPriceRule) => Promise<void>;
  deletePriceRule: (ruleId: string) => Promise<void>;
  /**
   * Undo one import. Deletes ONLY the records carrying that batch id, and then
   * the batch record itself.
   */
  deleteImportBatch: (batch: ImportBatch) => Promise<ImportRollbackResult>;

  /**
   * Standalone gauge / odometer updates for the active vehicle.
   *
   * These are readings, not transactions: nothing here creates spending or
   * purchased litres, and none of it ever leaves the owner's own subtree.
   */
  observations: TankObservation[];
  addObservation: (
    observation: Omit<TankObservation, "id" | "vehicleId" | "recordedAt">,
  ) => Promise<string>;
  deleteObservation: (observationId: string) => Promise<void>;

  /** Upcoming journeys. They move the forecast and never become real travel. */
  plans: TankPlan[];
  addPlan: (plan: Omit<TankPlan, "id" | "vehicleId" | "createdAt">) => Promise<string>;
  deletePlan: (planId: string) => Promise<void>;

  /** Per-vehicle tank preferences, with the product defaults filled in. */
  tankPreferences: TankPreferences;
  updateTankPreferences: (patch: Partial<TankPreferences>) => Promise<void>;

  /** Reports exactly what was and was not deleted. Never claims a clean sweep. */
  deleteAccount: () => Promise<DeletionResult>;
}

/** Read a stored preferences map defensively; any gap falls back to a default. */
function readTankPreferences(raw: unknown): TankPreferences {
  const data = (raw ?? {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number | null): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    reserveFraction:
      number(data.reserveFraction, DEFAULT_TANK_PREFERENCES.reserveFraction) ??
      DEFAULT_TANK_PREFERENCES.reserveFraction,
    refuelLevelOverride: number(data.refuelLevelOverride, null),
    usualFillStyle:
      data.usualFillStyle === "full" ||
      data.usualFillStyle === "partial" ||
      data.usualFillStyle === "unknown"
        ? data.usualFillStyle
        : null,
    usualRefuelLevel: number(data.usualRefuelLevel, null),
    habitResetAt: number(data.habitResetAt, null),
  };
}

/**
 * Attach a Firestore listener that survives an account handover.
 *
 * Two things happen when the signed-in user changes, and Firestore handles
 * neither of them for us:
 *
 * 1. Listeners still attached to the OUTGOING account's paths fail with
 *    permission-denied before React runs their cleanup. An onSnapshot with no
 *    error callback rethrows that.
 * 2. Listeners attached to the INCOMING account's paths can be created before
 *    the SDK has finished swapping its auth token, so they are evaluated
 *    against the previous user's credentials and also fail with
 *    permission-denied — and a Firestore listener that fails this way is
 *    terminated permanently. It never retries on its own.
 *
 * (2) is what left a second tab stuck on "add your first vehicle" after
 * switching accounts: the write had landed in Firestore, but the listener that
 * should have delivered it was already dead, and only a manual reload fixed it.
 *
 * So a permission error is re-attached a few times with a short backoff, which
 * is far longer than a token swap needs. A genuine, persistent permission
 * failure exhausts the retries and is then reported rather than hidden.
 */
function subscribeResilient<T>(
  attach: (onNext: (value: T) => void, onError: (error: unknown) => void) => () => void,
  onNext: (value: T) => void,
  options: {
    /** False once the account has moved on; the result is then dropped. */
    isCurrent: () => boolean;
    label: string;
    onError?: (error: unknown) => void;
    maxRetries?: number;
  },
): () => void {
  const maxRetries = options.maxRetries ?? 5;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let cancelled = false;

  const start = (): void => {
    if (cancelled) return;
    unsubscribe = attach(
      (value) => {
        if (!cancelled && options.isCurrent()) onNext(value);
      },
      (error) => {
        if (cancelled || !options.isCurrent()) return;

        const code = (error as { code?: string })?.code;
        if (code === "permission-denied" && attempts < maxRetries) {
          attempts += 1;
          unsubscribe?.();
          unsubscribe = null;
          timer = setTimeout(start, 120 * attempts);
          return;
        }

        // eslint-disable-next-line no-console
        console.warn(`[tank-maleh] ${options.label} listener failed`, error);
        options.onError?.(error);
      },
    );
  };

  start();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubscribe?.();
  };
}

/**
 * Monotonic session counter.
 *
 * Module-scoped rather than a compound assignment on the ref, which the React
 * lint rule reads as an unsafe mutation. The value only ever moves forward, so
 * a stale callback comparing against it can always tell that its session has
 * ended.
 */
let sessionCounter = 0;

/**
 * A personal pricing rule as stored.
 *
 * Deliberately scoped. The thing it replaces — `vehicle.priceAdjustment` and
 * `vehicle.manualPricePerLiter` — was vehicle-wide, permanent and invisible:
 * set once, then quietly setting the price of every future fill-up.
 */
export interface StoredPriceRule {
  id: string;
  /** null means every vehicle. */
  vehicleId: string | null;
  /** null means every station. A real rule normally names one. */
  stationId: string | null;
  stationName: string | null;
  fuelType: FuelType | null;
  /** ₪ per litre off the posted price. Negative is a surcharge. */
  discountPerLiter: number;
  /** A flat price that replaces the resolved one, when that is the deal. */
  fixedPricePerLiter: number | null;
  label: string | null;
  expiresAt: number | null;
  /** Carried over from the pre-upgrade vehicle fields. */
  legacy: boolean;
  /** A legacy rule does nothing until the user has confirmed it. */
  reviewed: boolean;
}

/** What an import batch records about itself, for a later rollback. */
export interface ImportBatchMeta {
  /** The detected source format, e.g. "legacy-fuel-tracker". */
  format: string;
  /** The file the user chose, for recognising the batch later. */
  fileName: string;
  recordCount: number;
  vehicleLabel: string;
}

export interface ImportBatch extends ImportBatchMeta {
  id: string;
  vehicleId: string;
  importedAt: number;
}

/** Outcome of rolling one import back. Never claims more than it did. */
export interface ImportRollbackResult {
  /** Records actually removed. */
  deleted: number;
  /** True when every record and the batch record itself were removed. */
  ok: boolean;
  /** Set when the server has not acknowledged the deletions yet. */
  pending?: boolean;
  reason?: string;
}

/** Outcome of an account deletion. */
export interface DeletionResult {
  ok: boolean;
  /** Collections successfully removed. */
  deleted: string[];
  /** Collections that failed; the user is told, not reassured. */
  failed: string[];
  /** True when Firebase Auth wants a fresh sign-in before it will delete. */
  needsReauth?: boolean;
}

/**
 * Firebase refuses to delete a user whose sign-in is not recent. Proving that
 * first turns "we deleted your data and then could not delete your account"
 * into a request the user can simply satisfy.
 */
async function ensureRecentLogin(user: User): Promise<{ ok: boolean }> {
  try {
    await reauthenticateWithPopup(user, googleProvider);
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    // Already recent enough, or the user simply closed the popup.
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return { ok: false };
    }
    // Some providers reject a redundant reauth; a fresh token proves the point.
    try {
      await user.getIdToken(true);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * A date that cannot be read is reported, not replaced with "now". For the
 * documents where a missing timestamp is merely cosmetic (a vehicle's
 * createdAt) callers fall back to 0 explicitly.
 */
function toMillis(value: unknown): number {
  return toEpochMillis(value) ?? 0;
}

/** Outbox payload → Firestore document: dates and the server-stamp sentinel. */
function toFirestoreData(payload: OutboxPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (key === "date" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else if (key === "observedAt" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else if (value === SERVER_TIMESTAMP) out[key] = serverTimestamp();
    else if (key === "createdAt" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else if (key === "recordedAt" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else out[key] = value;
  }
  return out;
}

function errorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? "unknown";
}

function errorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message;
  return typeof message === "string" ? message.slice(0, 500) : String(error).slice(0, 500);
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Firestore rejects `undefined`; strip those keys before every write. */
function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as T;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { setTheme, setAccent } = useTheme();

  // The uid, not the User object: a token refresh produces a NEW User instance
  // for the SAME person, and keying effects on the object tears down and
  // rebuilds every listener for no reason.
  const uid = user?.uid ?? null;

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [prices, setPrices] = useState<RegulatedPriceConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingFillups, setLoadingFillups] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [fromCache, setFromCache] = useState(false);
  const [writes, setWrites] = useState<WriteStatus>(EMPTY_WRITE_STATUS);
  const [priceRules, setPriceRules] = useState<StoredPriceRule[]>([]);
  const [observations, setObservations] = useState<TankObservation[]>([]);
  const [plans, setPlans] = useState<TankPlan[]>([]);
  const [outboxOps, setOutboxOps] = useState<OutboxOperation[]>([]);
  const [pendingFillupIds, setPendingFillupIds] = useState<ReadonlySet<string>>(new Set());
  const [fillupsError, setFillupsError] = useState<string | null>(null);
  const [malformedFillups, setMalformedFillups] = useState<
    { id: string; reason: string; raw: Record<string, unknown> }[]
  >([]);

  /**
   * User generation.
   *
   * Every asynchronous callback captures the generation it was created under
   * and drops its result if the generation has moved on. Firestore listeners
   * are unsubscribed by their effect cleanup, but a getDocs, a lookup or a
   * write acknowledgement started under account A can still land after account
   * B has signed in — and without this guard it would repopulate B's state
   * with A's data. That is the bug that made switching accounts require
   * clearing site data.
   */
  const generationRef = useRef(0);
  const trackerRef = useRef<WriteTracker | null>(null);
  const outboxRef = useRef<Outbox | null>(null);
  // The vehicle whose fill-ups the CURRENT listener serves. A snapshot that
  // arrives for another vehicle is dropped; state is never mixed.
  const fillupVehicleRef = useRef<string | null>(null);

  /** Is this still the account the app is showing? */
  const isCurrent = useCallback(
    (generation: number) => () => generation === generationRef.current,
    [],
  );

  useEffect(() => {
    pruneOldCaches();
  }, []);

  /**
   * Account boundary. Declared BEFORE every subscription effect so that on a
   * uid change React runs it first: the generation moves, all in-memory state
   * returns to its initial value, and only then do the listeners for the new
   * account attach. No state from the previous account survives into the next
   * account's first render.
   */
  useEffect(() => {
    sessionCounter += 1;
    // oxlint-disable-next-line react/immutability -- Assigning to a ref inside
    // an effect is the documented React pattern for a value that async
    // callbacks must be able to compare against without re-subscribing. State
    // would be captured stale by exactly the callbacks this guards.
    generationRef.current = sessionCounter;

    trackerRef.current?.dispose();
    const tracker = new WriteTracker();
    trackerRef.current = tracker;

    // The durable outbox is per account and lives in storage, so it is never
    // cleared here: the next sign-in of the SAME account picks up exactly the
    // entries it left, and another account cannot read them.
    outboxRef.current = uid ? new Outbox(uid, localStorage, APP_VERSION) : null;

    // Reset everything user-scoped, synchronously.
    setSettings(DEFAULT_SETTINGS);
    setVehicles([]);
    setFillups([]);
    setPrices(null);
    setReady(false);
    setLoadingFillups(Boolean(uid));
    setFromCache(false);
    setWrites(EMPTY_WRITE_STATUS);
    setPriceRules([]);
    setOutboxOps([]);
    setPendingFillupIds(new Set());
    setFillupsError(null);
    setMalformedFillups([]);

    const unsubscribe = tracker.subscribe(setWrites);
    const outbox = outboxRef.current;
    const unsubscribeOutbox = outbox?.subscribe((snapshot) => setOutboxOps(snapshot.operations));

    // Another tab of the same account changed the outbox: re-read it.
    const onStorage = (event: StorageEvent) => {
      if (uid && event.key === outboxKey(uid)) outbox?.notify();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      unsubscribe();
      unsubscribeOutbox?.();
      window.removeEventListener("storage", onStorage);
      tracker.dispose();
    };
  }, [uid]);

  // Paint the last-known view immediately, before Firestore has connected.
  // Reads only this uid's cache — the envelope carries the uid and a mismatch
  // is discarded, so one account can never paint with another's snapshot.
  useEffect(() => {
    if (!uid) return;
    const generation = generationRef.current;

    const cachedSettings = readCache<UserSettings>(uid, "settings");
    const cachedVehicles = readCache<Vehicle[]>(uid, "vehicles");
    const cachedPrices = readCache<RegulatedPriceConfig>(uid, "prices");
    if (generation !== generationRef.current) return;

    if (cachedSettings) setSettings({ ...DEFAULT_SETTINGS, ...cachedSettings });
    if (cachedVehicles?.length) {
      setVehicles(cachedVehicles);
      setFromCache(true);
    }
    if (cachedPrices) setPrices(cachedPrices);
    if (cachedSettings || cachedVehicles?.length) setReady(true);
  }, [uid]);

  useEffect(() => {
    const online = () => setOffline(false);
    const goneOffline = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", goneOffline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", goneOffline);
    };
  }, []);

  /* ---------- user document: profile + settings ---------- */

  useEffect(() => {
    if (!user || !uid) return;
    const generation = generationRef.current;

    const userRef = doc(db, "users", uid);

    return subscribeResilient<DocumentSnapshot<DocumentData>>(
      (onNext, onError) => onSnapshot(userRef, onNext, onError),
      (snapshot) => {
        if (!snapshot.exists()) {
          // First sign-in: create the profile document.
          // Not routed through the write tracker: this fires during the very
          // first render for a new account, before the tracker callback is
          // declared, and a profile that fails to create surfaces immediately
          // as an unusable app rather than needing a pending-write badge.
          void setDoc(
            userRef,
            {
              displayName: user.displayName,
              photoURL: user.photoURL,
              email: user.email,
              settings: DEFAULT_SETTINGS,
              createdAt: serverTimestamp(),
            },
            { merge: true },
          ).catch((error: unknown) => {
            // eslint-disable-next-line no-console
            console.warn("[tank-maleh] could not create the profile document", error);
          });
          setSettings(DEFAULT_SETTINGS);
          setReady(true);
          return;
        }

        const data = snapshot.data();
        const next: UserSettings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
        setSettings(next);
        writeCache(uid, "settings", next);
        setReady(true);
      },
      {
        isCurrent: isCurrent(generation),
        label: "user document",
        onError: () => setReady(true),
      },
    );
  }, [user, uid, isCurrent]);

  // The stored preference is the source of truth once it arrives; before that
  // the app runs on the localStorage value stamped in index.html.
  useEffect(() => {
    if (!ready) return;
    setTheme(settings.theme);
    setAccent(settings.accentColor, settings.customAccent ?? null);
  }, [ready, settings.theme, settings.accentColor, settings.customAccent, setTheme, setAccent]);

  /* ---------- vehicles ---------- */

  useEffect(() => {
    if (!uid) return;
    const generation = generationRef.current;

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(collection(db, "users", uid, "vehicles"), onNext, onError),
      (snapshot) => {
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            make: String(data.make ?? ""),
            model: String(data.model ?? ""),
            year: toNumberOrNull(data.year),
            plateNumber: data.plateNumber ?? null,
            fuelType: (data.fuelType ?? "95") as Vehicle["fuelType"],
            tankLiters: toNumberOrNull(data.tankLiters),
            // Absent on every pre-provenance document, and absence is treated
            // as "unknown", not "confirmed".
            tankLitersSource: (data.tankLitersSource ?? null) as Vehicle["tankLitersSource"],
            declaredKmPerLiter: toNumberOrNull(data.declaredKmPerLiter),
            declaredSource: (data.declaredSource ?? null) as Vehicle["declaredSource"],
            priceAdjustment: typeof data.priceAdjustment === "number" ? data.priceAdjustment : 0,
            manualPricePerLiter: toNumberOrNull(data.manualPricePerLiter),
            nickname: data.nickname ?? null,
            archived: Boolean(data.archived),
            createdAt: toMillis(data.createdAt),
            tozeretCd: toNumberOrNull(data.tozeretCd),
            degemCd: toNumberOrNull(data.degemCd),
            tankPrefs: readTankPreferences(data.tankPrefs),
          } satisfies Vehicle;
        });
        list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        setVehicles(list);
        writeCache(uid, "vehicles", list);
        if (!snapshot.metadata.fromCache) setFromCache(false);
      },
      { isCurrent: isCurrent(generation), label: "vehicles" },
    );
  }, [uid, isCurrent]);

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.archived), [vehicles]);

  const activeVehicle = useMemo(() => {
    if (activeVehicles.length === 0) return null;
    return (
      activeVehicles.find((v) => v.id === settings.activeVehicleId) ?? activeVehicles[0]
    );
  }, [activeVehicles, settings.activeVehicleId]);

  /* ---------- fill-ups for the active vehicle ---------- */

  const activeVehicleId = activeVehicle?.id ?? null;

  useEffect(() => {
    // Keyed on the vehicle ID, not the vehicle object: a vehicle edit (a
    // nickname, a capacity) used to tear the listener down and rebuild it.
    fillupVehicleRef.current = activeVehicleId;
    if (!uid || !activeVehicleId) {
      setFillups([]);
      setPendingFillupIds(new Set());
      setMalformedFillups([]);
      setFillupsError(null);
      setLoadingFillups(false);
      return;
    }
    const generation = generationRef.current;
    const vehicleId = activeVehicleId;

    // The previous vehicle's list must not show under the new vehicle's name
    // while its own snapshot is on the way. Hydrate from THIS vehicle's cache
    // or show the loading state — never the old list.
    const cached = readCache<Fillup[]>(uid, `fillups.${vehicleId}`);
    setFillups(cached ?? []);
    setPendingFillupIds(new Set());
    setMalformedFillups([]);
    setFillupsError(null);
    setLoadingFillups(!cached);

    const path = collection(db, "users", uid, "vehicles", vehicleId, "fillups");

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(path, { includeMetadataChanges: true }, onNext, onError),
      (snapshot) => {
        // A late snapshot for a vehicle the user already left.
        if (fillupVehicleRef.current !== vehicleId) return;

        const list: Fillup[] = [];
        const malformed: { id: string; reason: string; raw: Record<string, unknown> }[] = [];
        const pending = new Set<string>();
        for (const entry of snapshot.docs) {
          const parsed = parseFillupDocument(entry.id, entry.data());
          if (parsed.ok) list.push(parsed.fillup);
          else malformed.push({ id: parsed.id, reason: parsed.reason, raw: parsed.raw });
          if (entry.metadata.hasPendingWrites) pending.add(entry.id);
        }

        setFillups(list);
        setMalformedFillups(malformed);
        setPendingFillupIds(pending);
        setFillupsError(null);
        writeCache(uid, `fillups.${vehicleId}`, list);
        setLoadingFillups(false);

        // Only a SERVER-sourced snapshot can settle the fate of an operation
        // whose promise was lost to a reload or a crash. The SDK replays its
        // own queue, so a pending op is either still queued (its document has
        // pending writes), acknowledged (the content is on the server), or
        // gone — rejected, which a plain listener reads as "deleted".
        const outbox = outboxRef.current;
        if (outbox && !snapshot.metadata.fromCache) {
          const verdicts = reconcileWithServer(
            outbox.operations(),
            vehicleId,
            snapshot.docs.map((entry) => ({
              id: entry.id,
              data: entry.data() as OutboxPayload,
              hasPendingWrites: entry.metadata.hasPendingWrites,
            })),
            fillupPayloadMatches,
          );
          for (const verdict of verdicts) {
            if (verdict.verdict === "synced") outbox.acknowledge(verdict.opId);
            else if (verdict.verdict === "unconfirmed") {
              outbox.fail(verdict.opId, {
                code: "unconfirmed",
                message: verdict.reason,
                at: Date.now(),
              });
            } else if (verdict.verdict === "conflict") {
              outbox.markConflict(verdict.opId, verdict.serverImage);
            }
          }
        }
      },
      {
        isCurrent: isCurrent(generation),
        label: "fill-ups",
        onError: (error) => {
          if (fillupVehicleRef.current !== vehicleId) return;
          setLoadingFillups(false);
          // A read failure is not an empty history. The last cached list, if
          // any, stays on screen and the error is stated beside it.
          setFillupsError(describeError(error));
        },
      },
    );
  }, [uid, activeVehicleId, isCurrent]);

  /* ---------- tank observations and plans ---------- */

  /**
   * Standalone readings for the active vehicle.
   *
   * Kept in their own subcollection because they are not transactions: an
   * odometer or gauge update has no cost, no litres and no station, and folding
   * it into `fillups` would make it one.
   */
  useEffect(() => {
    if (!uid || !activeVehicle) {
      setObservations([]);
      return;
    }
    const generation = generationRef.current;
    const cached = readCache<TankObservation[]>(uid, `observations.${activeVehicle.id}`);
    if (cached) setObservations(cached);

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, "users", uid, "vehicles", activeVehicle.id, "observations"),
          onNext,
          onError,
        ),
      (snapshot) => {
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            vehicleId: activeVehicle.id,
            observedAt: toMillis(data.observedAt),
            recordedAt: toMillis(data.recordedAt),
            kind: (data.kind ?? "both") as TankObservation["kind"],
            odometer: toNumberOrNull(data.odometer),
            level: toNumberOrNull(data.level),
            levelUncertainty: toNumberOrNull(data.levelUncertainty),
            levelSource: (data.levelSource ?? null) as TankObservation["levelSource"],
            // Absence is NOT confirmation. A reading only counts as evidence
            // when the user actually stated it.
            confirmed: data.confirmed === true,
            fillupId: data.fillupId ?? null,
            phase: (data.phase ?? "standalone") as TankObservation["phase"],
            schemaVersion: toNumberOrNull(data.schemaVersion) ?? 1,
          } satisfies TankObservation;
        });
        list.sort((a, b) => a.observedAt - b.observedAt);
        setObservations(list);
        writeCache(uid, `observations.${activeVehicle.id}`, list);
      },
      { isCurrent: isCurrent(generation), label: "tank observations" },
    );
  }, [uid, activeVehicle, isCurrent]);

  useEffect(() => {
    if (!uid || !activeVehicle) {
      setPlans([]);
      return;
    }
    const generation = generationRef.current;

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, "users", uid, "vehicles", activeVehicle.id, "tankPlans"),
          onNext,
          onError,
        ),
      (snapshot) => {
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            vehicleId: activeVehicle.id,
            date: toMillis(data.date),
            distanceKm: Number(data.distanceKm ?? 0),
            mode: data.mode === "replaces" ? "replaces" : "additional",
            bufferKm: toNumberOrNull(data.bufferKm),
            note: data.note ?? null,
            createdAt: toMillis(data.createdAt),
          } satisfies TankPlan;
        });
        list.sort((a, b) => a.date - b.date);
        setPlans(list);
      },
      { isCurrent: isCurrent(generation), label: "tank plans" },
    );
  }, [uid, activeVehicle, isCurrent]);

  /* ---------- personal pricing rules ---------- */

  useEffect(() => {
    if (!uid) return;
    const generation = generationRef.current;

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(collection(db, "users", uid, "personalPriceRules"), onNext, onError),
      (snapshot) => {
        setPriceRules(
          snapshot.docs.map((entry) => {
            const data = entry.data();
            return {
              id: entry.id,
              vehicleId: data.vehicleId ?? null,
              stationId: data.stationId ?? null,
              stationName: data.stationName ?? null,
              fuelType: (data.fuelType ?? null) as FuelType | null,
              discountPerLiter:
                typeof data.discountPerLiter === "number" ? data.discountPerLiter : 0,
              fixedPricePerLiter: toNumberOrNull(data.fixedPricePerLiter),
              label: data.label ?? null,
              expiresAt: toNumberOrNull(data.expiresAt),
              legacy: data.legacy === true,
              reviewed: data.reviewed === true,
            } satisfies StoredPriceRule;
          }),
        );
      },
      { isCurrent: isCurrent(generation), label: "price rules" },
    );
  }, [uid, isCurrent]);

  /* ---------- global fuel prices ---------- */

  useEffect(() => {
    if (!uid) return;
    const generation = generationRef.current;

    return subscribeResilient<DocumentSnapshot<DocumentData>>(
      (onNext, onError) => onSnapshot(doc(db, "appConfig", "fuelPrices"), onNext, onError),
      (snapshot) => {
        if (!snapshot.exists()) {
          setPrices(null);
          return;
        }
        // The whole document, including the per-fuel-type series. Reading only
        // the legacy top-level fields — which is what this did — meant an
        // admin could set a diesel or 98 price that no client ever saw.
        const next = normalizePriceDocument(snapshot.data());
        setPrices(next);
        writeCache(uid, "prices", next);
      },
      {
        isCurrent: isCurrent(generation),
        label: "fuel prices",
        onError: () => setPrices(null),
      },
    );
  }, [uid, isCurrent]);

  /* ---------- mutations ----------
     Firestore write promises only settle on SERVER acknowledgement, so they
     are deliberately not awaited for UI flow: the local cache applies the
     change immediately and the queued write syncs when the network returns.

     They are, however, always TRACKED. Every write goes through the tracker,
     so a permanent rejection surfaces as a visible failure instead of being
     swallowed by a `.catch(() => undefined)` while the UI says "saved". */

  const track = useCallback(
    (kind: MutationKind, promise: Promise<unknown>): MutationReceipt => {
      const tracker = trackerRef.current;
      if (!tracker) return { id: "", settled: Promise.resolve(false) };
      return tracker.track(kind, promise);
    },
    [],
  );

  const dismissWriteFailure = useCallback((id: string) => {
    trackerRef.current?.dismiss(id);
  }, []);

  /**
   * The one path a user-data write takes.
   *
   * 1. The complete payload is written to the durable outbox. If storage
   *    refuses, this THROWS before Firestore is touched — the caller keeps
   *    the form open and must not claim success.
   * 2. The write is handed to Firestore and tracked. On acknowledgement the
   *    outbox entry is removed; on rejection it is marked failed with the
   *    real error, payload intact.
   *
   * Firestore's own queue still delivers a pending write across reloads; the
   * outbox never re-sends on its own (no competing dispatchers).
   */
  const submit = useCallback(
    (
      input: {
        kind: OutboxKind;
        docId: string;
        vehicleId: string | null;
        payload: OutboxPayload | null;
        beforeImage?: OutboxPayload | null;
        replaceOpId?: string | null;
      },
      write: () => Promise<unknown>,
    ): MutationReceipt => {
      const outbox = outboxRef.current;
      if (!outbox) throw new OutboxStorageError("אין חשבון מחובר");
      const operation = outbox.enqueue(input);

      let promise: Promise<unknown>;
      try {
        promise = write();
      } catch (error) {
        outbox.fail(operation.opId, {
          code: errorCode(error),
          message: errorMessage(error),
          at: Date.now(),
        });
        throw error;
      }

      const receipt = track(input.kind, promise);
      void promise.then(
        () => outbox.acknowledge(operation.opId),
        (error: unknown) =>
          outbox.fail(operation.opId, {
            code: errorCode(error),
            message: errorMessage(error),
            at: Date.now(),
          }),
      );
      return receipt;
    },
    [track],
  );

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!uid) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      track(
        "settings.update",
        updateDoc(doc(db, "users", uid), { settings: stripUndefined(next) }),
      );
    },
    [uid, settings, track],
  );

  const setActiveVehicle = useCallback(
    async (vehicleId: string) => {
      await updateSettings({ activeVehicleId: vehicleId });
    },
    [updateSettings],
  );

  const addVehicle = useCallback(
    async (vehicle: Omit<Vehicle, "id" | "createdAt">) => {
      if (!uid) throw new Error("not signed in");
      const ref = doc(collection(db, "users", uid, "vehicles"));
      track(
        "vehicle.add",
        setDoc(ref, stripUndefined({ ...vehicle, createdAt: serverTimestamp() })),
      );
      // First vehicle becomes the active one automatically.
      if (vehicles.filter((v) => !v.archived).length === 0) {
        await updateSettings({ activeVehicleId: ref.id });
      }
      return ref.id;
    },
    [uid, vehicles, updateSettings, track],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, patch: Partial<Vehicle>) => {
      if (!uid) return;
      const { id: _ignored, ...rest } = patch as Partial<Vehicle> & { id?: string };
      track(
        "vehicle.update",
        updateDoc(
          doc(db, "users", uid, "vehicles", vehicleId),
          stripUndefined(rest as Record<string, unknown>),
        ),
      );
    },
    [uid, track],
  );

  const setVehicleArchived = useCallback(
    async (vehicleId: string, archived: boolean) => {
      await updateVehicle(vehicleId, { archived });
      if (archived && settings.activeVehicleId === vehicleId) {
        const fallback = vehicles.find((v) => v.id !== vehicleId && !v.archived);
        await updateSettings({ activeVehicleId: fallback?.id ?? null });
      }
    },
    [updateVehicle, settings.activeVehicleId, vehicles, updateSettings],
  );

  /** Remove a vehicle and every subcollection under it. */
  const deleteVehicleTree = useCallback(
    async (vehicleId: string) => {
      if (!uid) return;
      const vehicleRef = doc(db, "users", uid, "vehicles", vehicleId);
      // Every subcollection, not just fill-ups: leaving observations or plans
      // behind would keep a deleted vehicle's private tank history alive.
      for (const name of ["fillups", "observations", "tankPlans"]) {
        const snapshot = await getDocs(collection(vehicleRef, name));
        for (let i = 0; i < snapshot.docs.length; i += 400) {
          const batch = writeBatch(db);
          snapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
          await batch.commit();
        }
      }
      await deleteDoc(vehicleRef);
    },
    [uid],
  );

  const deleteVehicle = useCallback(
    async (vehicleId: string) => {
      if (!uid) return;
      const previous = vehicles.find((v) => v.id === vehicleId) ?? null;
      // Tracked and recorded like every other write: a deletion the server
      // refuses used to be swallowed, leaving the vehicle visibly "deleted"
      // on this device and alive on every other.
      const receipt = submit(
        {
          kind: "vehicle.delete",
          docId: vehicleId,
          vehicleId,
          payload: null,
          beforeImage: previous ? (JSON.parse(JSON.stringify(previous)) as OutboxPayload) : null,
        },
        () => deleteVehicleTree(vehicleId),
      );

      if (settings.activeVehicleId === vehicleId) {
        const fallback = vehicles.find((v) => v.id !== vehicleId && !v.archived);
        await updateSettings({ activeVehicleId: fallback?.id ?? null });
      }
      await receipt.settled;
    },
    [uid, settings.activeVehicleId, vehicles, updateSettings, submit, deleteVehicleTree],
  );

  const fillupRef = useCallback(
    (vehicleId: string, fillupId: string) =>
      doc(db, "users", uid ?? "-", "vehicles", vehicleId, "fillups", fillupId),
    [uid],
  );

  const addFillup = useCallback(
    async (
      fillup: FillupWrite,
      options: { replaceOpId?: string | null; vehicleId?: string } = {},
    ) => {
      const vehicleId = options.vehicleId ?? activeVehicle?.id;
      if (!uid || !vehicleId) throw new Error("no active vehicle");
      // An edited copy of a failed operation keeps its op id AND its document
      // id, so a retry that happens to succeed twice cannot create two records.
      const replaced = options.replaceOpId ? outboxRef.current?.get(options.replaceOpId) : null;
      const ref = replaced
        ? fillupRef(vehicleId, replaced.docId)
        : doc(collection(db, "users", uid, "vehicles", vehicleId, "fillups"));
      const payload = serializeFillup(fillup);
      submit(
        {
          kind: "fillup.add",
          docId: ref.id,
          vehicleId,
          payload,
          replaceOpId: options.replaceOpId ?? null,
        },
        () => setDoc(ref, toFirestoreData(payload)),
      );
      return ref.id;
    },
    [uid, activeVehicle, submit, fillupRef],
  );

  const updateFillup = useCallback(
    async (fillupId: string, next: FillupWrite, previous?: Fillup | null) => {
      if (!uid || !activeVehicle) return;
      const patch = serializeFillupPatch(next);
      submit(
        {
          kind: "fillup.update",
          docId: fillupId,
          vehicleId: activeVehicle.id,
          payload: patch,
          beforeImage: previous ? serializeFillupPatch(previous) : null,
        },
        () => updateDoc(fillupRef(activeVehicle.id, fillupId), toFirestoreData(patch)),
      );
    },
    [uid, activeVehicle, submit, fillupRef],
  );

  const deleteFillup = useCallback(
    async (fillup: Fillup) => {
      if (!uid || !activeVehicle) return;
      submit(
        {
          kind: "fillup.delete",
          docId: fillup.id,
          vehicleId: activeVehicle.id,
          payload: null,
          beforeImage: serializeFillup(fillup),
        },
        () => deleteDoc(fillupRef(activeVehicle.id, fillup.id)),
      );
    },
    [uid, activeVehicle, submit, fillupRef],
  );

  const restoreFillup = useCallback(
    async (fillup: Fillup) => {
      if (!uid || !activeVehicle) return;
      // Creation metadata travels with the record: a restore is not a new
      // record and must not look like one.
      const payload = serializeFillup(fillup);
      submit(
        { kind: "fillup.restore", docId: fillup.id, vehicleId: activeVehicle.id, payload },
        () => setDoc(fillupRef(activeVehicle.id, fillup.id), toFirestoreData(payload)),
      );
    },
    [uid, activeVehicle, submit, fillupRef],
  );

  /**
   * Re-submit a failed or conflicted operation, on the user's explicit request.
   *
   * Idempotent: the document id is the original one, so a create that was in
   * fact acknowledged simply overwrites itself with identical content. An
   * UPDATE first re-reads the server: if the document no longer matches the
   * before-image the operation was made against, that is a conflict for the
   * user to resolve, not a race for the retry to win.
   */
  const retryOperation = useCallback(
    async (opId: string) => {
      const outbox = outboxRef.current;
      if (!uid || !outbox) return;
      const op = outbox.get(opId);
      if (!op || !op.vehicleId) return;

      if (op.kind === "fillup.update" && op.beforeImage) {
        const current = await getDocFromServer(fillupRef(op.vehicleId, op.docId)).catch(
          () => null,
        );
        if (current && current.exists()) {
          const server = current.data() as OutboxPayload;
          if (
            !fillupPayloadMatches(op.beforeImage, server) &&
            !(op.payload && fillupPayloadMatches(op.payload, server))
          ) {
            outbox.markConflict(opId, server);
            return;
          }
        } else if (current && !current.exists()) {
          outbox.fail(opId, {
            code: "not-found",
            message: "הרשומה כבר לא קיימת בשרת — אפשר לשמור אותה מחדש כרשומה חדשה",
            at: Date.now(),
          });
          return;
        }
      }

      const retried = outbox.retrying(opId);
      if (!retried) return;
      const ref = fillupRef(retried.vehicleId ?? "-", retried.docId);
      const run = (): Promise<unknown> => {
        switch (retried.kind) {
          case "fillup.add":
          case "fillup.restore":
            return setDoc(ref, toFirestoreData(retried.payload ?? {}));
          case "fillup.update":
            return updateDoc(ref, toFirestoreData(retried.payload ?? {}));
          case "fillup.delete":
            return deleteDoc(ref);
          case "tank.observation":
            return setDoc(
              doc(db, "users", uid, "vehicles", retried.vehicleId ?? "-", "observations", retried.docId),
              toFirestoreData(retried.payload ?? {}),
            );
          case "tank.observation.delete":
            return deleteDoc(
              doc(db, "users", uid, "vehicles", retried.vehicleId ?? "-", "observations", retried.docId),
            );
          case "vehicle.delete":
            return deleteVehicleTree(retried.docId);
        }
      };
      const promise = run();
      track(retried.kind, promise);
      await promise.then(
        () => outbox.acknowledge(opId),
        (error: unknown) =>
          outbox.fail(opId, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteVehicleTree is declared below and stable
    [uid, track, fillupRef],
  );

  const resolveConflict = useCallback(
    async (opId: string, choice: "keep-server" | "overwrite") => {
      const outbox = outboxRef.current;
      if (!outbox) return;
      if (choice === "keep-server") {
        outbox.discard(opId);
        return;
      }
      const op = outbox.get(opId);
      if (!op) return;
      // Overwrite deliberately: the before-image is replaced by what the
      // server holds now, so the next retry compares against the right base.
      outbox.fail(opId, { code: "retry", message: "", at: Date.now() });
      const patched = outbox.get(opId);
      if (patched) {
        // Re-enqueue under the same op id with the server image as the base.
        outbox.enqueue({
          kind: patched.kind,
          docId: patched.docId,
          vehicleId: patched.vehicleId,
          payload: patched.payload,
          beforeImage: patched.serverImage ?? null,
          replaceOpId: opId,
        });
      }
      await retryOperation(opId);
    },
    [retryOperation],
  );

  const discardOperation = useCallback((opId: string) => {
    outboxRef.current?.discard(opId);
  }, []);

  /**
   * Write an import batch.
   *
   * One WriteBatch per 400 documents — atomic per batch, and the receipt
   * settles only when the SERVER has acknowledged every one of them, so the
   * import report can distinguish "written" from "queued while offline".
   */
  const addFillupBatch = useCallback(
    async (
      vehicleId: string,
      list: Omit<Fillup, "id" | "createdAt">[],
      meta: ImportBatchMeta,
    ) => {
      if (!uid) throw new Error("not signed in");

      const path = collection(db, "users", uid, "vehicles", vehicleId, "fillups");
      const batchId = list[0]?.importBatchId;
      if (!batchId) throw new Error("import records must carry a batch id");

      const commits: Promise<void>[] = [];

      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        for (const fillup of list.slice(i, i + 400)) {
          batch.set(
            doc(path),
            stripUndefined({
              ...fillup,
              date: Timestamp.fromMillis(fillup.date),
              createdAt: serverTimestamp(),
            }),
          );
        }
        commits.push(batch.commit());
      }

      // The batch record is what makes the import undoable later. Written with
      // the rest so a rollback can find every row it created.
      commits.push(
        setDoc(doc(db, "users", uid, "importBatches", batchId), {
          vehicleId,
          format: meta.format,
          fileName: meta.fileName,
          recordCount: meta.recordCount,
          vehicleLabel: meta.vehicleLabel,
          importedAt: serverTimestamp(),
        }),
      );

      const receipt = track("import.batch", Promise.all(commits));
      return { written: list.length, receipt };
    },
    [uid, track],
  );

  /**
   * Record a gauge and/or odometer reading.
   *
   * `confirmed` comes from the caller and is only ever true when the user
   * actually set the value. A pre-filled suggestion nobody touched must reach
   * this function as `false`, or it becomes a training label for a measurement
   * that never happened.
   */
  const addObservation = useCallback(
    async (observation: Omit<TankObservation, "id" | "vehicleId" | "recordedAt">) => {
      if (!uid || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(
        collection(db, "users", uid, "vehicles", activeVehicle.id, "observations"),
      );
      const payload = stripUndefined({
        ...(observation as unknown as Record<string, unknown>),
        recordedAt: SERVER_TIMESTAMP,
        schemaVersion: 1,
      }) as OutboxPayload;
      submit(
        { kind: "tank.observation", docId: ref.id, vehicleId: activeVehicle.id, payload },
        () => setDoc(ref, toFirestoreData(payload)),
      );
      return ref.id;
    },
    [uid, activeVehicle, submit],
  );

  const deleteObservation = useCallback(
    async (observationId: string) => {
      if (!uid || !activeVehicle) return;
      submit(
        {
          kind: "tank.observation.delete",
          docId: observationId,
          vehicleId: activeVehicle.id,
          payload: null,
        },
        () =>
          deleteDoc(
            doc(db, "users", uid, "vehicles", activeVehicle.id, "observations", observationId),
          ),
      );
    },
    [uid, activeVehicle, submit],
  );

  const addPlan = useCallback(
    async (plan: Omit<TankPlan, "id" | "vehicleId" | "createdAt">) => {
      if (!uid || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(collection(db, "users", uid, "vehicles", activeVehicle.id, "tankPlans"));
      track(
        "tank.plan",
        setDoc(
          ref,
          stripUndefined({
            ...plan,
            date: Timestamp.fromMillis(plan.date),
            createdAt: serverTimestamp(),
          }),
        ),
      );
      return ref.id;
    },
    [uid, activeVehicle, track],
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      if (!uid || !activeVehicle) return;
      track(
        "tank.plan.delete",
        deleteDoc(doc(db, "users", uid, "vehicles", activeVehicle.id, "tankPlans", planId)),
      );
    },
    [uid, activeVehicle, track],
  );

  const tankPreferences = useMemo(
    () => activeVehicle?.tankPrefs ?? DEFAULT_TANK_PREFERENCES,
    [activeVehicle],
  );

  const updateTankPreferences = useCallback(
    async (patch: Partial<TankPreferences>) => {
      if (!uid || !activeVehicle) return;
      const next: TankPreferences = { ...tankPreferences, ...patch };
      track(
        "vehicle.update",
        updateDoc(doc(db, "users", uid, "vehicles", activeVehicle.id), {
          tankPrefs: stripUndefined(next as unknown as Record<string, unknown>),
        }),
      );
    },
    [uid, activeVehicle, tankPreferences, track],
  );

  const savePriceRule = useCallback(
    async (rule: StoredPriceRule) => {
      if (!uid) return;
      const { id, ...rest } = rule;
      track(
        "priceRule.save",
        setDoc(doc(db, "users", uid, "personalPriceRules", id), stripUndefined(rest), {
          merge: true,
        }),
      );
    },
    [uid, track],
  );

  const deletePriceRule = useCallback(
    async (ruleId: string) => {
      if (!uid) return;
      track(
        "priceRule.delete",
        deleteDoc(doc(db, "users", uid, "personalPriceRules", ruleId)),
      );
    },
    [uid, track],
  );

  const listImportBatches = useCallback(async (): Promise<ImportBatch[]> => {
    if (!uid) return [];
    const snapshot = await getDocs(
      query(collection(db, "users", uid, "importBatches"), limit(50)),
    );
    return snapshot.docs
      .map((entry) => {
        const data = entry.data();
        return {
          id: entry.id,
          vehicleId: String(data.vehicleId ?? ""),
          format: String(data.format ?? "unknown"),
          fileName: String(data.fileName ?? ""),
          recordCount: Number(data.recordCount ?? 0),
          vehicleLabel: String(data.vehicleLabel ?? ""),
          importedAt: toMillis(data.importedAt),
        } satisfies ImportBatch;
      })
      .sort((a, b) => b.importedAt - a.importedAt);
  }, [uid]);

  /**
   * Undo one import.
   *
   * Scoped by importBatchId, so it removes exactly the rows that import
   * created and nothing a person entered by hand — even at the same station on
   * the same day. Deleting the batch record last means an interrupted rollback
   * leaves the batch visible and retryable rather than orphaning its rows.
   *
   * Re-importing the same file afterwards behaves deterministically: the
   * identity hash is a pure function of the row, so the rows are simply new
   * again.
   */
  const deleteImportBatch = useCallback(
    async (batch: ImportBatch): Promise<ImportRollbackResult> => {
      if (!uid) return { deleted: 0, ok: false, reason: "not signed in" };

      try {
        const fillupsRef = collection(
          db,
          "users",
          uid,
          "vehicles",
          batch.vehicleId,
          "fillups",
        );
        const snapshot = await getDocs(
          query(fillupsRef, where("importBatchId", "==", batch.id)),
        );

        const commits: Promise<void>[] = [];
        for (let i = 0; i < snapshot.docs.length; i += 400) {
          const writeChunk = writeBatch(db);
          snapshot.docs.slice(i, i + 400).forEach((entry) => writeChunk.delete(entry.ref));
          commits.push(writeChunk.commit());
        }
        commits.push(deleteDoc(doc(db, "users", uid, "importBatches", batch.id)));

        const receipt = track("import.rollback", Promise.all(commits));

        // The local cache has already applied the deletions; whether the
        // SERVER has is a separate question, and the caller is told which.
        const acknowledged = await Promise.race([
          receipt.settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
        ]);

        return {
          deleted: snapshot.docs.length,
          ok: acknowledged !== false,
          pending: acknowledged === null,
          reason: acknowledged === false ? "השרת דחה את המחיקה" : undefined,
        };
      } catch {
        return { deleted: 0, ok: false, reason: "המחיקה נכשלה" };
      }
    },
    [uid, track],
  );

  /**
   * Explicit account switch.
   *
   * Signing out is enough for correctness — the generation guard and the reset
   * effect discard every trace of the outgoing account before the next one
   * attaches. What this adds is honesty about unacknowledged writes: if the
   * server has not confirmed something yet, the caller is told so it can warn
   * rather than silently walking away from the queue.
   *
   * Firestore's persistent cache is deliberately NOT cleared. Every query is
   * scoped to users/{uid}/..., so one account can never read another's cached
   * documents, and keeping persistence is what makes the app work at the pump
   * with no signal. The trade-off is recorded in docs/DATA-MIGRATION.md.
   */
  /**
   * Delete the account and everything attached to it.
   *
   * Order matters. Firebase Auth requires a recent sign-in before it will
   * delete a user, and discovering that AFTER wiping Firestore leaves someone
   * with an empty account they cannot remove. So reauthentication is proved
   * first, and only then is anything destroyed.
   *
   * The result is reported honestly: if a collection fails to clear, the
   * caller is told which one rather than being shown a success message.
   */
  const deleteAccount = useCallback(async (): Promise<DeletionResult> => {
    if (!user || !uid) return { ok: false, deleted: [], failed: ["no-session"] };

    // 1. Prove we are allowed to delete the Auth user BEFORE touching data.
    const reauth = await ensureRecentLogin(user);
    if (!reauth.ok) {
      return { ok: false, deleted: [], failed: [], needsReauth: true };
    }

    const deleted: string[] = [];
    const failed: string[] = [];

    const attempt = async (label: string, work: () => Promise<unknown>) => {
      try {
        await work();
        deleted.push(label);
      } catch {
        failed.push(label);
      }
    };

    // 2. Fill-ups and vehicles. Subcollections are not removed with a parent.
    await attempt("vehicles", async () => {
      const vehiclesSnapshot = await getDocs(collection(db, "users", uid, "vehicles"));
      for (const vehicleDoc of vehiclesSnapshot.docs) {
        for (const name of ["fillups", "observations", "tankPlans"]) {
          const subSnapshot = await getDocs(collection(vehicleDoc.ref, name));
          for (let i = 0; i < subSnapshot.docs.length; i += 400) {
            const batch = writeBatch(db);
            subSnapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
            await batch.commit();
          }
        }
        await deleteDoc(vehicleDoc.ref);
      }
    });

    // 3. Private community price reports.
    await attempt("stationPriceReports", async () => {
      const reports = await getDocs(collection(db, "users", uid, "stationPriceReports"));
      for (let i = 0; i < reports.docs.length; i += 400) {
        const batch = writeBatch(db);
        reports.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
      }
    });

    // 4. The published benchmark contribution — withdrawn, not orphaned.
    await attempt("benchmark", () => deleteDoc(doc(db, "benchmarks", uid)));

    // 5. The profile document itself.
    await attempt("profile", () => deleteDoc(doc(db, "users", uid)));

    // 6. Local caches.
    clearCache(uid);

    // 7. Finally the Auth user.
    await attempt("auth", () => user.delete());

    return { ok: failed.length === 0, deleted, failed };
  }, [user, uid]);

  const value = useMemo<DataContextValue>(
    () => ({
      ready,
      settings,
      vehicles,
      activeVehicles,
      activeVehicle,
      fillups,
      prices,
      loadingFillups,
      fromCache,
      offline,
      writes,
      dismissWriteFailure,
      outbox: outboxOps,
      pendingFillupIds,
      fillupsError,
      malformedFillups,
      retryOperation,
      resolveConflict,
      discardOperation,
      updateSettings,
      setActiveVehicle,
      addVehicle,
      updateVehicle,
      setVehicleArchived,
      deleteVehicle,
      addFillup,
      updateFillup,
      deleteFillup,
      restoreFillup,
      addFillupBatch,
      listImportBatches,
      deleteImportBatch,
      priceRules,
      savePriceRule,
      deletePriceRule,
      observations,
      addObservation,
      deleteObservation,
      plans,
      addPlan,
      deletePlan,
      tankPreferences,
      updateTankPreferences,
      deleteAccount,
    }),
    [
      ready,
      settings,
      vehicles,
      activeVehicles,
      activeVehicle,
      fillups,
      prices,
      loadingFillups,
      fromCache,
      offline,
      writes,
      dismissWriteFailure,
      outboxOps,
      pendingFillupIds,
      fillupsError,
      malformedFillups,
      retryOperation,
      resolveConflict,
      discardOperation,
      updateSettings,
      setActiveVehicle,
      addVehicle,
      updateVehicle,
      setVehicleArchived,
      deleteVehicle,
      addFillup,
      updateFillup,
      deleteFillup,
      restoreFillup,
      addFillupBatch,
      listImportBatches,
      deleteImportBatch,
      priceRules,
      savePriceRule,
      deletePriceRule,
      observations,
      addObservation,
      deleteObservation,
      plans,
      addPlan,
      deletePlan,
      tankPreferences,
      updateTankPreferences,
      deleteAccount,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) throw new Error("useData must be used inside DataProvider");
  return context;
}
