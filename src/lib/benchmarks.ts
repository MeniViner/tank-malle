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
  /** Histogram of peer economy, for the distribution chart. */
  distribution: { bucket: string; from: number; to: number; count: number; isYou: boolean }[];
  /** Quartile markers so the user can place themselves on the range. */
  best: number;
  worst: number;
  median: number;
  /** Peer average price paid per litre, when enough peers reported one. */
  peerAvgPrice: number | null;
  yourAvgPrice: number | null;
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

    const values = peers.map((peer) => peer.avgKmPerLiter).sort((a, b) => a - b);
    const below = values.filter((value) => value < yourAverage).length;
    const peerAverage = values.reduce((sum, value) => sum + value, 0) / values.length;

    const prices = peers
      .map((peer) => peer.avgPricePerLiter)
      .filter((value): value is number => typeof value === "number" && value > 0);

    return {
      percentile: Math.round((below / values.length) * 100),
      peers: values.length,
      peerAverage: round2(peerAverage),
      yourAverage: round2(yourAverage),
      basis: attempt.basis,
      label: attempt.label,
      distribution: buildDistribution(values, yourAverage),
      best: round2(values[values.length - 1]),
      worst: round2(values[0]),
      median: round2(values[Math.floor(values.length / 2)]),
      peerAvgPrice:
        prices.length >= MIN_PEERS
          ? round2(prices.reduce((sum, value) => sum + value, 0) / prices.length)
          : null,
      yourAvgPrice: null,
    };
  }

  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Bucket peer economy into a small histogram.
 *
 * Fixed-width buckets across the observed range, capped at six so the chart
 * stays legible on a 390px screen. The bucket containing the user is flagged
 * so it can be highlighted rather than labelled with a separate marker.
 */
function buildDistribution(
  sorted: number[],
  yours: number,
): BenchmarkComparison["distribution"] {
  const min = Math.min(sorted[0], yours);
  const max = Math.max(sorted[sorted.length - 1], yours);
  const span = max - min;

  if (span < 0.01) {
    return [
      { bucket: `${round2(min)}`, from: min, to: max, count: sorted.length, isYou: true },
    ];
  }

  const bucketCount = Math.min(6, Math.max(3, Math.round(Math.sqrt(sorted.length))));
  const width = span / bucketCount;

  return Array.from({ length: bucketCount }, (_, index) => {
    const from = min + index * width;
    const to = index === bucketCount - 1 ? max : from + width;
    const count = sorted.filter(
      (value) => value >= from && (index === bucketCount - 1 ? value <= to : value < to),
    ).length;
    const isYou =
      yours >= from && (index === bucketCount - 1 ? yours <= to : yours < to);

    return { bucket: `${round2(from)}`, from: round2(from), to: round2(to), count, isYou };
  });
}
