import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { useVehicleData } from '../context/VehicleDataContext';
import type { CareCollection } from '../lib/maintenance/model';
export function VehiclePage({title,subtitle,children,back}:{title:string;subtitle?:string;children:ReactNode;back?:string}) {return <main className="vehicle-page pb-[112px] pt-safe"><AppHeader/><div className="tm-page">{back?<Link className="v-back" to={back}>→ חזרה</Link>:null}<header className="v-page-heading"><h1>{title}</h1>{subtitle?<p>{subtitle}</p>:null}</header>{children}</div></main>;}
export function VehicleAddBar(){const {edit}=useVehicleData();return <div className="v-addbar" aria-label="הוספה ליומן">{([['serviceEvents','טיפול'],['vehicleExpenses','הוצאה / החזר'],['odometerReadings','ק״מ']] as [CareCollection,string][]).map(([collection,title])=><button key={collection} type="button" aria-label={collection==='serviceEvents'?'הוספת טיפול':collection==='vehicleExpenses'?'הוספת הוצאה':'עדכון ק״מ'} onClick={()=>edit({collection})}>＋ {title}</button>)}</div>;}
export function CoverageNotice(){const v=useVehicleData();return v.incomplete?<p role="status" className="helper">הנתונים חלקיים או ממתינים לאישור מהשרת. הסכום כולל רק עלויות ידועות.</p>:null;}
