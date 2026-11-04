import { useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { calculateTco } from '../lib/tco';

/** Uses the same selected vehicle, clock and source-completeness boundary as its ledger. */
export function useTco(kmPerDay: number | null) {
  const { activeVehicle } = useData();
  const vehicle = useVehicleData();
  return useMemo(() => calculateTco({ ledger: vehicle.ledger, docs: activeVehicle?.docs,
    today: vehicle.today, kmPerDay, incomplete: vehicle.incomplete }),
  [vehicle.ledger, activeVehicle?.docs, vehicle.today, kmPerDay, vehicle.incomplete]);
}
