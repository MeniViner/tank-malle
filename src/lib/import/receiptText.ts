import { validDay, localDay } from '../maintenance/model';
import { parseNumberInput } from '../numeric';
import type { Fillup } from '../types';

export interface DocumentIdentity { issuer: string; series: string; branch: string; number: string }
export interface TextReceipt {
  total: string; liters: string; day: string; time: string; identity: DocumentIdentity;
  credit: boolean; sections: { kind: 'fuel'|'shop'|'discount'|'fee'|'credit'|'other'; text: string }[];
}
const clean = (text: string) => text.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
/** Conservative labelled fields, not a provider adapter. Ambiguity stays empty for review. */
export function parseReceiptText(text: string): TextReceipt {
  if (text.length > 100000) throw new Error('אפשר לקרוא עד 100,000 תווים בכל מסמך.');
  const lines = clean(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const unique = (labels: string) => {
    const pattern = new RegExp(`^(?:${labels})\\s*[:：]\\s*(.+)$`,'i');
    const values = [...new Set(lines.map(line=>pattern.exec(line)?.[1]?.trim()).filter((v):v is string=>!!v))];
    return values.length === 1 ? values[0] : '';
  };
  const number = (value: string, kind:'money'|'liters') => {
    const parsed = parseNumberInput(value.replace(/₪|ILS|NIS/gi,'').trim(),kind).value;
    return Number.isFinite(parsed) && parsed>0 ? String(parsed) : '';
  };
  const sections: TextReceipt['sections'] = lines.map(text=>({text,kind:
    /חשבונית זיכוי|תעודת זיכוי|credit note/i.test(text) ? 'credit' : /הנחה|discount/i.test(text) ? 'discount' :
    /עמל[הת]|דמי שירות|service fee/i.test(text) ? 'fee' : /חנות|קפה|מוצר|shop|coffee/i.test(text) ? 'shop' :
    /דלק|בנזין|סולר|ליטר|fuel|lit[er]+s?/i.test(text) ? 'fuel' : 'other'}));
  const credit = sections.some(line=>line.kind==='credit');
  const date = unique('תאריך|date');
  return {
    total: credit ? '' : number(unique('סכום דלק|סה״כ דלק|fuel total'),'money'),
    liters: credit ? '' : number(unique('ליטרים|כמות ליטרים|liters|litres'),'liters'),
    day: validDay(date) ? date : '', time: /^([01]\d|2[0-3]):[0-5]\d$/.test(unique('שעה|time')) ? unique('שעה|time') : '',
    identity: { issuer:unique('מזהה מנפיק|ח״פ|issuer'),series:unique('סדרה|series'),branch:unique('סניף|branch'),number:unique('מספר מסמך|מספר חשבונית|document') },
    credit, sections,
  };
}
export async function receiptHash(text: string, identity: DocumentIdentity, confirmed: boolean): Promise<ReceiptImport> {
  const parts = [identity.issuer,identity.series,identity.branch,identity.number].map(clean);
  const strong = confirmed && parts.every(p=>p.length>0 && p.length<=120);
  const value = strong ? JSON.stringify(['receipt-v1','ILS',...parts]) : `receipt-text-v1\n${clean(text).replace(/\s+/g,' ')}`;
  const digest = async (value:string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return { hash:await digest(value),textHash:await digest(`receipt-text-v1\n${clean(text).replace(/\s+/g,' ')}`),strong };
}
export const RECEIPT_SOURCE = 'receipt-text-v1';
export function receiptDocumentId(source: unknown, hash: unknown): string | null {
  return source === RECEIPT_SOURCE && typeof hash==='string' && /^[a-f0-9]{64}$/.test(hash) ? `receipt-${hash}` : null;
}
export function possibleReceiptDuplicates(fillups: Fillup[], candidate: Pick<TextReceipt,'day'|'total'|'liters'>): Fillup[] {
  const total = parseNumberInput(candidate.total,'money').value, liters=parseNumberInput(candidate.liters,'liters').value;
  return fillups.filter(row=>Number.isFinite(row.date) && localDay(new Date(row.date))===candidate.day &&
    Math.abs(row.totalCost-total)<0.011 && Math.abs(row.liters-liters)<0.001);
}
export interface ReceiptImport { hash:string; textHash:string; strong:boolean }
