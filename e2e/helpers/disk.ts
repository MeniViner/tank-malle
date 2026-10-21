import { type Page } from '@playwright/test';

/** Block only this disposable browser's Firestore cache, not its separate
 * durable outbox. No application hook or real browser profile is involved. */
export async function holdFirestoreDisk(page: Page): Promise<void> {
  await page.evaluate(async()=>{
    const name=(await indexedDB.databases()).find(db=>db.name?.startsWith('firestore/'))?.name;
    if(!name)throw new Error('Firestore persistent cache was not opened');
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction([...db.objectStoreNames],'readwrite');
    const store=tx.objectStore(db.objectStoreNames[0]);
    const state={release:false,attempted:false};
    (window as unknown as {diskLock:typeof state}).diskLock=state;
    const tick=()=>{const request=store.count();request.onsuccess=()=>{if(!state.release)tick();};};tick();
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){
      if(this.name===name&&args[1]==='readwrite')state.attempted=true;
      return original.apply(this,args);
    };
    tx.oncomplete=()=>{IDBDatabase.prototype.transaction=original;db.close();};
  });
}
export async function waitForDiskAttempt(page: Page): Promise<void> {
  await page.waitForFunction(()=>(window as unknown as {diskLock:{attempted:boolean}}).diskLock.attempted);
}
export async function releaseFirestoreDisk(page: Page): Promise<void> {
  await page.evaluate(()=>{(window as unknown as {diskLock:{release:boolean}}).diskLock.release=true;});
}
