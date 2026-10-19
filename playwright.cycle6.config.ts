import { defineConfig, devices } from '@playwright/test';
// These variables are inherited by workers. Existing reset helpers only reach
// this disposable pair, never the acceptance/demo emulators on 9099/8080.
process.env.CARE_AUTH_PORT='9098';
process.env.CARE_FIRESTORE_PORT='8088';
export default defineConfig({
  testDir:'./e2e', testMatch:process.env.CARE_PWA==='1' ? ['**/care-pwa.spec.ts'] : process.env.CARE_REGRESSION==='1' ? ['**/scan-maintenance.spec.ts','**/cycle5.spec.ts','**/cycle6.spec.ts'] : ['**/cycle6.spec.ts'],
  fullyParallel:false, workers:1, timeout:60000, expect:{timeout:12000},
  reporter:'list', outputDir:'test-results/cycle6',
  use:{baseURL:'http://127.0.0.1:5286',locale:'he-IL',timezoneId:'Asia/Jerusalem',trace:'off',video:'off',serviceWorkers:process.env.CARE_PWA==='1'?'allow':'block'},
  projects:[{name:'cycle6-chromium',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
    ...(process.env.CARE_WEBKIT_PATH && process.env.CARE_PWA!=='1' ? [{name:'cycle6-webkit',use:{...devices['iPhone 13'],launchOptions:{executablePath:process.env.CARE_WEBKIT_PATH}}}] : [])],
  // Accept the built app, isolated from development HMR and dependency caches.
  webServer:{command:'npx --no-install vite build --mode care-test --outDir .care-device/cycle6/test-dist && npx --no-install vite preview --mode care-test --outDir .care-device/cycle6/test-dist --host 127.0.0.1 --port 5286 --strictPort',url:'http://127.0.0.1:5286',reuseExistingServer:false},
});
