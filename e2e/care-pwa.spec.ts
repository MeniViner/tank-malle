import { openCareHistory } from "./helpers/care";
import {startCareEditor,setCareTitle} from './helpers/care';
import {expect,test} from '@playwright/test';
import {ALICE,signIn,signOut,signedInWithData} from './helpers/app';
import {PROJECT_ID,getDocument,listDocuments} from './helpers/emulator';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {waitForServiceWorkerControl,expectNetworkCut,outboxCount} from './helpers/pwa';
import {holdFirestoreDisk,waitForDiskAttempt,releaseFirestoreDisk} from './helpers/disk';
test('an admin price save remains protected until the SDK disk accepts it, then survives an offline restart',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[],regulatedPrice:7.31});
  process.env.FIREBASE_AUTH_EMULATOR_HOST=`127.0.0.1:${process.env.CARE_AUTH_PORT??'9099'}`;
  const app=initializeApp({projectId:PROJECT_ID},'admin-disk-'+Date.now());await getAuth(app).setCustomUserClaims(scope.uid,{admin:true});await deleteApp(app);
  await signOut(page);await signIn(page,ALICE);await page.goto('/admin');await waitForServiceWorkerControl(page);
  await page.getByRole('button',{name:'נתונים',exact:true}).click();await page.getByRole('button',{name:'עריכת מחיר · בנזין 95',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('מחיר חדש לליטר · בנזין 95').fill('8.16');await context.setOffline(true);
  await holdFirestoreDisk(page);await dialog.getByRole('button',{name:'שמירה',exact:true}).click();await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);await waitForDiskAttempt(page);
  // Outbox persistence alone must not unlock closing/reloading the editor.
  await expect(dialog.getByRole('button',{name:'שמירה',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await expect(dialog).toBeVisible();
  await releaseFirestoreDisk(page);await expect(dialog.getByText('נשמר במכשיר · ממתין לאישור השרת',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await expect(dialog).toHaveCount(0);
  const response=await page.reload();expect(response?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);await context.setOffline(false);
  await expect.poll(async()=>((await getDocument('appConfig/fuelPrices'))?.byFuelType as Record<string,Record<string,Record<string,unknown>>>)?.['95']?.self?.current).toMatchObject({pricePerLiter:8.16});await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);
  await page.goto('/fillup/new');await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('8.16');
});
test('maintenance survives two real offline PWA restarts and syncs exactly once',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`;
  await page.goto('/vehicle');await expect(page.getByRole('heading',{name:'הרכב שלי',exact:true})).toBeVisible();await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);
  await waitForServiceWorkerControl(page);await context.setOffline(true);
  const response=await page.reload();expect(response?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);
  await startCareEditor(page,'expense');const dialog=page.getByRole('dialog');
  await setCareTitle(page,'חניה באופליין');await dialog.getByLabel('עלות כוללת',{exact:true}).fill('25');await dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);expect(await listDocuments(path)).toHaveLength(0);
  const restart=await page.reload();expect(restart?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);
  await openCareHistory(page);await expect(page.getByRole('heading',{name:'חניה באופליין',exact:true})).toBeVisible();await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
  await context.setOffline(false);await expect(async()=>{const rows=await listDocuments(path);expect(rows).toHaveLength(1);expect(rows[0].data.costAgorot).toBe(2500);}).toPass({timeout:30000});await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);
});


test('PDF worker and receipt draft survive offline PWA reload before exact-once delivery',async({page,context})=>{
  const {receipt,textPdf}=await import('./helpers/receipt');
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await page.goto('/fillup/new');await waitForServiceWorkerControl(page);await context.setOffline(true);
  await page.reload();await expectNetworkCut(page);
  await page.getByRole('button',{name:'ייבוא קבלה מקובץ או טקסט'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('קובץ קבלה PDF').setInputFiles({name:'synthetic-offline.pdf',mimeType:'application/pdf',buffer:textPdf(receipt.split('\n'))});
  await expect(dialog.getByLabel('ליטרים בקבלה')).toHaveValue('40');await dialog.getByRole('checkbox',{name:/בדקתי: אלה ליטרים/}).check();await dialog.getByRole('button',{name:'העברה לבדיקה בטופס'}).click();
  await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('100000');
  const restarted=await page.reload();expect(restarted?.fromServiceWorker()).toBe(true);await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('40');
  expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('PRIVATE-ISSUER')))).toBe(false);
  await page.getByRole('button',{name:/שמירת תדלוק/}).click();await expect(page).toHaveURL('/');await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
  await page.reload();await context.setOffline(false);await expect(async()=>expect(await listDocuments(path)).toHaveLength(1)).toPass({timeout:30000});await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);
});


test('automatic display worker is available after the first offline PWA restart',async({page,context})=>{
  const sharp=(await import('sharp')).default;const {demoPhoto}=await import('../src/lib/scan/fixtures');
  const png=async(kind:string)=>{const image=demoPhoto(kind);return sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer();};
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await waitForServiceWorkerControl(page);
  await context.setOffline(true);const response=await page.reload();expect(response?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);
  await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();await page.getByLabel('תמונת משאבה',{exact:true}).setInputFiles({name:'pump.png',mimeType:'image/png',buffer:await png('pump')});
  await expect(page.getByText('המשאבה נקראה',{exact:true})).toBeVisible();await page.getByLabel('תמונת קילומטראז׳',{exact:true}).setInputFiles({name:'odo.png',mimeType:'image/png',buffer:await png('odometer')});
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toHaveValue('287.40');await expect(page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/)).toHaveValue('128450');
});

test('an offline save waits for the Firestore disk transaction before allowing an immediate restart',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[]});
  const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`;
  await page.goto('/fillup/new');await waitForServiceWorkerControl(page);
  await context.setOffline(true);await page.reload();await expectNetworkCut(page);
  await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('100000');
  await page.getByLabel('ליטרים',{exact:true}).fill('40');
  await page.getByLabel('מחיר לליטר',{exact:true}).fill('8');
  // Hold only this disposable context's Firestore database. The separate
  // outbox can commit while the SDK's disk transaction is still blocked.
  await holdFirestoreDisk(page);
  await page.getByRole('button',{name:/שמירת תדלוק/}).click();
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
  await waitForDiskAttempt(page);
  await expect(page).toHaveURL('/fillup/new');
  await expect(page.getByRole('button',{name:'שמירת תדלוק',exact:true})).toBeDisabled();
  await releaseFirestoreDisk(page);
  await expect(page).toHaveURL('/');
  const response=await page.reload();expect(response?.fromServiceWorker()).toBe(true);
  await context.setOffline(false);
  await expect(async()=>{const rows=await listDocuments(path);expect(rows).toHaveLength(1);expect(rows[0].data.liters).toBe(40);}).toPass({timeout:30000});
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);
});

test('maintenance also waits for a durable SDK write before closing the editor',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`;
  await page.goto('/vehicle');await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);await waitForServiceWorkerControl(page);
  await context.setOffline(true);await page.reload();await startCareEditor(page,'expense');
  await setCareTitle(page,'שמירה בטוחה');const dialog=page.getByRole('dialog');await dialog.getByLabel('עלות כוללת',{exact:true}).fill('25');
  await holdFirestoreDisk(page);await dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);await waitForDiskAttempt(page);
  await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true})).toBeDisabled();
  await releaseFirestoreDisk(page);await expect(dialog).toHaveCount(0);
  await page.reload();await context.setOffline(false);
  await expect(async()=>{const rows=await listDocuments(path);expect(rows).toHaveLength(1);expect(rows[0].data.costAgorot).toBe(2500);}).toPass({timeout:30000});
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(0);
});
