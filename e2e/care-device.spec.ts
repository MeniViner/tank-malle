import {startCareEditor,setCareTitle} from "./helpers/care";
import { expect,test } from '@playwright/test';
import { signedInWithData } from './helpers/app';
import { listDocuments } from './helpers/emulator';
test('HTTPS gateway signs in and persists via same-origin demo Auth and Firestore',async({page,baseURL})=>{
  const successful:string[]=[],gatewayErrors:string[]=[];page.on('response',response=>{if(response.ok())successful.push(response.url());if(response.status()===502)gatewayErrors.push(response.url());});
  const scope=await signedInWithData(page,{fillups:[]});
  expect(await page.evaluate(()=>window.isSecureContext)).toBe(true);
  await page.goto('/vehicle');await startCareEditor(page,'expense');await setCareTitle(page,'HTTPS demo expense');await page.getByLabel('עלות כוללת',{exact:true}).fill('12');await page.getByRole('button',{name:'שמירת הוצאה לרכב'}).click();
  await expect(async()=>expect(await listDocuments(`users/${scope.uid}/vehicles/${scope.vehicleId}/vehicleExpenses`)).toHaveLength(1)).toPass();
  expect(successful.some(url=>url.startsWith(baseURL+'/google.firestore.v1.Firestore/'))).toBe(true);
  expect(successful.some(url=>url.includes('firestore.googleapis.com') || url.includes('identitytoolkit.googleapis.com')&&!url.startsWith(baseURL!))).toBe(false);
  const blocked=await page.evaluate(async()=>{
    const denied=await fetch('/emulator/v1/projects/demo-tankmaleh/accounts');
    const foreign=await fetch('/v1/projects/production/databases/(default)/documents');
    return [denied.status,foreign.status];
  });expect(blocked).toEqual([403,403]);
  expect(gatewayErrors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
