import { startCareEditor,setCareTitle,setExpenseKind } from './helpers/care';
import { expect,test,type Page } from '@playwright/test';
import { ALICE,BOB,signIn,signOut,signedInWithData } from './helpers/app';
import { getDocument,listDocuments,seedVehicle,setActiveVehicle,setDocument } from './helpers/emulator';
import { receipt,textPdf } from './helpers/receipt';
async function pasteReceipt(page:Page,text=receipt){
  await page.getByRole('button',{name:'ייבוא קבלה מקובץ או טקסט',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('טקסט הקבלה',{exact:true}).fill(text);await dialog.getByRole('button',{name:'חילוץ נתונים מהטקסט'}).click();
  await dialog.getByRole('checkbox',{name:/בדקתי: אלה ליטרים/}).check();return dialog;
}
test('maintenance draft survives reload, vehicle switching and account switching',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});
  await page.goto('/vehicle');await startCareEditor(page,'service');
  await setCareTitle(page,'טיוטת טיפול פרטית');await page.getByLabel('עלות כוללת',{exact:true}).fill('12.');
  await page.reload();await startCareEditor(page,'service');
  await expect(page.getByLabel('תיאור',{exact:true})).toHaveValue('טיוטת טיפול פרטית');await expect(page.getByLabel('עלות כוללת',{exact:true})).toHaveValue('12.');
  await seedVehicle(scope.uid,'v2',{make:'טויוטה',model:'שני'});await setActiveVehicle(scope.uid,'v2');await expect(page.getByRole('dialog')).toHaveCount(0);
  await startCareEditor(page,'service');await expect(page.getByLabel('תיאור',{exact:true})).toHaveValue('טיפול תקופתי');
  await page.goto('/');await signOut(page);await signIn(page,BOB);
  expect(await page.locator('body').innerText()).not.toContain('טיוטת טיפול פרטית');
  await signOut(page);await signIn(page,ALICE);await setActiveVehicle(scope.uid,scope.vehicleId);await page.goto('/vehicle');await expect(page.getByText('מאזדה 3',{exact:true}).first()).toBeVisible();await startCareEditor(page,'service');
  await expect(page.getByLabel('תיאור',{exact:true})).toHaveValue('טיוטת טיפול פרטית');
});
test('refunds reduce costs and unknown amounts remain explicit beyond the first history page',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await Promise.all(Array.from({length:55},(_,i)=>setDocument(`${base}/vehicleExpenses/e${i}`,{schemaVersion:1,version:1,day:'2026-10-01',title:`הוצאה ${i}`,category:'other',costAgorot:i===0?null:10000,notes:''})));
  await page.goto('/vehicle');await startCareEditor(page,'expense');await setCareTitle(page,'החזר');await page.getByLabel('עלות כוללת',{exact:true}).fill('40');await setExpenseKind(page,'החזר / זיכוי');await page.getByRole('button',{name:'שמירת הוצאה לרכב'}).click();
  await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await expect(page.getByRole('button',{name:/הצגת רשומות נוספות/})).toBeVisible();
  await page.getByRole('button',{name:'עלויות',exact:true}).click();await expect(page.getByTestId('care-total')).toContainText('5,360');await expect(page.getByText(/1 רשומות ללא עלות/)).toBeVisible();
  await page.context().setOffline(true);await expect(page.getByText(/הסיכום עדיין חלקי/)).toBeVisible();await page.context().setOffline(false);
});
test('device A offline care write cannot resurrect a vehicle deleted on device B',async({page,browser,baseURL})=>{
  const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await seedVehicle(scope.uid,'survivor',{make:'טויוטה',model:'אחר'});
  await page.goto('/vehicle');await expect(page.getByRole('heading',{name:'הרכב שלי',exact:true})).toBeVisible();await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);await page.context().setOffline(true);
  await startCareEditor(page,'expense');await setCareTitle(page,'ממתין במכשיר א');await page.getByLabel('עלות כוללת',{exact:true}).fill('50');await page.getByRole('button',{name:'שמירת הוצאה לרכב'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const context=await browser.newContext({baseURL,serviceWorkers:'block'});const second=await context.newPage();
  try {
    await signIn(second,ALICE);await setActiveVehicle(scope.uid,'survivor');
    await setDocument(base,{make:'מאזדה',model:'3',fuelType:'95',archived:true,priceAdjustment:0});
    await second.goto('/settings/vehicles');await second.getByRole('button',{name:'מחיקה',exact:true}).click();await second.getByRole('alertdialog').getByRole('button',{name:'מחיקה',exact:true}).click();
    await expect(async()=>expect(await getDocument(base)).toBeNull()).toPass();
    await page.context().setOffline(false);await page.goto('/settings/unsynced');
    await expect(page.locator('[data-outbox-op]').filter({hasText:'שמירת תחזוקת רכב'})).toBeVisible();
    await expect(async()=>expect(await listDocuments(`${base}/vehicleExpenses`)).toHaveLength(0)).toPass();
    expect(await getDocument(base)).toBeNull();
  } finally {await context.close();await page.context().setOffline(false);}
});
test('receipt uses durable offline writes, retains identity after edit and rejects repeated import',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await page.goto('/fillup/new');let dialog=await pasteReceipt(page);await dialog.getByText('מזהי מסמך למניעת כפילות',{exact:true}).click();await dialog.getByRole('checkbox',{name:'בדקתי את כל ארבעת המזהים מול המסמך'}).check();await dialog.getByRole('button',{name:'העברה לבדיקה בטופס'}).click();await expect(dialog).toHaveCount(0);
  await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('100000');await page.reload();await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('40');
  await page.context().setOffline(true);await page.getByRole('button',{name:/שמירת תדלוק/}).click();await expect(page).toHaveURL('/');expect(await listDocuments(path)).toHaveLength(0);
  await page.context().setOffline(false);await expect(async()=>expect(await listDocuments(path)).toHaveLength(1)).toPass();
  const first=(await listDocuments(path))[0];expect(first.id).toMatch(/^receipt-[a-f0-9]{64}$/);expect(JSON.stringify(first.data)).not.toContain('PRIVATE-ISSUER');expect(first.data.fillEndState).not.toBe('full');
  await page.goto(`/fillup/${first.id}`);await page.getByLabel('סה״כ לתשלום',{exact:true}).fill('281');await page.getByRole('button',{name:/שמירת/}).last().click();
  await expect(async()=>expect((await getDocument(`${path}/${first.id}`))?.totalCost).toBe(281)).toPass();
  await page.goto('/fillup/new');dialog=await pasteReceipt(page);await expect(dialog.getByRole('alert')).toContainText('כבר יובא');await expect(dialog.getByRole('button',{name:'העברה לבדיקה בטופס'})).toBeDisabled();expect(await listDocuments(path)).toHaveLength(1);
  await dialog.getByRole('button',{name:'חזרה לטופס',exact:true}).click();
  dialog=await pasteReceipt(page,receipt.replace('Fuel total: 280','Fuel total: 282'));await dialog.getByText('מזהי מסמך למניעת כפילות',{exact:true}).click();await dialog.getByRole('checkbox',{name:'בדקתי את כל ארבעת המזהים מול המסמך'}).check();await expect(dialog.getByRole('alert')).toContainText('כבר יובא');await expect(dialog.getByRole('button',{name:'העברה לבדיקה בטופס'})).toBeDisabled();
  await seedVehicle(scope.uid,'other',{make:'טויוטה',model:'שני'});await setActiveVehicle(scope.uid,'other');await expect(page.getByRole('dialog')).toHaveCount(0);
  dialog=await pasteReceipt(page);await dialog.getByRole('button',{name:'העברה לבדיקה בטופס'}).click();await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('200000');await page.getByRole('button',{name:/שמירת תדלוק/}).click();await expect(async()=>expect(await listDocuments(`users/${scope.uid}/vehicles/other/fillups`)).toHaveLength(1)).toPass();expect(await listDocuments(path)).toHaveLength(1);

});
test('import protects authored values and candidate disappears on vehicle/account change',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByLabel('ליטרים',{exact:true}).fill('33');
  let dialog=await pasteReceipt(page);await dialog.getByRole('button',{name:'העברה לבדיקה בטופס'}).click();await expect(dialog.getByRole('alert')).toContainText('לאשר');
  await dialog.getByRole('button',{name:'חזרה לטופס',exact:true}).click();await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('33');
  dialog=await pasteReceipt(page);await seedVehicle(scope.uid,'other',{make:'שני',model:'רכב'});await setActiveVehicle(scope.uid,'other');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('');
  await pasteReceipt(page);await page.goto('/');await signOut(page);await signIn(page,BOB);expect(await page.locator('body').innerText()).not.toContain('PRIVATE-ISSUER');
});
test('local PDF text extraction works without network PDF/OCR and credit documents cannot import fuel',async({page})=>{
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:'ייבוא קבלה מקובץ או טקסט'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('קובץ קבלה PDF').setInputFiles({name:'synthetic-text.pdf',mimeType:'application/pdf',buffer:textPdf(receipt.split('\n'))});
  await expect(dialog.getByLabel('עלות הדלק ששולמה')).toHaveValue('280');await expect(dialog.getByLabel('ליטרים בקבלה')).toHaveValue('40');
  await dialog.getByLabel('טקסט הקבלה').fill(receipt+'\nCredit note');await dialog.getByRole('button',{name:'חילוץ נתונים מהטקסט'}).click();await expect(dialog.getByRole('alert')).toContainText('זיכוי');await expect(dialog.getByRole('button',{name:'העברה לבדיקה בטופס'})).toHaveCount(0);
  await dialog.getByLabel('קובץ קבלה PDF').setInputFiles({name:'image-only.pdf',mimeType:'application/pdf',buffer:textPdf([])});await expect(dialog.getByRole('alert')).toContainText('אין בקובץ טקסט');
});
test('one scan step can be skipped and partial results reach the manual form',async({page})=>{
  const sharp=(await import('sharp')).default;const {demoPhoto}=await import('../src/lib/scan/fixtures');const pixels=demoPhoto('odometer');const image=await sharp(Buffer.from(pixels.data),{raw:{width:pixels.width,height:pixels.height,channels:4}}).png().toBuffer();
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();await page.getByRole('button',{name:'דילוג לקילומטראז׳'}).click();
  await page.getByLabel('תמונת קילומטראז׳',{exact:true}).setInputFiles({name:'odo.png',mimeType:'image/png',buffer:image});await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/)).toHaveValue('128450');await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('');
});

test('recovered maintenance edit keeps its original version after another device changes it',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses/insurance`;
  const record={schemaVersion:1,version:1,day:'2026-10-01',title:'ביטוח',category:'insurance',costAgorot:10000,notes:''};await setDocument(path,record);
  await page.goto('/vehicle');await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await page.getByRole('button',{name:'עריכה',exact:true}).click();await page.getByLabel('עלות כוללת',{exact:true}).fill('120');await page.reload();
  await setDocument(path,{...record,version:2,costAgorot:15000});await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await expect(page.getByText('150.00',{exact:false}).first()).toBeVisible();await page.getByRole('button',{name:'עריכה',exact:true}).click();await expect(page.getByLabel('עלות כוללת',{exact:true})).toHaveValue('120');
  await page.getByRole('button',{name:'שמירת הוצאה לרכב'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.goto('/settings/unsynced');await expect(page.locator('[data-outbox-op]').filter({hasText:'שמירת תחזוקת רכב'})).toBeVisible();expect((await getDocument(path))?.costAgorot).toBe(15000);
});
