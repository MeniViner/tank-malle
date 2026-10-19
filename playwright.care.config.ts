import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', testMatch:process.env.CARE_REGRESSION === '1' ? ['**/reliability.spec.ts','**/auth-isolation.spec.ts','**/consumption.spec.ts','**/datetime.spec.ts','**/mobile-regressions.spec.ts'] : '**/scan-maintenance.spec.ts', fullyParallel:false, workers:1,
  timeout:60000, expect:{timeout:12000}, reporter:'list', outputDir:'test-results/care',
  use:{baseURL:'http://127.0.0.1:5283',locale:'he-IL',timezoneId:'Asia/Jerusalem',trace:'off',video:'off',serviceWorkers:'block'},
  projects:[{name:'care-chromium',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
    ...(process.env.CARE_WEBKIT_PATH ? [{name:'care-webkit',use:{...devices['iPhone 13'],launchOptions:{executablePath:process.env.CARE_WEBKIT_PATH}}}] : [])],
  webServer:{command:'npx --no-install vite --mode care --host 127.0.0.1 --port 5283 --strictPort',url:'http://127.0.0.1:5283',reuseExistingServer:true},
});
