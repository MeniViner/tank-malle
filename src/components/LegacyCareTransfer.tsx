import {useState} from 'react';
import {useVehicleData} from '../context/VehicleDataContext';
import {useData} from '../context/DataContext';
import {CareTransfer} from './maintenance/CareTransfer';
export function LegacyCareTransfer(){const [open,setOpen]=useState(false),v=useVehicleData(),data=useData();if(!v.vehicleId)return null;return <><button type="button" className="v-row" onClick={()=>setOpen(true)}>גיבוי וייצוא תחזוקה<small>תאימות לגיבויי התחזוקה הקודמים · הרכב הפעיל</small></button>{open?<CareTransfer vehicleId={v.vehicleId} label={data.activeVehicle?.nickname??data.activeVehicle?.model??'הרכב הפעיל'} data={v.care.data} incomplete={v.incomplete} canImport={!v.incomplete} onSave={(name,record)=>data.saveCareRecord(v.vehicleId,name,record)} onClose={()=>setOpen(false)}/>:null}</>;}
