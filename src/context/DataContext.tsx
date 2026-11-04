import { backupPath, type BackupEntry } from "../lib/vehicle/backup";
import { writeWithLocalAcceptance } from "../lib/localWriteAcceptance";
import { receiptDocumentId } from "../lib/import/receiptText";
import { subscribeResilient } from "../lib/subscribeResilient";
import { carePayloadMatches, conditionalCareWrite } from "../lib/maintenance/persistence";
import { VEHICLE_COLLECTIONS as CARE_COLLECTIONS, vehiclePayload as carePayload, type VehicleCollection as CareCollection, type VehicleRecord as CareRecord } from "../lib/vehicle/model";
import { validFuelDiscount } from '../lib/prices/discount';
import { cachedPublicPrice, refreshPublicPrice } from "../lib/prices/browserFetch";
import { storedDeclaredSource } from '../lib/vehicleSpecs';
import { isVehicleEnrichmentOperation, isVehicleEnrichmentPatch, recoveryGroupsWithVehicleEnrichment, vehicleEnrichmentDecision, vehicleEnrichmentVerdict, vehicleSpecIdentityMatches } from '../lib/vehicleEnrichment';
import { decodeReusablePumpRule } from '../lib/fillupPricing';
import { assertMutationScope, conditionalRawWrite, decodeRawDocument, encodeRawDocument, storedRawDocumentMatches } from '../lib/rawDocument';
import { isVersionedFillupDelete, partitionFillupDeletes, retainedCreationUndo } from '../lib/fillupUndo';
import { reconcileFillupDeletion, writeFillupDeletion } from '../lib/fillupUndoPersistence';
import { createFillupEditUndo, fillupAfterPatch, fillupLifecycleImage, fillupLifecyclePatch } from '../lib/fillupLifecycle';
import { submitVehicleCreation, blockedVehicleSelection, vehicleCreationIdentityMatches, notifyVehicleSelection,
  type VehicleCreationOptions, type VehicleSelectionOptions, type VehicleSelectionResult, type VehicleWriteSubmission } from '../lib/vehicleCreation';
import { vehicleSelectionBase, selectedVehicleFromBase, vehicleSelectionIntent, isVehicleSelectionOperation,
  vehicleSelectionTargetId, vehicleSelectionApplied, writeVehicleSelectionOperation, reconcileVehicleSelectionOperation } from '../lib/vehicleSelection';
import { retireVehicleAttempt, sameVehicleAttempt, vehicleWriteError } from '../lib/vehicleWriteAttempt';
import {
  captureVehicleDocumentImages, createVehicleDocumentCapture, readVehicleDocumentCapture, vehicleDocumentIntent,
  isVehicleDocumentOperation, writeVehicleDocumentOperation, reconcileVehicleDocumentOperation,
  rebaseVehicleDocumentOperation, rawVehicleIdentity, type VehicleDocumentImages,
} from '../lib/vehicleDocumentPersistence';
import type { VehicleDocKey, VehicleDocChanges, VehicleDocumentSnapshot } from '../lib/vehicle/documents';
import {
  createObservationCapture, createRecordUndo, immutableRawImage, readObservationCapture,
  type ObservationDeletionSnapshot, type RecordDeletionOptions,
} from '../lib/recordUndo';
import {
  assertRecordUncontended, captureCareImage, isRecordUndoOperation, reconcileRecordOperation,
  recordConflictPayloadPatch, recordRestoreImage, writeRecordOperation, type RecordCollection,
} from '../lib/recordUndoPersistence';
import { withPublicPrice } from "../lib/prices/regulated";
import type { TankImportRecord } from "../lib/import/tankUpdates";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Timestamp,
  clearIndexedDbPersistence,
  terminate,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { reauthenticateWithPopup } from "firebase/auth";
import { db, googleProvider } from "../lib/firebase";
import { accountDataDeletionSteps, clearAccountLocalStorage, clearVehicleLocalDrafts, finishAccountDeletion, isAccountDeleting, markAccountDeleting, runAccountDeletion, type DeletionResult } from "../lib/accountDeletion";
import { withdrawBenchmark } from "../lib/benchmarks";
import { withdrawVehicleCost } from "../lib/costBenchmarks";
import { pruneOldCaches, readCache, writeCache } from "../lib/cache";
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
import { genericPayloadMatches } from "../lib/writesPayload";
import { conditionalFillupWrite, fillupBaseMatches, FillupConflictError } from "../lib/writesConditional";
import { APP_VERSION } from "../lib/version";
import { missingProfileFields, type LoginProfile } from "../lib/profileBootstrap";
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

import { readScopedTankInput, type ScopedTankInput, type TankInputScope, type TankInputStatus } from "../lib/tank/inputScope";

export type { ObservationDeletionSnapshot, RecordDeletionOptions, RecordDeletionSubmission } from '../lib/recordUndo';
export type { VehicleDocumentSnapshot } from '../lib/vehicle/documents';
export type { VehicleCreationSubmission, VehicleWriteSubmission, VehicleSelectionResult, VehicleSelectionOptions } from '../lib/vehicleCreation';

interface ObservationSnapshot extends ScopedTankInput<TankObservation> {
  rawImages: ReadonlyMap<string, OutboxPayload>;
  pendingIds: ReadonlySet<string>;
}

interface VehicleSnapshot {
  scope: object;
  records: Vehicle[];
  documentImages: ReadonlyMap<string, VehicleDocumentImages>;
  identities: ReadonlyMap<string, OutboxPayload>;
  pendingIds: ReadonlySet<string>;
}

export interface FillupSubmission {
  written: Readonly<Fillup>;
  receipt: MutationReceipt;
  /** Provider account/vehicle session; ordinary route unmount does not end it. */
  isCurrent: () => boolean;
  undoCreation?: () => Promise<MutationReceipt>;
  undoEdit?: () => Promise<MutationReceipt>;
  restoreDeleted?: () => Promise<MutationReceipt>;
}

export interface FillupSubmissionOptions {
  replaceOpId?: string | null;
  replaceVersion?: number;
  vehicleId?: string;
  onSubmitted?: (submission: FillupSubmission) => void;
}

function immutableFillup(fillup: Fillup): Readonly<Fillup> {
  return Object.freeze({ ...fillup, ...(fillup.station ? { station: Object.freeze({ ...fillup.station }) } : {}) });
}

interface DataContextValue {
  /** A render-bound lifetime check that survives route changes, but never account changes. */
  captureAccountAction: () => () => boolean;
  /** As above, also invalidated by switching away from the active vehicle. */
  captureVehicleAction: () => () => boolean;
  importBackupEntries: (entries: BackupEntry[]) => Promise<{written:number; receipts: MutationReceipt[]}>;
  saveCareRecord: (vehicleId: string, name: CareCollection, record: CareRecord, previous?: CareRecord) => Promise<MutationReceipt>;
  deleteCareRecord: (vehicleId: string, name: CareCollection, record: CareRecord, options?: RecordDeletionOptions) => Promise<MutationReceipt>;
  ready: boolean;
  accountDeletionPending: boolean;
  benchmarkWithdrawal: "idle" | "pending" | "done" | "error";
  retryBenchmarkWithdrawal: () => void;
  settings: UserSettings;
  vehicles: Vehicle[];
  activeVehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  fillups: Fillup[];
  prices: RegulatedPriceConfig | null;
  updateAdminPrices: (payload: OutboxPayload) => Promise<void>;
  /** True while the initial fill-up snapshot is still loading. */
  loadingFillups: boolean;
  fillupsFromCache: boolean;
  loadVehicleFillups: (vehicleId: string) => Promise<Fillup[]>;
  loadVehicleCatalog: () => Promise<Vehicle[]>;
  importTankUpdates: (vehicleId: string, records: TankImportRecord[]) => Promise<{ written: number; duplicates: number; receipt: MutationReceipt }>;
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
  /** Raw price presence; normalized missing prices must not become authored zeroes. */
  fillupPriceKnown: ReadonlyMap<string, boolean>;
  /** Re-submit a failed or conflicted operation. Idempotent by document id. */
  retryOperation: (opId: string) => Promise<void>;
  /** Resolve a conflict explicitly: keep the server's version or overwrite it. */
  resolveConflict: (opId: string, choice: "keep-server" | "overwrite", reviewed?: OutboxOperation) => Promise<void>;
  /**
   * Drop an operation the user explicitly gave up on. Removes the journal
   * entry only — a write the SDK still holds is NOT cancelled by this.
   */
  discardOperation: (opId: string) => Promise<void>;

  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setActiveVehicle: (vehicleId: string) => Promise<void>;

  addVehicle: (vehicle: Omit<Vehicle, "id" | "createdAt">, options?: VehicleCreationOptions) => Promise<string>;
  updateVehicle: (vehicleId: string, patch: Partial<Vehicle>) => Promise<MutationReceipt>;
  captureVehicleDocument: <K extends VehicleDocKey>(vehicle: Vehicle, key: K) => VehicleDocumentSnapshot<K> | null;
  updateVehicleDocument: <K extends VehicleDocKey>(vehicleId: string, key: K, changes: VehicleDocChanges<K>,
    options: { expected: VehicleDocumentSnapshot<K> }) => Promise<MutationReceipt>;
  /** Best-effort generated specs; only unchanged missing server fields may be filled. */
  enrichVehicleSpecs: (vehicle: Vehicle, patch: Partial<Vehicle>, signal?: AbortSignal) => Promise<MutationReceipt | null>;
  setVehicleArchived: (vehicleId: string, archived: boolean, options?: VehicleSelectionOptions) => Promise<void>;
  deleteVehicle: (vehicleId: string, options?: VehicleSelectionOptions) => Promise<void>;

  /**
   * Create a fill-up. The payload is written to the outbox BEFORE Firestore
   * sees it; a storage failure throws and nothing is submitted. `replaceOpId`
   * re-submits an edited copy of a failed operation under the same op id.
   */
  addFillup: (
    fillup: FillupWrite,
    options?: FillupSubmissionOptions & { onWritten?: (fillup: Fillup) => void },
  ) => Promise<string>;
  /**
   * Replace a record's fields. `previous` is the before-image: kept in the
   * outbox so a retry can detect that the server moved on in the meantime.
   */
  updateFillup: (
    fillupId: string,
    next: FillupWrite,
    previous?: Fillup | null,
    options?: FillupSubmissionOptions,
  ) => Promise<Fillup | null>;
  deleteFillup: (fillup: Fillup, options?: FillupSubmissionOptions) => Promise<void>;
  /** Re-create a deleted record with its original id and creation metadata, for Undo. */
  restoreFillup: (fillup: Fillup, options?: { vehicleId?: string }) => Promise<void>;
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
  rawPriceRules: ReadonlyMap<string, OutboxPayload>;
  eligiblePriceRules: StoredPriceRule[];
  priceRulesStatus: 'loading' | 'ready' | 'unavailable';
  savePriceRule: (rule: StoredPriceRule, options?: { expected?: OutboxPayload | null }) => Promise<MutationReceipt>;
  deletePriceRule: (ruleId: string, options?: { expected?: OutboxPayload | null }) => Promise<MutationReceipt>;
  /**
   * Undo one import. Deletes ONLY the records carrying that batch id, and then
   * the batch record itself.
   */
  deleteImportBatch: (batch: Pick<ImportBatch, "id" | "vehicleId">) => Promise<ImportRollbackResult>;

  /**
   * Standalone gauge / odometer updates for the active vehicle.
   *
   * These are readings, not transactions: nothing here creates spending or
   * purchased litres, and none of it ever leaves the owner's own subtree.
   */
  tankInputScope: TankInputScope;
  observationsStatus: TankInputStatus;
  plansStatus: TankInputStatus;
  observations: TankObservation[];
  addObservation: (
    observation: Omit<TankObservation, "id" | "vehicleId" | "recordedAt">,
  ) => Promise<string>;
  captureObservation: (record: TankObservation) => ObservationDeletionSnapshot | null;
  deleteObservation: (observationId: string, options?: RecordDeletionOptions & { snapshot?: ObservationDeletionSnapshot }) => Promise<void>;

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
    else if (key.endsWith(".effectiveFrom") && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else if (key === "createdAt" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else if (key === "recordedAt" && typeof value === "number") out[key] = Timestamp.fromMillis(value);
    else out[key] = value;
  }
  return out;
}

/**
 * The per-write marker for a fill-up write: unique for every journal version,
 * so a retry (new version) changes it too. The rules apply the version check
 * only to writes that change this field; a pre-version client never sets it.
 */
function stamped(payload: OutboxPayload, op: { opId: string; version: number }): OutboxPayload {
  return { ...payload, writeId: `${op.opId}.${op.version}` };
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

// This page still owns these SDK promises. A delayed collection snapshot
// must not reject a newer pending write before its actual promise settles.
// A reload opens a new Outbox instance, so lost promises remain reconcilable;
// other tabs' writes and conclusively failed entries remain reconcilable too.
const ownedWrites = new WeakMap<Outbox, Set<string>>();
function ownWrites(outbox: Outbox, operations: OutboxOperation[]): void {
  const versions = ownedWrites.get(outbox) ?? new Set<string>();
  operations.forEach(op => versions.add(`${op.opId}:${op.version}`));
  ownedWrites.set(outbox, versions);
}
function reconcilableOperations(outbox: Outbox, operations: OutboxOperation[]): OutboxOperation[] {
  const versions = ownedWrites.get(outbox);
  return operations.filter(op => op.status !== 'pending' || !versions?.has(`${op.opId}:${op.version}`));
}

function unverified(): { code: string; message: string; at: number } {
  return {
    code: "unverified",
    message: "לא ניתן היה לאמת את מצב הרשומה בשרת — לא נכתב דבר. נסו שוב כשיש חיבור",
    at: Date.now(),
  };
}

/** Automatic proposals never replace fields that became known while fetching. */
function writeVehicleEnrichment(
  path: string,
  payload: OutboxPayload | null,
  before: OutboxPayload | null,
  stillCurrent: () => boolean,
): Promise<void> {
  return runTransaction(db, async transaction => {
    if (!stillCurrent()) return;
    const ref = doc(db, path);
    const snapshot = await transaction.get(ref);
    if (!stillCurrent()) return;
    const decision = vehicleEnrichmentDecision(payload, before, snapshot.exists() ? snapshot.data() : null);
    if (decision.state === 'unverified') {
      throw Object.assign(new Error('לא ניתן לאמת את מפרט הרכב המקורי — ההצעה לא הוחלה'), { code: 'unverified' });
    }
    if (decision.state === 'update') transaction.update(ref, decision.patch);
  });
}


/**
 * Journal several operations, hand ONE write to Firestore for them, and bind
 * its outcome to the journal versions that were issued.
 */
async function submitMany(
  outbox: Outbox,
  inputs: EnqueueInput[],
  write: (operations: OutboxOperation[]) => Promise<unknown>,
  track: (kind: MutationKind, promise: Promise<unknown>) => MutationReceipt,
): Promise<MutationReceipt[]> {
  const operations = await outbox.enqueueMany(inputs);
  ownWrites(outbox, operations);
  let promise: Promise<unknown>;
  try {
    promise = write(operations);
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
          error instanceof FillupConflictError
            ? outbox.markConflict(op.opId, op.version, error.serverImage)
            : outbox.fail(op.opId, op.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
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
    const { ordinary, deletions } = partitionFillupDeletes(reconcilableOperations(outbox, operations));
    const records = ordinary.filter(isRecordUndoOperation);
    const documentWrites = ordinary.filter(isVehicleDocumentOperation);
    const selections = ordinary.filter(isVehicleSelectionOperation);
    for (const group of [...recoveryGroupsWithVehicleEnrichment(ordinary.filter(op => !isRecordUndoOperation(op) && !isVehicleDocumentOperation(op) && !isVehicleSelectionOperation(op))),
      ...selections.filter(op => op.status !== 'conflict').map(newest => ({ newest, superseded: [] })),
      ...documentWrites.filter(op => op.status !== 'conflict').map(newest => ({ newest, superseded: [] })),
      ...records.filter(op => op.status !== 'conflict').map(newest => ({ newest, superseded: [] })),
      ...deletions.filter(op => op.status !== 'conflict').map(newest => ({ newest, superseded: [] }))]) {
      const { newest, superseded } = group;
      const collectionPath = collectionOf(newest.path);
      const isFillup = newest.kind.startsWith("fillup.") || newest.kind === "import.batch";
      const matches = newest.kind.startsWith('priceRule.') ? storedRawDocumentMatches : newest.kind.startsWith("maintenance.") ? carePayloadMatches : isFillup ? fillupPayloadMatches : genericPayloadMatches;
      let done = false;
      const unsubscribe = onSnapshot(
        doc(db, newest.path),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (done || stopped || !stillCurrent() || snapshot.metadata.fromCache) return;
          if (isVehicleSelectionOperation(newest)) {
            void reconcileVehicleSelectionOperation(db, outbox, newest, () => !stopped && stillCurrent()).then(settled => {
              if (settled) { done = true; unsubscribe(); }
            });
            return;
          }
          if (isVehicleDocumentOperation(newest)) {
            void reconcileVehicleDocumentOperation(db, outbox, newest, () => !stopped && stillCurrent()).then(settled => {
              if (settled) { done = true; unsubscribe(); }
            });
            return;
          }
          if (isRecordUndoOperation(newest)) {
            void reconcileRecordOperation(db, outbox, newest, () => !stopped && stillCurrent()).then(settled => {
              if (settled) { done = true; unsubscribe(); }
            });
            return;
          }
          if (isVersionedFillupDelete(newest)) {
            void reconcileFillupDeletion(db, outbox, newest, () => !stopped && stillCurrent()).then(settled => {
              if (settled) { done = true; unsubscribe(); }
            });
            return;
          }
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
            if (stopped || !stillCurrent()) return;
            // Settled meanwhile (another tab, or a listener reconcile).
            if (!current || current.version !== newest.version) {
              done = true;
              unsubscribe();
              return;
            }
            let verdicts: ReconcileVerdict[];
            if (isVehicleEnrichmentOperation(current)) {
              if (snapshot.metadata.hasPendingWrites) return;
              verdicts = [vehicleEnrichmentVerdict(current, snapshot.exists() ? snapshot.data() : null)];
            } else {
              verdicts = reconcileWithServer(
                [current], collectionPath, documents, matches, snapshot.metadata.hasPendingWrites,
              );
            }
            const verdict = verdicts[0];
            if (!verdict || verdict.verdict === "still-pending") return;
            done = true;
            unsubscribe();
            applyVerdicts(outbox, newest.kind.startsWith('priceRule.') ? encodePrivateConflicts(verdicts) : verdicts);
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

function encodePrivateConflicts(verdicts: ReconcileVerdict[]): ReconcileVerdict[] {
  return verdicts.map(verdict => verdict.verdict === 'conflict'
    ? { ...verdict, serverImage: verdict.serverImage === null ? null : encodeRawDocument(verdict.serverImage) } : verdict);
}

/**
 * The triggering collection snapshot can predate the asynchronous journal
 * read. Obtain new server evidence after capturing these operation versions;
 * an older snapshot is never proof that a new suggestion became obsolete.
 */
function reconcileVehicleEnrichment(
  outbox: Outbox,
  operations: OutboxOperation[],
  stillCurrent: () => boolean,
): void {
  const reads = new Map<string, Promise<DocumentSnapshot<DocumentData>>>();
  for (const captured of operations) {
    let read = reads.get(captured.path);
    if (!read) {
      read = getDocFromServer(doc(db, captured.path));
      reads.set(captured.path, read);
    }
    void read.then(async snapshot => {
      if (!stillCurrent() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const current = await outbox.get(captured.opId);
      if (!stillCurrent() || !current || current.version !== captured.version || !isVehicleEnrichmentOperation(current)) return;
      applyVerdicts(outbox, [vehicleEnrichmentVerdict(current, snapshot.exists() ? snapshot.data() : null)]);
    }).catch(() => { /* Unreadable/offline evidence settles no journal entry. */ });
  }
}

/** Raw private-rule images must be judged against evidence newer than capture. */
function reconcilePrivateRules(outbox: Outbox, operations: OutboxOperation[], stillCurrent: () => boolean): void {
  const reads = new Map<string, Promise<DocumentSnapshot<DocumentData>>>();
  for (const captured of operations) {
    let read = reads.get(captured.path);
    if (!read) { read = getDocFromServer(doc(db, captured.path)); reads.set(captured.path, read); }
    void read.then(async snapshot => {
      if (!stillCurrent() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const current = await outbox.get(captured.opId);
      if (!stillCurrent() || !current || current.version !== captured.version) return;
      applyVerdicts(outbox, encodePrivateConflicts(reconcileWithServer([current], collectionOf(current.path), snapshot.exists()
        ? [{ id: snapshot.id, data: snapshot.data(), hasPendingWrites: false }] : [], storedRawDocumentMatches)));
    }).catch(() => { /* Keep the exact input while the server is unavailable. */ });
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const { setTheme, setAccent } = useTheme();

  // The uid, not the User object: a token refresh produces a NEW User instance
  // for the SAME person, and keying effects on the object tears down and
  // rebuilds every listener for no reason.
  const uid = user?.uid ?? null;

  const accountScope = useMemo(() => ({ uid }), [uid]);
  const currentAccountScope = useRef<typeof accountScope | null>(null);
  useLayoutEffect(() => {
    currentAccountScope.current = accountScope;
    return () => { currentAccountScope.current = null; };
  }, [accountScope]);

  const [accountDeletionPending, setAccountDeletionPending] = useState(false);
  const deletingRef = useRef(false);
  const [benchmarkWithdrawal, setBenchmarkWithdrawal] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [withdrawalAttempt, setWithdrawalAttempt] = useState(0);
  const retryBenchmarkWithdrawal = useCallback(() => setWithdrawalAttempt((n) => n + 1), []);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const settingsCacheIntentRef = useRef<object | null>(null);
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<{ scope: object; base: OutboxPayload | null; pending: boolean } | null>(null);
  const selectionIntentRef = useRef({ scope: accountScope, version: 0 });
  useLayoutEffect(() => { selectionIntentRef.current = { scope: accountScope, version: 0 }; }, [accountScope]);
  const [vehicleSnapshot, setVehicleSnapshot] = useState<VehicleSnapshot | null>(null);
  const vehicles = useMemo(() => vehicleSnapshot?.scope === accountScope ? vehicleSnapshot.records : [], [accountScope, vehicleSnapshot]);
  // Retry compares stored fields, not the display model's id/default values.
  const vehicleDocumentsRef = useRef(new Map<string, OutboxPayload>());
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [fillupPriceSnapshot, setFillupPriceSnapshot] = useState<{ scope: TankInputScope; values: ReadonlyMap<string, boolean> } | null>(null);
  const [prices, setPrices] = useState<RegulatedPriceConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingFillups, setLoadingFillups] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [fillupsFromCache,setFillupsFromCache] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [writes, setWrites] = useState<WriteStatus>(EMPTY_WRITE_STATUS);
  const priceRuleScope = useMemo(() => ({ uid }), [uid]);
  const [priceRuleSnapshot, setPriceRuleSnapshot] = useState<{
    scope: typeof priceRuleScope; raw: ReadonlyMap<string, OutboxPayload>;
    status: 'loading' | 'ready' | 'unavailable';
  } | null>(null);
  const rawPriceRules = useMemo<ReadonlyMap<string, OutboxPayload>>(() =>
    priceRuleSnapshot?.scope === priceRuleScope ? priceRuleSnapshot.raw : new Map(), [priceRuleSnapshot, priceRuleScope]);
  const priceRulesStatus = priceRuleSnapshot?.scope === priceRuleScope ? priceRuleSnapshot.status : 'loading';
  const priceRules = useMemo<StoredPriceRule[]>(() => [...rawPriceRules].map(([id, data]) => ({
    id, vehicleId: data.vehicleId ?? null, stationId: data.stationId ?? null,
    stationName: data.stationName ?? null, fuelType: data.fuelType ?? null,
    discountPerLiter: typeof data.discountPerLiter === 'number' ? data.discountPerLiter : 0,
    fixedPricePerLiter: toNumberOrNull(data.fixedPricePerLiter), label: data.label ?? null,
    expiresAt: toNumberOrNull(data.expiresAt), legacy: data.legacy === true, reviewed: data.reviewed === true,
  } as StoredPriceRule)), [rawPriceRules]);
  const eligiblePriceRules = useMemo(() => [...rawPriceRules].flatMap(([id, raw]) => {
    const rule = decodeReusablePumpRule(id, raw);
    return rule ? [rule] : [];
  }), [rawPriceRules]);
  const [observationSnapshot, setObservationSnapshot] = useState<ObservationSnapshot | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<ScopedTankInput<TankPlan> | null>(null);
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
  const [fillupDataScope, setFillupDataScope] = useState<string | null>(null);

  /** Is this still the account the app is showing? */
  useEffect(() => {
    deletingRef.current = uid ? isAccountDeleting(uid) : false;
    setAccountDeletionPending(deletingRef.current);
  }, [uid]);

  const isCurrent = useCallback(
    (generation: number) => () => generation === generationRef.current,
    [],
  );
  const captureAccountScope = useCallback(() => {
    const expected = accountScope;
    return () => currentAccountScope.current === expected && !deletingRef.current;
  }, [accountScope]);

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
      const generation = generationRef.current;
      const relevant = () => generation === generationRef.current && stillRelevant();
      const documents = snapshot.docs.map((entry) => ({
        id: entry.id,
        data: entry.data() as OutboxPayload,
        hasPendingWrites: entry.metadata.hasPendingWrites,
      }));
      const pendingWrites = snapshot.metadata.hasPendingWrites;
      void outboxPromiseRef.current?.then((outbox) =>
        outbox?.list().then((operations) => {
          if (!relevant()) return;
          const candidates = reconcilableOperations(outbox, operations);
          const { ordinary, deletions } = partitionFillupDeletes(operations);
          const ordinaryIds = new Set(ordinary.map(op => op.opId));
          const availableIds = new Set(candidates.map(op => op.opId));
          for (const deletion of deletions) {
            if (collectionOf(deletion.path) === collectionPath && availableIds.has(deletion.opId)) {
              void reconcileFillupDeletion(db, outbox, deletion, relevant);
            }
          }
          const eligible = candidates.filter(op => ordinaryIds.has(op.opId));
          for (const operation of eligible.filter(op => collectionOf(op.path) === collectionPath && isVehicleSelectionOperation(op))) {
            void reconcileVehicleSelectionOperation(db, outbox, operation, relevant);
          }
          for (const operation of eligible.filter(op => collectionOf(op.path) === collectionPath && isVehicleDocumentOperation(op))) {
            void reconcileVehicleDocumentOperation(db, outbox, operation, relevant);
          }
          const automatic = eligible.filter(op => collectionOf(op.path) === collectionPath && isVehicleEnrichmentOperation(op));
          reconcileVehicleEnrichment(outbox, automatic, relevant);
          const privateRules = eligible.filter(op => collectionOf(op.path) === collectionPath && op.kind.startsWith('priceRule.'));
          reconcilePrivateRules(outbox, privateRules, relevant);
          for (const operation of eligible.filter(op => collectionOf(op.path) === collectionPath && isRecordUndoOperation(op))) {
            void reconcileRecordOperation(db, outbox, operation, relevant);
          }
          applyVerdicts(
            outbox,
            reconcileWithServer(eligible.filter(op => !isVehicleEnrichmentOperation(op) && !isVehicleDocumentOperation(op) && !isVehicleSelectionOperation(op) && !op.kind.startsWith('priceRule.') && !isRecordUndoOperation(op)), collectionPath, documents, matches, pendingWrites),
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
    settingsCacheIntentRef.current = null;
    setPreferenceSnapshot(null);
    setVehicleSnapshot(null);
    vehicleDocumentsRef.current.clear();
    setFillups([]);
    setFillupPriceSnapshot(null);
    setFillupDataScope(null);
    setPrices(null);
    setReady(false);
    setLoadingFillups(Boolean(uid));
    setFromCache(false);
    setWrites(EMPTY_WRITE_STATUS);
    setPriceRuleSnapshot(null);
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
              message: "אחסון הפעולות המקומי אינו זמין — לא ניתן לדעת אם יש שינויים שעוד לא עלו לענן",
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
      setVehicleSnapshot({ scope: accountScope, records: cachedVehicles, documentImages: new Map(), identities: new Map(), pendingIds: new Set() });
      setFromCache(true);
    }
    if (cachedPrices) setPrices(cachedPrices);
    if (cachedSettings || cachedVehicles?.length) setReady(true);
  }, [uid, accountScope]);

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
    const accountCurrent = captureAccountScope();
    const identity: LoginProfile = { displayName: user.displayName, photoURL: user.photoURL, email: user.email };

    // Auth telemetry and a late reconnect may both initialize this document.
    // Every field value is derived from the transaction's current read, never
    // from an earlier missing cache snapshot or a queued defaults merge.
    const initializeProfileFields = () => {
      void runTransaction(db, async transaction => {
        assertMutationScope(accountCurrent);
        if (isAccountDeleting(uid)) return;
        const current = await transaction.get(userRef);
        assertMutationScope(accountCurrent);
        const existing = current.exists() ? current.data() : {};
        if (isAccountDeleting(uid) || existing.deletionPending === true) return;
        const patch = missingProfileFields(existing, identity, serverTimestamp());
        if (Object.keys(patch).length) transaction.set(userRef, patch, { merge: true });
      }).catch((error: unknown) => {
        if (!accountCurrent()) return;
        // eslint-disable-next-line no-console
        console.warn("[tank-maleh] could not complete the profile document", error);
      });
    };

    return subscribeResilient<DocumentSnapshot<DocumentData>>(
      (onNext, onError) => onSnapshot(userRef, { includeMetadataChanges: true }, onNext, onError),
      (snapshot) => {
        let preferenceBase: OutboxPayload | null = null;
        try { if (snapshot.exists()) preferenceBase = vehicleSelectionBase(snapshot.data()); } catch { /* An unverifiable preference grants no automatic selection. */ }
        setPreferenceSnapshot({ scope: accountScope, base: preferenceBase, pending: snapshot.metadata.hasPendingWrites });
        if (deletingRef.current || isAccountDeleting(uid) || snapshot.data()?.deletionPending === true) {
          deletingRef.current = true;
          setAccountDeletionPending(true);
          setReady(true);
          return;
        }
        // A cached absence supplies a local view only. A server snapshot on
        // reconnect retries incomplete profiles, including an existing empty
        // root. No attempted/in-flight flag may discard that later snapshot.
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites &&
            Object.keys(missingProfileFields(snapshot.data() ?? {}, identity, null)).length) {
          initializeProfileFields();
        }
        if (!snapshot.exists()) {
          // The local view is ready independently of server initialization.
          // Only the guarded transactions above may supply profile defaults.
          setReady(true);
          return;
        }

        const data = snapshot.data();
        // Account reset and UID cache hydration already supplied the local
        // view. Missing fields in an incomplete profile must not reset it.
        if (!Object.hasOwn(data, 'settings')) {
          setReady(true);
          return;
        }
        const next: UserSettings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
        settingsCacheIntentRef.current = null;
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
  }, [user, uid, accountScope, isCurrent, captureAccountScope]);

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
        const documentImages = new Map<string, VehicleDocumentImages>();
        const identities = new Map<string, OutboxPayload>();
        const pendingIds = new Set<string>();
        vehicleDocumentsRef.current = new Map(snapshot.docs.map((entry) => {
          const data = entry.data();
          documentImages.set(entry.id, captureVehicleDocumentImages(data));
          try { identities.set(entry.id, immutableRawImage(rawVehicleIdentity(data))); } catch { /* No invented identity. */ }
          if (entry.metadata.hasPendingWrites) pendingIds.add(entry.id);
          return [entry.id, { ...data, ...("createdAt" in data ? { createdAt: toMillis(data.createdAt) } : {}) }];
        }));
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            ...(Object.hasOwn(data, 'docs') ? { docs: data.docs } : {}),
            make: String(data.make ?? ""),
            model: String(data.model ?? ""),
            year: toNumberOrNull(data.year),
            plateNumber: data.plateNumber ?? null,
            fuelType: (data.fuelType ?? "95") as Vehicle["fuelType"],
            tankLiters: toNumberOrNull(data.tankLiters),
            // Absent on every pre-provenance document, and absence is treated
            // as "unknown", not "confirmed".
            tankLitersSource: (data.tankLitersSource ?? null) as Vehicle["tankLitersSource"],
            tankSourceUrl: data.tankSourceUrl ?? null,
            specSourceUrl: data.specSourceUrl ?? null,
            declaredKmPerLiter: toNumberOrNull(data.declaredKmPerLiter),
            declaredSource: storedDeclaredSource(data.declaredSource, data.specSourceUrl),
            priceAdjustment: typeof data.priceAdjustment === "number" ? data.priceAdjustment : 0,
            manualPricePerLiter: toNumberOrNull(data.manualPricePerLiter),
            priceDiscount: data.priceDiscount === undefined ? undefined : validFuelDiscount(data.priceDiscount) ? data.priceDiscount : null,
            nickname: data.nickname ?? null,
            archived: Boolean(data.archived),
            deletionPending: data.deletionPending === true,
            createdAt: toMillis(data.createdAt),
            tozeretCd: toNumberOrNull(data.tozeretCd),
            degemCd: toNumberOrNull(data.degemCd),
            tankPrefs: readTankPreferences(data.tankPrefs),
          } satisfies Vehicle;
        });
        list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        setVehicleSnapshot({ scope: accountScope, records: list, documentImages, identities, pendingIds });
        writeCache(uid, "vehicles", list);
        if (!snapshot.metadata.fromCache) setFromCache(false);

        reconcileLater(snapshot, `users/${uid}/vehicles`, genericPayloadMatches);
      },
      { isCurrent: isCurrent(generation), label: "vehicles" },
    );
  }, [uid, accountScope, isCurrent, reconcileLater]);

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.archived && !v.deletionPending), [vehicles]);

  const committedSelectionRef = useRef<{ scope: object; preference: typeof preferenceSnapshot; catalog: typeof vehicleSnapshot } | null>(null);
  useLayoutEffect(() => {
    committedSelectionRef.current = { scope: accountScope, preference: preferenceSnapshot, catalog: vehicleSnapshot };
    return () => { committedSelectionRef.current = null; };
  }, [accountScope, preferenceSnapshot, vehicleSnapshot]);

  const activeVehicle = useMemo(() => {
    if (activeVehicles.length === 0) return null;
    return (
      activeVehicles.find((v) => v.id === settings.activeVehicleId) ?? activeVehicles[0]
    );
  }, [activeVehicles, settings.activeVehicleId]);

  /* ---------- fill-ups for the active vehicle ---------- */

  const activeVehicleId = activeVehicle?.id ?? null;
  const tankInputScope = useMemo<TankInputScope>(() => ({ uid, vehicleId: activeVehicleId }), [uid, activeVehicleId]);
  const fillupPriceKnown = useMemo<ReadonlyMap<string, boolean>>(() => fillupPriceSnapshot?.scope === tankInputScope
    ? fillupPriceSnapshot.values : new Map(), [fillupPriceSnapshot, tankInputScope]);
  const mutationScope = useMemo(() => ({ uid, vehicleId: activeVehicleId }), [uid, activeVehicleId]);
  const currentMutationScope = useRef<typeof mutationScope | null>(null);
  useLayoutEffect(() => {
    currentMutationScope.current = mutationScope;
    return () => { currentMutationScope.current = null; };
  }, [mutationScope]);
  const captureMutationScope = useCallback(() => {
    const expected = mutationScope;
    return () => currentMutationScope.current === expected && !deletingRef.current;
  }, [mutationScope]);

  const captureVehicleDocument = useCallback(function<K extends VehicleDocKey>(vehicle: Vehicle, key: K) {
    return createVehicleDocumentCapture({ records: vehicles, vehicleId: activeVehicleId,
      images: vehicleSnapshot?.scope === accountScope ? vehicleSnapshot.documentImages : new Map(),
      pendingIds: vehicleSnapshot?.scope === accountScope ? vehicleSnapshot.pendingIds : new Set(),
    }, captureMutationScope())(vehicle, key);
  }, [vehicles, activeVehicleId, vehicleSnapshot, accountScope, captureMutationScope]);

  const { records: observations, status: observationsStatus } = readScopedTankInput(observationSnapshot, tankInputScope);
  const { records: plans, status: plansStatus } = readScopedTankInput(planSnapshot, tankInputScope);
  const captureObservation = useCallback((record: TankObservation) => createObservationCapture({
    vehicleId: activeVehicleId,
    records: observations,
    rawImages: observationSnapshot?.scope === tankInputScope ? observationSnapshot.rawImages : new Map(),
    pendingIds: observationSnapshot?.scope === tankInputScope ? observationSnapshot.pendingIds : new Set(),
  }, captureMutationScope())(record), [activeVehicleId, observations, observationSnapshot, tankInputScope, captureMutationScope]);

  useEffect(() => {
    // Keyed on the vehicle ID, not the vehicle object: a vehicle edit (a
    // nickname, a capacity) used to tear the listener down and rebuild it.
    fillupVehicleRef.current = activeVehicleId;
    setFillupsFromCache(true);
    setFillupDataScope(uid && activeVehicleId ? `${uid}/${activeVehicleId}` : null);
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
        const knownPrices = new Map<string, boolean>();
        for (const entry of snapshot.docs) {
          const raw = entry.data();
          const parsed = parseFillupDocument(entry.id, raw);
          knownPrices.set(entry.id, typeof raw.pricePerLiter === 'number' && Number.isFinite(raw.pricePerLiter) && raw.pricePerLiter >= 0);
          if (parsed.ok) list.push(parsed.fillup);
          else malformed.push({ id: parsed.id, reason: parsed.reason, raw: parsed.raw });
          if (entry.metadata.hasPendingWrites) pending.add(entry.id);
        }

        setFillupsFromCache(snapshot.metadata.fromCache);
        setFillups(list);
        setFillupPriceSnapshot({ scope: tankInputScope, values: knownPrices });
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
  }, [uid, activeVehicleId, tankInputScope, isCurrent, reconcileLater]);

  const scopedFillups = useMemo(() => uid && activeVehicleId && fillupDataScope === `${uid}/${activeVehicleId}` ? fillups : [], [uid, activeVehicleId, fillupDataScope, fillups]);
  const scopedLoadingFillups = loadingFillups || (!!activeVehicleId && fillupDataScope !== `${uid}/${activeVehicleId}`);

  /* ---------- tank observations and plans ---------- */

  /**
   * Standalone readings for the active vehicle.
   *
   * Kept in their own subcollection because they are not transactions: an
   * odometer or gauge update has no cost, no litres and no station, and folding
   * it into `fillups` would make it one.
   */
  useEffect(() => {
    if (!uid || !activeVehicleId) {
      setObservationSnapshot(null);
      return;
    }
    const generation = generationRef.current;
    const cached = readCache<TankObservation[]>(uid, `observations.${activeVehicleId}`);
    setObservationSnapshot({ scope: tankInputScope, records: cached ?? [], status: cached ? "cached" : "loading",
      rawImages: new Map(), pendingIds: new Set() });

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, "users", uid, "vehicles", activeVehicleId, "observations"),
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
      (snapshot) => {
        const rawImages = new Map<string, OutboxPayload>();
        const pendingIds = new Set<string>();
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          if (entry.metadata.hasPendingWrites) pendingIds.add(entry.id);
          try { rawImages.set(entry.id, immutableRawImage(data)); }
          catch { /* Displayable legacy data is not an authenticated raw delete base. */ }
          return {
            id: entry.id,
            vehicleId: activeVehicleId,
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
        setObservationSnapshot({ scope: tankInputScope, records: list, status: snapshot.metadata.fromCache ? "cached" : "ready",
          rawImages, pendingIds });
        writeCache(uid, `observations.${activeVehicleId}`, list);

        reconcileLater(snapshot, `users/${uid}/vehicles/${activeVehicleId}/observations`, genericPayloadMatches);
      },
      { isCurrent: isCurrent(generation), label: "tank observations", onError: () =>
        setObservationSnapshot((previous) => previous?.scope === tankInputScope
          ? { ...previous, status: 'unavailable' }
          : { scope: tankInputScope, records: [], status: 'unavailable', rawImages: new Map(), pendingIds: new Set() }) },
    );
  }, [uid, activeVehicleId, tankInputScope, isCurrent, reconcileLater]);

  useEffect(() => {
    if (!uid || !activeVehicleId) {
      setPlanSnapshot(null);
      return;
    }
    const generation = generationRef.current;
    const cached = readCache<TankPlan[]>(uid, `tankPlans.${activeVehicleId}`);
    setPlanSnapshot({ scope: tankInputScope, records: cached ?? [], status: cached ? "cached" : "loading" });

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) =>
        onSnapshot(
          collection(db, "users", uid, "vehicles", activeVehicleId, "tankPlans"),
          { includeMetadataChanges: true },
          onNext,
          onError,
        ),
      (snapshot) => {
        const list = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            vehicleId: activeVehicleId,
            date: toMillis(data.date),
            distanceKm: Number(data.distanceKm ?? 0),
            mode: data.mode === "replaces" ? "replaces" : "additional",
            bufferKm: toNumberOrNull(data.bufferKm),
            note: data.note ?? null,
            createdAt: toMillis(data.createdAt),
          } satisfies TankPlan;
        });
        list.sort((a, b) => a.date - b.date);
        setPlanSnapshot({ scope: tankInputScope, records: list, status: snapshot.metadata.fromCache ? "cached" : "ready" });
        writeCache(uid, `tankPlans.${activeVehicleId}`, list);
      },
      { isCurrent: isCurrent(generation), label: "tank plans", onError: () =>
        setPlanSnapshot((previous) => ({ scope: tankInputScope, records: readScopedTankInput(previous, tankInputScope).records, status: "unavailable" })) },
    );
  }, [uid, activeVehicleId, tankInputScope, isCurrent]);

  /* ---------- personal pricing rules ---------- */

  useEffect(() => {
    if (!uid) return;
    const generation = generationRef.current;
    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) => onSnapshot(collection(db, "users", uid, "personalPriceRules"),
        { includeMetadataChanges: true }, onNext, onError),
      snapshot => {
        const raw = new Map(snapshot.docs.map(entry => [entry.id, entry.data() as OutboxPayload]));
        setPriceRuleSnapshot({ scope: priceRuleScope, raw, status: snapshot.metadata.fromCache ? 'loading' : 'ready' });
        if (!snapshot.metadata.fromCache) reconcileLater(snapshot, `users/${uid}/personalPriceRules`, storedRawDocumentMatches);
      },
      { isCurrent: isCurrent(generation), label: "price rules", onError: () => setPriceRuleSnapshot(previous => ({
        scope: priceRuleScope, raw: previous?.scope === priceRuleScope ? previous.raw : new Map(), status: 'unavailable',
      })) },
    );
  }, [uid, priceRuleScope, isCurrent, reconcileLater]);

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
        setPrices(withPublicPrice(next, cachedPublicPrice()));
        writeCache(uid, "prices", next);
      },
      {
        isCurrent: isCurrent(generation),
        label: "fuel prices",
        onError: () => { /* Keep the last usable price while offline. */ },
      },
    );
  }, [uid, isCurrent]);

  useEffect(() => {
    if (!uid || import.meta.env.VITE_USE_EMULATORS === '1') return;
    let active = true;
    let lastAttempt = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastAttempt < 15 * 60_000) return;
      lastAttempt = Date.now();
      void refreshPublicPrice().then(reading => {
        if (active) setPrices(current => withPublicPrice(current, reading));
      }).catch(() => { /* Cached/server prices remain visible. */ });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => { active = false; document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, [uid]);

  /* ---------- mutations ----------
     Firestore write promises only settle on SERVER acknowledgement, so they
     are deliberately not awaited for UI flow: the local cache applies the
     change immediately and the queued write syncs when the network returns.

     They are, however, always TRACKED and always JOURNALED. Every user-data
     write goes through `submit`, so a permanent rejection surfaces as a
     visible failure with the input intact instead of being swallowed while
     the UI says "saved". */

  const dismissWriteFailure = useCallback((id: string) => {
    trackerRef.current?.dismiss(id);
  }, []);

  /** The outbox for the current account, once it has opened. Throws when it could not. */
  const requireOutbox = useCallback(async (): Promise<Outbox> => {
    if (deletingRef.current) throw new OutboxStorageError("מחיקת החשבון ממתינה להשלמה בפרופיל");
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
    async (
      input: EnqueueInput,
      write: (operation: OutboxOperation) => Promise<unknown>,
      localMatch?: (operation: OutboxOperation, data: DocumentData) => boolean,
      stillCurrent: () => boolean = () => true,
    ): Promise<MutationReceipt> => {
      const attemptTracker = trackerRef.current;
      const trackAttempt = (kind: MutationKind, promise: Promise<unknown>): MutationReceipt =>
        attemptTracker ? attemptTracker.track(kind, promise) : { id: '', settled: Promise.resolve(false) };
      assertMutationScope(stillCurrent);
      const outbox = await requireOutbox();
      assertMutationScope(stillCurrent);
      const ownerPath = `users/${outbox.uid}`;
      if (input.path.startsWith('users/') && input.path !== ownerPath && !input.path.startsWith(`${ownerPath}/`)) {
        throw new OutboxStorageError('החשבון התחלף — הפעולה לא נשלחה');
      }
      let accepted = Promise.resolve();
      const [operation] = await submitMany(outbox, [input], (ops) => {
        if (!localMatch) return write(ops[0]);
        const receipt = writeWithLocalAcceptance(refFor(input.path), data => localMatch(ops[0], data), () => write(ops[0]));
        accepted = receipt.accepted;
        return receipt.settled;
      }, trackAttempt);
      await accepted;
      return operation;
    },
    [requireOutbox, refFor],
  );

  const updateAdminPrices = useCallback(async (payload: OutboxPayload) => {
    if (!user) throw new Error("not signed in");
    if (!isAdmin) throw new Error("admin required");
    const stillCurrent = captureAccountScope();
    assertMutationScope(stillCurrent);
    const path = "appConfig/fuelPrices";
    await submit({ kind: "adminPrice.update", path, vehicleId: null, payload, opType: "update" },
      () => { assertMutationScope(stillCurrent); return updateDoc(refFor(path), toFirestoreData(payload)); },
      (operation, data) => genericPayloadMatches(operation.payload ?? {}, data), stillCurrent);
  }, [user, isAdmin, captureAccountScope, submit, refFor]);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!uid) return;
      const stillCurrent = captureAccountScope();
      assertMutationScope(stillCurrent);
      if (Object.hasOwn(patch, 'activeVehicleId')) {
        selectionIntentRef.current = { scope: accountScope, version: selectionIntentRef.current.version + 1 };
      }
      const next = { ...settings, ...patch };
      const cacheIntent = {};
      settingsCacheIntentRef.current = cacheIntent;
      setSettings(next);
      const payload = { settings: stripUndefined(next) as OutboxPayload };
      await submit(
        { kind: "settings.update", path: userPath(), vehicleId: null, payload, opType: "update" },
        // Own exactly the same whole settings map as updateDoc, while allowing
        // this explicit preference to create an absent parent atomically. A
        // separate empty parent write has no durable SDK overlay and can make
        // a queued preference look absent during reconnect reconciliation.
        () => { assertMutationScope(stillCurrent); return setDoc(doc(db, "users", uid), payload, { mergeFields: ["settings"] }); }, undefined, stillCurrent,
      );
      // After durable local acceptance, retain the same UID-scoped view across
      // offline reloads independently of the next SDK snapshot callback.
      // A newer preference or an actual settings snapshot owns the cache first.
      if (stillCurrent() && settingsCacheIntentRef.current === cacheIntent) writeCache(uid, 'settings', next);
    },
    [uid, settings, submit, userPath, captureAccountScope, accountScope],
  );

  const setActiveVehicle = useCallback(
    async (vehicleId: string) => {
      await updateSettings({ activeVehicleId: vehicleId });
    },
    [updateSettings],
  );

  const submitVehicleSelection = useCallback(async (
    payload: OutboxPayload, beforeImage: OutboxPayload, stillCurrent: () => boolean,
    retained?: VehicleWriteSubmission,
  ): Promise<VehicleSelectionResult> => {
    const attemptTracker = trackerRef.current;
    try {
      assertMutationScope(stillCurrent);
      const outbox = await requireOutbox();
      assertMutationScope(stillCurrent);
      if (retained) {
        const original = await outbox.get(retained.opId);
        assertMutationScope(stillCurrent);
        if (!original) {
          const targetId = vehicleSelectionTargetId(payload);
          const target = targetId ? await getDocFromServer(refFor(userPath('vehicles', targetId))) : null;
          const profile = await getDocFromServer(refFor(userPath()));
          assertMutationScope(stillCurrent);
          if (profile.exists() && !profile.metadata.fromCache && !profile.metadata.hasPendingWrites &&
              (!target || !target.metadata.fromCache && !target.metadata.hasPendingWrites) &&
              vehicleSelectionApplied(payload, beforeImage, profile.data(), target?.exists() ? target.data() : null)) {
            return { state: 'not-required', reason: 'already-selected' };
          }
          throw vehicleWriteError('vehicle-selection-ended', 'הפעולה כבר אינה ממתינה — אפשר לבחור ברכב מתוך רשימת הרכבים');
        }
        if (original.version !== retained.version) throw vehicleWriteError('vehicle-operation-changed', 'פעולת הבחירה השתנתה — יש לפתוח את השינויים השמורים');
        if (original.status === 'pending') return { state: 'submitted', ...retained };
        if (!isVehicleSelectionOperation(original)) throw vehicleWriteError('vehicle-selection-unverified', 'פעולת הבחירה השתנתה — יש לפתוח את השינויים השמורים');
        const operation = await outbox.claimRetry(original.opId);
        assertMutationScope(stillCurrent);
        if (!operation || operation.version !== original.version + 1) {
          if (operation) await outbox.fail(operation.opId, operation.version, { code: 'operation-changed', message: 'פעולת הבחירה השתנתה — הפרטים נשמרו לבדיקה', at: Date.now() });
          throw vehicleWriteError('vehicle-operation-changed', 'פעולת הבחירה השתנתה — יש לפתוח את השינויים השמורים');
        }
        ownWrites(outbox, [operation]);
        const promise = writeVehicleSelectionOperation(db, outbox, operation, stillCurrent);
        void promise.then(() => outbox.acknowledge(operation.opId, operation.version), error => error instanceof FillupConflictError
          ? outbox.markConflict(operation.opId, operation.version, error.serverImage)
          : outbox.fail(operation.opId, operation.version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }));
        const receipt = attemptTracker ? attemptTracker.track('settings.update', promise) : { id: '', settled: Promise.resolve(false) };
        return { state: 'submitted', opId: operation.opId, version: operation.version, receipt };
      }
      let issued: OutboxOperation | null = null;
      const receipt = await submit({ kind: 'settings.update', path: userPath(), vehicleId: null, payload, beforeImage, opType: 'update' },
        operation => { issued = operation; return writeVehicleSelectionOperation(db, outbox, operation, stillCurrent); }, undefined, stillCurrent);
      return { state: 'submitted', opId: issued!.opId, version: issued!.version, receipt };
    } catch (error) { return blockedVehicleSelection(error, retained); }
  }, [requireOutbox, submit, userPath, refFor]);

  const addVehicle = useCallback(
    async (vehicle: Omit<Vehicle, "id" | "createdAt">, options: VehicleCreationOptions = {}) => {
      if (!uid) throw new Error("not signed in");
      const accountCurrent = captureAccountScope();
      assertMutationScope(accountCurrent);
      const attemptTracker = trackerRef.current;
      const opening = committedSelectionRef.current;
      const initialPreference = opening?.scope === accountScope && opening.preference?.scope === accountScope && !opening.preference.pending
        ? opening.preference.base : null;
      const initialCatalog = opening?.scope === accountScope && opening.catalog?.scope === accountScope ? opening.catalog : null;
      const firstVehicle = initialCatalog !== null && initialCatalog.records.every(row => row.archived || row.deletionPending);
      const selectionVersion = selectionIntentRef.current.version;
      const ref = doc(collection(db, "users", uid, "vehicles"));
      const payload = decodeRawDocument(immutableRawImage(stripUndefined({
        ...(vehicle as unknown as Record<string, unknown>),
        createdAt: SERVER_TIMESTAMP,
      })));
      const outbox = await requireOutbox();
      assertMutationScope(accountCurrent);
      let retainedSelection: VehicleWriteSubmission | undefined;
      let selectionPayload: OutboxPayload | null = null;
      const select = async (creation: OutboxOperation, attempt: 'initial' | 'retry'): Promise<VehicleSelectionResult> => {
        assertMutationScope(accountCurrent);
        if (initialCatalog === null) throw vehicleWriteError('vehicle-selection-unverified', 'רשימת הרכבים לא אומתה — אפשר לבחור ברכב מתוך רשימת הרכבים');
        if (!firstVehicle) return { state: 'not-required', reason: 'not-first-vehicle' };
        if (!initialPreference) throw vehicleWriteError('vehicle-selection-unverified', 'הבחירה הקודמת לא אומתה — אפשר לבחור ברכב מתוך רשימת הרכבים');
        if (attempt === 'initial') await retireVehicleAttempt(outbox, creation, accountCurrent);
        else if (await outbox.get(creation.opId)) throw vehicleWriteError('creation-unconfirmed', 'יצירת הרכב עדיין ממתינה — יש להשלים את הפעולה השמורה');
        assertMutationScope(accountCurrent);
        if (!retainedSelection && selectionIntentRef.current.version !== selectionVersion) return { state: 'not-required', reason: 'newer-choice' };
        if (retainedSelection && selectionPayload) {
          const result = await submitVehicleSelection(selectionPayload, initialPreference, accountCurrent, retainedSelection);
          if (result.state === 'submitted') retainedSelection = result;
          return result;
        }
        const target = await getDocFromServer(ref);
        assertMutationScope(accountCurrent);
        if (!target.exists() || target.metadata.hasPendingWrites || target.metadata.fromCache || !vehicleCreationIdentityMatches(payload, target.data())) {
          throw vehicleWriteError('vehicle-selection-unverified', 'הרכב לבחירה השתנה או לא אומת — אפשר לבחור מתוך רשימת הרכבים');
        }
        const capturedSelection = selectedVehicleFromBase(initialPreference);
        selectionPayload = vehicleSelectionIntent({ vehicleId: ref.id, raw: target.data() }, typeof capturedSelection === 'string' ? capturedSelection : null);
        const stillCurrent = () => accountCurrent() && selectionIntentRef.current.version === selectionVersion;
        const result = await submitVehicleSelection(selectionPayload, initialPreference, stillCurrent);
        if (result.state === 'submitted') retainedSelection = result;
        return result;
      };
      return submitVehicleCreation({ vehicleId: ref.id, isCurrent: accountCurrent, select, onSubmitted: options.onSubmitted,
        journal: async settled => {
          let issued: OutboxOperation | null = null;
          const [receipt] = await submitMany(outbox, [{ kind: 'vehicle.add', path: userPath('vehicles', ref.id), vehicleId: ref.id, payload }],
            operations => { issued = operations[0]; return settled; },
            (kind, promise) => attemptTracker ? attemptTracker.track(kind, promise) : { id: '', settled: Promise.resolve(false) });
          return { operation: issued!, receipt };
        },
        start: () => writeWithLocalAcceptance(ref, data => genericPayloadMatches(payload, data), () => {
          assertMutationScope(accountCurrent); return setDoc(ref, toFirestoreData(payload));
        }),
      });
    },
    [uid, accountScope, captureAccountScope, requireOutbox, submitVehicleSelection, userPath],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, patch: Partial<Vehicle>) => {
      if (!uid) throw new Error("not signed in");
      const stillCurrent = captureAccountScope();
      assertMutationScope(stillCurrent);
      if (Object.keys(patch).some(key => key === 'docs' || key.startsWith('docs.'))) {
        throw new Error('מסמכי רכב נשמרים מתוך מסך הרישוי והביטוח');
      }
      const { id: _ignored, ...rest } = patch as Partial<Vehicle> & { id?: string };
      const payload = stripUndefined(rest as Record<string, unknown>) as OutboxPayload;
      return submit(
        {
          kind: "vehicle.update",
          path: userPath("vehicles", vehicleId),
          vehicleId,
          payload,
          opType: "update",
          beforeImage: vehicleDocumentsRef.current.get(vehicleId) ?? null,
        },
        () => { assertMutationScope(stillCurrent); return updateDoc(doc(db, "users", uid, "vehicles", vehicleId), payload); }, undefined, stillCurrent,
      );
    },
    [uid, submit, userPath, captureAccountScope],
  );

  const updateVehicleDocument = useCallback(async <K extends VehicleDocKey,>(
    vehicleId: string, key: K, changes: VehicleDocChanges<K>, options: { expected: VehicleDocumentSnapshot<K> },
  ): Promise<MutationReceipt> => {
    if (!uid || activeVehicleId !== vehicleId) throw new Error('הרכב או החשבון התחלפו');
    const captured = readVehicleDocumentCapture(options.expected, vehicleId, key);
    const current = captureMutationScope();
    const stillCurrent = () => current() && captured.isCurrent();
    assertMutationScope(stillCurrent);
    const payload = vehicleDocumentIntent(key, changes);
    const outbox = await requireOutbox();
    assertMutationScope(stillCurrent);
    return submit({ kind: 'vehicle.update', path: userPath('vehicles', vehicleId), vehicleId,
      payload, beforeImage: captured.beforeImage, opType: 'update' },
    operation => writeVehicleDocumentOperation(db, outbox, operation, stillCurrent), undefined, stillCurrent);
  }, [uid, activeVehicleId, captureMutationScope, requireOutbox, submit, userPath]);

  const enrichVehicleSpecs = useCallback(
    async (vehicle: Vehicle, patch: Partial<Vehicle>, signal?: AbortSignal) => {
      const generation = generationRef.current;
      const stillCurrent = () => generation === generationRef.current && !signal?.aborted;
      if (!uid || !stillCurrent()) return null;
      const original = vehicleDocumentsRef.current.get(vehicle.id);
      // A local display cache is not a raw before-image. Wait for the real
      // vehicle listener rather than rebinding an old lookup to newer data.
      if (!original || !vehicleSpecIdentityMatches(original, { ...vehicle })) return null;
      const beforeImage = { ...original };
      const payload = stripUndefined({ ...patch }) as OutboxPayload;
      if (!isVehicleEnrichmentPatch(payload)) throw new Error('הצעת מפרט הרכב אינה תקינה');
      const path = userPath('vehicles', vehicle.id);
      return submit(
        { kind: 'vehicle.update', path, vehicleId: vehicle.id, payload, opType: 'update', beforeImage },
        op => writeVehicleEnrichment(path, op.payload, op.beforeImage, stillCurrent),
      );
    },
    [uid, submit, userPath],
  );

  const selectAfterVehicleRemoval = useCallback(async (sourceId: string, accountCurrent: () => boolean, intentVersion: number): Promise<VehicleSelectionResult> => {
    try {
      assertMutationScope(accountCurrent);
      if (selectionIntentRef.current.version !== intentVersion) return { state: 'not-required', reason: 'newer-choice' };
      const latest = committedSelectionRef.current;
      if (latest?.scope !== accountScope || latest.preference?.scope !== accountScope || latest.preference.pending ||
          !latest.preference.base || latest.catalog?.scope !== accountScope) {
        throw vehicleWriteError('vehicle-selection-unverified', 'בחירת הרכב הבאה לא אומתה — אפשר לבחור מתוך רשימת הרכבים');
      }
      if (selectedVehicleFromBase(latest.preference.base) !== sourceId) return { state: 'not-required', reason: 'newer-choice' };
      const target = latest.catalog.records.find(row => row.id !== sourceId && !row.archived && !row.deletionPending);
      const identity = target ? latest.catalog.identities.get(target.id) : null;
      if (target && (!identity || latest.catalog.pendingIds.has(target.id))) {
        throw vehicleWriteError('vehicle-selection-unverified', 'הרכב הבא עדיין לא אומת — הבחירה הקיימת נשמרה');
      }
      const payload = vehicleSelectionIntent(target && identity ? { vehicleId: target.id, raw: decodeRawDocument(identity) } : null, sourceId);
      return submitVehicleSelection(payload, latest.preference.base,
        () => accountCurrent() && selectionIntentRef.current.version === intentVersion);
    } catch (error) { return blockedVehicleSelection(error); }
  }, [accountScope, submitVehicleSelection]);

  const setVehicleArchived = useCallback(
    async (vehicleId: string, archived: boolean, options: VehicleSelectionOptions = {}) => {
      const accountCurrent = captureAccountScope(), intentVersion = selectionIntentRef.current.version;
      assertMutationScope(accountCurrent);
      const receipt = await updateVehicle(vehicleId, { archived });
      if (!(await receipt.settled)) throw new Error("vehicle-archive-rejected");
      if (archived && accountCurrent()) {
        await withdrawVehicleCost(uid!, vehicleId, db, accountCurrent);
        const selection = await selectAfterVehicleRemoval(vehicleId, accountCurrent, intentVersion);
        notifyVehicleSelection(options, selection, accountCurrent);
      }
    },
    [uid, updateVehicle, captureAccountScope, selectAfterVehicleRemoval],
  );

  /** Remove a vehicle and every subcollection under it. */
  const deleteVehicleTree = useCallback(
    async (vehicleId: string) => {
      if (!uid) return;
      const vehicleRef = doc(db, "users", uid, "vehicles", vehicleId);
      // Lock new care writes before enumerating children. The marker is kept on failure for a safe retry.
      const vehicle = await getDocFromServer(vehicleRef);
      if (vehicle.exists()) await updateDoc(vehicleRef, { deletionPending: true, archived: true });
      // Every subcollection, not just fill-ups: leaving observations or plans
      // behind would keep a deleted vehicle's private tank history alive.
      for (const name of ["fillups", "observations", "tankPlans", ...CARE_COLLECTIONS]) {
        const snapshot = await getDocsFromServer(collection(vehicleRef, name));
        for (let i = 0; i < snapshot.docs.length; i += 400) {
          const batch = writeBatch(db);
          snapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
          await batch.commit();
        }
      }
      await withdrawVehicleCost(uid, vehicleId);
      await deleteDoc(vehicleRef);
      clearVehicleLocalDrafts(uid,vehicleId);
    },
    [uid],
  );

  const deleteVehicle = useCallback(
    async (vehicleId: string, options: VehicleSelectionOptions = {}) => {
      if (!uid) return;
      const accountCurrent = captureAccountScope(), intentVersion = selectionIntentRef.current.version;
      assertMutationScope(accountCurrent);
      const previous = vehicles.find((v) => v.id === vehicleId) ?? null;
      const receipt = await submit(
        {
          kind: "vehicle.delete",
          path: userPath("vehicles", vehicleId),
          vehicleId,
          payload: null,
          beforeImage: previous ? (JSON.parse(JSON.stringify(previous)) as OutboxPayload) : null,
        },
        () => { assertMutationScope(accountCurrent); return deleteVehicleTree(vehicleId); }, undefined, accountCurrent,
      );
      if (!(await receipt.settled)) throw new Error("vehicle-delete-rejected");
      if (accountCurrent()) {
        const selection = await selectAfterVehicleRemoval(vehicleId, accountCurrent, intentVersion);
        notifyVehicleSelection(options, selection, accountCurrent);
      }

    },
    [uid, vehicles, captureAccountScope, selectAfterVehicleRemoval, submit, deleteVehicleTree, userPath],
  );

  const fillupPath = useCallback(
    (vehicleId: string, fillupId: string) => userPath("vehicles", vehicleId, "fillups", fillupId),
    [userPath],
  );

  const restoreSubmittedFillup = useCallback(async (fillup: Readonly<Fillup>, vehicleId: string, stillCurrent: () => boolean) => {
    assertMutationScope(stillCurrent);
    const payload = fillupLifecycleImage({ ...fillup, version: (fillup.version ?? 0) + 1 });
    const path = fillupPath(vehicleId, fillup.id);
    return submit(
      { kind: 'fillup.restore', path, vehicleId, payload, beforeImage: fillupLifecycleImage(fillup) },
      op => conditionalFillupWrite(db, refFor(path), 'set', toFirestoreData(stamped(payload, op)), op.beforeImage, true, stillCurrent),
      undefined, stillCurrent,
    );
  }, [submit, fillupPath, refFor]);

  const deleteSubmittedFillup = useCallback(async (fillup: Readonly<Fillup>, vehicleId: string, stillCurrent: () => boolean) => {
    assertMutationScope(stillCurrent);
    const outbox = await requireOutbox();
    assertMutationScope(stillCurrent);
    const path = fillupPath(vehicleId, fillup.id);
    return submit(
      { kind: 'fillup.delete', path, vehicleId, payload: null, beforeImage: fillupLifecycleImage(fillup) },
      op => writeFillupDeletion(db, outbox, op, stillCurrent), undefined, stillCurrent,
    );
  }, [requireOutbox, submit, fillupPath]);

  const addFillup = useCallback(
    async (fillup: FillupWrite, options: FillupSubmissionOptions & { onWritten?: (fillup: Fillup) => void } = {}) => {
      const vehicleId = options.vehicleId ?? activeVehicle?.id;
      if (!uid || !vehicleId) throw new Error('no active vehicle');
      const stillCurrent = captureMutationScope();
      assertMutationScope(stillCurrent);
      const outbox = await requireOutbox();
      assertMutationScope(stillCurrent);
      const replaced = options.replaceOpId ? await outbox.get(options.replaceOpId) : null;
      if (options.replaceOpId && !replaced) throw new Error('הפעולה כבר אינה ממתינה — פתחו את הרשומה המעודכנת');
      if (replaced && options.replaceVersion !== undefined && replaced.version !== options.replaceVersion) {
        throw new Error('הפעולה נערכה מאז שפתחתם אותה — הנתונים שהקלדתם נשארו כאן');
      }
      if (replaced && (replaced.uid !== uid || replaced.vehicleId !== vehicleId || !replaced.kind.startsWith('fillup.') ||
          replaced.opType === 'delete' || replaced.status === 'pending' || replaced.path !== fillupPath(vehicleId, replaced.docId))) {
        throw new Error('הפעולה השתנתה — פתחו אותה שוב לפני שליחה');
      }
      if (replaced && retainedCreationUndo(await outbox.list(), replaced)) {
        throw new Error('לתדלוק הזה ממתינה פעולת ביטול — יש לפתור אותה לפני שליחה נוספת');
      }
      const receiptId = receiptDocumentId(fillup.importSource, fillup.importRowHash);
      if (!replaced && receiptId && (scopedFillups.some(row => row.id === receiptId || row.importRowHash === fillup.importRowHash ||
          (fillup.importBatchId && row.importBatchId === fillup.importBatchId)) || (await outbox.list()).some(op => op.vehicleId === vehicleId && op.docId === receiptId))) {
        throw new Error('הקבלה כבר קיימת או ממתינה לסנכרון ברכב הזה. פתחו אותה ביומן או בשינויים שעוד לא עלו לענן.');
      }
      assertMutationScope(stillCurrent);
      const docId = replaced ? replaced.docId : receiptId ?? doc(collection(db, 'users', uid, 'vehicles', vehicleId, 'fillups')).id;
      const path = fillupPath(vehicleId, docId);
      const payload = serializeFillup({ ...fillup, version: fillup.version ?? 1 });
      let written: Fillup | null = null;
      const receipt = await submit(
        { kind: replaced?.kind ?? 'fillup.add', path, vehicleId, payload, opType: replaced?.opType ?? 'set',
          beforeImage: replaced?.beforeImage ?? null, replaceOpId: options.replaceOpId ?? null },
        async op => {
          assertMutationScope(stillCurrent);
          if (replaced) {
            if (op.version !== replaced.version + 1 || retainedCreationUndo(await outbox.list(), op)) {
              throw new Error('הפעולה השתנתה או ממתינה לביטול — הנתונים נשמרו לבדיקה');
            }
            assertMutationScope(stillCurrent);
          }
          const outgoing = stamped(payload, op);
          const parsed = parseFillupDocument(docId, outgoing);
          if (!parsed.ok) throw new Error('לא ניתן לקרוא את התדלוק שנשמר');
          written = parsed.fillup;
          options.onWritten?.(immutableFillup(parsed.fillup));
          return replaced
            ? conditionalFillupWrite(db, refFor(path), op.opType, toFirestoreData(outgoing), op.beforeImage, op.kind === 'fillup.restore', stillCurrent)
            : setDoc(refFor(path), toFirestoreData(outgoing));
        },
        (op, data) => data.writeId === `${op.opId}.${op.version}`, stillCurrent,
      );
      if (written) {
        const snapshot = immutableFillup(written);
        options.onSubmitted?.({ written: snapshot, receipt, isCurrent: stillCurrent,
          ...(!replaced ? { undoCreation: () => deleteSubmittedFillup(snapshot, vehicleId, stillCurrent) } : {}) });
      }
      return docId;
    },
    [uid, activeVehicle, scopedFillups, captureMutationScope, submit, requireOutbox, fillupPath, refFor, deleteSubmittedFillup],
  );

  const updateFillup = useCallback(
    async (fillupId: string, next: FillupWrite, previous?: Fillup | null, options: FillupSubmissionOptions = {}) => {
      const vehicleId = options.vehicleId ?? activeVehicle?.id;
      if (!uid || !vehicleId) return null;
      const stillCurrent = captureMutationScope();
      assertMutationScope(stillCurrent);
      const capturedPrevious = previous ? immutableFillup(previous) : null;
      const base = capturedPrevious?.version ?? 0;
      const patch = serializeFillupPatch({ ...next, version: base + 1 });
      const outbox = await requireOutbox();
      assertMutationScope(stillCurrent);
      const path = fillupPath(vehicleId, fillupId);
      const replaced = options.replaceOpId ? await outbox.get(options.replaceOpId) : null;
      if (options.replaceOpId && (!replaced || replaced.uid !== uid || replaced.path !== path || replaced.status === 'pending' || replaced.opType === 'delete')) {
        throw new Error('הפעולה השתנתה — פתחו אותה שוב לפני שליחה');
      }
      if (replaced && options.replaceVersion !== undefined && replaced.version !== options.replaceVersion) {
        throw new Error('הפעולה נערכה מאז שפתחתם אותה — הנתונים שהקלדתם נשארו כאן');
      }
      if (replaced && retainedCreationUndo(await outbox.list(), replaced)) {
        throw new Error('לתדלוק הזה ממתינה פעולת ביטול — יש לפתור אותה לפני שליחה נוספת');
      }
      let written: Fillup | null = null;
      const receipt = await submit(
        { kind: 'fillup.update', path, vehicleId, payload: patch, opType: 'update',
          beforeImage: capturedPrevious ? fillupLifecyclePatch(capturedPrevious) : null, replaceOpId: options.replaceOpId ?? null },
        async op => {
          assertMutationScope(stillCurrent);
          const outgoing = stamped(patch, op);
          written = fillupAfterPatch(fillupId, capturedPrevious, outgoing);
          if (replaced) {
            if (op.version !== replaced.version + 1 || retainedCreationUndo(await outbox.list(), op)) {
              throw new Error('הפעולה השתנתה או ממתינה לביטול — הנתונים נשמרו לבדיקה');
            }
            assertMutationScope(stillCurrent);
          }
          return conditionalFillupWrite(db, refFor(path), 'update', toFirestoreData(outgoing), op.beforeImage, false, stillCurrent);
        }, undefined, stillCurrent,
      );
      if (written) {
        const snapshot = immutableFillup(written);
        const undoEdit = createFillupEditUndo({ previous: capturedPrevious, written: snapshot, receipt,
          replacement: !!replaced, isCurrent: stillCurrent,
          submitPatch: (payload, beforeImage) => submit({ kind: 'fillup.update', path, vehicleId, payload,
            beforeImage, opType: 'update' }, op => conditionalFillupWrite(db, refFor(path), 'update',
            toFirestoreData(stamped(payload, op)), op.beforeImage, false, stillCurrent), undefined, stillCurrent),
        });
        options.onSubmitted?.({ written: snapshot, receipt, isCurrent: stillCurrent, ...(undoEdit ? { undoEdit } : {}) });
      }
      return written;
    },
    [uid, activeVehicle, captureMutationScope, submit, requireOutbox, fillupPath, refFor],
  );

  const deleteFillup = useCallback(async (fillup: Fillup, options: FillupSubmissionOptions = {}) => {
    const vehicleId = options.vehicleId ?? activeVehicle?.id;
    if (!uid || !vehicleId) return;
    const stillCurrent = captureMutationScope();
    const snapshot = immutableFillup(fillup);
    const receipt = await deleteSubmittedFillup(snapshot, vehicleId, stillCurrent);
    options.onSubmitted?.({ written: snapshot, receipt, isCurrent: stillCurrent,
      restoreDeleted: () => restoreSubmittedFillup(snapshot, vehicleId, stillCurrent) });
  }, [uid, activeVehicle, captureMutationScope, deleteSubmittedFillup, restoreSubmittedFillup]);

  const restoreFillup = useCallback(async (fillup: Fillup, options: { vehicleId?: string } = {}) => {
    const vehicleId = options.vehicleId ?? activeVehicle?.id;
    if (!uid || !vehicleId) return;
    await restoreSubmittedFillup(immutableFillup(fillup), vehicleId, captureMutationScope());
  }, [uid, activeVehicle, captureMutationScope, restoreSubmittedFillup]);

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
   * written. Fill-up mutations compare the base inside a transaction whose
   * read-version precondition the server checks atomically, including legacy edits.
   *
   * A pending entry cannot be retried: the SDK already owns that write, and a
   * second competing write for the same input is exactly what this avoids.
   */
  const retryOperation = useCallback(
    async (opId: string, expected?: OutboxOperation) => {
      if (!uid) return;
      const generation = generationRef.current;
      const accountCurrent = captureAccountScope();
      const attemptTracker = trackerRef.current;
      const trackAttempt = (kind: MutationKind, promise: Promise<unknown>): MutationReceipt =>
        attemptTracker ? attemptTracker.track(kind, promise) : { id: '', settled: Promise.resolve(false) };
      const outbox = await requireOutbox();
      const stillCurrent = () => accountCurrent() && generation === generationRef.current;
      assertMutationScope(stillCurrent);
      const original = await outbox.get(opId);
      if (expected && (!original || !sameVehicleAttempt(original, expected) || original.status !== expected.status)) {
        throw vehicleWriteError('vehicle-conflict-changed', 'ההתנגשות השתנתה — יש לפתוח מחדש את הפרטים לפני שליחה');
      }
      if (!original) return;
      if (retainedCreationUndo(await outbox.list(), original)) {
        throw new Error('לתדלוק הזה ממתינה פעולת ביטול — יש לפתור אותה לפני ניסיון חוזר');
      }
      assertMutationScope(stillCurrent);
      const claimed = await outbox.claimRetry(opId);
      if (!claimed) return;
      ownWrites(outbox, [claimed]);
      const { version } = claimed;
      if (!stillCurrent() || version !== original.version + 1 || expected && !sameVehicleAttempt(claimed, { ...expected, version }) || retainedCreationUndo(await outbox.list(), original) ||
          retainedCreationUndo(await outbox.list(), claimed)) {
        await outbox.fail(opId, version, { code: 'operation-changed', message: 'הפעולה השתנתה או ממתינה לביטול — לא נשלח ניסיון נוסף', at: Date.now() });
        return;
      }
      const settle = (promise: Promise<unknown>) => {
        trackAttempt(claimed.kind, promise);
        return promise.then(
          () => outbox.acknowledge(opId, version),
          (error: unknown) => error instanceof FillupConflictError
            ? outbox.markConflict(opId, version, error.serverImage)
            : outbox.fail(opId, version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
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

      if (isVehicleSelectionOperation(claimed)) {
        await settle(writeVehicleSelectionOperation(db, outbox, claimed, stillCurrent));
        return;
      }

      if (isVehicleDocumentOperation(claimed)) {
        await settle(writeVehicleDocumentOperation(db, outbox, claimed, stillCurrent));
        return;
      }

      if (isVehicleEnrichmentOperation(claimed)) {
        await settle(writeVehicleEnrichment(claimed.path, claimed.payload, claimed.beforeImage,
          () => generation === generationRef.current));
        return;
      }

      if (claimed.kind.startsWith('priceRule.')) {
        await settle(conditionalRawWrite(db, refFor(claimed.path), claimed.opType,
          claimed.payload, claimed.beforeImage, stillCurrent));
        return;
      }

      if (claimed.kind === "backup.import") {
        const mutation = runTransaction(db, async transaction=>{const ref=refFor(claimed.path),snap=await transaction.get(ref);if(snap.exists()){if(!genericPayloadMatches(claimed.payload??{},snap.data()))throw new FillupConflictError(snap.data());return;}transaction.set(ref,toFirestoreData(claimed.payload??{}));});
        trackAttempt(claimed.kind,mutation);await mutation.then(()=>outbox.acknowledge(opId,version),error=>error instanceof FillupConflictError?outbox.markConflict(opId,version,error.serverImage):outbox.fail(opId,version,{code:errorCode(error),message:errorMessage(error),at:Date.now()}));return;
      }

      if (isRecordUndoOperation(claimed)) {
        await settle(writeRecordOperation(db, outbox, claimed, stillCurrent));
        return;
      }

      if (claimed.kind.startsWith("maintenance.")) {
        const mutation = conditionalCareWrite(db, refFor(claimed.path), claimed.opType, claimed.payload, claimed.beforeImage);
        trackAttempt(claimed.kind, mutation);
        await mutation.then(() => outbox.acknowledge(opId, version), error => error instanceof FillupConflictError
          ? outbox.markConflict(opId, version, error.serverImage)
          : outbox.fail(opId, version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }));
        return;
      }

      if (collectionOf(claimed.path).endsWith("/fillups")) {
        if (claimed.opType === 'delete') {
          await settle(writeFillupDeletion(db, outbox, claimed, stillCurrent));
          return;
        }
        const payload = claimed.payload;
        const current = await getDocFromServer(refFor(claimed.path)).catch(() => null);
        if (!current) {
          await outbox.fail(opId, version, unverified());
          return;
        }
        if (!stillCurrent() || retainedCreationUndo(await outbox.list(), original) || retainedCreationUndo(await outbox.list(), claimed)) {
          await outbox.fail(opId, version, { code: 'operation-changed', message: 'הפעולה השתנתה או ממתינה לביטול — לא נשלח ניסיון נוסף', at: Date.now() });
          return;
        }
        // Replays already acknowledged before a crash are idempotent. This
        // read only settles equal content; all mutations use a transaction.
        if (payload && current.exists() && fillupPayloadMatches(payload, current.data())) {
          await outbox.acknowledge(opId, version);
          return;
        }
        const mutation = conditionalFillupWrite(db, refFor(claimed.path), claimed.opType,
          payload ? toFirestoreData(stamped(payload, claimed)) : null,
          claimed.beforeImage, claimed.kind === "fillup.restore", stillCurrent);
        trackAttempt(claimed.kind, mutation);
        await mutation.then(
          () => outbox.acknowledge(opId, version),
          error => error instanceof FillupConflictError
            ? outbox.markConflict(opId, version, error.serverImage)
            : outbox.fail(opId, version, { code: errorCode(error), message: errorMessage(error), at: Date.now() }),
        );
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
      // Only fill-up DOCUMENTS carry the concurrency stamp. An import's batch
      // record shares the "import.batch" kind but lives in importBatches,
      // whose whitelist has no writeId — stamping it makes its retry fail.
      const stampable = collectionOf(claimed.path).endsWith("/fillups");
      const outgoing = (body: OutboxPayload) => toFirestoreData(stampable ? stamped(body, claimed) : body);

      if (claimed.kind === "adminPrice.update") {
        const payload = claimed.payload ?? {};
        if (server && same(payload, server)) await outbox.acknowledge(opId, version);
        else await settle(updateDoc(refFor(claimed.path), outgoing(payload)));
        return;
      }

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
            ? fillupBaseMatches(base, server)
            : genericPayloadMatches(base, server)
          : false;
        if (!baseMatches) {
          await outbox.markConflict(opId, version, server);
          return;
        }
        await settle(updateDoc(refFor(claimed.path), outgoing(payload)));
        return;
      }

      // set (create / restore / import row)
      if (server) {
        // A newer, different document exists where this create wanted to go.
        await outbox.markConflict(opId, version, server);
        return;
      }
      await settle(setDoc(refFor(claimed.path), outgoing(payload)));
    },
    [uid, requireOutbox, captureAccountScope, refFor, deleteVehicleTree],
  );

  const resolveConflict = useCallback(
    async (opId: string, choice: "keep-server" | "overwrite", reviewed?: OutboxOperation) => {
      const accountCurrent = captureAccountScope();
      const capturedReview = reviewed ? structuredClone(reviewed) : null;
      assertMutationScope(accountCurrent);
      const outbox = await requireOutbox();
      assertMutationScope(accountCurrent);
      if (choice === "keep-server") {
        await outbox.discard(opId);
        return;
      }
      const op = await outbox.get(opId);
      if (!op) return;
      if (retainedCreationUndo(await outbox.list(), op)) {
        throw new Error('לתדלוק הזה ממתינה פעולת ביטול — יש לפתור אותה לפני החלפת הגרסה');
      }
      if (isVehicleSelectionOperation(op)) {
        throw new Error('בחירת הרכב השתנתה — יש להשאיר את הבחירה המעודכנת ולבחור שוב מתוך רשימת הרכבים');
      }
      if (isVehicleDocumentOperation(op)) {
        if (!capturedReview || capturedReview.opId !== opId) throw new Error('יש לפתוח את פרטי ההתנגשות לפני החלפת מסמך הרכב');
        const rebased = await rebaseVehicleDocumentOperation(outbox, capturedReview, accountCurrent);
        await retryOperation(opId, rebased);
        return;
      }
      // Rebinding an old automatic lookup to a new car identity would make
      // stale specifications appear current. Recheck its original guard.
      if (isVehicleEnrichmentOperation(op)) {
        await retryOperation(opId);
        return;
      }
      if (!op.serverImage) return;
      // Overwrite deliberately: re-base on what the server holds now. For a
      // fill-up the payload's version becomes the server's plus one, so the
      // rules accept exactly this write and refuse any other stale one.
      const isFillup = op.kind.startsWith("fillup.") || op.kind === "import.batch";
      const patch: OutboxPayload = isRecordUndoOperation(op) ? recordConflictPayloadPatch(op) : isFillup || op.kind.startsWith("maintenance.")
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
    [requireOutbox, retryOperation, captureAccountScope],
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
      const stillCurrent = captureAccountScope(), attemptTracker = trackerRef.current;
      assertMutationScope(stillCurrent);
      const batchId = list[0]?.importBatchId;
      if (!batchId) throw new Error("import records must carry a batch id");
      const outbox = await requireOutbox();
      assertMutationScope(stillCurrent);

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
      try { assertMutationScope(stillCurrent); }
      catch (error) {
        await Promise.all(journaled.map(op => outbox.fail(op.opId, op.version,
          { code: errorCode(error), message: errorMessage(error), at: Date.now() }))).catch(() => undefined);
        throw error;
      }
      const rowOps = journaled.slice(0, rows.length);
      ownWrites(outbox, journaled);
      const batchOp = journaled[rows.length];

      const commits: Promise<unknown>[] = [];
      for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        const chunkOps = rowOps.slice(i, i + 400);
        rows.slice(i, i + 400).forEach((row, index) =>
          batch.set(refFor(row.path), toFirestoreData(stamped(row.payload, chunkOps[index]))),
        );
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
      const committed = allCommits(commits);
      const receipt = attemptTracker ? attemptTracker.track("import.batch", committed)
        : { id: "", settled: committed.then(() => true, () => false) };
      return { written: list.length, receipt };
    },
    [uid, captureAccountScope, requireOutbox, fillupPath, userPath, refFor],
  );

  const loadVehicleCatalog = useCallback(async (): Promise<Vehicle[]> => {
    if (!uid) throw new Error("not signed in");
    const stillCurrent = captureAccountScope();
    assertMutationScope(stillCurrent);
    const snapshot = await getDocsFromServer(collection(db, "users", uid, "vehicles"));
    assertMutationScope(stillCurrent);
    return snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id, createdAt: toMillis(entry.data().createdAt) } as Vehicle));
  }, [uid, captureAccountScope]);

  const loadVehicleFillups = useCallback(async (vehicleId: string): Promise<Fillup[]> => {
    if (!uid || !vehicleId || vehicleId.includes("/")) throw new Error("unknown vehicle");
    const stillCurrent = captureAccountScope();
    assertMutationScope(stillCurrent);
    if (!(await getDocFromServer(doc(db, "users", uid, "vehicles", vehicleId))).exists()) throw new Error("unknown vehicle");
    assertMutationScope(stillCurrent);
    const snapshot = await getDocsFromServer(collection(db, "users", uid, "vehicles", vehicleId, "fillups"));
    assertMutationScope(stillCurrent);
    return snapshot.docs.map((entry) => {
      const parsed = parseFillupDocument(entry.id, entry.data());
      if (!parsed.ok) throw new Error("unreadable existing record");
      return parsed.fillup;
    });
  }, [uid, captureAccountScope]);

  const importTankUpdates = useCallback(async (vehicleId: string, records: TankImportRecord[]) => {
    if (!uid || !vehicleId || vehicleId.includes("/")) throw new Error("unknown vehicle");
    const stillCurrent = captureAccountScope(), attemptTracker = trackerRef.current;
    assertMutationScope(stillCurrent);
    const outbox = await requireOutbox();
    assertMutationScope(stillCurrent);
    if (!(await getDocFromServer(doc(db, "users", uid, "vehicles", vehicleId))).exists()) throw new Error("unknown vehicle");
    assertMutationScope(stillCurrent);
    const existing = new Set<string>();
    for (const name of ["observations", "tankPlans"]) {
      const snapshot = await getDocsFromServer(collection(db, "users", uid, "vehicles", vehicleId, name));
      assertMutationScope(stillCurrent);
      snapshot.docs.forEach((entry) => existing.add(`${name}/${entry.id}`));
    }
    const inputs: EnqueueInput[] = [];
    let duplicates = 0;
    for (const record of records) {
      const name = record.type === "observation" ? "observations" : "tankPlans";
      const { id, vehicleId: _sourceVehicle, ...data } = record.value;
      if (existing.has(`${name}/${id}`)) { duplicates++; continue; }
      existing.add(`${name}/${id}`);
      inputs.push({ kind: record.type === "observation" ? "tank.observation" : "tank.plan",
        path: userPath("vehicles", vehicleId, name, id), vehicleId, payload: data as unknown as OutboxPayload });
    }
    if (!inputs.length) return { written: 0, duplicates, receipt: { id: "empty", settled: Promise.resolve(true) } };
    const receipts = await submitMany(outbox, inputs, async (ops) => {
      assertMutationScope(stillCurrent);
      // Transactions make a repeated/concurrent import incapable of replacing
      // a reading that was edited after the export.
      for (const op of ops) await runTransaction(db, async (transaction) => {
        assertMutationScope(stillCurrent);
        const ref = doc(db, op.path);
        const current = await transaction.get(ref);
        assertMutationScope(stillCurrent);
        if (current.exists()) throw new Error("הרשומה כבר קיימת. יש לרענן את הייבוא");
        transaction.set(ref, toFirestoreData(op.payload!));
      });
    }, (kind, promise) => attemptTracker ? attemptTracker.track(kind, promise)
      : { id: "", settled: promise.then(() => true, () => false) });
    return { written: inputs.length, duplicates, receipt: receipts[0] };
  }, [uid, captureAccountScope, requireOutbox, userPath]);

  const importBackupEntries = useCallback(async (entries: BackupEntry[]) => {
    if(!uid || entries.length>5000 || entries.some(e=>!backupPath(e.path)))throw new Error("גיבוי לא תקין");
    const stillCurrent=captureAccountScope();assertMutationScope(stillCurrent);
    const receipts:MutationReceipt[]=[];let written=0;
    // Parents precede children. Each create rechecks server identity in its transaction;
    // a retry can acknowledge identical content but never overwrite a different record.
    for(const entry of [...entries].sort((a,b)=>a.path.split('/').length-b.path.split('/').length)) {
      assertMutationScope(stillCurrent);
      const parts=entry.path.split('/');const payload={...entry.data};
      if(parts.length===4&&(CARE_COLLECTIONS as readonly string[]).includes(parts[2]))payload.version=1;
      const path=userPath(...parts);
      const receipt=await submit({kind:"backup.import",path,vehicleId:parts[0]==="vehicles"?parts[1]:null,payload,opType:"set"},()=>runTransaction(db,async transaction=>{
        assertMutationScope(stillCurrent);
        const ref=refFor(path),snap=await transaction.get(ref);assertMutationScope(stillCurrent);
        if(snap.exists()){if(!genericPayloadMatches(payload,snap.data()))throw new FillupConflictError(snap.data());return;}transaction.set(ref,toFirestoreData(payload));
      }),undefined,stillCurrent);receipts.push(receipt);if(!(await receipt.settled))throw new Error("השחזור נעצר. הפעולה נשמרה בתור הפעולות; לא הוחלפו רשומות קיימות.");written++;
    }
    return {written,receipts};
  },[uid,captureAccountScope,submit,userPath,refFor]);

  const saveCareRecord = useCallback(async (vehicleId: string, name: CareCollection, record: CareRecord, previous?: CareRecord) => {
    if (!uid || activeVehicle?.id !== vehicleId || !CARE_COLLECTIONS.includes(name)) throw new Error("הרכב או החשבון התחלפו");
    const stillCurrent = captureMutationScope();
    assertMutationScope(stillCurrent);
    const payload = carePayload(name, record);
    const path = userPath("vehicles", vehicleId, name, record.id);
    return submit({ kind: "maintenance.save", path, vehicleId, payload, opType: previous ? "update" : "set",
      beforeImage: previous ? carePayload(name, previous) : null }, () => {
      assertMutationScope(stillCurrent);
      return previous ? updateDoc(refFor(path), payload) : setDoc(refFor(path), payload);
    }, (_op, data) => carePayloadMatches(payload, data), stillCurrent);
  }, [uid, activeVehicle?.id, captureMutationScope, submit, userPath, refFor]);

  const submitRecordDeletion = useCallback(async (
    path: string, vehicleId: string, name: RecordCollection, beforeImage: OutboxPayload,
    stillCurrent: () => boolean, options: RecordDeletionOptions,
  ): Promise<MutationReceipt> => {
    assertMutationScope(stillCurrent);
    const outbox = await requireOutbox();
    assertMutationScope(stillCurrent);
    await assertRecordUncontended(outbox, path);
    assertMutationScope(stillCurrent);
    const payload = recordRestoreImage(beforeImage, name);
    const undo = createRecordUndo(stillCurrent, async () => {
      assertMutationScope(stillCurrent);
      await assertRecordUncontended(outbox, path);
      assertMutationScope(stillCurrent);
      return submit({ kind: name === 'observations' ? 'tank.observation' : 'maintenance.save',
        path, vehicleId, payload, beforeImage: null, opType: 'set' },
      operation => writeRecordOperation(db, outbox, operation, stillCurrent), undefined, stillCurrent);
    });
    const receipt = await submit({ kind: name === 'observations' ? 'tank.observation.delete' : 'maintenance.delete',
      path, vehicleId, payload: null, beforeImage, opType: 'delete' }, async operation => {
      const result = await writeRecordOperation(db, outbox, operation, stillCurrent);
      if (result === 'deleted') undo.deleted();
    }, undefined, stillCurrent);
    options.onSubmitted?.(undo.submission(receipt));
    return receipt;
  }, [requireOutbox, submit]);

  const deleteCareRecord = useCallback(async (
    vehicleId: string, name: CareCollection, record: CareRecord, options: RecordDeletionOptions = {},
  ) => {
    if (!uid || activeVehicle?.id !== vehicleId || !CARE_COLLECTIONS.includes(name)) throw new Error("הרכב או החשבון התחלפו");
    const stillCurrent = captureMutationScope();
    const path = userPath("vehicles", vehicleId, name, record.id);
    const beforeImage = await captureCareImage(refFor(path), name, record, stillCurrent);
    return submitRecordDeletion(path, vehicleId, name, beforeImage, stillCurrent, options);
  }, [uid, activeVehicle?.id, captureMutationScope, submitRecordDeletion, userPath, refFor]);

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
    async (observationId: string, options: RecordDeletionOptions & { snapshot?: ObservationDeletionSnapshot } = {}) => {
      if (!uid || !activeVehicle) return;
      const record = observations.find(row => row.id === observationId);
      const token = options.snapshot ?? (record ? captureObservation(record) : null);
      if (!token) throw new Error('יש לפתוח מחדש את הרשומה לפני המחיקה');
      const captured = readObservationCapture(token, observationId, activeVehicle.id);
      const current = captureMutationScope();
      const stillCurrent = () => current() && captured.isCurrent();
      const path = userPath('vehicles', activeVehicle.id, 'observations', observationId);
      await submitRecordDeletion(path, activeVehicle.id, 'observations', captured.beforeImage, stillCurrent, options);
    },
    [uid, activeVehicle, observations, captureObservation, captureMutationScope, submitRecordDeletion, userPath],
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

  const savePriceRule = useCallback(async (rule: StoredPriceRule, options: { expected?: OutboxPayload | null } = {}) => {
    if (!uid) throw new Error('no account');
    const stillCurrent = captureMutationScope();
    assertMutationScope(stillCurrent);
    if (!rule.id || rule.id.length > 128 || rule.id.includes('/')) throw new Error('מזהה כלל המחיר אינו תקין');
    if (priceRulesStatus !== 'ready') throw new Error('כללי המחיר עדיין נטענים — נסו שוב לאחר החיבור');
    const before = options.expected === undefined ? rawPriceRules.get(rule.id) ?? null : options.expected;
    const payload: OutboxPayload = {
      vehicleId: rule.vehicleId, stationId: rule.stationId, stationName: rule.stationName, fuelType: rule.fuelType,
      discountPerLiter: rule.discountPerLiter, fixedPricePerLiter: rule.fixedPricePerLiter, label: rule.label,
      expiresAt: rule.expiresAt, legacy: rule.legacy, reviewed: rule.reviewed,
      ...(before && Object.hasOwn(before, 'migratedAt') ? { migratedAt: before.migratedAt } : {}),
    };
    if (before && Object.keys(before).some(key => !Object.hasOwn(payload, key))) {
      throw new Error('לכלל המחיר יש נתונים שלא ניתן לערוך כאן — הם נשמרו ללא שינוי');
    }
    const path = userPath('personalPriceRules', rule.id);
    return submit({ kind: 'priceRule.save', path, vehicleId: rule.vehicleId, payload: encodeRawDocument(payload),
      opType: before ? 'update' : 'set', beforeImage: before ? encodeRawDocument(before) : null },
    op => conditionalRawWrite(db, refFor(path), op.opType, op.payload, op.beforeImage, stillCurrent),
    undefined, stillCurrent);
  }, [uid, captureMutationScope, priceRulesStatus, rawPriceRules, submit, userPath, refFor]);

  const deletePriceRule = useCallback(async (ruleId: string, options: { expected?: OutboxPayload | null } = {}) => {
    if (!uid) throw new Error('no account');
    const stillCurrent = captureMutationScope();
    assertMutationScope(stillCurrent);
    if (!ruleId || ruleId.length > 128 || ruleId.includes('/')) throw new Error('מזהה כלל המחיר אינו תקין');
    if (priceRulesStatus !== 'ready') throw new Error('כללי המחיר עדיין נטענים — נסו שוב לאחר החיבור');
    const before = options.expected === undefined ? rawPriceRules.get(ruleId) ?? null : options.expected;
    const path = userPath('personalPriceRules', ruleId);
    return submit({ kind: 'priceRule.delete', path, vehicleId: typeof before?.vehicleId === 'string' ? before.vehicleId : null,
      payload: null, beforeImage: before ? encodeRawDocument(before) : null },
    op => conditionalRawWrite(db, refFor(path), 'delete', null, op.beforeImage, stillCurrent), undefined, stillCurrent);
  }, [uid, captureMutationScope, priceRulesStatus, rawPriceRules, submit, userPath, refFor]);

  const listImportBatches = useCallback(async (): Promise<ImportBatch[]> => {
    if (!uid) return [];
    const stillCurrent = captureAccountScope();
    assertMutationScope(stillCurrent);
    const snapshot = await getDocs(
      query(collection(db, "users", uid, "importBatches"), limit(50)),
    );
    assertMutationScope(stillCurrent);
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
  }, [uid, captureAccountScope]);

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
    async (batch: Pick<ImportBatch, "id" | "vehicleId">): Promise<ImportRollbackResult> => {
      if (!uid) return { deleted: 0, ok: false, reason: "not signed in" };
      const stillCurrent = captureAccountScope(), attemptTracker = trackerRef.current;

      try {
        assertMutationScope(stillCurrent);
        const outbox = await requireOutbox();
        assertMutationScope(stillCurrent);
        const fillupsRef = collection(db, "users", uid, "vehicles", batch.vehicleId, "fillups");
        const snapshot = await getDocs(query(fillupsRef, where("importBatchId", "==", batch.id)));
        assertMutationScope(stillCurrent);

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
        try { assertMutationScope(stillCurrent); }
        catch (error) {
          await Promise.all(journaled.map(op => outbox.fail(op.opId, op.version,
            { code: errorCode(error), message: errorMessage(error), at: Date.now() }))).catch(() => undefined);
          throw error;
        }
        const rowOps = journaled.slice(0, snapshot.docs.length);
        ownWrites(outbox, journaled);
        const batchOp = journaled[snapshot.docs.length];

        const commits: Promise<unknown>[] = [];
        for (let i = 0; i < snapshot.docs.length; i += 400) {
          const chunkOps = rowOps.slice(i, i + 400);
          const entries = snapshot.docs.slice(i, i + 400);
          const commit = runTransaction(db, async transaction => {
            assertMutationScope(stillCurrent);
            const current = await Promise.all(entries.map(entry => transaction.get(entry.ref)));
            assertMutationScope(stillCurrent);
            current.forEach((entry, index) => {
              if (!entry.exists()) return;
              const before = chunkOps[index].beforeImage;
              if (!before || !fillupBaseMatches(before, entry.data())) throw new FillupConflictError(entry.data());
            });
            current.forEach(entry => { if (entry.exists()) transaction.delete(entry.ref); });
          });
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

        const committed = allCommits(commits);
        const receipt = attemptTracker ? attemptTracker.track("import.rollback", committed)
          : { id: "", settled: committed.then(() => true, () => false) };

        // Transactions delete only after server confirmation; pending means
        // the conditional check or commit has not answered yet.
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
    [uid, captureAccountScope, requireOutbox, userPath, refFor],
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
    const result = await runAccountDeletion({
      reauthenticate: async () => { await reauthenticateWithPopup(user, googleProvider); return true; },
      preflight: async () => {
        if (await unacknowledgedState() !== "none" || writes.pending.length > 0) throw new Error("pending-writes");
        markAccountDeleting(uid);
        deletingRef.current = true;
        setAccountDeletionPending(true);
      },
      data: accountDataDeletionSteps(db, uid),
      profile: async () => {
        const ref = doc(db, "users", uid);
        await deleteDoc(ref);
        if ((await getDocFromServer(ref)).exists()) throw new Error("profile-remains");
      },
      local: async () => {
        // Recheck immediately before clearing the device's shared SDK cache.
        if (await unacknowledgedState() !== "none") throw new Error("pending-writes");
        generationRef.current += 1;
        outboxRef.current?.close();
        await terminate(db);
        await clearIndexedDbPersistence(db);
        clearAccountLocalStorage(uid);
      },
      identity: () => user.delete(),
    });
    if (result.ok) {
      finishAccountDeletion(uid);
      // The shared SDK was terminated for verified erasure. Start a fresh
      // instance before the next person tries to sign in on this device.
      setTimeout(() => window.location.replace("/"), 0);
    }
    return result;
  }, [user, uid, writes.pending.length]);

  // Privacy withdrawal must run even when Statistics has never been opened.
  useEffect(() => {
    if (!uid || !ready || accountDeletionPending || settings.shareBenchmarks !== false) {
      setBenchmarkWithdrawal("idle");
      return;
    }
    let cancelled = false;
    setBenchmarkWithdrawal("pending");
    void (async () => {
      // The opt-out must reach the server before deleting: rules then prevent
      // an older tab or in-flight publisher from recreating a contribution.
      const profile = await getDocFromServer(doc(db, "users", uid));
      if (profile.data()?.settings?.shareBenchmarks !== false) throw new Error("opt-out-pending");
      await withdrawBenchmark(uid);
    })().then(() => { if (!cancelled) setBenchmarkWithdrawal("done"); },
      () => { if (!cancelled) setBenchmarkWithdrawal("error"); });
    const online = () => setWithdrawalAttempt((n) => n + 1);
    window.addEventListener("online", online);
    return () => { cancelled = true; window.removeEventListener("online", online); };
  }, [uid, ready, settings.shareBenchmarks, accountDeletionPending, withdrawalAttempt, writes.pending.length]);

  const value = useMemo<DataContextValue>(
    () => ({
      captureAccountAction: captureAccountScope,
      captureVehicleAction: captureMutationScope,
      importBackupEntries,
      saveCareRecord,
      deleteCareRecord,
      ready,
      accountDeletionPending,
      benchmarkWithdrawal,
      retryBenchmarkWithdrawal,
      settings,
      vehicles,
      activeVehicles,
      activeVehicle,
      fillups: scopedFillups,
      prices,
      updateAdminPrices,
      loadingFillups: scopedLoadingFillups,
      fillupsFromCache,
      loadVehicleFillups,
      loadVehicleCatalog,
      importTankUpdates,
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
      fillupPriceKnown,
      retryOperation,
      resolveConflict,
      discardOperation,
      updateSettings,
      setActiveVehicle,
      addVehicle,
      updateVehicle,
      captureVehicleDocument,
      updateVehicleDocument,
      enrichVehicleSpecs,
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
      rawPriceRules,
      eligiblePriceRules,
      priceRulesStatus,
      savePriceRule,
      deletePriceRule,
      tankInputScope,
      observationsStatus,
      plansStatus,
      observations,
      addObservation,
      captureObservation,
      deleteObservation,
      plans,
      addPlan,
      deletePlan,
      tankPreferences,
      updateTankPreferences,
      deleteAccount,
    }),
    [
      captureAccountScope,
      captureMutationScope,
      importBackupEntries,
      saveCareRecord,
      deleteCareRecord,
      ready,
      accountDeletionPending,
      benchmarkWithdrawal,
      retryBenchmarkWithdrawal,
      settings,
      vehicles,
      activeVehicles,
      activeVehicle,
      scopedFillups,
      prices,
      updateAdminPrices,
      scopedLoadingFillups,
      fillupsFromCache,
      loadVehicleFillups,
      loadVehicleCatalog,
      importTankUpdates,
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
      fillupPriceKnown,
      retryOperation,
      resolveConflict,
      discardOperation,
      updateSettings,
      setActiveVehicle,
      addVehicle,
      updateVehicle,
      captureVehicleDocument,
      updateVehicleDocument,
      enrichVehicleSpecs,
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
      rawPriceRules,
      eligiblePriceRules,
      priceRulesStatus,
      savePriceRule,
      deletePriceRule,
      tankInputScope,
      observationsStatus,
      plansStatus,
      observations,
      addObservation,
      captureObservation,
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
