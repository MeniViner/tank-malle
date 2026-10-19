import { defineConfig } from '@playwright/test';
import { careDeviceOrigin } from './src/lib/careEnvironment';
const origin=process.env.CARE_DEVICE_ORIGIN??'https://127.0.0.1:5443';
if(!careDeviceOrigin(origin,origin))throw new Error('Device tests require an explicit private HTTPS origin');
export default defineConfig({testDir:'./e2e',testMatch:'**/care-device.spec.ts',workers:1,timeout:60000,expect:{timeout:15000},reporter:'list',outputDir:'test-results/device',use:{baseURL:origin,viewport:{width:390,height:844},locale:'he-IL',timezoneId:'Asia/Jerusalem',serviceWorkers:'block',trace:'off',launchOptions:{args:process.env.CARE_TLS_SPKI?[`--ignore-certificate-errors-spki-list=${process.env.CARE_TLS_SPKI}`]:[]}}});
