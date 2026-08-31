import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { FuelType, Vehicle } from "./types";
import type { Stats } from "./stats";

/**
 * Community benchmarks.
 *
 * Comparing your economy against other drivers is only useful if it costs
 * nobody their privacy. Each user publishes exactly one anonymous summary
 * document — no name, no email, no plate, no odometer, no station, no dates —
 * keyed by their uid so it can be updated and deleted, and readable by any
 * signed-in user. Everything the comparison shows is derived from those
 * summaries client-side.
 *
 * Publishing is opt-out (Settings → "השוואה אנונימית"), and deleting the
 * account or opting out removes the document.
 */

export interface BenchmarkDoc {
  /** Normalised so "מזדה 3" and "מזדה  3 " land in the same bucket. */
  modelKey: string;
  fuelType: FuelType;
  year: number | null;
  avgKmPerLiter: number;
  /** How many closed segments back the figure — a confidence signal. */
  segments: number;
  avgPricePerLiter: number | null;
  updatedAt?: unknown;
}

export interface BenchmarkComparison {
  /** 0–100; higher means more economical than that share of drivers. */
  percentile: number;
  /** Number of comparable drivers, excluding the current user. */
  peers: number;
  peerAverage: number;
  yourAverage: number;
  /** What the peer group was matched on. */
  basis: "model" | "fuelType";
  label: string;
}

/** Minimum peers before a comparison is shown at all. */
const MIN_PEERS = 4;

export function modelKey(vehicle: Pick<Vehicle, "make" | "model">): string {
  return `${vehicle.make} ${vehicle.model}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Publish (or refresh) the current user's anonymous summary.
 * Skipped unless there is a real, segment-backed figure to contribute.
 */
export async function publishBenchmark(
  uid: string,
  vehicle: Vehicle,
  stats: Stats,
): Promise<void> {
  if (stats.avgKmPerLiter === null || stats.segments.length < 2) return;

  const payload: BenchmarkDoc = {
    modelKey: modelKey(vehicle),
    fuelType: vehicle.fuelType,
    year: vehicle.year ?? null,
    avgKmPerLiter: Math.round(stats.avgKmPerLiter * 100) / 100,
    segments: stats.segments.length,
    avgPricePerLiter: stats.avgPricePaid,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "benchmarks", uid), payload, { merge: true });
}

export async function withdrawBenchmark(uid: string): Promise<void> {
  await deleteDoc(doc(db, "benchmarks", uid)).catch(() => undefined);
}

/**
 * Compare against drivers of the same model, falling back to the same fuel
 * type when the model is too rare to say anything meaningful.
 */
export async function fetchComparison(
  uid: string,
  vehicle: Vehicle,
  yourAverage: number,
): Promise<BenchmarkComparison | null> {
  const key = modelKey(vehicle);

  const attempts: { basis: "model" | "fuelType"; label: string; constraint: ReturnType<typeof where> }[] =
    [
      {
        basis: "model",
        label: `נהגי ${vehicle.make} ${vehicle.model}`.trim(),
        constraint: where("modelKey", "==", key),
      },
      {
        basis: "fuelType",
        label: vehicle.fuelType === "diesel" ? "רכבי סולר" : "רכבי בנזין",
        constraint: where("fuelType", "==", vehicle.fuelType),
      },
    ];

  for (const attempt of attempts) {
    const snapshot = await getDocs(
      query(collection(db, "benchmarks"), attempt.constraint, limit(500)),
    );

    const peers = snapshot.docs
      .filter((entry) => entry.id !== uid)
      .map((entry) => entry.data() as BenchmarkDoc)
      .filter((entry) => Number.isFinite(entry.avgKmPerLiter) && entry.avgKmPerLiter > 0);

    if (peers.length < MIN_PEERS) continue;

    const below = peers.filter((peer) => peer.avgKmPerLiter < yourAverage).length;
    const peerAverage =
      peers.reduce((sum, peer) => sum + peer.avgKmPerLiter, 0) / peers.length;

    return {
      percentile: Math.round((below / peers.length) * 100),
      peers: peers.length,
      peerAverage: Math.round(peerAverage * 100) / 100,
      yourAverage: Math.round(yourAverage * 100) / 100,
      basis: attempt.basis,
      label: attempt.label,
    };
  }

  return null;
}
