import { openCareHistory,openCareRecord,openCareCosts } from "./helpers/care";
import { startCareEditor,setCareTitle,addCareJob } from './helpers/care';
import { expect,test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { listDocuments } from './helpers/emulator';

test('two-photo flow offers manual entry in the normal review form without saving early',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  await page.getByRole('button',{name:'מעבר להזנה ידנית',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('סה״כ לתשלום',{exact:true}).fill('287.40');await page.getByLabel('ליטרים',{exact:true}).fill('40');await page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/).fill('128450');
  await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7.185');expect(await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`)).toHaveLength(0);
  await page.getByRole('button',{name:/שמירת תדלוק/}).click();
  await expect(async()=>{const rows=await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/fillups`);expect(rows).toHaveLength(1);expect(rows[0].data).toMatchObject({odometer:128450,liters:40,totalCost:287.4,pricePerLiter:7.185});}).toPass();
});

test('service invoice, recurring reminder and costs persist independently of fuel',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await page.goto('/vehicle'); await startCareEditor(page,'plan');
  let dialog=page.getByRole('dialog');
  await setCareTitle(page,'טיפול שמן');
  await dialog.getByLabel('יעד קילומטראז׳',{exact:true}).fill('130000');
  await dialog.getByRole('checkbox',{name:/תזכורת חוזרת/}).check();await dialog.getByLabel('חזרה כל מספר ק״מ',{exact:true}).fill('10000');
  await dialog.getByRole('button',{name:'שמירת תזכורת לטיפול',exact:true}).click();
  await expect(async()=>expect(await listDocuments(`${base}/maintenancePlans`)).toHaveLength(1)).toPass();
  await page.getByRole('link',{name:/טיפול שמן/}).first().click();await page.getByRole('button',{name:'רישום טיפול שבוצע',exact:true}).click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('קילומטראז׳ בעת הביצוע',{exact:true}).fill('130200');
  await dialog.getByLabel('עלות כוללת',{exact:true}).fill('800');
  await addCareJob(page,'צמיגים');
  await dialog.getByRole('button',{name:'שמירת טיפול שבוצע',exact:true}).click();
  await expect(async()=>{const rows=await listDocuments(`${base}/serviceEvents`);expect(rows).toHaveLength(1);expect(rows[0].data.costAgorot).toBe(80000);}).toPass();
  await expect(page.getByText('140,200 ק״מ',{exact:false})).toBeVisible();
  await openCareCosts(page);await expect(page.getByTestId('running-total')).toContainText('800');
  await page.reload();await openCareHistory(page);await expect(page.getByRole('heading',{name:'טיפול שמן',exact:true})).toBeVisible();
  expect(await listDocuments(`${base}/fillups`)).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('offline creation is journaled, visible and delivered once after reconnect',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]}); const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await page.goto('/vehicle'); await expect(page.getByRole('heading',{name:'הרכב שלי',exact:true})).toBeVisible(); await expect(page.getByText('טוענים את נתוני הרכב…')).toHaveCount(0);
  await page.context().setOffline(true);
  await startCareEditor(page,'expense');
  const dialog=page.getByRole('dialog'); await setCareTitle(page,'הוצאה אופליין');await dialog.getByLabel('עלות כוללת',{exact:true}).fill('123.45');
  await dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();
  await openCareHistory(page);await expect(page.getByRole('heading',{name:'הוצאה אופליין',exact:true})).toBeVisible();
  expect(await listDocuments(`${base}/vehicleExpenses`)).toHaveLength(0);
  await page.context().setOffline(false);
  await expect(async()=>{const rows=await listDocuments(`${base}/vehicleExpenses`);expect(rows).toHaveLength(1);expect(rows[0].data.costAgorot).toBe(12345);}).toPass();
  await page.reload();await openCareHistory(page);await expect(page.getByRole('heading',{name:'הוצאה אופליין',exact:true})).toBeVisible();
});

test('stale edits retain input and explicit conflict resolution advances the version',async({page})=>{
  const { setDocument,getDocument }=await import('./helpers/emulator');
  const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const data={schemaVersion:1,version:1,title:'ביטוח',day:'2026-10-01',category:'insurance',costAgorot:10000,notes:''};
  await setDocument(`${base}/vehicleExpenses/insurance`,data);
  await page.goto('/vehicle');await openCareHistory(page);
  await openCareRecord(page);
  await page.getByRole('dialog').getByLabel('עלות כוללת',{exact:true}).fill('120');
  await setDocument(`${base}/vehicleExpenses/insurance`,{...data,version:2,costAgorot:15000});
  await page.getByRole('dialog').getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/settings/unsynced');
  const row=page.locator('[data-outbox-op]').filter({hasText:'שמירת תחזוקת רכב'});
  await expect(row).toBeVisible();
  if (await row.getByRole('button',{name:/ניסיון חוזר/}).count()) await row.getByRole('button',{name:/ניסיון חוזר/}).click();
  await expect(row).toHaveAttribute('data-outbox-status','conflict');
  expect((await getDocument(`${base}/vehicleExpenses/insurance`))?.costAgorot).toBe(15000);
  await row.getByRole('button',{name:'לדרוס עם הגרסה שלי',exact:true}).click();
  await expect(async()=>expect(await getDocument(`${base}/vehicleExpenses/insurance`)).toMatchObject({costAgorot:12000,version:3})).toPass();
  await expect(row).toHaveCount(0);
});

test('synthetic pixel selection advances both steps while preserving manually authored values',async({page})=>{
  const sharp=(await import('sharp')).default;const {demoPhoto}=await import('../src/lib/scan/fixtures');
  const png=async(kind:string)=>{const image=demoPhoto(kind);return sharp(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer();};
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByLabel('סה״כ לתשלום',{exact:true}).fill('280');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  await page.getByLabel('תמונת משאבה',{exact:true}).setInputFiles({name:'pump.png',mimeType:'image/png',buffer:await png('pump')});await expect(page.getByText('המשאבה נקראה',{exact:true})).toBeVisible();
  await page.getByLabel('תמונת קילומטראז׳',{exact:true}).setInputFiles({name:'odo.png',mimeType:'image/png',buffer:await png('odometer')});await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toHaveValue('280');await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue('40.000');await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('7');
  expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('data:image')))).toBe(false);
});

test('camera denial offers manual entry and a late permission result is stopped after closing',async({page})=>{
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  const dialog=page.getByRole('dialog');
  await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('denied','NotAllowedError');}});});
  await dialog.getByRole('button',{name:'פתיחת מצלמה',exact:true}).click();await expect(dialog.getByText(/המצלמה לא זמינה/)).toBeVisible();
  await dialog.getByRole('button',{name:'סגירת מצלמה',exact:true}).click();
  await page.evaluate(()=>{(window as any).__stopped=false;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(resolve=>{(window as any).__release=()=>resolve({getTracks:()=>[{stop:()=>{(window as any).__stopped=true;}}]});})});});
  await dialog.getByRole('button',{name:'פתיחת מצלמה',exact:true}).click();await expect(dialog.getByText('פותחים מצלמה…')).toBeVisible();
  await dialog.getByRole('button',{name:'סגירת מצלמה',exact:true}).click();await page.evaluate(()=>(window as any).__release());
  await expect.poll(()=>page.evaluate(()=>(window as any).__stopped)).toBe(true);
  await dialog.getByRole('button',{name:'מעבר להזנה ידנית',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toBeVisible();
});

test('backup import deduplicates, CSV and date calendar export work on mobile',async({page})=>{
  const scope=await signedInWithData(page,{fillups:[]});
  const {careBackup}=await import('../src/lib/maintenance/export');const {EMPTY_CARE}=await import('../src/lib/maintenance/model');
  const records={...EMPTY_CARE,vehicleExpenses:[{id:'restore-insurance',schemaVersion:1 as const,version:4,title:'ביטוח מגיבוי',day:'2026-10-01',category:'insurance' as const,costAgorot:45000,notes:''}],maintenancePlans:[{id:'restore-plan',schemaVersion:1 as const,version:2,title:'טסט שנתי',job:'custom' as const,dueDay:'2027-10-19',dueOdometer:null,intervalMonths:12,intervalKm:null,basis:'fixed' as const,source:'owner' as const,active:true,notes:''}]};
  const buffer=Buffer.from(careBackup({id:scope.vehicleId,label:'מאזדה 3'},records,false));
  await page.goto('/vehicle');await page.goto('/settings/profile');await page.getByRole('button',{name:/^גיבוי וייצוא תחזוקה/}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('קובץ גיבוי תחזוקה').setInputFiles({name:'backup.json',mimeType:'application/json',buffer});
  await expect(dialog.getByText(/2 רשומות חדשות/)).toBeVisible();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'ייבוא הרשומות החדשות',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('2 רשומות יובאו ואושרו בשרת');
  await dialog.getByLabel('קובץ גיבוי תחזוקה').setInputFiles({name:'backup.json',mimeType:'application/json',buffer});await expect(dialog.getByText(/0 רשומות חדשות · 2 כבר קיימות/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:'ייבוא הרשומות החדשות',exact:true})).toBeDisabled();
  const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'הורדת גיבוי JSON',exact:true}).click()]);expect(download.suggestedFilename()).toBe('tank-maleh-care.json');
  const [csv]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'ייצוא עלויות CSV',exact:true}).click()]);expect(csv.suggestedFilename()).toBe('tank-maleh-care-costs.csv');
  await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.goto('/vehicle');await page.getByRole('link',{name:/טסט שנתי/}).click();
  const [calendar]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'הוספה ליומן המכשיר ↓',exact:true}).click()]);expect(calendar.suggestedFilename()).toBe('tank-maleh-reminder.ics');
  expect(await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`)).toHaveLength(1);
  for(const width of [320,390,430,820]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});

for(const fixture of ['synthetic','supplied'] as const)test(`live scanning reads two ${fixture} displays automatically and stops every stream`,async({page,browserName})=>{
  test.skip(fixture==='supplied'&&(!process.env.CARE_PUMP_PHOTO||!process.env.CARE_ODO_PHOTO),'Private local photographs required.');
  test.skip(browserName!=='chromium','canvas.captureStream fixture is Chromium-only; this is not a physical camera test');
  const sharp=(await import('sharp')).default;const {demoPhoto}=await import('../src/lib/scan/fixtures');
  const urls=await Promise.all(['pump','odometer'].map(async kind=>{const raw=demoPhoto(kind);const source=fixture==='supplied'?sharp((kind==='pump'?process.env.CARE_PUMP_PHOTO:process.env.CARE_ODO_PHOTO)!).rotate():sharp(Buffer.from(raw.data),{raw:{width:raw.width,height:raw.height,channels:4}});return 'data:image/png;base64,'+(await source.png().toBuffer()).toString('base64');}));
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  await page.evaluate(async urls=>{
    const images=await Promise.all(urls.map(async url=>{const image=new Image();image.src=url;await image.decode();return image;}));(window as any).__cameras=[];
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
      const image=images[document.querySelector('input[aria-label="תמונת משאבה"]')?0:1],canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const stream=canvas.captureStream(5);(window as any).__cameras.push(stream);
      const draw=()=>canvas.getContext('2d')!.drawImage(image,0,0);draw();const timer=setInterval(()=>{if(stream.active)draw();else clearInterval(timer);},100);return stream;
    }});
  },urls);
  await page.getByRole('dialog').getByRole('button',{name:'פתיחת מצלמה',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('סה״כ לתשלום',{exact:true})).toHaveValue(fixture==='supplied'?'202.73':'287.40');await expect(page.getByLabel('ליטרים',{exact:true})).toHaveValue(fixture==='supplied'?'26.092':'40.000');await expect(page.getByLabel(/^קילומטראז׳ (נוכחי|בתאריך זה)$/)).toHaveValue(fixture==='supplied'?'171272':'128450');
  expect(await page.evaluate(()=>(window as any).__cameras.length)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(()=>(window as any).__cameras.every((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
});

test('editing and deleting a service recalculates costs and the linked deadline',async({page})=>{
  const {setDocument,getDocument}=await import('./helpers/emulator');const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(`${base}/maintenancePlans/oil`,{schemaVersion:1,version:1,title:'שמן תקופתי',job:'oil',dueDay:null,dueOdometer:100000,intervalMonths:null,intervalKm:10000,basis:'completion',source:'owner',notes:'',active:true});
  await setDocument(`${base}/serviceEvents/service`,{schemaVersion:1,version:1,title:'טיפול ראשון',day:'2026-10-01',jobs:['oil'],odometer:100000,costAgorot:70000,garage:'',notes:'',completedPlanIds:['oil']});
  await page.goto('/vehicle');await expect(page.getByText('110,000 ק״מ',{exact:true})).toBeVisible();
  await openCareHistory(page);await openCareRecord(page);const dialog=page.getByRole('dialog');
  await dialog.getByLabel('עלות כוללת',{exact:true}).fill('900');await dialog.getByLabel('קילומטראז׳ בעת הביצוע',{exact:true}).fill('101000');await dialog.getByRole('button',{name:'שמירת טיפול שבוצע',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(async()=>expect(await getDocument(`${base}/serviceEvents/service`)).toMatchObject({version:2,costAgorot:90000,odometer:101000})).toPass();
  await page.getByRole('navigation').getByRole('link',{name:'רכב',exact:true}).click();await expect(page.getByText('111,000 ק״מ',{exact:true})).toBeVisible();
  await openCareHistory(page);await openCareRecord(page,'delete');await page.getByRole('alertdialog').getByRole('button',{name:'מחיקת הרשומה',exact:true}).click();await expect(async()=>expect(await getDocument(`${base}/serviceEvents/service`)).toBeNull()).toPass();
  await page.getByRole('navigation').getByRole('link',{name:'רכב',exact:true}).click();await expect(page.getByText('100,000 ק״מ',{exact:true})).toBeVisible();
  await openCareCosts(page);await expect(page.getByTestId('running-total')).toContainText('₪0');
});

test('unavailable journal storage leaves input in the editor and sends no care record',async({page})=>{
  await page.addInitScript(()=>{const original=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name:string,version?:number){if(name==='tm-outbox')throw new DOMException('simulated storage unavailable','QuotaExceededError');return original.call(this,name,version);};});
  const scope=await signedInWithData(page,{fillups:[]});await page.goto('/vehicle');await startCareEditor(page,'expense');const dialog=page.getByRole('dialog');await setCareTitle(page,'קלט שנשמר בטופס');await dialog.getByLabel('עלות כוללת',{exact:true}).fill('80');await dialog.getByRole('button',{name:'שמירת הוצאה לרכב',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('אחסון הפעולות המקומי אינו זמין');await expect(dialog.getByLabel('תיאור',{exact:true})).toHaveValue('קלט שנשמר בטופס');expect(await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`)).toHaveLength(0);
});

test('vehicle switching isolates care and deleting a vehicle removes all care, issue and notification collections',async({page})=>{
  const {setDocument,seedVehicle,setActiveVehicle,getDocument}=await import('./helpers/emulator');const scope=await signedInWithData(page,{fillups:[]});const base=`users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(`${base}/vehicleExpenses/e`,{schemaVersion:1,version:1,title:'הוצאה לרכב הראשון',day:'2026-10-01',category:'insurance',costAgorot:70000,notes:''});
  await setDocument(`${base}/maintenancePlans/p`,{schemaVersion:1,version:1,title:'בדיקה',job:'custom',dueDay:'2027-01-01',dueOdometer:null,intervalMonths:null,intervalKm:null,basis:'manual',source:'owner',active:true,notes:''});
  await setDocument(`${base}/odometerReadings/r`,{schemaVersion:1,version:1,day:'2026-10-01',odometer:100000,notes:''});
  await setDocument(`${base}/serviceEvents/s`,{schemaVersion:1,version:1,title:'טיפול',day:'2026-10-01',jobs:['oil'],odometer:100000,costAgorot:50000,garage:'',notes:'',completedPlanIds:[]});
  await setDocument(`${base}/vehicleIssues/issue`,{schemaVersion:1,version:1,day:'2026-10-01',title:'תקלה',symptoms:'',odometer:null,importance:'normal',status:'open',notes:'',serviceEventIds:[],history:[]});await setDocument(`${base}/notificationStates/n`,{schemaVersion:1,version:1,occurrence:'test',read:true,archived:true,snoozeUntilDay:null});
  await seedVehicle(scope.uid,'v2',{make:'טויוטה',model:'שני'});await page.goto('/vehicle');await openCareHistory(page);await expect(page.getByRole('heading',{name:'הוצאה לרכב הראשון',exact:true})).toBeVisible();
  await setActiveVehicle(scope.uid,'v2');await expect(page.getByText('טויוטה שני',{exact:false}).first()).toBeVisible();await openCareHistory(page);await expect(page.getByRole('heading',{name:'הוצאה לרכב הראשון',exact:true})).toHaveCount(0);
  await setDocument(`users/${scope.uid}/vehicles/${scope.vehicleId}`,{make:'מאזדה',model:'3',fuelType:'95',archived:true,priceAdjustment:0});
  await page.goto('/settings/vehicles');await page.getByRole('button',{name:'מחיקה',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:/מחק|מחיק/}).click();
  await expect(async()=>{expect(await getDocument(base)).toBeNull();for(const name of ['serviceEvents','maintenancePlans','vehicleExpenses','odometerReadings','vehicleIssues','notificationStates'])expect(await listDocuments(`${base}/${name}`)).toHaveLength(0);}).toPass();
  expect(await getDocument(`users/${scope.uid}/vehicles/v2`)).not.toBeNull();
});

test('a pending camera result cannot reopen the camera after the page goes to the background',async({page,browserName})=>{
  test.skip(browserName!=='chromium','canvas.captureStream lifecycle fixture is Chromium-only');
  await signedInWithData(page,{fillups:[]});await page.goto('/fillup/new');await page.getByRole('button',{name:/הוספה בשני צילומים/}).click();
  await page.evaluate(()=>{
    (window as any).__deliver=[];(window as any).__cameras=[];
    window.Worker=class {
      onmessage:any;onerror:any;
      postMessage(){(window as any).__deliver.push(()=>this.onmessage?.({data:{status:'read',values:{total:'287.40',liters:'40.000'}}}));}
      terminate(){}
    } as any;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const stream=canvas.captureStream(5);(window as any).__cameras.push(stream);
      const draw=()=>{canvas.getContext('2d')!.fillRect(0,0,640,480);};draw();const timer=setInterval(()=>{if(stream.active)draw();else clearInterval(timer);},100);return stream;
    }});
  });
  await page.getByRole('button',{name:'פתיחת מצלמה',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__deliver.length)).toBe(1);await page.evaluate(()=>(window as any).__deliver[0]());
  await expect.poll(()=>page.evaluate(()=>(window as any).__deliver.length)).toBe(2);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));(window as any).__deliver[1]();});
  await expect(page.getByText(/המצלמה נעצרה ברקע/)).toBeVisible();await expect(page.getByText('המשאבה נקראה',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__cameras.every((stream:MediaStream)=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
});
