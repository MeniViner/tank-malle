import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { getDocument, listDocuments } from './helpers/emulator';
import { startCareEditor, setCareTitle } from './helpers/care';
import { outboxCount, waitForServiceWorkerControl, expectNetworkCut } from './helpers/pwa';

const version=readFileSync('src/lib/version.ts','utf8').match(/APP_VERSION = "([^"]+)"/)![1];
const liters=(page:Page)=>page.getByLabel('ליטרים',{exact:true});
const documentId=(page:Page)=>page.evaluate(()=>{
  const state=window as unknown as {acceptanceDocument?:string};
  return state.acceptanceDocument ??= crypto.randomUUID();
});
async function publish(page:Page) { expect((await page.request.post('/__acceptance/publish')).status()).toBe(204); }
async function expectVersion(page:Page,value:string) {
  await page.goto('/settings');await expect(page.getByText(`טנק מלא · גרסה ${value}`,{exact:false})).toBeVisible();
}
async function activate(page:Page) {
  const before=await documentId(page);
  await page.getByRole('button',{name:'רענון',exact:true}).click();
  await expect(async()=>expect(await documentId(page)).not.toBe(before)).toPass();
}
test.beforeEach(async({request})=>{expect((await request.post('/__acceptance/reset')).status()).toBe(204);});

test('resume discovers a waiting build; activation preserves existing data, both drafts and an offline queue',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[{id:'kept',date:new Date(Date.now()-86400000),odometer:99000,liters:10,pricePerLiter:8,totalCost:80}]});
  const root=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const existing=await getDocument(root+'/fillups/kept');
  await page.goto('/vehicle');await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);await waitForServiceWorkerControl(page);
  await context.setOffline(true);await page.reload();await expectNetworkCut(page);
  await startCareEditor(page,'expense');await setCareTitle(page,'חניה שממתינה לחיבור');
  await page.getByRole('dialog').getByLabel('עלות כוללת',{exact:true}).fill('25');
  await page.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
  await startCareEditor(page,'expense');await setCareTitle(page,'טיוטת חידוש ביטוח');
  await page.getByRole('dialog').getByLabel('עלות כוללת',{exact:true}).fill('123');
  await page.getByRole('dialog').getByRole('button',{name:'סגירה',exact:true}).click();
  await page.goto('/fillup/new');await liters(page).fill('40');await page.getByLabel('מחיר לליטר',{exact:true}).fill('8');
  await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('100000');
  await expect(page.getByText('טיוטה נשמרת במכשיר — אפשר לחזור ולהמשיך')).toBeVisible();
  const before=await documentId(page);
  // Keep Firestore disconnected while the new static build is downloaded.
  // The admin assertions remain outside the browser and see actual server data.
  await context.route(/^http:\/\/127\.0\.0\.1:8088\//,route=>route.abort());
  await publish(page);await page.clock.setSystemTime(new Date(Date.now()+61_000));
  await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('גרסה חדשה זמינה',{exact:true})).toBeVisible();
  expect(await documentId(page)).toBe(before);
  expect(await page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  expect(await listDocuments(root+'/vehicleExpenses')).toHaveLength(0);
  await activate(page);await expect(liters(page)).toHaveValue('40');await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
  await expectVersion(page,version);await page.goto('/vehicle');await startCareEditor(page,'expense');
  await expect(page.getByRole('dialog').getByLabel('תיאור',{exact:true})).toHaveValue('טיוטת חידוש ביטוח');
  await expect(page.getByRole('dialog').getByLabel('עלות כוללת',{exact:true})).toHaveValue('123');
  await page.getByRole('dialog').getByRole('button',{name:'סגירה',exact:true}).click();
  await page.goto('/fillup/new');await expect(liters(page)).toHaveValue('40');
  await expect(page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/)).toHaveValue('100000');
  expect(await getDocument(root+'/fillups/kept')).toEqual(existing);
  await context.unroute(/^http:\/\/127\.0\.0\.1:8088\//);await context.setOffline(true);await context.setOffline(false);
  await expect(async()=>{const rows=await listDocuments(root+'/vehicleExpenses');expect(rows).toHaveLength(1);expect(rows[0].data.costAgorot).toBe(2500);}).toPass({timeout:30000});
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);expect(await listDocuments(root+'/fillups')).toHaveLength(1);
});

test('manual checks report offline/current and can reopen a dismissed waiting update',async({page,context})=>{
  await signedInWithData(page,{fillups:[]});await expectVersion(page,'acceptance-before');await waitForServiceWorkerControl(page);
  await context.setOffline(true);await page.getByRole('button',{name:'בדיקת עדכון',exact:true}).click();
  await expect(page.getByText('חזרו לחיבור לאינטרנט כדי לבדוק עדכון.')).toBeVisible();await context.setOffline(false);
  await page.getByRole('button',{name:'בדיקת עדכון',exact:true}).click();await expect(page.getByText('לא נמצא עדכון חדש.')).toBeVisible();
  await publish(page);await page.getByRole('button',{name:'בדיקת עדכון',exact:true}).click();
  await expect(page.getByText('גרסה חדשה זמינה',{exact:true})).toBeVisible();await page.getByRole('button',{name:'אחר כך',exact:true}).click();
  await expect(page.getByRole('button',{name:'רענון',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'בדיקת עדכון',exact:true}).click();await expect(page.getByRole('button',{name:'רענון',exact:true})).toBeVisible();
  await activate(page);await expectVersion(page,version);
});

test('another tab activating an update cannot discard a draft whose disk write failed',async({page,context})=>{
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await waitForServiceWorkerControl(page);
  await page.evaluate(()=>{
    const state={broken:true};(window as unknown as {draftDisk:typeof state}).draftDisk=state;
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(state.broken&&key.startsWith('tm.fillup-draft.'))throw new Error('test disk unavailable');return original.call(this,key,value);};
  });
  await liters(page).fill('37');await expect(page.getByText(/לא ניתן לשמור טיוטה במכשיר/)).toBeVisible();
  // A native beforeunload dialog must not be what makes this test pass.
  page.on('dialog',dialog=>dialog.accept());
  const before=await documentId(page);
  await publish(page);const other=await context.newPage();await other.goto('/settings');
  await other.getByRole('button',{name:'בדיקת עדכון',exact:true}).click();
  await expect(other.getByRole('button',{name:'רענון',exact:true})).toBeVisible();await activate(other);
  await expect(page.getByText('סיימו את השמירה או שמרו את הטיוטה לפני הרענון.')).toBeVisible();
  expect(await documentId(page)).toBe(before);await expect(liters(page)).toHaveValue('37');
  await page.getByRole('button',{name:'רענון',exact:true}).click();expect(await documentId(page)).toBe(before);
  await page.evaluate(()=>{(window as unknown as {draftDisk:{broken:boolean}}).draftDisk.broken=false;});
  await liters(page).fill('38');await expect(page.getByText('טיוטה נשמרת במכשיר — אפשר לחזור ולהמשיך')).toBeVisible();
  await activate(page);await expect(liters(page)).toHaveValue('38');await expectVersion(page,version);
});
