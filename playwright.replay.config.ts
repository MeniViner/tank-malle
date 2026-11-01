import {defineConfig,devices} from '@playwright/test';
import {sceneFile,type SceneName} from './e2e/helpers/replay';
// Camera replay (e2e/scan-replay.spec.ts): Chromium's fake capture device plays
// a rendered scene as the camera; everything after getUserMedia is the real app.
// The same disposable emulator pair as the unified suite.
process.env.CARE_AUTH_PORT='9098';process.env.CARE_FIRESTORE_PORT='8088';
const camera=(scene:SceneName)=>({...devices['Desktop Chrome'],viewport:{width:390,height:844},baseURL:'http://127.0.0.1:5286',permissions:['camera'],
  launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${sceneFile(scene)}`]}});
export default defineConfig({testDir:'./e2e',testMatch:'**/scan-replay.spec.ts',fullyParallel:false,workers:1,forbidOnly:!!process.env.CI,retries:0,timeout:120000,expect:{timeout:20000},reporter:'list',outputDir:'test-results/replay',globalSetup:'./e2e/replay-setup.ts',
  use:{locale:'he-IL',timezoneId:'Asia/Jerusalem',trace:'retain-on-failure',video:'off',serviceWorkers:'block'},
  projects:[
    {name:'replay-pump',use:camera('pump')},
    {name:'replay-odometer',use:camera('odometer')},
    {name:'replay-blur-to-clear',use:camera('blur-to-clear')},
    {name:'replay-movement',use:camera('movement')},
    {name:'replay-counting-pump',use:camera('counting-pump')},
    {name:'replay-trip-and-odo',use:camera('trip-and-odo')},
    {name:'replay-labelled-pump',use:camera('labelled-pump')},
    {name:'replay-offline',use:{...camera('pump'),serviceWorkers:'allow'}},
    // The whole fill-up from the camera, and the original difficult displays.
    {name:'replay-two-step',use:camera('pump-then-odometer')},
    {name:'replay-segment-two-step',use:camera('segment-pump-then-odometer')},
    {name:'replay-segment-pump',use:camera('segment-pump')},
    {name:'replay-segment-odometer',use:camera('segment-odometer')},
    {name:'replay-dashboard',use:camera('dashboard')},
    // Nothing may be filled from these.
    {name:'replay-trip-only',use:camera('trip-only')},
    {name:'replay-euro-pump',use:camera('euro-pump')},
  ],
  webServer:[{command:'firebase emulators:start --only auth,firestore --project demo-tankmaleh --config firebase.care-test.json',url:'http://127.0.0.1:8088',reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:15000},timeout:120000},
    {command:'vite build --mode care-test --outDir .care-device/replay/test-dist && vite preview --mode care-test --outDir .care-device/replay/test-dist --host 127.0.0.1 --port 5286 --strictPort',url:'http://127.0.0.1:5286',reuseExistingServer:false,gracefulShutdown:{signal:'SIGTERM',timeout:15000},timeout:180000}],
});
