import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import {
  fetchComparison,
  publishBenchmark,
  withdrawBenchmark,
  type BenchmarkComparison,
} from "../lib/benchmarks";
import type { Stats } from "../lib/stats";

/**
 * Keeps the user's anonymous summary in step with their data and fetches the
 * peer comparison.
 *
 * Publishing is throttled to once a session per value: this runs on a screen
 * the user may revisit constantly, and there is no reason to write the same
 * row again.
 */
export function useBenchmark(stats: Stats): {
  comparison: BenchmarkComparison | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const { activeVehicle, settings } = useData();
  const [comparison, setComparison] = useState<BenchmarkComparison | null>(null);
  const [loading, setLoading] = useState(false);

  const lastPublished = useRef<string | null>(null);
  const sharing = settings.shareBenchmarks !== false;

  useEffect(() => {
    if (!user || !activeVehicle) return;

    if (!sharing) {
      // Opting out withdraws the row immediately rather than at next login.
      if (lastPublished.current !== "withdrawn") {
        lastPublished.current = "withdrawn";
        void withdrawBenchmark(user.uid);
      }
      return;
    }

    if (stats.avgKmPerLiter === null || stats.segments.length < 2) return;

    const signature = `${activeVehicle.id}:${stats.avgKmPerLiter}:${stats.segments.length}`;
    if (lastPublished.current === signature) return;
    lastPublished.current = signature;

    void publishBenchmark(user.uid, activeVehicle, stats).catch(() => undefined);
  }, [user, activeVehicle, stats, sharing]);

  useEffect(() => {
    if (!user || !activeVehicle || stats.avgKmPerLiter === null) {
      setComparison(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchComparison(user.uid, activeVehicle, stats.avgKmPerLiter)
      .then((result) => {
        if (!cancelled) setComparison(result);
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
  }, [user, activeVehicle, stats.avgKmPerLiter]);

  return { comparison, loading };
}
