import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { fetchVehicleSpecs } from '../lib/vehicleSpecs';
import { lookupPlate } from '../lib/plateLookup';
import type { Vehicle } from '../lib/stats';
import { vehicleEnrichmentRequestKey, vehicleEnrichmentSettled, vehicleSpecIdentityMatches } from '../lib/vehicleEnrichment';

/** Enrich missing fields only; stale requests cannot modify a different account/car. */
export function useVehicleEnrichment() {
  const { user } = useAuth();
  const { activeVehicle, activeVehicleVerified, enrichVehicleSpecs, outboxReady } = useData();
  const latest = useRef({ vehicle: activeVehicle, uid: user?.uid });
  useLayoutEffect(() => { latest.current = { vehicle: activeVehicle, uid: user?.uid }; }, [activeVehicle, user?.uid]);
  const attempted = useRef(new Set<string>());
  const requestKey = vehicleEnrichmentRequestKey(user?.uid, activeVehicle);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const { vehicle, uid } = latest.current;
    // A cached vehicle has no raw before-image yet; an attempt now would be refused
    // and never retried, so wait for the listener's copy (it re-runs this effect).
    if (!uid || !vehicle || !outboxReady || !activeVehicleVerified || !requestKey) { setLoading(false); return; }
    const key = requestKey;
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
      if (!vehicleSpecIdentityMatches({ ...vehicle }, { ...current })) return;
      const patch: Partial<Vehicle> = {};
      if (!current.tankLiters && current.tankLitersSource !== 'user' && specs.trustedTankLiters) Object.assign(patch, { tankLiters: specs.trustedTankLiters, tankLitersSource: 'trusted', tankSourceUrl: specs.tankSourceUrl });
      if (!current.declaredKmPerLiter && current.declaredSource !== 'user' && specs.declaredKmPerLiter && specs.declaredSource === 'exact-year') Object.assign(patch, {
        declaredKmPerLiter: specs.declaredKmPerLiter, declaredSource: specs.consumptionIsOfficial ? 'exact-year' : 'co2-estimate', specSourceUrl: specs.sourceUrl,
      });
      if (params.tozeretCd && !current.tozeretCd) patch.tozeretCd = params.tozeretCd;
      if (params.degemCd && !current.degemCd) patch.degemCd = params.degemCd;
      if (!Object.keys(patch).length) attempted.current.add(key);
      else {
        const receipt = await enrichVehicleSpecs(vehicle, patch, abort.signal);
        if (await vehicleEnrichmentSettled(receipt, () => !abort.signal.aborted)) attempted.current.add(key);
      }
    })().catch(() => { /* Manual refresh remains available in vehicle settings. */ })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [requestKey, outboxReady, activeVehicleVerified, enrichVehicleSpecs]);
  return loading;
}
