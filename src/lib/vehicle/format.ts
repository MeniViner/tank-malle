import {shekel} from "../format";
export const vehicleMoney=(agorot:number|null)=>agorot===null?'לא ידוע':`${agorot<0?'−':''}${shekel(agorot/100,agorot%100===0?0:2)}`;
export const vehicleDay=(day:string)=>new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"short",year:"numeric"}).format(new Date(day+"T12:00:00"));
