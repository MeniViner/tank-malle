import { expect,it } from 'vitest';
import { parseReceiptText,receiptHash,receiptDocumentId,possibleReceiptDuplicates } from './receiptText';
import type { Fillup } from '../types';
const text='Issuer: 123\nSeries: A\nBranch: 002\nDocument: 0045\nDate: 2026-10-01\nTime: 14:30\nFuel total: 280\nLiters: 40\nShop: 20\nDiscount: 3\nService fee: 5\nTotal: 302';
it('extracts only explicit fuel facts and separately classifies other charges',()=>{
  const receipt=parseReceiptText(text);expect(receipt).toMatchObject({total:'280',liters:'40',day:'2026-10-01',time:'14:30',identity:{issuer:'123',series:'A',branch:'002',number:'0045'},credit:false});
  expect(receipt.sections.map(s=>s.kind)).toEqual(expect.arrayContaining(['fuel','shop','discount','fee','other']));
  expect(parseReceiptText('Total: 300\nLiters: 40').total).toBe('');
});
it('does not convert credit documents, ambiguous values or impossible dates into fuel',()=>{
  expect(parseReceiptText(text+'\nCredit note')).toMatchObject({credit:true,total:'',liters:''});
  expect(parseReceiptText(text+'\nFuel total: 300').total).toBe('');
  expect(parseReceiptText('Date: 2026-02-30\nFuel total: 28000\nLiters: ?')).toMatchObject({day:'',total:'28000',liters:''});
});
it('identity survives edits and isolates issuer, branch, series and leading zeros',async()=>{
  const receipt=parseReceiptText(text),base=await receiptHash(text,receipt.identity,true);
  expect((await receiptHash(text.replace('280','290'),receipt.identity,true)).hash).toBe(base.hash);
  for(const key of ['issuer','series','branch','number'] as const) expect((await receiptHash(text,{...receipt.identity,[key]:'different'},true)).hash).not.toBe(base.hash);
  expect((await receiptHash(text,receipt.identity,false)).textHash).toBe(base.textHash);
  expect((await receiptHash(text,{...receipt.identity,series:''},true)).strong).toBe(false);
  expect(receiptDocumentId('receipt-text-v1',base.hash)).toBe(`receipt-${base.hash}`);
  expect(receiptDocumentId('other',base.hash)).toBeNull();
});
it('uncertain duplicate matching is a review hint, independent of odometer or authored edits',()=>{
  const fill={id:'x',date:new Date('2026-10-01T14:30:00').getTime(),odometer:20000,totalCost:280,liters:40,pricePerLiter:7,isFullTank:false} satisfies Fillup;
  expect(possibleReceiptDuplicates([fill],parseReceiptText(text))).toEqual([fill]);
  expect(possibleReceiptDuplicates([{...fill,totalCost:290}],parseReceiptText(text))).toEqual([]);
});
