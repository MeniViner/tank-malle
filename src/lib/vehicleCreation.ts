import type { MutationReceipt } from './writes';
import type { OutboxOperation, OutboxPayload } from './outbox';
import { assertMutationScope, rawDocumentMatches } from './rawDocument';
import { rawVehicleIdentity } from './vehicleDocumentPersistence';

export interface VehicleWriteSubmission {
  readonly opId: string;
  readonly version: number;
  readonly receipt: MutationReceipt;
}

export type VehicleSelectionResult =
  | { state: 'not-required'; reason: 'not-first-vehicle' | 'already-selected' | 'newer-choice' | 'source-available' }
  | ({ state: 'submitted' } & VehicleWriteSubmission)
  | { state: 'blocked'; reason: string; message: string; operation?: { opId: string; version: number } };

export interface VehicleCreationSubmission {
  readonly vehicleId: string;
  readonly creation: VehicleWriteSubmission;
  /** Account lifetime; normal first activation and route exit remain current. */
  readonly isCurrent: () => boolean;
  readonly selection: Promise<VehicleSelectionResult>;
  readonly retrySelection: () => Promise<VehicleSelectionResult>;
}

export interface VehicleCreationOptions {
  onSubmitted?: (submission: VehicleCreationSubmission) => void;
}

export interface VehicleSelectionOptions {
  /** Separate from the archive/delete result; the guard also protects later receipt notices. */
  onSelection?: (result: VehicleSelectionResult, isCurrent: () => boolean) => void;
}

export function notifyVehicleSelection(options: VehicleSelectionOptions, result: VehicleSelectionResult, isCurrent: () => boolean): void {
  if (!isCurrent()) return;
  try { options.onSelection?.(result, isCurrent); }
  catch { /* A follow-up notice cannot turn an acknowledged primary action into a failure. */ }
}

/** Generated specs may arrive after creation; they are not a new vehicle identity. */
export function vehicleCreationIdentityMatches(payload: OutboxPayload, server: OutboxPayload): boolean {
  try {
    const expected = rawVehicleIdentity(payload), actual = rawVehicleIdentity(server);
    delete expected.createdAt; delete actual.createdAt;
    return rawDocumentMatches(expected, actual);
  } catch { return false; }
}

export function blockedVehicleSelection(error: unknown, operation?: { opId: string; version: number }): VehicleSelectionResult {
  const value = error as { code?: unknown; message?: unknown } | null;
  return { state: 'blocked', reason: typeof value?.code === 'string' ? value.code : 'selection-unavailable',
    message: typeof value?.message === 'string' ? value.message : 'בחירת הרכב לא הושלמה — הרכב שנוצר נשמר',
    ...(operation ? { operation } : {}) };
}

/** A durable creation has one identity even if SDK setup or first selection fails. */
export async function submitVehicleCreation(options: {
  vehicleId: string;
  isCurrent: () => boolean;
  journal: (settled: Promise<unknown>) => Promise<{ operation: OutboxOperation; receipt: MutationReceipt }>;
  start: () => { accepted: Promise<void>; settled: Promise<unknown> };
  select: (creation: OutboxOperation, attempt: 'initial' | 'retry') => Promise<VehicleSelectionResult>;
  onSubmitted?: VehicleCreationOptions['onSubmitted'];
}): Promise<string> {
  assertMutationScope(options.isCurrent);
  let acceptWrite!: (value: unknown) => void, rejectWrite!: (error: unknown) => void;
  const deferred = new Promise<unknown>((resolve, reject) => { acceptWrite = resolve; rejectWrite = reject; });
  void deferred.catch(() => {});
  const { operation, receipt } = await options.journal(deferred);
  const creation = Object.freeze({ opId: operation.opId, version: operation.version, receipt });
  let ongoing: Promise<VehicleSelectionResult> | null = null;
  const select = (attempt: 'initial' | 'retry'): Promise<VehicleSelectionResult> => {
    if (ongoing) return ongoing;
    const run = async () => {
      try { assertMutationScope(options.isCurrent); return await options.select(operation, attempt); }
      catch (error) { return blockedVehicleSelection(error); }
    };
    ongoing = run().finally(() => { ongoing = null; });
    return ongoing;
  };
  // The server receipt resolves false for rejected writes, including setup
  // errors. It is independent of local acceptance and the first-run mount.
  const selection = receipt.settled.then(acknowledged => acknowledged ? select('initial') :
    blockedVehicleSelection(Object.assign(new Error('יצירת הרכב לא אושרה — יש להשלים את הפעולה השמורה'), { code: 'creation-unconfirmed' }), creation));
  const envelope: VehicleCreationSubmission = Object.freeze({ vehicleId: options.vehicleId, creation,
    isCurrent: options.isCurrent, selection, retrySelection: () => select('retry') });
  try { options.onSubmitted?.(envelope); }
  catch { /* The journal already owns this identity; notification code cannot create a second attempt. */ }
  let write: { accepted: Promise<void>; settled: Promise<unknown> };
  try {
    assertMutationScope(options.isCurrent);
    write = options.start();
  } catch (error) {
    rejectWrite(error);
    throw error;
  }
  void write.settled.then(acceptWrite, rejectWrite);
  // A listener/local-acceptance failure does not cancel a write the SDK
  // already owns. Only its actual server promise settles the durable entry.
  await write.accepted;
  return options.vehicleId;
}
