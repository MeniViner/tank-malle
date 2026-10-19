import { expect,test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { setDocument,seedFillups,listDocuments } from './helpers/emulator';
import { receipt } from './helpers/receipt';
import { parseReceiptText,receiptHash } from '../src/lib/import/receiptText';

test('returning an edited cost to its original value cannot restore an intermediate draft',async({page})=>{
  const {uid,vehicleId}=await signedInWithData(page,{fillups:[]});
  await setDocument(`users/${uid}/vehicles/${vehicleId}/vehicleExpenses/original`,{schemaVersion:1,version:1,day:'2026-10-01',title:'ביטוח',category:'insurance',costAgorot:10000,notes:''});
  await page.goto('/vehicle');await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await page.getByRole('button',{name:'עריכה',exact:true}).click();
  const cost=page.getByLabel('עלות כוללת',{exact:true});await cost.fill('120');
  await expect.poll(()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('tm.care-draft.v1.')).length)).toBe(1);
  await cost.fill('100');await page.reload();await page.getByRole('button',{name:'היסטוריה',exact:true}).click();await page.getByRole('button',{name:'עריכה',exact:true}).click();
  await expect(page.getByLabel('עלות כוללת',{exact:true})).toHaveValue('100');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('tm.care-draft.v1.')))).toEqual([]);
});

test('re-extracting receipt text starts a fresh review of values, replacement, identity and uncertain matches',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});
  const candidate=parseReceiptText(receipt);
  await seedFillups(scope.uid,scope.vehicleId,[{id:'similar',date:new Date(`${candidate.day}T${candidate.time}:00+03:00`),odometer:100000,liters:40,pricePerLiter:7}]);
  await page.goto('/fillup/new');await page.getByLabel('ליטרים',{exact:true}).fill('30');
  await page.getByRole('button',{name:'ייבוא קבלה מקובץ או טקסט'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('טקסט הקבלה',{exact:true}).fill(receipt);await dialog.getByRole('button',{name:'חילוץ נתונים מהטקסט'}).click();
  await dialog.getByLabel('עלות הדלק ששולמה').fill('280.01');
  await dialog.getByText('מזהי מסמך למניעת כפילות',{exact:true}).click();
  // Identity hashing can temporarily hide the uncertain-match control.
  // Address controls by label and wait for each state, never snapshot indices.
  const confirmations=[/בדקתי את כל ארבעת המזהים/,/להחליף את הסכום/,/בדקתי: אלה ליטרים/,/תדלוקים דומים/];
  for(const name of confirmations)await dialog.getByRole('checkbox',{name}).check();
  await expect(dialog.getByRole('checkbox',{name:/תדלוקים דומים/})).toBeChecked();
  await dialog.getByRole('button',{name:'חילוץ נתונים מהטקסט'}).click();
  await expect(dialog.getByLabel('עלות הדלק ששולמה')).toHaveValue('280');
  for(const name of confirmations)await expect(dialog.getByRole('checkbox',{name})).not.toBeChecked();
  await dialog.getByRole('button',{name:'העברה לבדיקה בטופס'}).click();await expect(dialog.getByRole('alert')).toContainText('לאשר');
});

test('exact receipt identity blocks import before offering an uncertain duplicate override',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});const candidate=parseReceiptText(receipt);const identity=await receiptHash(receipt,candidate.identity,false);
  await seedFillups(scope.uid,scope.vehicleId,[{id:'receipt-existing',date:new Date(`${candidate.day}T${candidate.time}:00+03:00`),odometer:100000,liters:40,pricePerLiter:7}]);
  await setDocument(`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups/receipt-existing`,{...(await import('./helpers/emulator').then(m=>m.getDocument(`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups/receipt-existing`))),importRowHash:identity.hash,importBatchId:identity.textHash,importSource:identity.source});
  await page.goto('/fillup/new');await page.getByRole('button',{name:'ייבוא קבלה מקובץ או טקסט'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('טקסט הקבלה',{exact:true}).fill(receipt);await dialog.getByRole('button',{name:'חילוץ נתונים מהטקסט'}).click();
  await expect(dialog.getByRole('alert')).toContainText('כבר יובא');
  await expect(dialog.getByRole('checkbox',{name:/תדלוקים דומים/})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'העברה לבדיקה בטופס'})).toBeDisabled();
  expect(await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`)).toHaveLength(1);
});

test('the two supplied photographs advance automatically and populate the normal review form',async({page})=>{
  test.skip(!process.env.CARE_PUMP_PHOTO||!process.env.CARE_ODO_PHOTO,'Private photographs supplied through local environment paths only.');
  await signedInWithData(page,{fillups:[]});
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['blob:','data:'].includes(url.protocol)||['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort();});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  await page.evaluate(()=>{
    (window as any).__photoTimes={};(window as any).__photoStages=[];
    const decode=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=async function(){const start=performance.now();await decode.call(this);(window as any).__photoStages.push({stage:'decode',ms:Math.round(performance.now()-start)});};
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      started=0;
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',()=>{(window as any).__photoStages.push({stage:'worker',ms:Math.round(performance.now()-this.started)});});}
      postMessage(message:any,transfer:any){this.started=performance.now();super.postMessage(message,transfer);}
    };
    document.addEventListener('change',event=>{
      const label=(event.target as HTMLInputElement).getAttribute('aria-label');if(!label?.startsWith('תמונת '))return;
      const kind=label==='תמונת משאבה'?'pump':'odometer',start=performance.now();
      const observer=new MutationObserver(()=>{
        const done=kind==='pump'?document.body.textContent?.includes('המשאבה נקראה'):!document.querySelector('[role=dialog]');
        if(done){(window as any).__photoTimes[kind]=Math.round(performance.now()-start);observer.disconnect();}
      });observer.observe(document.body,{childList:true,subtree:true,attributes:true});
    },true);
  });
  const start=Date.now();await page.getByLabel('תמונת משאבה',{exact:true}).setInputFiles(process.env.CARE_PUMP_PHOTO!);
  await expect(page.getByText('המשאבה נקראה',{exact:true})).toBeVisible();const pumpMs=Date.now()-start;
  const odoStart=Date.now();await page.getByLabel('תמונת קילומטראז׳',{exact:true}).setInputFiles(process.env.CARE_ODO_PHOTO!);
  await expect(page.getByRole('dialog')).toHaveCount(0);const odoMs=Date.now()-odoStart;
  await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toHaveValue('202.73');
  await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('26.092');
  await expect(page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/)).toHaveValue('171272');
  console.info(`PHOTO_AUTOMATION_MS pump=${pumpMs} odometer=${odoMs}; CHANGE_TO_RENDER_MS ${JSON.stringify(await page.evaluate(()=>({render:(window as any).__photoTimes,stages:(window as any).__photoStages})))}`);
});


test('the guided care picker and details remain usable in light and dark phone and desktop layouts',async({page})=>{
  await signedInWithData(page,{fillups:[]});await page.goto('/vehicle');
  for(const colorScheme of ['light','dark'] as const)for(const width of [320,390,430,1280]) {
    await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:844});
    await page.getByRole('button',{name:'הוספת טיפול',exact:true}).click();const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('heading',{name:'מה בוצע ברכב?',exact:true})).toBeVisible();
    for(const name of ['צמיגים','בלמים']) {
      const choice=dialog.getByRole('button',{name,exact:true});const box=await choice.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(40);expect(box!.height).toBeGreaterThanOrEqual(40);await choice.click();
    }
    await dialog.getByRole('button',{name:'המשך לפרטי הטיפול',exact:true}).click();await expect(dialog.getByRole('button',{name:'שינוי סוג הרשומה'})).toContainText('צמיגים · בלמים');
    await expect(dialog.getByLabel('תיאור',{exact:true})).not.toBeVisible();await expect(dialog.getByLabel('עלות כוללת',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await dialog.getByRole('button',{name:'מחיקת הטיוטה',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'יציאה ללא שמירה',exact:true}).click();
  }
});


test('unreadable and corrupt photographs leave the manual path available without guessed values',async({page})=>{
  const sharp=(await import('sharp')).default;
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  const input=page.getByLabel('תמונת משאבה',{exact:true});
  const blank=await sharp({create:{width:640,height:480,channels:4,background:'#808080'}}).png().toBuffer();
  await input.setInputFiles({name:'unreadable.png',mimeType:'image/png',buffer:blank});await expect(page.getByText(/הספרות עדיין לא ברורות מספיק/)).toBeVisible();
  await input.setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});await expect(page.getByText(/התמונה לא נפתחה/)).toBeVisible();
  await page.getByRole('button',{name:'מעבר להזנה ידנית',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toHaveValue('');await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('');
});
