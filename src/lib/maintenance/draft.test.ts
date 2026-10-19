import { expect,it,vi,afterEach } from 'vitest';
import { careDraftKey,readCareDraft,writeCareDraft,removeCareDraft } from './draft';
afterEach(()=>vi.unstubAllGlobals());
it('recovers invalid/incomplete human strings only within account, vehicle and editor scope',()=>{
  const values=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k),setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
  const key=careDraftKey('alice','v1','serviceEvents'),draft={fields:{cost:'12.',title:'unfinished'},base:null};
  expect(writeCareDraft(key,draft)).toBe(true);expect(readCareDraft(key)).toEqual(draft);
  for(const other of [careDraftKey('bob','v1','serviceEvents'),careDraftKey('alice','v2','serviceEvents'),careDraftKey('alice','v1','vehicleExpenses'),careDraftKey('alice','v1','serviceEvents','edit')])expect(readCareDraft(other)).toBeNull();
  removeCareDraft(key);expect(readCareDraft(key)).toBeNull();
});
it('reports unavailable storage and ignores malformed/expired drafts',()=>{
  vi.stubGlobal('localStorage',{setItem:()=>{throw new Error('quota');},getItem:()=>JSON.stringify({version:1,at:0,data:{fields:{}}})});
  expect(writeCareDraft('x',{fields:{},base:null})).toBe(false);expect(readCareDraft('x')).toBeNull();
});
