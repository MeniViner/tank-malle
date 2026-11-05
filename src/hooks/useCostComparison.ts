import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { fetchCostComparison } from '../lib/costBenchmarks';
import { costBenchmark, type CostComparison } from '../lib/costBenchmarkModel';
import type { TcoResult } from '../lib/tco';

export function useCostComparison(tco: TcoResult) {
  const { user, signingOut } = useAuth();
  const data = useData(), source = useVehicleData();
  const [attempt, setAttempt] = useState(0);
  const sharing = data.settings.shareTcoBenchmarks === true;
  const eligible = !!data.activeVehicle && costBenchmark(data.activeVehicle, tco) !== null && !source.incomplete && !data.fromCache;
  const key = JSON.stringify([user?.uid, source.scope, data.activeVehicle?.make, data.activeVehicle?.model, data.activeVehicle?.fuelType, tco.month, sharing, eligible, data.accountDeletionPending, signingOut]);
  const scope = useMemo(() => ({ key, attempt }), [key, attempt]);
  const [state, setState] = useState<{ scope: object | null; status: 'loading' | 'ready' | 'error'; result: CostComparison | null }>({ scope: null, status: 'loading', result: null });
  useEffect(() => {
    const resume = () => setAttempt(value => value + 1);
    window.addEventListener('online', resume);
    return () => window.removeEventListener('online', resume);
  }, []);
  useEffect(() => {
    if (!user || !data.activeVehicle || !sharing || !eligible || data.accountDeletionPending || signingOut) return;
    let cancelled = false;
    void fetchCostComparison(user.uid, data.activeVehicle, tco.month).then(result => {
      if (!cancelled) setState({ scope, status: 'ready', result });
    }, () => { if (!cancelled) setState({ scope, status: 'error', result: null }); });
    return () => { cancelled = true; };
  }, [scope, attempt, user, data.activeVehicle, data.accountDeletionPending, sharing, eligible, signingOut, tco.month]);
  return { sharing, eligible, status: state.scope === scope ? state.status : 'loading' as const,
    comparison: state.scope === scope ? state.result : null, retry: () => setAttempt(value => value + 1) };
}
