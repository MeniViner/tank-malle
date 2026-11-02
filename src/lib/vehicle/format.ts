import {shekel} from "../format";
export const vehicleMoney=(agorot:number|null)=>agorot===null?'לא ידוע':`${agorot<=-50?'−':''}${shekel(agorot/100)}`;
export const vehicleDay=(day:string)=>new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"short",year:"numeric"}).format(new Date(day+"T12:00:00"));
