import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useTankEstimate } from "../hooks/useTankEstimate";
import { TankPreferenceControls } from "./tank/TankPreferenceControls";

/** The Vehicle screen owns this fit; Home passes its existing estimate directly. */
export function TankPreferencesSection({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { activeVehicle } = useData();
  const { estimate } = useTankEstimate();
  return <TankPreferenceControls key={`${user?.uid ?? ""}/${activeVehicle?.id ?? ""}`}
    estimate={estimate} embedded={embedded} />;
}
