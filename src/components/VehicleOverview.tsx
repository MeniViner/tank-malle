import { vehicleMoney } from "../lib/vehicle/format";
import { Link } from 'react-router-dom';
import { useVehicleData } from '../context/VehicleDataContext';
import { useVehicleNotifications } from '../hooks/useVehicleNotifications';
export function VehicleOverview() {
  const v=useVehicleData(),{active}=useVehicleNotifications();const urgent=active.filter(n=>n.urgent);
  const due=v.reminders.filter(r=>r.plan.active&&r.status==='due').length,activePlans=v.reminders.filter(r=>r.plan.active).length;
  return <><section className="vehicle-gauges" aria-label="מצב הרכב">
    <Link to="/vehicle"><small>קילומטראז׳ מתועד</small><b><bdi>{v.currentMileage?v.currentMileage.odometer.toLocaleString('he-IL'):'—'}</bdi></b><span>{v.currentMileage?'ק״מ · לעדכון ברכב שלי':'הוסיפו קריאה ראשונה'}</span></Link>
    <Link to="/vehicle"><small>תחזוקה</small><b className={due?'text-warning-ink':''}>{v.care.loading?'טוענים…':due?`${due} לטיפול`:activePlans?'במעקב':'ללא כללים'}</b><span>{activePlans?activePlans===1?'תזכורת פעילה אחת':`${activePlans} תזכורות פעילות`:'הוסיפו תזכורת ראשונה'}</span></Link>
    <Link to={`/history?period=month`}><small>הוצאות החודש</small><b data-testid="overview-month">{v.care.loading?'—':vehicleMoney(v.month.total)}</b><span>{v.month.unknown||v.incomplete?'סכום ידוע · חלקי':`${v.month.financialCount} רשומות כספיות`}</span></Link>
  </section>{urgent.length?<section className="urgent-group" aria-label="דורש תשומת לב"><div className="v-section-head"><h2>דורש תשומת לב</h2><Link to="/notifications">הכול</Link></div><div className="v-group">{urgent.slice(0,2).map(n=><Link key={n.id} className="v-row" to={n.to}><span><b>{n.title}</b><small>{n.detail}</small></span><span aria-hidden="true">←</span></Link>)}</div></section>:null}</>;
}
