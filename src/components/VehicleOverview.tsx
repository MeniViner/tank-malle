import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useVehicleData } from '../context/VehicleDataContext';
import { FUEL_TYPE_SHORT, int } from '../lib/format';
import { vehicleDay } from '../lib/vehicle/format';
import { Odometer, PlateXL } from './DesignPrimitives';
import { NumericText, NumRun } from './Fmt';

export function VehicleOverview() {
  const { activeVehicle } = useData();
  const { currentMileage, edit } = useVehicleData();
  if (!activeVehicle) return null;
  const update = () => edit({ collection: 'odometerReadings', odometerIntent: 'current' });
  const meta = [activeVehicle.year, FUEL_TYPE_SHORT[activeVehicle.fuelType],
    activeVehicle.tankLiters ? `מיכל ${activeVehicle.tankLiters} ל׳${activeVehicle.tankLitersSource === 'estimate' ? ' · הערכה' : ''}` : null].filter(Boolean).join(' · ');
  return <section className="tm-vehicle-overview" aria-label="הרכב שלי">
    <div className="tm-vehicle-topline"><span className="tm-vehicle-eyebrow"><NumericText>{activeVehicle.nickname || 'הרכב שלי'}</NumericText></span><Link className="tm-vehicle-chip" to="/settings/vehicles">ניהול רכבים</Link></div>
    <PlateXL value={activeVehicle.plateNumber ?? ''}/>
    <div className="tm-vehicle-heading"><h1><NumericText>{`${activeVehicle.make} ${activeVehicle.model}`.trim() || 'הרכב שלי'}</NumericText></h1><p><NumericText>{meta}</NumericText></p></div>
    <div className="tm-vehicle-odometer">
      <div className="tm-vehicle-topline"><span className="tm-vehicle-eyebrow"><NumericText>{`קילומטראז׳${currentMileage ? ` · ${vehicleDay(currentMileage.day)}` : ''}`}</NumericText></span><button type="button" className="tm-vehicle-chip" onClick={update}>עדכון</button></div>
      <Odometer value={currentMileage?.ambiguous ? null : currentMileage?.odometer ?? null} onClick={update}/>
      {currentMileage?.ambiguous ? <p className="tm-vehicle-note">תועדו <NumRun>{`${int(currentMileage.minimum)}–${int(currentMileage.maximum)}`}</NumRun> ק״מ באותו יום. סדר הקריאות אינו ידוע.</p>
        : !currentMileage ? <p className="tm-vehicle-note">מוסיפים את הקריאה שמופיעה בלוח הקילומטרים.</p> : null}
    </div>
  </section>;
}
