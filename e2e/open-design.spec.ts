import { test, expect, type Page } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ALICE, signedInWithData, signIn, signOut } from './helpers/app';
import { PROJECT_ID, getDocument, listDocuments, setDocument, seedVehicle, setActiveVehicle } from './helpers/emulator';
import { notificationId } from '../src/lib/vehicle/model';
import { localDay } from '../src/lib/maintenance/model';
const plan=(title:string)=>({schemaVersion:1,version:1,title,job:'oil',dueDay:'2026-10-01',dueOdometer:null,intervalMonths:1,intervalKm:null,basis:'completion',source:'owner',notes:'',active:true});
const state=(id:string,read=false,archived=false)=>({schemaVersion:1,version:1,occurrence:`reminder:${id}:2026-10-01:-:initial`,read,archived,snoozeUntilDay:null});
async function setup(page:Page,admin=false){
  const account=await signedInWithData(page,{fillups:[],regulatedPrice:7.31});
  if(admin){process.env.FIREBASE_AUTH_EMULATOR_HOST=`127.0.0.1:${process.env.CARE_AUTH_PORT??'9099'}`;const app=initializeApp({projectId:PROJECT_ID},'design-'+Date.now());await getAuth(app).setCustomUserClaims(account.uid,{admin:true});await deleteApp(app);await signOut(page);await signIn(page,ALICE);}
  return {...account,base:`users/${account.uid}/vehicles/${account.vehicleId}`};
}

test('the admin shows unified costs and legacy profiles, with scoped search and read-only user details',async({page})=>{
  const {uid,vehicleId,base}=await setup(page,true);
  await setDocument(base+'/serviceEvents/service',{schemaVersion:1,version:1,day:localDay(),title:'בלמים',jobs:['brakes'],odometer:null,costAgorot:50000,garage:'',notes:'',completedPlanIds:[]});
  await setDocument(base+'/vehicleExpenses/refund',{schemaVersion:1,version:1,day:localDay(),category:'refund',title:'החזר בדיקה',costAgorot:1000,notes:''});
  await setDocument('users/legacy-no-created-date',{displayName:'חשבון ותיק לבדיקה',email:'legacy-design@example.test',settings:{}});
  await setDocument('users/malformed-profile',{displayName:{unexpected:'object'},email:'malformed-design@example.test',photoURL:{unexpected:'object'},createdAt:{toMillis:'not a function'},settings:{}});
  await expect.poll(async()=>((await getDocument(`userSummaries/${uid}`))?.vehicles as Record<string,Record<string,unknown>>)?.[vehicleId]?.ledger).toMatchObject({totalAgorot:49000,counts:{service:1,expense:1}});
  await page.goto('/admin');await expect(page.getByRole('region',{name:'סיכום המערכת'})).toContainText('רשומות יומן');await expect(page.getByRole('region',{name:'הוצאה מתועדת בששת החודשים האחרונים'})).toBeVisible();
  await expect(page.getByRole('button',{name:'תדלוק חדש',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'משתמשים',exact:true}).click();await expect(page.getByText('חשבון ותיק לבדיקה',{exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'חיפוש משתמשים'}).fill('legacy-design');await expect(page.locator('.admin-user-row')).toHaveCount(1);
  await page.locator('.admin-user-row').click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('לא זמין סיכום תקין');await expect(dialog.getByRole('button',{name:/מחיקה|עריכה|שמירה/})).toHaveCount(0);await dialog.getByRole('button',{name:'סגירה',exact:true}).click();
  await page.getByRole('searchbox',{name:'חיפוש משתמשים'}).fill('malformed-design');await expect(page.locator('.admin-user-row')).toHaveCount(1);await expect(page.locator('.admin-user-row')).toContainText('ללא שם');await page.locator('.admin-user-row').click();await expect(dialog).toContainText('לא ידוע');await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.getByRole('searchbox',{name:'חיפוש משתמשים'}).fill('');await expect(page.locator('.admin-user-row')).toHaveCount(3);
});

test('admin prices are compact rows and an explicit sheet save reaches the normal fillup default',async({page})=>{
  await setup(page,true);await page.goto('/admin');await page.getByRole('button',{name:'נתונים',exact:true}).click();
  await expect(page.getByLabel('מחיר חדש לליטר · בנזין 95')).toHaveCount(0);await expect(page.getByRole('button',{name:'עריכת מחיר · בנזין 95',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'עריכת מחיר · בנזין 95',exact:true}).click();const dialog=page.getByRole('dialog');const input=dialog.getByLabel('מחיר חדש לליטר · בנזין 95');await expect(input).toHaveValue('7.31');await expect(dialog.getByRole('button',{name:'שמירה',exact:true})).toBeDisabled();await input.fill('8.15');await dialog.getByRole('button',{name:'שמירה',exact:true}).click();
  await expect.poll(async()=>((await getDocument('appConfig/fuelPrices'))?.byFuelType as Record<string,Record<string,Record<string,Record<string,unknown>>>>)?.['95']?.self?.current?.pricePerLiter).toBe(8.15);
  await expect(dialog.getByText('המחיר מאושר בשרת',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.goto('/fillup/new');await expect(page.getByLabel('מחיר לליטר',{exact:true})).toHaveValue('8.15');
});

test('notifications keep unread, read and archive in one list; deletion survives reload and leaves a new cycle visible',async({page})=>{
  const {base}=await setup(page);
  for(const [id,title,read,archived] of [['a','טיפול חדש',false,false],['b','טיפול שנקרא',true,false],['c','טיפול בארכיון',true,true]] as const){await setDocument(base+'/maintenancePlans/'+id,plan(title));if(read||archived){const value=state(id,read,archived);await setDocument(base+'/notificationStates/'+notificationId(value.occurrence),value);}}
  await page.goto('/notifications');await expect(page.getByRole('button',{name:'פעילות',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'ארכיון',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'חדש',exact:true})).toContainText('טיפול חדש');await expect(page.getByRole('region',{name:'נקרא',exact:true})).toContainText('טיפול שנקרא');await expect(page.getByRole('region',{name:'בארכיון',exact:true})).toContainText('טיפול בארכיון');
  await page.getByRole('button',{name:'העברה לארכיון · טיפול חדש',exact:true}).click();await expect(page.getByRole('region',{name:'בארכיון',exact:true})).toContainText('טיפול חדש');
  await expect.poll(async()=>getDocument(base+'/notificationStates/'+notificationId(state('a').occurrence))).toMatchObject({archived:true,read:true});
  await page.getByRole('button',{name:'מחיקת התראה · טיפול בארכיון',exact:true}).click();await expect.poll(async()=>getDocument(base+'/notificationStates/'+notificationId(state('c').occurrence))).toMatchObject({deleted:true,archived:true});await page.reload();await expect(page.getByRole('heading',{name:'טיפול בארכיון',exact:true})).toHaveCount(0);
  await setDocument(base+'/serviceEvents/completion',{schemaVersion:1,version:1,day:'2026-09-01',title:'טיפול למחזור חדש',jobs:['oil'],odometer:null,costAgorot:10000,garage:'',notes:'',completedPlanIds:['c']});await expect(page.getByRole('region',{name:'חדש',exact:true}).getByRole('heading',{name:'טיפול בארכיון',exact:true})).toBeVisible();
});

test('the same advance window drives Home, the vehicle badge and the notification list',async({page})=>{
  const {base,uid}=await setup(page);const day=localDay(new Date(Date.now()+10*86400000));await setDocument(base+'/maintenancePlans/p',{...plan('בדיקה בעוד עשרה ימים'),dueDay:day});await page.goto('/');
  await expect(page.getByRole('region',{name:'מצב הרכב'})).toContainText('במעקב');await expect(page.getByTestId('vehicle-alert-count')).toHaveCount(0);
  await page.goto('/settings');await page.getByRole('button',{name:/העדפות התראות/}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('radiogroup',{name:'זמן התראה מראש'}).getByRole('radio',{name:'שבועיים',exact:true}).click();await expect.poll(async()=>((await getDocument(`users/${uid}`))?.settings as Record<string,unknown>)?.reminderLeadDays).toBe(14);await dialog.getByRole('button',{name:'סגירה',exact:true}).click();
  await page.goto('/');await expect(page.getByRole('region',{name:'מצב הרכב'})).toContainText('1 בקרוב');await expect(page.getByTestId('vehicle-alert-count')).toHaveText('1');await page.goto('/notifications');await expect(page.getByRole('heading',{name:'בדיקה בעוד עשרה ימים',exact:true})).toBeVisible();
  expect((await getDocument(base+'/maintenancePlans/p'))?.dueDay).toBe(day);expect(await listDocuments(base+'/serviceEvents')).toHaveLength(0);
});

test('a remote active-vehicle switch closes an old snooze sheet and scopes subsequent updates',async({page})=>{
  const {base,uid}=await setup(page);await setDocument(base+'/maintenancePlans/p',plan('תזכורת לרכב הראשון'));await seedVehicle(uid,'second',{make:'רכב',model:'שני'});await setDocument(`users/${uid}/vehicles/second/maintenancePlans/p`,plan('תזכורת לרכב השני'));await page.goto('/notifications');await page.getByRole('button',{name:'דחיית הופעה',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await setActiveVehicle(uid,'second');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'תזכורת לרכב השני',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'סימון כנקרא',exact:true}).click();await expect.poll(async()=>listDocuments(`users/${uid}/vehicles/second/notificationStates`)).not.toHaveLength(0);expect(await listDocuments(base+'/notificationStates')).toHaveLength(0);
});

test('notification Undo survives navigation in the same vehicle but cannot act after a vehicle switch',async({page})=>{
  const {base,uid}=await setup(page);await setDocument(base+'/maintenancePlans/p',plan('התראה ראשונה'));await seedVehicle(uid,'second',{make:'רכב',model:'שני לבדיקה'});await setDocument(`users/${uid}/vehicles/second/maintenancePlans/p`,plan('התראה שנייה'));
  const first=base+'/notificationStates/'+notificationId(state('p').occurrence);
  const archiveFirst=async()=>{await page.getByRole('button',{name:'העברה לארכיון · התראה ראשונה',exact:true}).click();await expect(page.getByRole('button',{name:'ביטול',exact:true})).toBeVisible();};
  await page.goto('/notifications');await archiveFirst();await page.getByRole('button',{name:'חזרה לבית',exact:true}).click();await page.getByRole('button',{name:'ביטול',exact:true}).click();await expect.poll(()=>getDocument(first)).toMatchObject({archived:false});
  await page.getByRole('button',{name:'התראות',exact:true}).click();await archiveFirst();await page.getByRole('button',{name:'חזרה לבית',exact:true}).click();await setActiveVehicle(uid,'second');await expect(page.getByRole('button',{name:'ניהול רכבים',exact:true})).toContainText('רכב שני לבדיקה');await page.getByRole('button',{name:'ביטול',exact:true}).click();
  await page.getByRole('button',{name:'התראות',exact:true}).click();await page.getByRole('button',{name:'העברה לארכיון · התראה שנייה',exact:true}).click();await expect.poll(()=>getDocument(`users/${uid}/vehicles/second/notificationStates/${notificationId(state('p').occurrence)}`)).toMatchObject({archived:true});expect((await getDocument(first))?.archived).toBe(true);
});

test('completing a reminder offers the last linked invoice and current mileage; a restored draft takes precedence',async({page})=>{
  const {base}=await setup(page);await setDocument(base+'/maintenancePlans/p',{...plan('החלפת שמן לבדיקה'),intervalMonths:12});
  await setDocument(base+'/serviceEvents/previous',{schemaVersion:1,version:1,day:'2025-10-01',title:'חשבונית קודמת',jobs:['oil'],odometer:90000,costAgorot:42000,garage:'המוסך הקודם',notes:'',completedPlanIds:['p']});
  await setDocument(base+'/odometerReadings/current',{schemaVersion:1,version:1,day:localDay(),odometer:100000,notes:''});await page.goto('/vehicle/reminders/p');await page.getByRole('button',{name:'רישום טיפול שבוצע',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog.getByLabel('עלות כוללת',{exact:true})).toHaveValue('420');await expect(dialog.getByLabel('קילומטראז׳ בעת הביצוע')).toHaveValue('100000');await dialog.getByText('עוד פרטים',{exact:true}).click();await expect(dialog.getByLabel('מוסך / ספק')).toHaveValue('המוסך הקודם');await expect(dialog.getByLabel('החלפת שמן לבדיקה',{exact:true})).toBeChecked();
  await dialog.getByLabel('עלות כוללת',{exact:true}).fill('450');await dialog.getByLabel('מוסך / ספק').fill('המוסך החדש');await dialog.getByRole('button',{name:'סגירה',exact:true}).click();await page.reload();await page.getByRole('button',{name:'רישום טיפול שבוצע',exact:true}).click();await expect(dialog.getByLabel('עלות כוללת',{exact:true})).toHaveValue('450');await dialog.getByText('עוד פרטים',{exact:true}).click();await expect(dialog.getByLabel('מוסך / ספק')).toHaveValue('המוסך החדש');await dialog.getByRole('button',{name:'שמירת טיפול שבוצע',exact:true}).click();
  await expect.poll(async()=>listDocuments(base+'/serviceEvents')).toHaveLength(2);const rows=await listDocuments(base+'/serviceEvents');expect(rows.find(r=>r.id!=='previous')?.data).toMatchObject({costAgorot:45000,garage:'המוסך החדש',odometer:100000,completedPlanIds:['p']});await expect(dialog).toHaveCount(0);await expect(page.locator('main')).toContainText('2027');
});

test('vehicle tabs follow the reference, keep vehicle preferences out of app settings and total every recorded year',async({page})=>{
  const {base}=await setup(page);await setDocument(base+'/vehicleExpenses/old',{schemaVersion:1,version:1,day:'2025-10-01',category:'insurance',title:'ביטוח שנה קודמת',costAgorot:10000,notes:''});await setDocument(base+'/vehicleExpenses/current',{schemaVersion:1,version:1,day:localDay(),category:'parking',title:'חניה',costAgorot:2000,notes:''});
  await page.goto('/vehicle');const tabs=page.getByLabel('אזור הרכב');await expect(tabs.getByRole('button')).toHaveText(['מה מתקרב','עלויות','הרכב','הגדרות הרכב']);await tabs.getByRole('button',{name:'עלויות',exact:true}).click();await expect(page.getByTestId('running-total')).toHaveText('₪120');await expect(page.getByRole('link',{name:/2025.*100/})).toBeVisible();await page.getByRole('link',{name:/2025.*100/}).click();await expect(page.getByTestId('running-total')).toHaveText('₪100');
  await page.goto('/vehicle?tab=prefs');await expect(page.getByRole('link',{name:'רכבים וארכיון ←',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/רזרבה — מתי להתריע/})).toBeVisible();await page.goto('/settings');await expect(page.getByText('רכב',{exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:/רזרבה — מתי להתריע/})).toHaveCount(0);await expect(page.getByRole('button',{name:/העדפות התראות/})).toBeVisible();
});
