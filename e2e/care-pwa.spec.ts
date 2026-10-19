import {expect,test} from '@playwright/test';
import {signedInWithData} from './helpers/app';
import {listDocuments} from './helpers/emulator';
import {waitForServiceWorkerControl,expectNetworkCut,outboxCount} from './helpers/pwa';
test('maintenance survives two real offline PWA restarts and syncs exactly once',async({page,context})=>{
  const scope=await signedInWithData(page,{fillups:[]});const path=`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`;
  await page.goto('/vehicle');await expect(page.getByRole('heading',{name:'הרכב שלי',exact:true})).toBeVisible();await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);
  await waitForServiceWorkerControl(page);await context.setOffline(true);
  const response=await page.reload();expect(response?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);
  await page.getByRole('button',{name:'הוספת הוצאה',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('שם הרשומה',{exact:true}).fill('חניה באופליין');await dialog.getByLabel('עלות כוללת',{exact:true}).fill('25');await dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);expect(await listDocuments(path)).toHaveLength(0);
  const restart=await page.reload();expect(restart?.fromServiceWorker()).toBe(true);await expectNetworkCut(page);
  await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await expect(page.getByRole('heading',{name:'חניה באופליין',exact:true})).toBeVisible();await expect.poll(()=>outboxCount(page,scope.uid)).toBe(1);
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
