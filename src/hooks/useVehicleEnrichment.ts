import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { fetchVehicleSpecs } from '../lib/vehicleSpecs';
import { lookupPlate } from '../lib/plateLookup';
import type { Vehicle } from '../lib/stats';

/** Enrich missing fields only; stale requests cannot modify a different account/car. */
export function useVehicleEnrichment() {
  const { user } = useAuth();
  const { activeVehicle, updateVehicle, outboxReady } = useData();
  const latest = useRef({ vehicle: activeVehicle, uid: user?.uid });
  useLayoutEffect(() => { latest.current = { vehicle: activeVehicle, uid: user?.uid }; }, [activeVehicle, user?.uid]);
  const attempted = useRef(new Set<string>());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const vehicle = activeVehicle;
    const uid = user?.uid;
    if (!uid || !vehicle || !outboxReady || (vehicle.tankLiters && vehicle.declaredKmPerLiter)) { setLoading(false); return; }
    const key = `${uid}:${vehicle.id}:${vehicle.make}:${vehicle.model}:${vehicle.year}`;
    if (attempted.current.has(key)) { setLoading(false); return; }
    const abort = new AbortController();
    setLoading(true);
    void (async () => {
      let params = { ...vehicle };
      if ((!vehicle.tozeretCd || !vehicle.degemCd) && vehicle.plateNumber) {
        const result = await lookupPlate(vehicle.plateNumber, { uid, signal: abort.signal });
        if (result.status === 'found') params = { ...params, ...result.vehicle, id: vehicle.id };
      }
      const specs = await fetchVehicleSpecs(params, abort.signal);
      if (abort.signal.aborted || latest.current.uid !== uid || latest.current.vehicle?.id !== vehicle.id) return;
      const current = latest.current.vehicle;
      const patch: Partial<Vehicle> = {};
      if (!current.tankLiters && specs.trustedTankLiters) Object.assign(patch, { tankLiters: specs.trustedTankLiters, tankLitersSource: 'trusted', tankSourceUrl: specs.tankSourceUrl });
      if (!current.declaredKmPerLiter && specs.declaredKmPerLiter && specs.declaredSource === 'exact-year') Object.assign(patch, {
        declaredKmPerLiter: specs.declaredKmPerLiter, declaredSource: specs.consumptionIsOfficial ? 'exact-year' : 'co2-estimate', specSourceUrl: specs.sourceUrl,
      });
      if (params.tozeretCd && !current.tozeretCd) patch.tozeretCd = params.tozeretCd;
      if (params.degemCd && !current.degemCd) patch.degemCd = params.degemCd;
      attempted.current.add(key);
      if (Object.keys(patch).length) await updateVehicle(vehicle.id, patch);
    })().catch(() => { /* Manual refresh remains available in vehicle settings. */ })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [user?.uid, activeVehicle, outboxReady, updateVehicle]);
  return loading;
}
