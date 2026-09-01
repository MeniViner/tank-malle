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
 * Each user publishes one economy summary PER VEHICLE — no name, no email, no
 * plate, no odometer, no station, no dates. Everything the comparison shows is
 * derived from those summaries client-side.
 *
 * Two things this is careful about:
 *
 * 1. **Per vehicle, not per user.** The document was previously keyed by uid
 *    alone, so a two-car household had whichever vehicle happened to be active
 *    overwrite the other's figure, and a diesel van could replace a petrol
 *    hatchback's entry in the same pool.
 *
 * 2. **Pseudonymous, not anonymous.** The document id contains the uid, which
 *    is what lets the rules prove ownership without a backend. Any signed-in
 *    user can therefore see that *some account* has this economy figure for
 *    this model — they cannot see who, but the documents are linkable across
 *    time. Calling that "anonymous" would be untrue. Genuine anonymity needs
 *    the Blaze-side cohort aggregator, which is written but not deployed; see
 *    docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md.
 *
 * Publishing is opt-out (Settings → "השוואה אנונימית"), and opting out or
 * deleting the account removes the documents.
 */

export interface BenchmarkDoc {
  /** The vehicle this figure describes. Present so one car cannot mask another. */
  vehicleId?: string;
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

/**
 * Not enough comparable drivers yet.
 *
 * Returned instead of null so the Community section can stay on screen and say
 * what it is waiting for. The old behaviour — returning null and rendering
 * nothing — made the whole feature look like it did not exist.
 */
export interface InsufficientPeers {
  insufficient: true;
  /** How many comparable drivers were found. */
  peers: number;
  required: number;
}

export function hasComparison(
  result: BenchmarkComparison | InsufficientPeers | null,
): result is BenchmarkComparison {
  return result !== null && !("insufficient" in result);
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

/**
 * Minimum peers before a NUMBER is shown. Below this the section still
 * appears, saying how far off it is — it does not vanish.
 */
export const MIN_PEERS = 4;

/**
 * How many peer documents to read per comparison.
 *
 * The old limit of 500 was fetched on every visit to Statistics. This is a
 * sample, not a census: a percentile from 120 peers is not meaningfully worse
 * than one from 500, and it is four times cheaper against the Spark read quota.
 */
const PEER_SAMPLE_LIMIT = 120;

/** Separator in the composite document id. */
const ID_SEPARATOR = "__";

/** users/{uid} + vehicle → the per-vehicle benchmark document id. */
export function benchmarkDocId(uid: string, vehicleId: string): string {
  return `${uid}${ID_SEPARATOR}${vehicleId}`;
}

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
    vehicleId: vehicle.id,
    modelKey: modelKey(vehicle),
    fuelType: vehicle.fuelType,
    year: vehicle.year ?? null,
    avgKmPerLiter: Math.round(stats.avgKmPerLiter * 100) / 100,
    segments: stats.segments.length,
    avgPricePerLiter: stats.avgPricePaid,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "benchmarks", benchmarkDocId(uid, vehicle.id)), payload, {
    merge: true,
  });
}

/**
 * Withdraw this user's contributions.
 *
 * The caller passes the vehicle ids because a client cannot list documents by
 * id prefix; the legacy uid-only document is removed too, so a user who opts
 * out does not leave a pre-upgrade row behind.
 */
export async function withdrawBenchmark(
  uid: string,
  vehicleIds: string[] = [],
): Promise<void> {
  const targets = [uid, ...vehicleIds.map((id) => benchmarkDocId(uid, id))];
  await Promise.all(
    targets.map((id) => deleteDoc(doc(db, "benchmarks", id)).catch(() => undefined)),
  );
}

/**
 * Compare against drivers of the same model, falling back to the same fuel
 * type when the model is too rare to say anything meaningful.
 */
export async function fetchComparison(
  uid: string,
  vehicle: Vehicle,
  yourAverage: number,
): Promise<BenchmarkComparison | InsufficientPeers> {
  const key = modelKey(vehicle);
  // Every one of this user's own documents is excluded, not just the one for
  // the active vehicle — comparing a car against its garage-mate is not a
  // community comparison.
  const isOwn = (id: string) => id === uid || id.startsWith(`${uid}${ID_SEPARATOR}`);

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

  let shortfall = 0;

  for (const attempt of attempts) {
    const snapshot = await getDocs(
      query(collection(db, "benchmarks"), attempt.constraint, limit(PEER_SAMPLE_LIMIT)),
    );

    const peers = snapshot.docs
      .filter((entry) => !isOwn(entry.id))
      .map((entry) => entry.data() as BenchmarkDoc)
      // Fuel type is part of the cohort, never crossed: a diesel figure and a
      // petrol figure are not comparable numbers.
      .filter((entry) => entry.fuelType === vehicle.fuelType)
      .filter((entry) => Number.isFinite(entry.avgKmPerLiter) && entry.avgKmPerLiter > 0);

    if (peers.length < MIN_PEERS) {
      // Remember how close we got, so the empty state can say "2 of 4".
      shortfall = Math.max(shortfall, peers.length);
      continue;
    }

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

  // Not null: the section stays visible and says what it is waiting for.
  return { insufficient: true, peers: shortfall, required: MIN_PEERS };
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
