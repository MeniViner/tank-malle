/** Idempotent, additive demo seed. Never clears either emulator. */
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
const app=initializeApp({projectId:'demo-tankmaleh'},'care-cycle6-seed');
const auth=getAuth(app),db=getFirestore(app),uid='care-cycle6-meni',email='meni.cycle6@example.test',vehicleId='cycle6-car';
try {
  let user=await auth.getUser(uid).catch(e=>{if(e.code==='auth/user-not-found')return null;throw e;});
  if(user && user.email!==email)throw new Error('Refusing an account not owned by this demo seed');
  if(!user){user=await auth.createUser({uid,email,displayName:'מני · הדגמה מקומית',emailVerified:true});await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid,email,displayName:'מני · הדגמה מקומית'}});}
  const date=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
  const base=`users/${uid}/vehicles/${vehicleId}`;
  const common={schemaVersion:1,version:1,notes:'נתוני דוגמה לקבלה המקומית; אינם היסטוריית הרכב האמיתית.'};
  const records=[
    [`users/${uid}`,{displayName:'מני · הדגמה מקומית',email,settings:{activeVehicleId:vehicleId,units:'kmPerLiter',onboardingDone:true}}],
    [base,{make:'רכב',model:'ההדגמה',fuelType:'95',archived:false,priceAdjustment:0,manualPricePerLiter:7,tankLiters:45,tankLitersSource:'user',declaredKmPerLiter:14,createdAt:new Date()}],
    [`${base}/serviceEvents/oil`,{...common,title:'טיפול שמן ומסננים',day:date(-18),odometer:170000,costAgorot:65000,jobs:['periodic','oil'],garage:'מוסך הדגמה',completedPlanIds:[]}],
    [`${base}/serviceEvents/tires`,{...common,title:'החלפת שני צמיגים',day:date(-6),odometer:170900,costAgorot:120000,jobs:['tires'],garage:'צמיגי הדגמה',completedPlanIds:[]}],
    [`${base}/vehicleExpenses/insurance`,{...common,title:'ביטוח שנתי',day:date(-17),costAgorot:240000,category:'insurance'}],
    [`${base}/vehicleExpenses/wash`,{...common,title:'שטיפה',day:date(-3),costAgorot:6000,category:'wash'}],
    [`${base}/vehicleExpenses/refund`,{...common,title:'החזר על צמיג ישן',day:date(-5),costAgorot:10000,category:'refund'}],
    [`${base}/odometerReadings/latest`,{...common,day:date(-1),odometer:171100}],
    [`${base}/maintenancePlans/periodic`,{...common,title:'טיפול תקופתי — דוגמה',job:'periodic',dueDay:date(6),dueOdometer:171500,intervalMonths:6,intervalKm:10000,basis:'completion',source:'owner',active:true}],
    [`${base}/maintenancePlans/brakes`,{...common,title:'בדיקת בלמים — דוגמה',job:'brakes',dueDay:date(0),dueOdometer:null,intervalMonths:null,intervalKm:null,basis:'manual',source:'owner',active:true}],
  ];
  for(const [id,offset,odometer,liters] of [['fuel-1',-17,170300,40],['fuel-2',-7,170850,36]]){
    const stamp=new Date(`${date(offset)}T12:00:00+03:00`);
    records.push([`${base}/fillups/${id}`,{date:stamp,odometer,liters,pricePerLiter:7,totalCost:liters*7,isFullTank:true,continuityBreakBefore:false,createdAt:stamp}]);
  }
  let created=0;
  for(const [path,data] of records){const ref=db.doc(path);if(!(await ref.get()).exists){await ref.create(data);created++;}}
  console.log(JSON.stringify({project:'demo-tankmaleh',uid,email,vehicleId,created,retained:records.length-created,initialRecordedCostILS:4742},null,2));
} finally {await deleteApp(app);}
