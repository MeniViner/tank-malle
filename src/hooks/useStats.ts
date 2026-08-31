import { useMemo } from "react";
import { useData } from "../context/DataContext";
import { computeStats, type Stats } from "../lib/stats";

/** Memoised derived metrics for the active vehicle's raw fill-ups. */
export function useStats(): Stats {
  const { fillups, activeVehicle, prices } = useData();
  return useMemo(
    () => computeStats(fillups, activeVehicle, prices),
    [fillups, activeVehicle, prices],
  );
}
