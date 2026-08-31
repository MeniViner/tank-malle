import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { clearCache, pruneOldCaches, readCache, writeCache } from "../lib/cache";
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

  deleteAccount: () => Promise<void>;
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
  const { user } = useAuth();
  const { setTheme, setAccent } = useTheme();

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fillups, setFillups] = useState<Fillup[]>([]);
  const [prices, setPrices] = useState<FuelPrices | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingFillups, setLoadingFillups] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    pruneOldCaches();
  }, []);

  // Paint the last-known view immediately, before Firestore has connected.
  useEffect(() => {
    if (!user) return;
    const cachedSettings = readCache<UserSettings>(user.uid, "settings");
    const cachedVehicles = readCache<Vehicle[]>(user.uid, "vehicles");
    const cachedPrices = readCache<FuelPrices>(user.uid, "prices");

    if (cachedSettings) setSettings({ ...DEFAULT_SETTINGS, ...cachedSettings });
    if (cachedVehicles?.length) {
      setVehicles(cachedVehicles);
      setFromCache(true);
    }
    if (cachedPrices) setPrices(cachedPrices);
    if (cachedSettings || cachedVehicles?.length) setReady(true);
  }, [user]);

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
    if (!user) {
      setSettings(DEFAULT_SETTINGS);
      setVehicles([]);
      setFillups([]);
      setReady(false);
      return;
    }

    const userRef = doc(db, "users", user.uid);

    return onSnapshot(
      userRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          // First sign-in: create the profile document.
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
          ).catch(() => undefined);
          setSettings(DEFAULT_SETTINGS);
          setReady(true);
          return;
        }

        const data = snapshot.data();
        const next: UserSettings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
        setSettings(next);
        writeCache(user.uid, "settings", next);
        setReady(true);
      },
      () => setReady(true),
    );
  }, [user]);

  // The stored preference is the source of truth once it arrives; before that
  // the app runs on the localStorage value stamped in index.html.
  useEffect(() => {
    if (!ready) return;
    setTheme(settings.theme);
    setAccent(settings.accentColor, settings.customAccent ?? null);
  }, [ready, settings.theme, settings.accentColor, settings.customAccent, setTheme, setAccent]);

  /* ---------- vehicles ---------- */

  useEffect(() => {
    if (!user) return;

    return onSnapshot(collection(db, "users", user.uid, "vehicles"), (snapshot) => {
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
      writeCache(user.uid, "vehicles", list);
      if (!snapshot.metadata.fromCache) setFromCache(false);
    });
  }, [user]);

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.archived), [vehicles]);

  const activeVehicle = useMemo(() => {
    if (activeVehicles.length === 0) return null;
    return (
      activeVehicles.find((v) => v.id === settings.activeVehicleId) ?? activeVehicles[0]
    );
  }, [activeVehicles, settings.activeVehicleId]);

  /* ---------- fill-ups for the active vehicle ---------- */

  useEffect(() => {
    if (!user || !activeVehicle) {
      setFillups([]);
      setLoadingFillups(false);
      return;
    }

    // Hydrate from cache first so the dashboard has numbers on it instantly.
    const cached = readCache<Fillup[]>(user.uid, `fillups.${activeVehicle.id}`);
    if (cached) {
      setFillups(cached);
      setLoadingFillups(false);
    } else {
      setLoadingFillups(true);
    }

    const path = collection(db, "users", user.uid, "vehicles", activeVehicle.id, "fillups");

    return onSnapshot(
      path,
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
            } satisfies Fillup;
          });

        setFillups(list);
        writeCache(user.uid, `fillups.${activeVehicle.id}`, list);
        setLoadingFillups(false);
      },
      () => setLoadingFillups(false),
    );
  }, [user, activeVehicle]);

  /* ---------- global fuel prices ---------- */

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, "appConfig", "fuelPrices"),
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
        writeCache(user.uid, "prices", next);
      },
      () => setPrices(null),
    );
  }, [user]);

  /* ---------- mutations ----------
     Firestore write promises only settle on server acknowledgement, so they
     are deliberately not awaited for UI flow: the local cache applies the
     change immediately and the queued write syncs when the network returns. */

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!user) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      void updateDoc(doc(db, "users", user.uid), { settings: stripUndefined(next) }).catch(
        () => undefined,
      );
    },
    [user, settings],
  );

  const setActiveVehicle = useCallback(
    async (vehicleId: string) => {
      await updateSettings({ activeVehicleId: vehicleId });
    },
    [updateSettings],
  );

  const addVehicle = useCallback(
    async (vehicle: Omit<Vehicle, "id" | "createdAt">) => {
      if (!user) throw new Error("not signed in");
      const ref = doc(collection(db, "users", user.uid, "vehicles"));
      void setDoc(ref, stripUndefined({ ...vehicle, createdAt: serverTimestamp() })).catch(
        () => undefined,
      );
      // First vehicle becomes the active one automatically.
      if (vehicles.filter((v) => !v.archived).length === 0) {
        await updateSettings({ activeVehicleId: ref.id });
      }
      return ref.id;
    },
    [user, vehicles, updateSettings],
  );

  const updateVehicle = useCallback(
    async (vehicleId: string, patch: Partial<Vehicle>) => {
      if (!user) return;
      const { id: _ignored, ...rest } = patch as Partial<Vehicle> & { id?: string };
      void updateDoc(
        doc(db, "users", user.uid, "vehicles", vehicleId),
        stripUndefined(rest as Record<string, unknown>),
      ).catch(() => undefined);
    },
    [user],
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
      if (!user) return;
      // Subcollections are not removed with their parent, so clear fill-ups
      // in batches first.
      const fillupsRef = collection(db, "users", user.uid, "vehicles", vehicleId, "fillups");
      const snapshot = await getDocs(fillupsRef);
      for (let i = 0; i < snapshot.docs.length; i += 400) {
        const batch = writeBatch(db);
        snapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, "users", user.uid, "vehicles", vehicleId));

      if (settings.activeVehicleId === vehicleId) {
        const fallback = vehicles.find((v) => v.id !== vehicleId && !v.archived);
        await updateSettings({ activeVehicleId: fallback?.id ?? null });
      }
    },
    [user, settings.activeVehicleId, vehicles, updateSettings],
  );

  const addFillup = useCallback(
    async (fillup: Omit<Fillup, "id" | "createdAt">) => {
      if (!user || !activeVehicle) throw new Error("no active vehicle");
      const ref = doc(
        collection(db, "users", user.uid, "vehicles", activeVehicle.id, "fillups"),
      );
      void setDoc(
        ref,
        stripUndefined({
          ...fillup,
          date: Timestamp.fromMillis(fillup.date),
          createdAt: serverTimestamp(),
        }),
      ).catch(() => undefined);
      return ref.id;
    },
    [user, activeVehicle],
  );

  const updateFillup = useCallback(
    async (fillupId: string, patch: Partial<Omit<Fillup, "id">>) => {
      if (!user || !activeVehicle) return;
      const payload: Record<string, unknown> = { ...patch };
      if (typeof patch.date === "number") payload.date = Timestamp.fromMillis(patch.date);
      void updateDoc(
        doc(db, "users", user.uid, "vehicles", activeVehicle.id, "fillups", fillupId),
        stripUndefined(payload),
      ).catch(() => undefined);
    },
    [user, activeVehicle],
  );

  const deleteFillup = useCallback(
    async (fillupId: string) => {
      if (!user || !activeVehicle) return;
      void deleteDoc(
        doc(db, "users", user.uid, "vehicles", activeVehicle.id, "fillups", fillupId),
      ).catch(() => undefined);
    },
    [user, activeVehicle],
  );

  const restoreFillup = useCallback(
    async (fillup: Fillup) => {
      if (!user || !activeVehicle) return;
      const { id, createdAt, ...rest } = fillup;
      void setDoc(
        doc(db, "users", user.uid, "vehicles", activeVehicle.id, "fillups", id),
        stripUndefined({
          ...rest,
          date: Timestamp.fromMillis(fillup.date),
          createdAt: createdAt ? Timestamp.fromMillis(createdAt) : serverTimestamp(),
        }),
      ).catch(() => undefined);
    },
    [user, activeVehicle],
  );

  const deleteAccount = useCallback(async () => {
    if (!user) return;
    const vehiclesSnapshot = await getDocs(collection(db, "users", user.uid, "vehicles"));

    for (const vehicleDoc of vehiclesSnapshot.docs) {
      const fillupsSnapshot = await getDocs(collection(vehicleDoc.ref, "fillups"));
      for (let i = 0; i < fillupsSnapshot.docs.length; i += 400) {
        const batch = writeBatch(db);
        fillupsSnapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
      }
      await deleteDoc(vehicleDoc.ref);
    }

    await deleteDoc(doc(db, "users", user.uid));
    clearCache(user.uid);
    await user.delete();
  }, [user]);

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
