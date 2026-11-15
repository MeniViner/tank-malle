import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

// A separate debug package for testing system Back with the DEV Firebase
// emulators. The production wrapper and signing key live outside this repo.
const repo = fileURLToPath(new URL("../", import.meta.url));
const appId = "com.meniviner.tankmalle.backtest";
const sourceVersion = readFileSync(join(repo, "src/lib/version.ts"), "utf8");
const version = sourceVersion.match(/APP_VERSION = "(\d+\.\d+\.\d+)"/)?.[1];
if (!version) throw new Error("Missing app version");

const versionName = `${version}-rc.1`;
const demo = parseEnv(readFileSync(join(repo, ".env.e2e"), "utf8"));
if (demo.VITE_FIREBASE_PROJECT_ID !== "demo-tankmaleh" || demo.VITE_USE_EMULATORS !== "1") {
  throw new Error("The Android debug build requires the local Firebase emulators");
}

const devEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_"))),
  ...demo,
  VITE_LOCAL_CARE: "0",
  VITE_CARE_DEVICE_ORIGIN: "",
  VITE_AUTH_EMULATOR_PORT: "9097",
  VITE_FIRESTORE_EMULATOR_PORT: "8087",
};
const staging = mkdtempSync(join(tmpdir(), "tank-malle-back-"));
const webDir = "www";
const windows = process.platform === "win32";

function run(command, args, options) {
  const child = spawnSync(command, args, { stdio: "inherit", ...options });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${command} exited with code ${child.status}`);
}

function replace(file, from, to) {
  const content = readFileSync(file, "utf8");
  if (!content.includes(from)) throw new Error(`Unexpected Capacitor template: ${file}`);
  writeFileSync(file, content.replace(from, to));
}

run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--mode", "e2e", "--outDir", join(staging, webDir)], {
  cwd: repo,
  env: devEnv,
});
writeFileSync(join(staging, "package.json"), JSON.stringify({ name: "tank-malle-backtest", private: true }));
writeFileSync(join(staging, "capacitor.config.json"), JSON.stringify({
  appId,
  appName: "טנק מלא בדיקות",
  webDir,
  server: { hostname: "localhost", androidScheme: "https" },
  plugins: { App: { disableBackButtonHandler: false } },
}));

const capacitor = "8.6.2";
run(windows ? "npm.cmd" : "npm", [
  "install", "--save-exact", "--no-audit", "--no-fund",
  `@capacitor/core@${capacitor}`, `@capacitor/cli@${capacitor}`,
  `@capacitor/android@${capacitor}`, "@capacitor/app@8.1.2",
], { cwd: staging, shell: windows });
run(process.execPath, ["node_modules/@capacitor/cli/bin/capacitor", "add", "android"], { cwd: staging });

const android = join(staging, "android");
const manifest = join(android, "app/src/main/AndroidManifest.xml");
replace(manifest, "<activity", '<activity android:enableOnBackInvokedCallback="true"');
replace(manifest, "<application", '<application android:networkSecurityConfig="@xml/backtest_network_security"');
const xml = join(android, "app/src/main/res/xml");
mkdirSync(xml, { recursive: true });
writeFileSync(join(xml, "backtest_network_security.xml"), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false"/>
    <domain-config cleartextTrafficPermitted="true">
        <domain>localhost</domain>
        <domain>127.0.0.1</domain>
    </domain-config>
</network-security-config>
`);
const appGradle = join(android, "app/build.gradle");
replace(appGradle, "versionCode 1", "versionCode 3");
replace(appGradle, 'versionName "1.0"', `versionName "${versionName}"`);
const wrapper = join(android, "gradle/wrapper/gradle-wrapper.properties");
replace(wrapper, "gradle-8.14.3-all.zip", "gradle-8.14.3-bin.zip");
replace(wrapper, "networkTimeout=10000", [
  "networkTimeout=120000",
  "distributionSha256Sum=bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531",
].join("\n"));
run(windows ? "gradlew.bat" : "./gradlew", ["--no-daemon", "--console=plain", "assembleDebug"], {
  cwd: android,
  shell: windows,
});

const output = join(repo, ".care-device", "android-back-rc");
mkdirSync(output, { recursive: true });
const apk = join(output, `tank-malle-${versionName}-backtest.apk`);
copyFileSync(join(android, "app/build/outputs/apk/debug/app-debug.apk"), apk);
console.log(apk);
