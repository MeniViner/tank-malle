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
  type MutationKind,
  type MutationReceipt,
  type WriteStatus,
} from "../lib/writes";
import { useAuth } from "./AuthContext";
import { useTheme } from "./ThemeContext";
import {
  DEFAULT_SETTINGS,
  type Fillup,
  type FuelPrices,
  type UserSettings,
  type Vehicle,
} from "../lib/types";

interface DataContextValue {
  ready: boolean;
  settings: UserSettings;
  vehicles: Vehicle[];
  activeVehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  fillups: Fillup[];
  prices: FuelPrices | null;
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
  /** Sign out, discarding every trace of the current account from memory. */
  switchAccount: () => Promise<void>;

  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setActiveVehicle: (vehicleId: string) => Promise<void>;

  addVehicle: (vehicle: Omit<Vehicle, "id" | "createdAt">) => Promise<string>;
  updateVehicle: (vehicleId: string, patch: Partial<Vehicle>) => Promise<void>;
  setVehicleArchived: (vehicleId: string, archived: boolean) => Promise<void>;
  deleteVehicle: (vehicleId: string) => Promise<void>;

  addFillup: (fillup: Omit<Fillup, "id" | "createdAt">) => Promise<string>;
  updateFillup: (fillupId: string, patch: Partial<Omit<Fillup, "id">>) => Promise<void>;
  deleteFillup: (fillupId: string) => Promise<void>;
  /** Re-create a deleted record with its original id, for Undo. */
  restoreFillup: (fillup: Fillup) => Promise<void>;
  /** Write many fill-ups at once, for an import batch. */
  addFillupBatch: (
    vehicleId: string,
    fillups: Omit<Fillup, "id" | "createdAt">[],
    meta: ImportBatchMeta,
  ) => Promise<{ written: number; receipt: MutationReceipt }>;
  /** Completed imports, newest first. Read on demand, not kept in a listener. */
  listImportBatches: () => Promise<ImportBatch[]>;
  /**
   * Undo one import. Deletes ONLY the records carrying that batch id, and then
   * the batch record itself.
   */
  deleteImportBatch: (batch: ImportBatch) => Promise<ImportRollbackResult>;

  /** Reports exactly what was and was not deleted. Never claims a clean sweep. */
  deleteAccount: () => Promise<DeletionResult>;
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

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "seconds" in value) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return Date.now();
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
  const { user, signOutUser } = useAuth();
  const { setTheme, setAccent } = useTheme();

  // The uid, not the User object: a token refresh produces a NEW User instance
  // for the SAME person, and keying effects on the object tears down and
  // rebuilds every listener for no reason.
  const uid = user?.uid ?? null;

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [prices, setPrices] = useState<FuelPrices | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingFillups, setLoadingFillups] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [fromCache, setFromCache] = useState(false);
  const [writes, setWrites] = useState<WriteStatus>(EMPTY_WRITE_STATUS);

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

    // Reset everything user-scoped, synchronously.
    setSettings(DEFAULT_SETTINGS);
    setVehicles([]);
    setFillups([]);
    setPrices(null);
    setReady(false);
    setLoadingFillups(Boolean(uid));
    setFromCache(false);
    setWrites(EMPTY_WRITE_STATUS);

    const unsubscribe = tracker.subscribe(setWrites);

    return () => {
      unsubscribe();
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
    const cachedPrices = readCache<FuelPrices>(uid, "prices");
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
            declaredKmPerLiter: toNumberOrNull(data.declaredKmPerLiter),
            priceAdjustment: typeof data.priceAdjustment === "number" ? data.priceAdjustment : 0,
            manualPricePerLiter: toNumberOrNull(data.manualPricePerLiter),
            nickname: data.nickname ?? null,
            archived: Boolean(data.archived),
            createdAt: toMillis(data.createdAt),
            tozeretCd: toNumberOrNull(data.tozeretCd),
            degemCd: toNumberOrNull(data.degemCd),
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

  useEffect(() => {
    if (!uid || !activeVehicle) {
      setFillups([]);
      setLoadingFillups(false);
      return;
    }
    const generation = generationRef.current;

    // Hydrate from cache first so the dashboard has numbers on it instantly.
    const cached = readCache<Fillup[]>(uid, `fillups.${activeVehicle.id}`);
    if (cached) {
      setFillups(cached);
      setLoadingFillups(false);
    } else {
      setLoadingFillups(true);
    }

    const path = collection(db, "users", uid, "vehicles", activeVehicle.id, "fillups");

    return subscribeResilient<QuerySnapshot<DocumentData>>(
      (onNext, onError) => onSnapshot(path, onNext, onError),
      (snapshot) => {
        const list =
          snapshot.docs.map((entry) => {
            const data = entry.data();
            return {
              id: entry.id,
              date: toMillis(data.date),
              odometer: Number(data.odometer ?? 0),
              liters: Number(data.liters ?? 0),
              pricePerLiter: Number(data.pricePerLiter ?? 0),
              totalCost: Number(data.totalCost ?? 0),
              isFullTank: data.isFullTank !== false,
              station: data.station ?? null,
              notes: data.notes ?? null,
              createdAt: toMillis(data.createdAt),
              // Added by the upgrade. Absent on every pre-existing document,
              // and absence must read as "no break", so the default is false.
              continuityBreakBefore: data.continuityBreakBefore === true,
              fullTankSource:
                data.fullTankSource === "legacy-assumption" ? "legacy-assumption" : "user",
              postedPricePerLiter: toNumberOrNull(data.postedPricePerLiter),
              fuelType: (data.fuelType ?? null) as Fillup["fuelType"],
              importSource: data.importSource ?? null,
              importBatchId: data.importBatchId ?? null,
              importRowHash: data.importRowHash ?? null,
              schemaVersion:
                typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
            } satisfies Fillup;
          });

        setFillups(list);
        writeCache(uid, `fillups.${activeVehicle.id}`, list);
        setLoadingFillups(false);
      },
      {
        isCurrent: isCurrent(generation),
        label: "fill-ups",
        onError: () => setLoadingFillups(false),
      },
    );
  }, [uid, activeVehicle, isCurrent]);

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
        const data = snapshot.data();
        const next: FuelPrices = {
          current: data.current
            ? {
                pricePerLiter: Number(data.current.pricePerLiter),
                effectiveFrom: data.current.effectiveFrom
                  ? toMillis(data.current.effectiveFrom)
                  : undefined,
                updatedAt: data.current.updatedAt ? toMillis(data.current.updatedAt) : undefined,
              }
            : null,
          history: (data.history ?? {}) as Record<string, number>,
        };
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

  const deleteVehicle = useCallback(
    async (vehicleId: string) => {
      if (!uid) return;
      // Subcollections are not removed with their parent, so clear fill-ups
      // in batches first.
      const fillupsRef = collection(db, "users", uid, "vehicles", vehicleId, "fillups");
      const snapshot = await getDocs(fillupsRef);
      for (let i = 0; i < snapshot.docs.length; i += 400) {
        const batch = writeBatch(db);
        snapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, "users", uid, "vehicles", vehicleId));

      if (settings.activeVehicleId === vehicleId) {
        const fallback = vehicles.find((v) => v.id !== vehicleId && !v.archived);
        await updateSettings({ activeVehicleId: fallback?.id ?? null });
      }
    },
    [uid, settings.activeVehicleId, vehicles, updateSettings],
  );

  const addFillup = useCallback(
    async (fillup: Omit<Fillup, "id" | "createdAt">) => {
      if (!uid || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(
        collection(db, "users", uid, "vehicles", activeVehicle.id, "fillups"),
      );
      track(
        "fillup.add",
        setDoc(
          ref,
          stripUndefined({
            ...fillup,
            date: Timestamp.fromMillis(fillup.date),
            createdAt: serverTimestamp(),
          }),
        ),
      );
      return ref.id;
    },
    [uid, activeVehicle, track],
  );

  const updateFillup = useCallback(
    async (fillupId: string, patch: Partial<Omit<Fillup, "id">>) => {
      if (!uid || !activeVehicle) return;
      const payload: Record<string, unknown> = { ...patch };
      if (typeof patch.date === "number") payload.date = Timestamp.fromMillis(patch.date);
      track(
        "fillup.update",
        updateDoc(
          doc(db, "users", uid, "vehicles", activeVehicle.id, "fillups", fillupId),
          stripUndefined(payload),
        ),
      );
    },
    [uid, activeVehicle, track],
  );

  const deleteFillup = useCallback(
    async (fillupId: string) => {
      if (!uid || !activeVehicle) return;
      track(
        "fillup.delete",
        deleteDoc(
          doc(db, "users", uid, "vehicles", activeVehicle.id, "fillups", fillupId),
        ),
      );
    },
    [uid, activeVehicle, track],
  );

  const restoreFillup = useCallback(
    async (fillup: Fillup) => {
      if (!uid || !activeVehicle) return;
      const { id, createdAt, ...rest } = fillup;
      track(
        "fillup.restore",
        setDoc(
          doc(db, "users", uid, "vehicles", activeVehicle.id, "fillups", id),
          stripUndefined({
            ...rest,
            date: Timestamp.fromMillis(fillup.date),
            createdAt: createdAt ? Timestamp.fromMillis(createdAt) : serverTimestamp(),
          }),
        ),
      );
    },
    [uid, activeVehicle, track],
  );

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
  const switchAccount = useCallback(async () => {
    const outstanding = trackerRef.current?.unacknowledged() ?? [];
    if (outstanding.length > 0) {
      // Give queued writes a brief chance to land before the session ends.
      await Promise.race([
        Promise.allSettled(outstanding.map(() => Promise.resolve())),
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ]);
    }
    await signOutUser();
  }, [signOutUser]);

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
        const fillupsSnapshot = await getDocs(collection(vehicleDoc.ref, "fillups"));
        for (let i = 0; i < fillupsSnapshot.docs.length; i += 400) {
          const batch = writeBatch(db);
          fillupsSnapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
          await batch.commit();
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
      switchAccount,
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
      switchAccount,
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
