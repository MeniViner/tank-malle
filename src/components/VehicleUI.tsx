import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { NumericText } from './Fmt';
import { useVehicleData } from '../context/VehicleDataContext';
import type { CareCollection } from '../lib/maintenance/model';
import { InfoIcon } from './icons';
import '../vehicle-page-design.css';
export function VehiclePage({title,subtitle,vehicleChoice,children,back,heading=true}:{title:string;subtitle?:string;vehicleChoice?:string;children:ReactNode;back?:string;heading?:boolean}) {
  const { pathname } = useLocation();
  return <main className="vehicle-page vehicle-v2-page pb-[112px] pt-safe"><div className="tm-page">
    {back ? <Link className="v-back" to={back}>→ חזרה</Link> : null}
    {heading?<header className={`v-page-heading${vehicleChoice ? ' v-page-choice' : ''}`}>
      <h1><NumericText>{title}</NumericText></h1>
      {vehicleChoice ? pathname.replace(/\/+$/, '') === '/vehicle'
        ? <Link to="/settings/vehicles" aria-label={`ניהול רכבים, ${vehicleChoice}`} className="v-vehicle-choice"><span><NumericText>{vehicleChoice}</NumericText></span></Link>
        : <span className="v-vehicle-choice"><NumericText>{vehicleChoice}</NumericText></span> : null}
      {subtitle ? <p><NumericText>{subtitle}</NumericText></p> : null}
    </header>:null}{children}
  </div></main>;
}
export function VehicleAddBar({includeMileage=true}:{includeMileage?:boolean}){const {edit}=useVehicleData();return <div className="v-addbar" aria-label="הוספה ליומן">{([['serviceEvents','טיפול'],['vehicleExpenses','הוצאה / החזר'],['odometerReadings','ק״מ']] as [CareCollection,string][]).filter(([collection])=>includeMileage||collection!=='odometerReadings').map(([collection,title])=><button key={collection} type="button" aria-label={collection==='serviceEvents'?'הוספת טיפול':collection==='vehicleExpenses'?'הוספת הוצאה':'עדכון ק״מ'} onClick={()=>edit({collection})}>＋ {title}</button>)}</div>;}
export function CoverageNotice(){const v=useVehicleData();return v.incomplete?<p role="status" className="helper">הנתונים חלקיים או ממתינים לאישור מהשרת. הסכום כולל רק עלויות ידועות.</p>:null;}
export function VehicleInfo({title,children}:{title:string;children:ReactNode}) {
  return <details className="tm-vehicle-info"><summary><InfoIcon size={16}/><NumericText>{title}</NumericText></summary><div className="tm-vehicle-note">{children}</div></details>;
}
