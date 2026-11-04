/* oxlint-disable react/only-export-components -- One provider and its scoped consumer. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useData } from './DataContext';
import { useVehicleData } from './VehicleDataContext';
import { useTco } from '../hooks/useTco';
import { useAccountScope } from '../components/account/useAccountScope';
import { costBenchmark } from '../lib/costBenchmarkModel';
import { publishCostBenchmark, withdrawCostBenchmarks, withdrawVehicleCost } from '../lib/costBenchmarks';

type Status = 'idle' | 'pending' | 'done' | 'error';
interface CostSharing { withdrawal: Status; publication: Status; retry: () => void }
const Context = createContext<CostSharing | null>(null);

/** One privacy lifecycle for every route. Only completed server operations set result state. */
export function CostCommunityProvider({ children }: { children: ReactNode }) {
  const { user, signingOut } = useAuth();
  const data = useData(), source = useVehicleData(), tco = useTco(null);
  const uid = user?.uid ?? '', sharing = data.settings.shareTcoBenchmarks === true;
  const captureAccount = useAccountScope(uid), captureVehicle = useAccountScope(source.scope);
  const [attempt, setAttempt] = useState(0);
  // Object lifetimes distinguish A → B → A and consent off → on, even with equal values.
  const lifetime = useMemo(() => ({ uid, scope: source.scope, sharing }), [uid, source.scope, sharing]);
  const withdrawalScope = useMemo(() => ({ uid, ready: data.ready, deleting: data.accountDeletionPending, pending: data.writes.pending.length, offline: data.offline, sharing, signingOut, attempt }), [uid, data.ready, data.accountDeletionPending, data.writes.pending.length, data.offline, sharing, signingOut, attempt]);
  const publicationScope = useMemo(() => ({ lifetime, ready: data.ready, deleting: data.accountDeletionPending, vehicle: data.activeVehicle, cached: data.fromCache, pending: data.writes.pending.length, incomplete: source.incomplete, tco, signingOut, attempt }), [lifetime, data.ready, data.accountDeletionPending, data.activeVehicle, data.fromCache, data.writes.pending.length, source.incomplete, tco, signingOut, attempt]);
  const [withdrawalResult, setWithdrawalResult] = useState<{ scope: object; status: Status } | null>(null);
  const [publicationResult, setPublicationResult] = useState<{ scope: object; status: Status } | null>(null);
  const [published, setPublished] = useState<{ lifetime: object; signature: string } | null>(null);
  const retry = useCallback(() => { setPublished(null); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retry]);

  const active = !!uid && data.ready && !data.accountDeletionPending && !signingOut;
  const sourceReady = active && sharing && !!data.activeVehicle && !source.incomplete && !data.fromCache && !data.writes.pending.length;
  const payload = useMemo(() => data.activeVehicle ? costBenchmark(data.activeVehicle, tco) : null, [data.activeVehicle, tco]);
  const signature = JSON.stringify([uid, payload, data.activeVehicle?.docs, tco.windowStart]);
  const alreadyPublished = !!payload && published?.lifetime === lifetime && published.signature === signature;
  const withdrawal: Status = !active || sharing ? 'idle' : withdrawalResult?.scope === withdrawalScope ? withdrawalResult.status : 'pending';
  const publication: Status = !active || !sharing ? 'idle' : sourceReady && alreadyPublished ? 'done'
    : sourceReady && publicationResult?.scope === publicationScope ? publicationResult.status : 'pending';

  useEffect(() => {
    if (!active || sharing) return;
    const current = captureAccount(); let cancelled = false;
    void withdrawCostBenchmarks(uid).then(confirmed => {
      if (!cancelled && current()) setWithdrawalResult({ scope: withdrawalScope, status: confirmed ? 'done' : 'pending' });
    }, () => { if (!cancelled && current()) setWithdrawalResult({ scope: withdrawalScope, status: 'error' }); });
    return () => { cancelled = true; };
  }, [uid, active, sharing, withdrawalScope, captureAccount]);

  useEffect(() => {
    const vehicle = data.activeVehicle;
    if (!sourceReady || !vehicle || alreadyPublished) return;
    const current = captureVehicle(); let cancelled = false;
    const valid = () => !cancelled && current();
    const operation = payload ? publishCostBenchmark(uid, vehicle, tco, valid)
      : withdrawVehicleCost(uid, vehicle.id, undefined, valid).then(() => true);
    void operation.then(confirmed => {
      if (!valid()) return;
      if (confirmed) setPublished(payload ? { lifetime, signature } : null);
      setPublicationResult({ scope: publicationScope, status: confirmed ? 'done' : 'pending' });
    }, () => { if (valid()) setPublicationResult({ scope: publicationScope, status: 'error' }); });
    return () => { cancelled = true; };
  }, [uid, sourceReady, data.activeVehicle, alreadyPublished, publicationScope, lifetime, signature, tco, captureVehicle, payload]);

  const value = useMemo(() => ({ withdrawal, publication, retry }), [withdrawal, publication, retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCostSharing() {
  const value = useContext(Context);
  if (!value) throw new Error('CostCommunityProvider is required');
  return value;
}
