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
  collectionOf,
  orphanGroups,
  reconcileWithServer,
  unacknowledgedState,
  type EnqueueInput,
  type OutboxHealth,
  type OutboxOperation,
  type OutboxPayload,
  type ReconcileVerdict,
  type UnacknowledgedState,
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
  /**
   * Whether the outbox itself can be trusted. "ok" means an empty list is
   * really empty; anything else means the account's unsynced state is
   * UNKNOWN and no screen may claim "all synced".
   */
  outboxHealth: OutboxHealth;
  /** False until the account's outbox has opened (or failed to). */
  outboxReady: boolean;
  /** Device-wide: does ANY account still hold unacknowledged writes? */
  checkUnacknowledged: () => Promise<UnacknowledgedState>;
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
  /**
   * Drop an operation the user explicitly gave up on. Removes the journal
   * entry only — a write the SDK still holds is NOT cancelled by this.
   */
  discardOperation: (opId: string) => Promise<void>;

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
  updateFillup: (
    fillupId: string,
    next: FillupWrite,
    previous?: Fillup | null,
    options?: { replaceOpId?: string | null; vehicleId?: string },
  ) => Promise<void>;
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

/** Every commit settled; rejects with the first rejection once all are in. */
async function allCommits(commits: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(commits);
  const failed = results.find((result) => result.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;
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

const UNOPENED_HEALTH: OutboxHealth = { state: "unavailable", quarantined: [], message: null };

function unverified(): { code: string; message: string; at: number } {
  return {
    code: "unverified",
    message: "לא ניתן היה לאמת את מצב הרשומה בשרת — לא נכתב דבר. נסו שוב כשיש חיבור",
    at: Date.now(),
  };
}

/** Content equality for documents without a dedicated serializer (timestamps ignored). */
function genericPayloadMatches(mine: OutboxPayload, theirs: OutboxPayload): boolean {
  for (const [key, value] of Object.entries(mine)) {
    if (value === SERVER_TIMESTAMP) continue;
    const other = theirs[key];
    const left = typeof value === "number" && (key === "date" || key === "observedAt") ? value : value;
    const right = typeof other === "object" && other !== null && "toMillis" in (other as object)
      ? toEpochMillis(other)
      : other;
    if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) return false;
  }
  return true;
}

/**
 * Journal several operations, hand ONE write to Firestore for them, and bind
 * its outcome to the journal versions that were issued.
 */
async function submitMany(
  outbox: Outbox,
  inputs: EnqueueInput[],
  write: () => Promise<unknown>,
  track: (kind: MutationKind, promise: Promise<unknown>) => MutationReceipt,
): Promise<MutationReceipt[]> {
  const operations = await outbox.enqueueMany(inputs);
  let promise: Promise<unknown>;
  try {
    promise = write();
  } catch (error) {
    await Promise.all(
      operations.map((op) =>
        outbox.fail(op.opId, op.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
      ),
    );
    throw error;
  }
  void promise.then(
    () => Promise.all(operations.map((op) => outbox.acknowledge(op.opId, op.version))),
    (error: unknown) =>
      Promise.all(
        operations.map((op) =>
          outbox.fail(op.opId, op.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
        ),
      ),
  );
  const receipt = track(inputs[0].kind, promise);
  return operations.map(() => receipt);
}

/**
 * Settle journal entries that were already pending when this page opened.
 *
 * Their write promises died with the previous page. Firestore's own queue
 * still delivers them, but only a collection with a live query listener
 * (fill-ups and observations of the active vehicle, the vehicle list) ever
 * reports their fate — an import's batch record, a price rule, a plan, a
 * settings write or another vehicle's fill-up could stay "pending" forever.
 * So every orphan gets its own document listener until the server answers:
 * present with the entry's content → acknowledged; absent with nothing
 * pending → rejected (or lost) and retryable; a newer document → conflict.
 * Only the newest revision per document is judged; the revisions it
 * superseded are settled with it.
 */
function settleOrphans(outbox: Outbox, stillCurrent: () => boolean): () => void {
  const unsubscribers: (() => void)[] = [];
  let stopped = false;

  void outbox.list().then((operations) => {
    if (stopped || !stillCurrent()) return;
    for (const group of orphanGroups(operations)) {
      const { newest, superseded } = group;
      const collectionPath = collectionOf(newest.path);
      const isFillup = newest.kind.startsWith("fillup.") || newest.kind === "import.batch";
      const matches = isFillup ? fillupPayloadMatches : genericPayloadMatches;
      let done = false;
      const unsubscribe = onSnapshot(
        doc(db, newest.path),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (done || stopped || !stillCurrent() || snapshot.metadata.fromCache) return;
          const documents = snapshot.exists()
            ? [
                {
                  id: snapshot.id,
                  data: snapshot.data() as OutboxPayload,
                  hasPendingWrites: snapshot.metadata.hasPendingWrites,
                },
              ]
            : [];
          void outbox.get(newest.opId).then((current) => {
            // Settled meanwhile (another tab, or a listener reconcile).
            if (!current || current.version !== newest.version) {
              done = true;
              unsubscribe();
              return;
            }
            const verdicts = reconcileWithServer(
              [current],
              collectionPath,
              documents,
              matches,
              snapshot.metadata.hasPendingWrites,
            );
            const verdict = verdicts[0];
            if (!verdict || verdict.verdict === "still-pending") return;
            done = true;
            unsubscribe();
            applyVerdicts(outbox, verdicts);
            // The inputs this one replaced are settled with it.
            for (const older of superseded) {
              if (verdict.verdict === "synced") void outbox.acknowledge(older.opId, older.version);
              else {
                void outbox.fail(older.opId, older.version, {
                  code: "superseded",
                  message: "הוחלף בעריכה מאוחרת יותר של אותה רשומה",
                  at: Date.now(),
                });
              }
            }
          });
        },
        () => {
          // A listener error (e.g. permission-denied on a path the user no
          // longer owns) settles nothing: the entry stays pending and
          // retryable rather than being guessed at.
          unsubscribe();
        },
      );
      unsubscribers.push(unsubscribe);
    }
  });

  return () => {
    stopped = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/** Apply reconciliation verdicts to the outbox, version-bound. */
function applyVerdicts(outbox: Outbox, verdicts: ReconcileVerdict[]): void {
  for (const verdict of verdicts) {
    if (verdict.verdict === "synced") void outbox.acknowledge(verdict.opId, verdict.version);
    else if (verdict.verdict === "unconfirmed") {
      void outbox.fail(verdict.opId, verdict.version, {
        code: "unconfirmed",
        message: verdict.reason,
        at: Date.now(),
      });
    } else if (verdict.verdict === "conflict") {
      void outbox.markConflict(verdict.opId, verdict.version, verdict.serverImage);
    }
  }
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
  const [outboxHealth, setOutboxHealth] = useState<OutboxHealth>(UNOPENED_HEALTH);
  const [outboxReady, setOutboxReady] = useState(false);
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
  /** Resolves to the account's outbox once opened, or null when it could not be. */
  const outboxPromiseRef = useRef<Promise<Outbox | null> | null>(null);
  // The vehicle whose fill-ups the CURRENT listener serves. A snapshot that
  // arrives for another vehicle is dropped; state is never mixed.
  const fillupVehicleRef = useRef<string | null>(null);

  /** Is this still the account the app is showing? */
  const isCurrent = useCallback(
    (generation: number) => () => generation === generationRef.current,
    [],
  );

  /**
   * Reconcile a collection's pending/failed journal entries against a
   * SERVER-sourced snapshot. The outbox opens asynchronously; after a reload
   * the first server snapshot can land before it has, so this waits on the
   * open promise (already resolved, later) instead of reading the ref — the
   * one snapshot that settles a reload's fate must never be skipped.
   */
  const reconcileLater = useCallback(
    (
      snapshot: QuerySnapshot<DocumentData>,
      collectionPath: string,
      matches: (a: OutboxPayload, b: OutboxPayload) => boolean,
      stillRelevant: () => boolean = () => true,
    ) => {
      if (snapshot.metadata.fromCache) return;
      const documents = snapshot.docs.map((entry) => ({
        id: entry.id,
        data: entry.data() as OutboxPayload,
        hasPendingWrites: entry.metadata.hasPendingWrites,
      }));
      const pendingWrites = snapshot.metadata.hasPendingWrites;
      void outboxPromiseRef.current?.then((outbox) =>
        outbox?.list().then((operations) => {
          if (!stillRelevant()) return;
          applyVerdicts(
            outbox,
            reconcileWithServer(operations, collectionPath, documents, matches, pendingWrites),
          );
        }),
      );
    },
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
    setOutboxHealth(UNOPENED_HEALTH);
    setOutboxReady(false);
    setPendingFillupIds(new Set());
    setFillupsError(null);
    setMalformedFillups([]);

    const unsubscribe = tracker.subscribe(setWrites);

    // The durable outbox is per account and lives in IndexedDB, so it is
    // never cleared here: the next sign-in of the SAME account picks up
    // exactly the entries it left, and another account cannot read them.
    // Opening is asynchronous; every write waits for it, and a failure to
    // open is reported as UNKNOWN state, never as an empty queue.
    outboxRef.current?.close();
    outboxRef.current = null;
    let unsubscribeOutbox: (() => void) | null = null;
    let stopOrphans: (() => void) | null = null;
    const generation = generationRef.current;
    outboxPromiseRef.current = uid
      ? Outbox.open(uid, APP_VERSION)
          .then((outbox) => {
            if (generation !== generationRef.current) {
              outbox.close();
              return null;
            }
            outboxRef.current = outbox;
            setOutboxHealth(outbox.health());
            setOutboxReady(true);
            unsubscribeOutbox = outbox.subscribe((snapshot) => setOutboxOps(snapshot.operations));
            stopOrphans = settleOrphans(outbox, () => generation === generationRef.current);
            return outbox;
          })
          .catch((error: unknown) => {
            if (generation !== generationRef.current) return null;
            // eslint-disable-next-line no-console
            console.warn("[tank-maleh] outbox unavailable", error);
            setOutboxHealth({
              state: "unavailable",
              quarantined: [],
              message: "אחסון הפעולות המקומי אינו זמין — לא ניתן לדעת אם יש פעולות שלא סונכרנו",
            });
            setOutboxReady(true);
            return null;
          })
      : Promise.resolve(null);

    return () => {
      unsubscribe();
      unsubscribeOutbox?.();
      stopOrphans?.();
      outboxRef.current?.close();
      outboxRef.current = null;
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
        onSnapshot(
          collection(db, "users", uid, "vehicles"),
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
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

        reconcileLater(snapshot, `users/${uid}/vehicles`, genericPayloadMatches);
      },
      { isCurrent: isCurrent(generation), label: "vehicles" },
    );
  }, [uid, isCurrent, reconcileLater]);

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
        reconcileLater(snapshot, path.path, fillupPayloadMatches, () => fillupVehicleRef.current === vehicleId);
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
  }, [uid, activeVehicleId, isCurrent, reconcileLater]);

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
          { includeMetadataChanges: true },
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

        reconcileLater(snapshot, `users/${uid}/vehicles/${activeVehicle.id}/observations`, genericPayloadMatches);
      },
      { isCurrent: isCurrent(generation), label: "tank observations" },
    );
  }, [uid, activeVehicle, isCurrent, reconcileLater]);

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

     They are, however, always TRACKED and always JOURNALED. Every user-data
     write goes through `submit`, so a permanent rejection surfaces as a
     visible failure with the input intact instead of being swallowed while
     the UI says "saved". */

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

  /** The outbox for the current account, once it has opened. Throws when it could not. */
  const requireOutbox = useCallback(async (): Promise<Outbox> => {
    const generation = generationRef.current;
    const outbox = await (outboxPromiseRef.current ?? Promise.resolve(null));
    if (generation !== generationRef.current) throw new OutboxStorageError("החשבון התחלף");
    if (!outbox) {
      throw new OutboxStorageError(
        "אחסון הפעולות המקומי אינו זמין — הרשומה לא נשלחה כדי שלא תאבד",
      );
    }
    return outbox;
  }, []);

  /** Path helpers. */
  const userPath = useCallback((...parts: string[]) => ["users", uid ?? "-", ...parts].join("/"), [uid]);
  const refFor = useCallback((path: string) => doc(db, path), []);

  /**
   * The one path a user-data write takes.
   *
   * 1. The complete payload is journaled in the durable outbox — one
   *    IndexedDB transaction — and the journal entry's VERSION is captured.
   *    If storage refuses, this THROWS before Firestore is touched.
   * 2. The write is handed to Firestore and tracked. Its acknowledgement or
   *    rejection is applied to the outbox only if the entry still carries
   *    the version it was issued for: an edit-and-resend or a claimed retry
   *    moves the version, and a late answer for the old input changes
   *    nothing.
   *
   * Firestore's own queue still delivers a pending write across reloads;
   * the outbox never re-sends on its own (no competing dispatchers).
   */
  const submit = useCallback(
    async (input: EnqueueInput, write: () => Promise<unknown>): Promise<MutationReceipt> => {
      const outbox = await requireOutbox();
      const [operation] = await submitMany(outbox, [input], write, track);
      return operation;
    },
    [requireOutbox, track],
  );

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!uid) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      const payload = { settings: stripUndefined(next) as OutboxPayload };
      await submit(
        { kind: "settings.update", path: userPath(), vehicleId: null, payload, opType: "update" },
        () => updateDoc(doc(db, "users", uid), payload),
      );
    },
    [uid, settings, submit, userPath],
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
      const payload = stripUndefined({
        ...(vehicle as unknown as Record<string, unknown>),
        createdAt: SERVER_TIMESTAMP,
      }) as OutboxPayload;
      await submit(
        { kind: "vehicle.add", path: userPath("vehicles", ref.id), vehicleId: ref.id, payload },
        () => setDoc(ref, toFirestoreData(payload)),
      );
      // First vehicle becomes the active one automatically.
      if (vehicles.filter((v) => !v.archived).length === 0) {
        await updateSettings({ activeVehicleId: ref.id });
      }
      return ref.id;
    },
    [uid, vehicles, updateSettings, submit, userPath],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, patch: Partial<Vehicle>) => {
      if (!uid) return;
      const { id: _ignored, ...rest } = patch as Partial<Vehicle> & { id?: string };
      const payload = stripUndefined(rest as Record<string, unknown>) as OutboxPayload;
      const previous = vehicles.find((v) => v.id === vehicleId) ?? null;
      await submit(
        {
          kind: "vehicle.update",
          path: userPath("vehicles", vehicleId),
          vehicleId,
          payload,
          opType: "update",
          beforeImage: previous ? (JSON.parse(JSON.stringify(previous)) as OutboxPayload) : null,
        },
        () => updateDoc(doc(db, "users", uid, "vehicles", vehicleId), payload),
      );
    },
    [uid, vehicles, submit, userPath],
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
      const receipt = await submit(
        {
          kind: "vehicle.delete",
          path: userPath("vehicles", vehicleId),
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
    [uid, settings.activeVehicleId, vehicles, updateSettings, submit, deleteVehicleTree, userPath],
  );

  const fillupPath = useCallback(
    (vehicleId: string, fillupId: string) => userPath("vehicles", vehicleId, "fillups", fillupId),
    [userPath],
  );

  const addFillup = useCallback(
    async (
      fillup: FillupWrite,
      options: { replaceOpId?: string | null; vehicleId?: string } = {},
    ) => {
      const vehicleId = options.vehicleId ?? activeVehicle?.id;
      if (!uid || !vehicleId) throw new Error("no active vehicle");
      const outbox = await requireOutbox();
      // An edited copy of a failed operation keeps its op id AND its document
      // id, so a retry that happens to succeed twice cannot create two records.
      const replaced = options.replaceOpId ? await outbox.get(options.replaceOpId) : null;
      const docId = replaced ? replaced.docId : doc(collection(db, "users", uid, "vehicles", vehicleId, "fillups")).id;
      const path = fillupPath(vehicleId, docId);
      const payload = serializeFillup({ ...fillup, version: fillup.version ?? 1 });
      await submit(
        { kind: "fillup.add", path, vehicleId, payload, replaceOpId: options.replaceOpId ?? null },
        () => setDoc(refFor(path), toFirestoreData(payload)),
      );
      return docId;
    },
    [uid, activeVehicle, submit, requireOutbox, fillupPath, refFor],
  );

  const updateFillup = useCallback(
    async (
      fillupId: string,
      next: FillupWrite,
      previous?: Fillup | null,
      options: { replaceOpId?: string | null; vehicleId?: string } = {},
    ) => {
      const vehicleId = options.vehicleId ?? activeVehicle?.id;
      if (!uid || !vehicleId) return;
      // The version the edit was made against, plus one. The rules refuse
      // the update unless the server still holds exactly that base, which is
      // what closes the check-then-write race — for an online edit and for
      // one queued offline alike.
      const base = previous?.version ?? 0;
      const patch = serializeFillupPatch({ ...next, version: base + 1 });
      const path = fillupPath(vehicleId, fillupId);
      await submit(
        {
          kind: "fillup.update",
          path,
          vehicleId,
          payload: patch,
          opType: "update",
          beforeImage: previous ? serializeFillupPatch(previous) : null,
          replaceOpId: options.replaceOpId ?? null,
        },
        () => updateDoc(refFor(path), toFirestoreData(patch)),
      );
    },
    [uid, activeVehicle, submit, fillupPath, refFor],
  );

  const deleteFillup = useCallback(
    async (fillup: Fillup) => {
      if (!uid || !activeVehicle) return;
      const path = fillupPath(activeVehicle.id, fillup.id);
      await submit(
        {
          kind: "fillup.delete",
          path,
          vehicleId: activeVehicle.id,
          payload: null,
          beforeImage: serializeFillup(fillup),
        },
        () => deleteDoc(refFor(path)),
      );
    },
    [uid, activeVehicle, submit, fillupPath, refFor],
  );

  const restoreFillup = useCallback(
    async (fillup: Fillup) => {
      if (!uid || !activeVehicle) return;
      // Creation metadata travels with the record: a restore is not a new
      // record and must not look like one. Its version follows the deleted
      // one, so it is accepted whether the delete reached the server or not.
      const payload = serializeFillup({ ...fillup, version: (fillup.version ?? 0) + 1 });
      const path = fillupPath(activeVehicle.id, fillup.id);
      await submit(
        { kind: "fillup.restore", path, vehicleId: activeVehicle.id, payload },
        () => setDoc(refFor(path), toFirestoreData(payload)),
      );
    },
    [uid, activeVehicle, submit, fillupPath, refFor],
  );

  /**
   * Re-submit a failed or conflicted operation, on the user's explicit request.
   *
   * Fail closed: the retry first READS the server document. If that read
   * fails — offline, unauthorised, anything — the entry stays failed with a
   * "could not verify" error and nothing is written: an unverifiable state is
   * not permission to overwrite. If the server already holds the operation's
   * content the entry is simply acknowledged; if it holds something newer the
   * entry becomes a conflict for the user to resolve; only a document in the
   * expected state (absent for a create, the same base for an update) is
   * written — and for fill-ups the rules re-check the version on the server,
   * so even a write that races another device is refused rather than
   * silently winning.
   *
   * A pending entry cannot be retried: the SDK already owns that write, and a
   * second competing write for the same input is exactly what this avoids.
   */
  const retryOperation = useCallback(
    async (opId: string) => {
      if (!uid) return;
      const outbox = await requireOutbox();
      const claimed = await outbox.claimRetry(opId);
      if (!claimed) return;
      const { version } = claimed;
      const settle = (promise: Promise<unknown>) => {
        track(claimed.kind, promise);
        return promise.then(
          () => outbox.acknowledge(opId, version),
          (error: unknown) =>
            outbox.fail(opId, version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
        );
      };

      // Vehicle deletion is a tree, not a document; verification is the
      // vehicle document itself.
      if (claimed.kind === "vehicle.delete") {
        const current = await getDocFromServer(refFor(claimed.path)).catch(() => null);
        if (!current) {
          await outbox.fail(opId, version, unverified());
          return;
        }
        if (!current.exists()) {
          await outbox.acknowledge(opId, version);
          return;
        }
        await settle(deleteVehicleTree(claimed.docId));
        return;
      }

      const current = await getDocFromServer(refFor(claimed.path)).catch(() => null);
      if (!current) {
        await outbox.fail(opId, version, unverified());
        return;
      }
      const server = current.exists() ? (current.data() as OutboxPayload) : null;
      const isFillup = claimed.kind.startsWith("fillup.") || claimed.kind === "import.batch";
      const same = (a: OutboxPayload, b: OutboxPayload) =>
        isFillup ? fillupPayloadMatches(a, b) : genericPayloadMatches(a, b);

      if (claimed.opType === "delete") {
        if (!server) {
          await outbox.acknowledge(opId, version);
          return;
        }
        await settle(deleteDoc(refFor(claimed.path)));
        return;
      }

      const payload = claimed.payload ?? {};
      if (server && same(payload, server)) {
        // Already applied — an earlier attempt did reach the server.
        await outbox.acknowledge(opId, version);
        return;
      }

      if (claimed.opType === "update") {
        if (!server) {
          await outbox.fail(opId, version, {
            code: "not-found",
            message: "הרשומה כבר לא קיימת בשרת — אפשר לשמור אותה מחדש כרשומה חדשה",
            at: Date.now(),
          });
          return;
        }
        const base = claimed.beforeImage;
        const baseMatches = base
          ? isFillup
            ? (server.version ?? 0) === (base.version ?? 0)
            : genericPayloadMatches(base, server)
          : false;
        if (!baseMatches) {
          await outbox.markConflict(opId, version, server);
          return;
        }
        await settle(updateDoc(refFor(claimed.path), toFirestoreData(payload)));
        return;
      }

      // set (create / restore / import row)
      if (server) {
        // A newer, different document exists where this create wanted to go.
        await outbox.markConflict(opId, version, server);
        return;
      }
      await settle(setDoc(refFor(claimed.path), toFirestoreData(payload)));
    },
    [uid, requireOutbox, track, refFor, deleteVehicleTree],
  );

  const resolveConflict = useCallback(
    async (opId: string, choice: "keep-server" | "overwrite") => {
      const outbox = await requireOutbox();
      if (choice === "keep-server") {
        await outbox.discard(opId);
        return;
      }
      const op = await outbox.get(opId);
      if (!op || !op.serverImage) return;
      // Overwrite deliberately: re-base on what the server holds now. For a
      // fill-up the payload's version becomes the server's plus one, so the
      // rules accept exactly this write and refuse any other stale one.
      const isFillup = op.kind.startsWith("fillup.") || op.kind === "import.batch";
      const patch: OutboxPayload = isFillup
        ? { version: (typeof op.serverImage.version === "number" ? op.serverImage.version : 0) + 1 }
        : {};
      const rebased = await outbox.rebase(opId, op.serverImage, patch);
      if (!rebased) return;
      if (rebased.opType === "set") {
        // A create over an existing document is an update from here on.
        await outbox.fail(opId, rebased.version, { code: "rebased", message: "", at: Date.now() });
        const again = await outbox.get(opId);
        if (!again) return;
        // The retry path treats an existing document with a matching base as
        // an update; make the entry say so.
        await outbox.enqueue({
          kind: op.kind === "fillup.restore" ? "fillup.update" : op.kind,
          path: op.path,
          vehicleId: op.vehicleId,
          payload: rebased.payload,
          beforeImage: op.serverImage,
          opType: "update",
          replaceOpId: opId,
        });
        const fresh = await outbox.get(opId);
        if (fresh) await outbox.fail(opId, fresh.version, { code: "rebased", message: "", at: Date.now() });
      }
      await retryOperation(opId);
    },
    [requireOutbox, retryOperation],
  );

  const discardOperation = useCallback(
    async (opId: string) => {
      const outbox = await requireOutbox();
      await outbox.discard(opId);
    },
    [requireOutbox],
  );

  const checkUnacknowledged = useCallback(() => unacknowledgedState(), []);

  /**
   * Write an import batch.
   *
   * Every row is journaled with its final document id BEFORE anything is
   * committed, together with the batch record, so a rejection, a reload or a
   * crash mid-import leaves the rows retryable one by one — under the same
   * ids, so a retry can never duplicate a row that did land. One WriteBatch
   * per 400 documents; each chunk's receipt settles its own rows.
   */
  const addFillupBatch = useCallback(
    async (
      vehicleId: string,
      list: Omit<Fillup, "id" | "createdAt">[],
      meta: ImportBatchMeta,
    ) => {
      if (!uid) throw new Error("not signed in");
      const batchId = list[0]?.importBatchId;
      if (!batchId) throw new Error("import records must carry a batch id");
      const outbox = await requireOutbox();

      const rows = list.map((fillup) => {
        const id = doc(collection(db, "users", uid, "vehicles", vehicleId, "fillups")).id;
        return {
          path: fillupPath(vehicleId, id),
          payload: serializeFillup({ ...fillup, version: 1 }),
        };
      });
      const batchPath = userPath("importBatches", batchId);
      const batchPayload: OutboxPayload = {
        vehicleId,
        format: meta.format,
        fileName: meta.fileName,
        recordCount: meta.recordCount,
        vehicleLabel: meta.vehicleLabel,
        importedAt: SERVER_TIMESTAMP,
      };

      const journaled = await outbox.enqueueMany([
        ...rows.map((row) => ({
          kind: "import.batch" as const,
          path: row.path,
          vehicleId,
          payload: row.payload,
          batchId,
        })),
        { kind: "import.batch" as const, path: batchPath, vehicleId, payload: batchPayload, batchId },
      ]);
      const rowOps = journaled.slice(0, rows.length);
      const batchOp = journaled[rows.length];

      const commits: Promise<unknown>[] = [];
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        const chunkOps = rowOps.slice(i, i + 400);
        rows.slice(i, i + 400).forEach((row) => batch.set(refFor(row.path), toFirestoreData(row.payload)));
        const commit = batch.commit();
        commits.push(commit);
        void commit.then(
          () => Promise.all(chunkOps.map((op) => outbox.acknowledge(op.opId, op.version))),
          (error: unknown) =>
            Promise.all(
              chunkOps.map((op) =>
                outbox.fail(op.opId, op.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
              ),
            ),
        );
      }
      const batchWrite = setDoc(refFor(batchPath), toFirestoreData(batchPayload));
      commits.push(batchWrite);
      void batchWrite.then(
        () => outbox.acknowledge(batchOp.opId, batchOp.version),
        (error: unknown) =>
          outbox.fail(batchOp.opId, batchOp.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
      );

      // The receipt settles once EVERY commit has answered — including the
      // batch record's — so "done" on the import screen never precedes a
      // write that is still in flight. It rejects if any of them did.
      const receipt = track("import.batch", allCommits(commits));
      return { written: list.length, receipt };
    },
    [uid, requireOutbox, fillupPath, userPath, refFor, track],
  );

  const addObservation = useCallback(
    async (observation: Omit<TankObservation, "id" | "vehicleId" | "recordedAt">) => {
      if (!uid || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(collection(db, "users", uid, "vehicles", activeVehicle.id, "observations"));
      const payload = stripUndefined({
        ...(observation as unknown as Record<string, unknown>),
        recordedAt: SERVER_TIMESTAMP,
        schemaVersion: 1,
      }) as OutboxPayload;
      await submit(
        { kind: "tank.observation", path: ref.path, vehicleId: activeVehicle.id, payload },
        () => setDoc(ref, toFirestoreData(payload)),
      );
      return ref.id;
    },
    [uid, activeVehicle, submit],
  );

  const deleteObservation = useCallback(
    async (observationId: string) => {
      if (!uid || !activeVehicle) return;
      const path = userPath("vehicles", activeVehicle.id, "observations", observationId);
      await submit(
        { kind: "tank.observation.delete", path, vehicleId: activeVehicle.id, payload: null },
        () => deleteDoc(refFor(path)),
      );
    },
    [uid, activeVehicle, submit, userPath, refFor],
  );

  const addPlan = useCallback(
    async (plan: Omit<TankPlan, "id" | "vehicleId" | "createdAt">) => {
      if (!uid || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(collection(db, "users", uid, "vehicles", activeVehicle.id, "tankPlans"));
      const payload = stripUndefined({
        ...(plan as unknown as Record<string, unknown>),
        createdAt: SERVER_TIMESTAMP,
      }) as OutboxPayload;
      await submit(
        { kind: "tank.plan", path: ref.path, vehicleId: activeVehicle.id, payload },
        () => setDoc(ref, toFirestoreData({ ...payload, date: payload.date })),
      );
      return ref.id;
    },
    [uid, activeVehicle, submit],
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      if (!uid || !activeVehicle) return;
      const path = userPath("vehicles", activeVehicle.id, "tankPlans", planId);
      await submit(
        { kind: "tank.plan.delete", path, vehicleId: activeVehicle.id, payload: null },
        () => deleteDoc(refFor(path)),
      );
    },
    [uid, activeVehicle, submit, userPath, refFor],
  );

  const tankPreferences = useMemo(
    () => activeVehicle?.tankPrefs ?? DEFAULT_TANK_PREFERENCES,
    [activeVehicle],
  );

  const updateTankPreferences = useCallback(
    async (patch: Partial<TankPreferences>) => {
      if (!uid || !activeVehicle) return;
      const next: TankPreferences = { ...tankPreferences, ...patch };
      await updateVehicle(activeVehicle.id, {
        tankPrefs: stripUndefined(next as unknown as Record<string, unknown>) as unknown as TankPreferences,
      });
    },
    [uid, activeVehicle, tankPreferences, updateVehicle],
  );

  const savePriceRule = useCallback(
    async (rule: StoredPriceRule) => {
      if (!uid) return;
      const { id, ...rest } = rule;
      const payload = stripUndefined(rest as unknown as Record<string, unknown>) as OutboxPayload;
      const path = userPath("personalPriceRules", id);
      await submit(
        { kind: "priceRule.save", path, vehicleId: rule.vehicleId, payload },
        () => setDoc(refFor(path), payload, { merge: true }),
      );
    },
    [uid, submit, userPath, refFor],
  );

  const deletePriceRule = useCallback(
    async (ruleId: string) => {
      if (!uid) return;
      const path = userPath("personalPriceRules", ruleId);
      await submit(
        { kind: "priceRule.delete", path, vehicleId: null, payload: null },
        () => deleteDoc(refFor(path)),
      );
    },
    [uid, submit, userPath, refFor],
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
   * created and nothing a person entered by hand. The rows to delete are
   * resolved first and every deletion is journaled (one entry per row, plus
   * the batch record, all under the batch id) before any write, so an
   * interrupted or rejected rollback is visible and retryable row by row.
   */
  const deleteImportBatch = useCallback(
    async (batch: ImportBatch): Promise<ImportRollbackResult> => {
      if (!uid) return { deleted: 0, ok: false, reason: "not signed in" };

      try {
        const outbox = await requireOutbox();
        const fillupsRef = collection(db, "users", uid, "vehicles", batch.vehicleId, "fillups");
        const snapshot = await getDocs(query(fillupsRef, where("importBatchId", "==", batch.id)));

        const batchPath = userPath("importBatches", batch.id);
        const journaled = await outbox.enqueueMany([
          ...snapshot.docs.map((entry) => ({
            kind: "import.rollback" as const,
            path: entry.ref.path,
            vehicleId: batch.vehicleId,
            payload: null,
            beforeImage: entry.data() as OutboxPayload,
            batchId: batch.id,
          })),
          {
            kind: "import.rollback" as const,
            path: batchPath,
            vehicleId: batch.vehicleId,
            payload: null,
            batchId: batch.id,
          },
        ]);
        const rowOps = journaled.slice(0, snapshot.docs.length);
        const batchOp = journaled[snapshot.docs.length];

        const commits: Promise<unknown>[] = [];
        for (let i = 0; i < snapshot.docs.length; i += 400) {
          const writeChunk = writeBatch(db);
          const chunkOps = rowOps.slice(i, i + 400);
          snapshot.docs.slice(i, i + 400).forEach((entry) => writeChunk.delete(entry.ref));
          const commit = writeChunk.commit();
          commits.push(commit);
          void commit.then(
            () => Promise.all(chunkOps.map((op) => outbox.acknowledge(op.opId, op.version))),
            (error: unknown) =>
              Promise.all(
                chunkOps.map((op) =>
                  outbox.fail(op.opId, op.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
                ),
              ),
          );
        }
        const batchDelete = deleteDoc(refFor(batchPath));
        commits.push(batchDelete);
        void batchDelete.then(
          () => outbox.acknowledge(batchOp.opId, batchOp.version),
          (error: unknown) =>
            outbox.fail(batchOp.opId, batchOp.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
        );

        const receipt = track("import.rollback", allCommits(commits));

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
    [uid, requireOutbox, userPath, refFor, track],
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
      outboxHealth,
      outboxReady,
      checkUnacknowledged,
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
      outboxHealth,
      outboxReady,
      checkUnacknowledged,
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
