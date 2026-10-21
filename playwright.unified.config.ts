import {defineConfig,devices} from '@playwright/test';
process.env.CARE_AUTH_PORT='9098';process.env.CARE_FIRESTORE_PORT='8088';
const pwa='**/care-pwa.spec.ts',device='**/care-device.spec.ts';
export default defineConfig({testDir:'./e2e',fullyParallel:false,workers:1,forbidOnly:!!process.env.CI,retries:0,timeout:60000,expect:{timeout:12000},reporter:'list',outputDir:'test-results/unified',globalSetup:'./e2e/global-setup.ts',
  use:{locale:'he-IL',timezoneId:'Asia/Jerusalem',trace:'retain-on-failure',video:'off',serviceWorkers:'block'},
  projects:[{name:'unified-chromium',testMatch:['**/unified-vehicle.spec.ts','**/ui-review.spec.ts','**/scan-maintenance.spec.ts','**/cycle5.spec.ts','**/cycle6.spec.ts'],use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL:'http://127.0.0.1:5286'}},
    {name:'unified-pwa',testMatch:pwa,use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL:'http://127.0.0.1:5286',serviceWorkers:'allow'}},
    {name:'unified-https',testMatch:device,use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL:'https://127.0.0.1:5448',ignoreHTTPSErrors:true}},
    {name:'unified-updates',testMatch:'**/care-pwa-upgrade.spec.ts',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL:'http://127.0.0.1:5289',serviceWorkers:'allow'}},
    ...(process.env.CARE_WEBKIT_PATH?[{name:'unified-webkit',testMatch:['**/unified-vehicle.spec.ts','**/ui-review.spec.ts','**/cycle6.spec.ts'],use:{...devices['iPhone 13'],baseURL:'http://127.0.0.1:5286',launchOptions:{executablePath:process.env.CARE_WEBKIT_PATH}}}]:[])],
  webServer:[{command:'firebase emulators:start --only auth,firestore --project demo-tankmaleh --config firebase.care-test.json',url:'http://127.0.0.1:8088',reuseExistingServer:false,gracefulShutdown:{signal:"SIGTERM",timeout:15000},timeout:120000},
    {command:'vite build --mode care-test --outDir .care-device/unified/test-dist && vite preview --mode care-test --outDir .care-device/unified/test-dist --host 127.0.0.1 --port 5286 --strictPort',url:'http://127.0.0.1:5286',reuseExistingServer:false,gracefulShutdown:{signal:"SIGTERM",timeout:15000},timeout:120000},
    {command:'node scripts/unified-test-https.mjs',url:'https://127.0.0.1:5448',ignoreHTTPSErrors:true,reuseExistingServer:false,gracefulShutdown:{signal:"SIGTERM",timeout:15000},timeout:120000},
    {command:'node scripts/pwa-upgrade-test.mjs',url:'http://127.0.0.1:5289',reuseExistingServer:false,gracefulShutdown:{signal:"SIGTERM",timeout:15000},timeout:120000}],
});
