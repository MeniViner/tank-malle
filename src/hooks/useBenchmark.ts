import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  fetchComparison,
  hasComparison,
  publishBenchmark,
  withdrawBenchmark,
  type BenchmarkComparison,
  type InsufficientPeers,
} from "../lib/benchmarks";
import type { Stats } from "../lib/stats";

/**
 * Keeps the user's per-vehicle summary in step with their data and fetches the
 * peer comparison.
 *
 * The published figure is built from the vehicle's COMPLETE closed-segment
 * history, never from the range selected in Statistics. Tapping "3 months"
 * changes what the charts show; it must not change the canonical figure this
 * user contributes to the pool, nor the cohort they are measured against.
 *
 * Publishing is throttled to once a session per value: this runs on a screen
 * the user may revisit constantly, and there is no reason to write the same
 * row again.
 */
export function useBenchmark(stats: Stats): {
  /** Either a real comparison or an explicit "not enough peers yet". */
  comparison: BenchmarkComparison | InsufficientPeers | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const { activeVehicle, activeVehicles, settings } = useData();
  const [comparison, setComparison] = useState<
    BenchmarkComparison | InsufficientPeers | null
  >(null);
  const [loading, setLoading] = useState(false);

  const lastPublished = useRef<string | null>(null);
  const sharing = settings.shareBenchmarks !== false;

  useEffect(() => {
    if (!user || !activeVehicle) return;

    if (!sharing) {
      // Opting out withdraws the row immediately rather than at next login.
      if (lastPublished.current !== "withdrawn") {
        lastPublished.current = "withdrawn";
        // Every vehicle's contribution, plus the pre-upgrade uid-only document.
        void withdrawBenchmark(
          user.uid,
          activeVehicles.map((entry) => entry.id),
        );
      }
      return;
    }

    if (stats.avgKmPerLiter === null || stats.segments.length < 2) return;

    const signature = `${activeVehicle.id}:${stats.avgKmPerLiter}:${stats.segments.length}`;
    if (lastPublished.current === signature) return;
    lastPublished.current = signature;

    void publishBenchmark(user.uid, activeVehicle, stats).catch(() => undefined);
  }, [user, activeVehicle, activeVehicles, stats, sharing]);

  useEffect(() => {
    if (!user || !activeVehicle || stats.avgKmPerLiter === null) {
      setComparison(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchComparison(user.uid, activeVehicle, stats.avgKmPerLiter)
      .then((result) => {
        if (cancelled) return;
        // The price you paid is local knowledge; splice it in here rather
        // than round-tripping it through the anonymous pool.
        setComparison(
          hasComparison(result) ? { ...result, yourAvgPrice: stats.avgPricePaid } : result,
        );
      })
      .catch(() => {
        if (!cancelled) setComparison(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, activeVehicle, stats.avgKmPerLiter, stats.avgPricePaid]);

  return { comparison, loading };
}
