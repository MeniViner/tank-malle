export interface FinancialRow { kind:string; financial:boolean; amountAgorot:number|null }
/** One minor-unit convention for Home, ledger, insights, vehicle and account export. */
export function financialTotals(rows:FinancialRow[]) {
  const financial=rows.filter(r=>r.financial);
  const sum=(predicate:(r:FinancialRow)=>boolean)=>financial.filter(predicate).reduce((n,r)=>n+(r.amountAgorot??0),0);
  const fuel=sum(r=>r.kind==='fuel'),maintenance=sum(r=>r.kind==='service'),other=sum(r=>r.kind==='expense'&&(r.amountAgorot??0)>=0),refunds=-sum(r=>r.kind==='expense'&&(r.amountAgorot??0)<0);
  return {total:fuel+maintenance+other-refunds,fuel,maintenance,other,refunds,unknown:financial.filter(r=>r.amountAgorot===null).length};
}
