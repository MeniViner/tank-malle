/**
 * Demo mode in the data layer: while a sample is active, every screen reads the sample's
 * vehicles, fill-ups and tank readings instead of the account's, and every change is applied to
 * the sample in this device's localStorage. Nothing reaches Firestore, the outbox, the community
 * comparisons or the account. See `lib/demo/demo.ts`.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { DataContext, type DataContextValue, type FillupSubmission } from "./DataContext";
import { exitDemo, isDemoVehicleId, readDemo, subscribeDemo, updateDemo, type DemoState } from "../lib/demo/demo";
import type { MutationReceipt } from "../lib/writes";
import type { Fillup } from "../lib/stats";
import type { VehicleDocumentSnapshot } from "../lib/vehicle/documents";
import { vehicleDocumentIntent } from "../lib/vehicleDocumentPersistence";

export const DEMO_BLOCKED = "בנתוני הדוגמה אי אפשר לשמור את זה. כדי לשמור באמת, יוצאים מהדוגמה ומוסיפים רכב.";

const blocked = async (): Promise<never> => { throw new Error(DEMO_BLOCKED); };
const accepted = (id: string): MutationReceipt => ({ id, settled: Promise.resolve(true) });
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1)}`;

export function DemoDataLayer({ children }: { children: ReactNode }) {
  const real = useContext(DataContext);
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const demo = useSyncExternalStore(subscribeDemo, () => readDemo(uid), () => null);
  if (!real || !demo || !uid) return <>{children}</>;
  return <DemoProvider real={real} demo={demo} uid={uid}>{children}</DemoProvider>;
}

function DemoProvider({ real, demo, uid, children }: { real: DataContextValue; demo: DemoState; uid: string; children: ReactNode }) {
  const isCurrent = useCallback(() => readDemo(uid) !== null, [uid]);
  const pendingExit = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingExit.current;
    if (id && real.vehicles.some(vehicle => vehicle.id === id)) { pendingExit.current = null; exitDemo(uid); }
  }, [real.vehicles, uid]);
  const value = useMemo<DataContextValue>(() => {
    const vehicleId = demo.activeVehicleId;
    const activeVehicles = demo.vehicles.filter(vehicle => !vehicle.archived);
    const activeVehicle = activeVehicles.find(vehicle => vehicle.id === vehicleId) ?? activeVehicles[0] ?? null;
    const fillups = activeVehicle ? demo.fillups[activeVehicle.id] ?? [] : [];
    const change = (apply: (state: DemoState) => DemoState) => updateDemo(uid, apply);
    const setFillups = (id: string, apply: (rows: Fillup[]) => Fillup[]) =>
      change(state => ({ ...state, fillups: { ...state.fillups, [id]: apply(state.fillups[id] ?? []) } }));
    const setCare = (id: string, name: string, apply: (rows: unknown[]) => unknown[]) => change(state => {
      const vehicleCare = state.care?.[id] ?? {};
      return { ...state, care: { ...state.care, [id]: { ...vehicleCare, [name]: apply(vehicleCare[name] ?? []) } } };
    });
    const submission = (written: Fillup, extra: Partial<FillupSubmission>): FillupSubmission =>
      ({ written: Object.freeze({ ...written }), receipt: accepted(written.id), isCurrent, ...extra });
    const target = (requested?: string) => requested && isDemoVehicleId(requested) ? requested : activeVehicle?.id ?? vehicleId;

    return {
      ...real,
      demo: true,
      settings: { ...real.settings, activeVehicleId: activeVehicle?.id ?? null, shareBenchmarks: false, shareTcoBenchmarks: false },
      vehicles: demo.vehicles,
      activeVehicles,
      activeVehicle,
      activeVehicleVerified: true,
      fillups,
      loadingFillups: false,
      fillupsFromCache: false,
      fromCache: false,
      pendingFillupIds: new Set<string>(),
      fillupsError: null,
      malformedFillups: [],
      fillupPriceKnown: new Map(fillups.map(row => [row.id, true])),
      loadVehicleFillups: async (id: string) => readDemo(uid)?.fillups[id] ?? [],
      loadVehicleCatalog: async () => readDemo(uid)?.vehicles ?? [],
      listImportBatches: async () => [],

      setActiveVehicle: async (id: string) => {
        if (isDemoVehicleId(id)) { change(state => ({ ...state, activeVehicleId: id })); return; }
        exitDemo(uid);
        await real.setActiveVehicle(id);
      },
      // A real car: saved to the account first; the demo ends once the account lists it (ending it
      // earlier would show "no car" for a moment and send the wizard back to its start).
      addVehicle: async (vehicle, options) => {
        const id = await real.addVehicle(vehicle, options);
        pendingExit.current = id;
        setTimeout(() => { if (pendingExit.current === id) { pendingExit.current = null; exitDemo(uid); } }, 8000);
        return id;
      },
      updateVehicle: async (id, patch) => {
        if (!isDemoVehicleId(id)) return real.updateVehicle(id, patch);
        change(state => ({ ...state, vehicles: state.vehicles.map(v => v.id === id ? { ...v, ...patch, id } : v) }));
        return accepted(id);
      },
      captureVehicleDocument: (vehicle, docKey) => isDemoVehicleId(vehicle.id)
        ? ({ vehicleId: vehicle.id, key: docKey } as unknown as VehicleDocumentSnapshot<typeof docKey>)
        : real.captureVehicleDocument(vehicle, docKey),
      updateVehicleDocument: async (id, docKey, changes) => {
        if (!isDemoVehicleId(id)) throw new Error(DEMO_BLOCKED);
        vehicleDocumentIntent(docKey, changes); // the same validation a real save runs
        change(state => ({ ...state, vehicles: state.vehicles.map(v => {
          if (v.id !== id) return v;
          const docs = v.docs && typeof v.docs === "object" ? v.docs as Record<string, unknown> : {};
          const current = docs[docKey] && typeof docs[docKey] === "object" ? docs[docKey] as Record<string, unknown> : {};
          return { ...v, docs: { ...docs, [docKey]: { ...current, ...changes } } };
        }) }));
        return accepted(id);
      },
      enrichVehicleSpecs: async () => null,
      setVehicleArchived: blocked,
      deleteVehicle: async (id, options) => {
        if (!isDemoVehicleId(id)) return real.deleteVehicle(id, options);
        exitDemo(uid);
      },

      addFillup: async (fillup, options = {}) => {
        const id = nextId("demo-f");
        const written: Fillup = { ...fillup, id, createdAt: Date.now(), version: 1 } as Fillup;
        const vehicle = target(options.vehicleId);
        setFillups(vehicle, rows => [...rows, written].sort((a, b) => a.date - b.date));
        options.onSubmitted?.(submission(written, {
          undoCreation: async () => { setFillups(vehicle, rows => rows.filter(row => row.id !== id)); return accepted(id); },
        }));
        options.onWritten?.(written);
        return id;
      },
      updateFillup: async (fillupId, next, previous, options = {}) => {
        const vehicle = target(options.vehicleId);
        const before = (readDemo(uid)?.fillups[vehicle] ?? []).find(row => row.id === fillupId) ?? previous ?? null;
        if (!before) throw new Error("התדלוק לא נמצא בנתוני הדוגמה");
        const written: Fillup = { ...before, ...next, id: fillupId, createdAt: before.createdAt, version: (before.version ?? 0) + 1 } as Fillup;
        setFillups(vehicle, rows => rows.map(row => row.id === fillupId ? written : row).sort((a, b) => a.date - b.date));
        options.onSubmitted?.(submission(written, {
          undoEdit: async () => { setFillups(vehicle, rows => rows.map(row => row.id === fillupId ? before : row)); return accepted(fillupId); },
        }));
        return written;
      },
      deleteFillup: async (fillup, options = {}) => {
        const vehicle = target(options.vehicleId);
        setFillups(vehicle, rows => rows.filter(row => row.id !== fillup.id));
        options.onSubmitted?.(submission(fillup, {
          restoreDeleted: async () => { setFillups(vehicle, rows => [...rows.filter(row => row.id !== fillup.id), fillup].sort((a, b) => a.date - b.date)); return accepted(fillup.id); },
        }));
      },
      restoreFillup: async (fillup, options = {}) => {
        const vehicle = target(options.vehicleId);
        setFillups(vehicle, rows => [...rows.filter(row => row.id !== fillup.id), fillup].sort((a, b) => a.date - b.date));
      },
      addFillupBatch: blocked,
      importBackupEntries: blocked,
      importTankUpdates: blocked,
      deleteImportBatch: blocked,
      savePriceRule: blocked,
      deletePriceRule: blocked,
      demoCare: activeVehicle ? demo.care?.[activeVehicle.id] ?? {} : {},
      saveCareRecord: async (id, name, record) => {
        setCare(id, name, rows => [...rows.filter(row => (row as { id?: string }).id !== record.id), record]);
        return accepted(record.id);
      },
      deleteCareRecord: async (id, name, record) => {
        setCare(id, name, rows => rows.filter(row => (row as { id?: string }).id !== record.id));
        return accepted(record.id);
      },

      tankInputScope: { uid, vehicleId: activeVehicle?.id ?? vehicleId },
      observationsStatus: "ready",
      plansStatus: "ready",
      observations: activeVehicle ? demo.observations[activeVehicle.id] ?? [] : [],
      addObservation: async (observation) => {
        const id = nextId("demo-o");
        const vehicle = activeVehicle?.id ?? vehicleId;
        change(state => ({ ...state, observations: { ...state.observations,
          [vehicle]: [...(state.observations[vehicle] ?? []), { ...observation, id, vehicleId: vehicle, recordedAt: Date.now() }] } }));
        return id;
      },
      captureObservation: (record) => Object.freeze({ id: record.id, vehicleId: record.vehicleId, record: Object.freeze({ ...record }) }),
      deleteObservation: async (observationId) => {
        change(state => ({ ...state, observations: Object.fromEntries(Object.entries(state.observations)
          .map(([id, rows]) => [id, rows.filter(row => row.id !== observationId)])) }));
      },
      plans: activeVehicle ? demo.plans[activeVehicle.id] ?? [] : [],
      addPlan: async (plan) => {
        const id = nextId("demo-p");
        const vehicle = activeVehicle?.id ?? vehicleId;
        change(state => ({ ...state, plans: { ...state.plans,
          [vehicle]: [...(state.plans[vehicle] ?? []), { ...plan, id, vehicleId: vehicle, createdAt: Date.now() }] } }));
        return id;
      },
      deletePlan: async (planId) => {
        change(state => ({ ...state, plans: Object.fromEntries(Object.entries(state.plans)
          .map(([id, rows]) => [id, rows.filter(row => row.id !== planId)])) }));
      },
      tankPreferences: activeVehicle ? demo.prefs[activeVehicle.id] ?? real.tankPreferences : real.tankPreferences,
      updateTankPreferences: async (patch) => {
        const vehicle = activeVehicle?.id ?? vehicleId;
        change(state => ({ ...state, prefs: { ...state.prefs, [vehicle]: { ...(state.prefs[vehicle] ?? real.tankPreferences), ...patch } } }));
      },
      deleteAccount: async () => { exitDemo(uid); return real.deleteAccount(); },
    };
  }, [real, demo, uid, isCurrent]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
