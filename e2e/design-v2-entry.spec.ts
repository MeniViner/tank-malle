import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Outbox, OutboxOperation } from "../src/lib/outbox";
import { DEFAULT_SETTINGS } from "../src/lib/types";
import { ALICE, BOB, completeGooglePopup, signIn, signOut, uidOf, waitForVehicleSelection } from "./helpers/app";
import { FIRESTORE_HOST, getDocument, listDocuments, resetEmulators, uidForEmail } from "./helpers/emulator";
import { captureJournal, journalEvidence, journalRawFields, removeJournalDocument, replaceJournalRawFields, type RawFields } from "./helpers/design-v2-journal";
import { homeAppearance } from "./helpers/design-v2-home";
import { fixtureField, manualWizard, vehicleFieldPair, vehiclePlateGeometry, vehicleTarget } from "./helpers/design-v2-vehicle";
import { holdJournal, journalOperations, releaseJournal, waitForJournalHold } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";
import { holdFirestoreDisk, releaseFirestoreDisk } from "./helpers/disk";

test.use({ viewport: { width: 390, height: 844 } });
const CKAN = "**/api/3/action/datastore_search**";
const WLTP = "142afde2-6228-49f9-8a29-9b6c3a0cbe40";
const registry = (plate = 12345678) => ({ mispar_rechev: plate, tozeret_nm: "מאזדה יפן", kinuy_mishari: "3",
  shnat_yitzur: 2020, sug_delek_nm: "בנזין", tozeret_cd: 123, degem_cd: 456 });
const response = (records: unknown[]) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, result: { records } }) });

async function freshAccount(page: Page) {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toBeTruthy();
  await expect(page.getByTestId("wizard-manual")).toBeVisible();
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  return uid;
}

async function noRegistry(page: Page) {
  await page.route(CKAN, route => route.fulfill(response([])));
}

async function captureEntry320(page: Page, name: string, targets: Locator[]) {
  const focused = await page.locator(":focus").elementHandle();
  expect(focused).not.toBeNull();
  try {
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
    for (const target of targets) await vehicleTarget(target);
    expect(await focused!.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { focused: document.activeElement === element, centerHit: hit === element || element.contains(hit) };
    }), name).toEqual({ focused: true, centerHit: true });
    const pair = await page.getByTestId("wizard-tank").count()
      ? await vehicleFieldPair(page.getByTestId("wizard-tank"), page.getByTestId("wizard-declared"), true) : null;
    await captureJournal(page, `${name}-320-light-plate`);
    return pair;
  } finally {
    await page.setViewportSize({ width: 390, height: 844 });
    await focused?.dispose();
  }
}

async function entryControlEvidence(name: string, target: Locator) {
  return target.evaluate((element, name) => {
    const style = getComputedStyle(element);
    const outline = (computed: CSSStyleDeclaration) => ({ color: computed.outlineColor, style: computed.outlineStyle,
      width: computed.outlineWidth, offset: computed.outlineOffset, boxShadow: computed.boxShadow });
    const backgroundAncestors = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const computed = getComputedStyle(ancestor);
      backgroundAncestors.push({ tag: ancestor.tagName, className: ancestor.className,
        color: computed.backgroundColor, image: computed.backgroundImage, opacity: computed.opacity,
        focusWithin: ancestor.matches(":focus-within"), outline: outline(computed), borderColor: computed.borderColor });
    }
    return { name, tag: element.tagName, foreground: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight,
      textShadow: style.textShadow, opacity: style.opacity,
      background: { color: style.backgroundColor, image: style.backgroundImage }, backgroundAncestors,
      focus: { active: document.activeElement === element, visible: element.matches(":focus-visible"), outline: outline(style) },
      motion: { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        animationName: style.animationName, animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount, transitionProperty: style.transitionProperty,
        transitionDuration: style.transitionDuration, transitionDelay: style.transitionDelay,
        animations: element.getAnimations().map(animation => ({ playState: animation.playState,
          finite: Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) })) } };
  }, name);
}

test("unchecked consent never starts auth, legal links do not check it, and checked consent uses the real popup", async ({ page }) => {
  await resetEmulators();
  await page.goto("/");
  await page.getByTestId("onboarding-skip").click();
  const popups: Page[] = [];
  const authRequests: string[] = [];
  page.on("popup", popup => popups.push(popup));
  page.on("request", request => { if (request.url().includes("accounts:signInWithIdp")) authRequests.push(request.url()); });
  const consent = page.getByTestId("signin-consent");
  await expect(consent).not.toBeChecked();
  await page.getByTestId("signin-google").focus();
  await expect(page.getByTestId("signin-google")).toBeFocused();
  await page.keyboard.press("Enter");
  const finishedShakes = await page.locator(".entry-consent").evaluate(async node => {
    const shakes = node.getAnimations().filter(animation => animation instanceof CSSAnimation
      && animation.animationName === "entry-consent-shake"
      && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    await Promise.all(shakes.map(animation => animation.finished));
    return shakes.length;
  });
  expect(finishedShakes).toBeGreaterThan(0);
  await expect(consent).toBeFocused();
  await expect(consent).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("signin-consent-error")).toBeVisible();
  expect(popups).toHaveLength(0);
  expect(authRequests).toHaveLength(0);
  expect(await uidForEmail(ALICE.email)).toBeNull();
  for (const path of ["terms", "privacy"]) {
    await page.locator(`a[href="/legal/${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/legal/${path}$`));
    await page.goBack();
    await expect(consent).not.toBeChecked();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("signin-google").click();
  expect(await page.locator(".entry-consent").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  expect(popups).toHaveLength(0);
  await expect(consent).toBeFocused();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await expect(page.getByTestId("signin-consent-error")).toHaveCount(0);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("signin-google").click()]);
  await completeGooglePopup(popup, ALICE);
  await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
  expect(await uidOf(ALICE)).toBeTruthy();
  expect(popups).toHaveLength(1);
});

test("login initializes a profile before queued writes and live recovery fills only absent fields", async ({ page }) => {
  await resetEmulators();
  const gate = () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    return { wait, release };
  };
  const sdkGate = gate(), initialReadGate = gate();
  let dataGate = gate();
  // Either missing-only initializer may win. Holding a commit would occupy
  // Firestore's shared queue and prevent the missing-document callback.
  dataGate.release();
  const gates = [sdkGate, initialReadGate, dataGate];
  let initialProfileReads = 0;
  type Commit = { update?: { name?: string; fields?: RawFields }; verify?: string };
  type Attempt = { request: Request; login: boolean; dataGate?: typeof dataGate; status?: number };
  const attempts: Attempt[] = [];
  const loginCommits: { name: string; fields: RawFields }[] = [];
  const profileDocument = (name?: string) => /\/documents\/users\/[^/]+$/.test(name ?? "");
  page.on("response", reply => {
    const attempt = attempts.find(candidate => candidate.request === reply.request());
    if (!attempt) return;
    attempt.status = reply.status();
    if (!attempt.login || reply.status() !== 200) return;
    const body = reply.request().postDataJSON() as { writes?: Commit[] };
    for (const write of body.writes ?? []) {
      const update = write.update;
      if (profileDocument(update?.name) && update?.fields?.lastProcessedAuthTime) {
        loginCommits.push({ name: update.name!, fields: update.fields });
      }
    }
  });
  await page.route("**/google.firestore.v1.Firestore/Write/**", async route => {
    await sdkGate.wait;
    await route.continue();
  });
  await page.route("**/documents:batchGet", async route => {
    const body = route.request().postDataJSON() as { documents?: string[] };
    if ((body.documents ?? []).some(profileDocument)) {
      initialProfileReads += 1;
      await initialReadGate.wait;
    }
    await route.continue();
  });
  await page.route("**/documents:commit", async route => {
    const body = route.request().postDataJSON() as { writes?: Commit[] };
    const writes = (body.writes ?? []).filter(write => profileDocument(write.update?.name ?? write.verify));
    if (writes.length) {
      const login = writes.some(write => !!write.update?.fields?.lastProcessedAuthTime);
      const attempt: Attempt = { request: route.request(), login };
      attempts.push(attempt);
      if (!login && writes.some(write => !!write.update)) {
        // The initial gate is already released. Later live-repair phases hold
        // their own actual commit while inspecting the original raw fields.
        attempt.dataGate = dataGate;
        await attempt.dataGate.wait;
      }
    }
    await route.continue();
  });
  const settleReleasedData = async (released: typeof dataGate) => {
    const held = attempts.filter(attempt => attempt.dataGate === released);
    if (!held.length) return;
    const first = attempts.indexOf(held[0]);
    for (const attempt of held) {
      const response = await attempt.request.response();
      expect(response).not.toBeNull();
      expect(await response!.finished()).toBeNull();
    }
    // A stale read may reject its first commit and legitimately retry with a
    // verification-only commit. Await actual successful server completion.
    await expect.poll(() => attempts.slice(first).filter(attempt => !attempt.login && attempt.status === 200).length,
      { timeout: 15_000 }).toBeGreaterThanOrEqual(held.length);
  };
  const holdDataAgain = () => { dataGate = gate(); gates.push(dataGate); return dataGate; };
  try {
    await signIn(page, ALICE);
    const uid = await uidOf(ALICE), path = `users/${uid}`;
    await expect.poll(() => initialProfileReads, { timeout: 15_000 }).toBeGreaterThan(0);
    // Initial profile reads are still held outside the commit queue, so this
    // UI proves the missing callback supplied a local view without waiting
    // for any profile-field initialization to reach the server.
    await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
    initialReadGate.release();
    await expect.poll(() => loginCommits.find(commit => commit.name.endsWith(`/${path}`)), { timeout: 15_000 }).toBeTruthy();
    const loginCommit = loginCommits.find(commit => commit.name.endsWith(`/${path}`))!;
    await expect.poll(() => getDocument(path), { timeout: 15_000 }).toMatchObject({
      displayName: ALICE.displayName, email: ALICE.email, photoURL: null,
      settings: DEFAULT_SETTINGS, previousLoginAt: null,
    });
    const initial = (await journalRawFields(path))!;
    expect(initial.createdAt).toMatchObject({ timestampValue: expect.any(String) });
    expect(initial.currentLoginAt).toEqual(loginCommit.fields.currentLoginAt);
    expect(initial.lastProcessedAuthTime).toEqual(loginCommit.fields.lastProcessedAuthTime);

    const authoredSettings = { ...DEFAULT_SETTINGS, activeVehicleId: "owned-before-initializer", theme: "dark", accentColor: "mint", units: "litersPer100", shareBenchmarks: false, reminderNotifications: false };
    await replaceJournalRawFields(path, {
      ...initial, settings: fixtureField(authoredSettings), createdAt: { timestampValue: "2001-02-03T04:05:06.123456000Z" },
      profileSentinel: fixtureField({ owner: "authored before initializer release", amount: 7.123456789, missingIsNotNull: null }),
    });
    const beforeRelease = (await journalRawFields(path))!;
    expect(await getDocument(path)).toMatchObject({ settings: authoredSettings });
    sdkGate.release();
    dataGate.release();
    // Use the exact app SDK URL and instance, including its Vite version query.
    await page.evaluate(async () => {
      const modulePath = "/src/lib/firebase.ts";
      const source = await (await fetch(modulePath)).text();
      const sdkPath = source.match(/from\s*["']([^"']*firebase_firestore[^"']*)["']/)?.[1];
      if (!sdkPath) throw new Error("Firestore SDK import was not present in the served app module");
      const [{ db }, { waitForPendingWrites }] = await Promise.all([import(modulePath), import(sdkPath)]);
      await waitForPendingWrites(db);
    });
    await settleReleasedData(dataGate);
    expect(await journalRawFields(path)).toEqual(beforeRelease);
    await page.goto("/account");
    await page.getByTestId("account-identity").click();
    await expect(page.getByText("זו ההתחברות הראשונה", { exact: true })).toBeVisible();
    const complete = (await journalRawFields(path))!;
    expect(complete).toEqual(beforeRelease);

    // Existing empty documents must be repaired by the mounted listener, with
    // no reload and no SDK defaults merge that can own existing field values.
    const emptyGate = holdDataAgain(), emptyStart = attempts.length;
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await replaceJournalRawFields(path, {});
    expect(await getDocument(path)).toEqual({});
    expect((await journalRawFields(path)) ?? {}).toEqual({});
    await expect.poll(() => attempts.slice(emptyStart).some(attempt => attempt.dataGate === emptyGate), { timeout: 15_000 }).toBe(true);
    emptyGate.release();
    await settleReleasedData(emptyGate);
    await expect.poll(() => getDocument(path), { timeout: 15_000 }).toMatchObject({
      displayName: ALICE.displayName, email: ALICE.email, photoURL: null, settings: DEFAULT_SETTINGS,
    });
    const repairedEmpty = (await journalRawFields(path))!;
    expect(Object.keys(repairedEmpty).sort()).toEqual(["createdAt", "displayName", "email", "photoURL", "settings"]);
    expect(repairedEmpty.createdAt).toMatchObject({ timestampValue: expect.any(String) });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);

    const loginOnlyGate = holdDataAgain();
    const stampKeys = ["previousLoginAt", "currentLoginAt", "lastProcessedAuthTime", "updatedAt"];
    const loginOnly: RawFields = Object.fromEntries(stampKeys.map(key => [key, complete[key]]));
    loginOnly.profileSentinel = fixtureField({ owner: "retained across bootstrap", amount: 7.123456789, missingIsNotNull: null });
    await replaceJournalRawFields(path, loginOnly);
    const originalLoginOnly = (await journalRawFields(path))!;
    expect(originalLoginOnly).toEqual(loginOnly);
    expect(Object.hasOwn(originalLoginOnly, "settings")).toBe(false);
    loginOnlyGate.release();
    await expect.poll(() => getDocument(path), { timeout: 15_000 }).toMatchObject({
      displayName: ALICE.displayName, email: ALICE.email, photoURL: null, settings: DEFAULT_SETTINGS,
    });
    await settleReleasedData(loginOnlyGate);
    const healed = (await journalRawFields(path))!;
    for (const [key, value] of Object.entries(originalLoginOnly)) expect(healed[key], key).toEqual(value);
    expect(Object.keys(healed).sort()).toEqual([...Object.keys(originalLoginOnly), "displayName", "photoURL", "email", "settings", "createdAt"].sort());

    await replaceJournalRawFields(path, {
      ...healed, displayName: fixtureField(null), photoURL: fixtureField(null), email: fixtureField(null),
      settings: fixtureField(authoredSettings), createdAt: { timestampValue: "2001-02-03T04:05:06.123456000Z" },
    });
    const preserved = (await journalRawFields(path))!;
    expect(await getDocument(path)).toMatchObject({ displayName: null, photoURL: null, email: null, settings: authoredSettings });
    expect(preserved.createdAt).not.toEqual(healed.createdAt);
    await page.reload();
    await page.getByTestId("account-identity").click();
    await expect(page.getByText("זו ההתחברות הראשונה", { exact: true })).toBeVisible();
    expect(await journalRawFields(path)).toEqual(preserved);
  } finally {
    for (const held of gates) held.release();
    await page.unrouteAll({ behavior: "wait" });
  }
});


test("an offline preference with a missing profile survives reload and reaches the server once", async ({ page, context }, testInfo) => {
  const uid = await freshAccount(page), path = `users/${uid}`;
  await page.goto("/account");
  const quickScan = () => page.getByTestId("account-quick-scan").getByRole("switch");
  await expect(quickScan()).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  const sdk = (action: "observe" | "offline" | "online" | "drain") => page.evaluate(async ({ uid, action }) => {
    const modulePath = "/src/lib/firebase.ts";
    const source = await (await fetch(modulePath)).text();
    const sdkPath = source.match(/from\s*["']([^"']*firebase_firestore[^"']*)["']/)?.[1];
    if (!sdkPath) throw new Error("Firestore SDK import was not present in the served app module");
    const [{ db }, api] = await Promise.all([import(modulePath), import(sdkPath)]);
    if (action === "offline") { await api.disableNetwork(db); return; }
    if (action === "online") { await api.disableNetwork(db); await api.enableNetwork(db); return; }
    if (action === "drain") { await api.waitForPendingWrites(db); return; }
    const state = window as Window & { profileParentObservations?: { exists: boolean; cached: boolean; pending: boolean }[]; profileParentObserver?: () => void };
    state.profileParentObserver?.();
    state.profileParentObservations = [];
    state.profileParentObserver = api.onSnapshot(api.doc(db, "users", uid), { includeMetadataChanges: true }, (snapshot: { exists(): boolean; metadata: { fromCache: boolean; hasPendingWrites: boolean } }) => {
      state.profileParentObservations!.push({ exists: snapshot.exists(), cached: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites });
    });
  }, { uid, action });
  await sdk("drain");
  const missingObserved = (cached: boolean) => page.evaluate(cached =>
    (window as Window & { profileParentObservations?: { exists: boolean; cached: boolean }[] }).profileParentObservations?.some(snapshot => !snapshot.exists && snapshot.cached === cached) ?? false, cached);
  const observedSnapshots = () => page.evaluate(() =>
    (window as Window & { profileParentObservations?: { exists: boolean; cached: boolean; pending: boolean }[] }).profileParentObservations ?? []);
  const cachedSettings = () => page.evaluate(uid => {
    const raw = localStorage.getItem(`tm.cache.v1.${uid}.settings`);
    return raw ? JSON.parse(raw) as { uid: string; data: Record<string, unknown> } : null;
  }, uid);
  let connection: "writes-unavailable" | "all-unavailable" | "online" = "writes-unavailable";
  const firestore = (url: URL) => url.origin === FIRESTORE_HOST;
  await context.route(firestore, async route => {
    const url = route.request().url();
    if (connection === "all-unavailable" || (connection === "writes-unavailable" &&
      (url.includes("/google.firestore.v1.Firestore/Write/") || url.endsWith("/documents:commit")))) {
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  try {
    await sdk("observe");
    await removeJournalDocument(path);
    await expect.poll(() => missingObserved(false), { timeout: 15_000 }).toBe(true);
    expect(await getDocument(path)).toBeNull();
    connection = "all-unavailable";
    await sdk("offline");
    await quickScan().click();
    await expect(quickScan()).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => journalOperations(page, uid)).toHaveLength(1);
    const original = (await journalOperations(page, uid))[0];
    expect(original).toMatchObject({ kind: "settings.update", path, payload: { settings: { quickEntry: true } } });
    const desiredSettings = original.payload!.settings as Record<string, unknown>;
    await expect.poll(cachedSettings).toMatchObject({ uid, data: desiredSettings });
    expect((await cachedSettings())!.data).toEqual(desiredSettings);
    await expect.poll(() => missingObserved(true)).toBe(true);
    await expect(quickScan()).toHaveAttribute("aria-checked", "true");

    // Firestore alone is unavailable so a DEV reload can still fetch Vite
    // modules. Both Auth/Data profile commits and SDK writes remain blocked.
    await page.reload();
    await expect(quickScan()).toHaveAttribute("aria-checked", "true");
    await sdk("observe");
    // Rehydrated SDK mutations may legitimately create a local parent view.
    // The server remains absent; the retained preference must survive either
    // cached representation and reach the server without a duplicate attempt.
    await expect.poll(observedSnapshots, { timeout: 15_000 }).toContainEqual(expect.objectContaining({ cached: true }));
    await testInfo.attach("offline-reload-snapshots", {
      body: JSON.stringify(await observedSnapshots(), null, 2), contentType: "application/json",
    });
    await expect(quickScan()).toHaveAttribute("aria-checked", "true");
    expect((await cachedSettings())!.data).toEqual(desiredSettings);
    await expect.poll(() => journalOperations(page, uid)).toHaveLength(1);
    const recovered = (await journalOperations(page, uid))[0];
    for (const key of ["opId", "version", "kind", "path", "opType", "payload", "beforeImage"] as const) {
      expect(recovered[key], key).toEqual(original[key]);
    }
    expect(await getDocument(path)).toBeNull();

    connection = "online";
    await sdk("online");
    await expect.poll(async () => (await getDocument(path))?.settings, { timeout: 15_000 }).toEqual(desiredSettings);
    await sdk("drain");
    await expect.poll(() => outboxCount(page, uid), { timeout: 15_000 }).toBe(0);
    await expect(quickScan()).toHaveAttribute("aria-checked", "true");
    expect((await cachedSettings())!.data).toEqual(desiredSettings);
  } finally {
    connection = "online";
    await context.unrouteAll({ behavior: "wait" });
  }
});

test("plate keyboard, paste and Enter enforce 5–8 digits and keep found data readonly until correction", async ({ page }) => {
  await freshAccount(page);
  const plates: number[] = [];
  await page.route(CKAN, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("resource_id") === WLTP) return route.fulfill(response([]));
    const plate = Number(JSON.parse(url.searchParams.get("filters") ?? "{}").mispar_rechev);
    plates.push(plate);
    return route.fulfill(response([registry(plate)]));
  });
  const input = page.getByTestId("wizard-plate");
  await input.fill("1234");
  await expect(page.getByTestId("wizard-lookup")).toBeDisabled();
  await input.press("Enter");
  expect(plates).toHaveLength(0);
  await page.getByTestId("wizard-key-5").click();
  await input.press("Enter");
  await expect(page.getByTestId("wizard-make-value")).toHaveText("מאזדה");
  expect(plates).toEqual([12345]);
  await expect(page.getByTestId("wizard-make")).toHaveCount(0);
  await page.getByTestId("wizard-correct").click();
  await expect(page.getByTestId("wizard-confirm-title")).toBeFocused();
  await page.getByTestId("wizard-model").fill("3 ידני");
  await page.getByTestId("wizard-back").click();
  await expect(page.getByTestId("wizard-plate-title")).toBeFocused();
  await input.fill("12-345-678901");
  await expect(input).toHaveValue("123-45-678");
  await page.getByTestId("wizard-key-9").click();
  await expect(input).toHaveValue("123-45-678");
  await page.getByTestId("wizard-key-delete").click();
  await expect(input).toHaveValue("12-345-67");
  await page.getByTestId("wizard-key-clear").click();
  await expect(input).toHaveValue("");
});

test("late registry responses cannot replace manual input or another account's wizard", async ({ page }) => {
  await freshAccount(page);
  const releases: (() => void)[] = [];
  const gates = [0, 1].map(index => new Promise<void>(resolve => { releases[index] = resolve; }));
  const completed = [false, false];
  let started = 0;
  await page.route(CKAN, async route => {
    const index = started++;
    await gates[index];
    await route.fulfill(response([registry()])).catch(() => undefined); // A correctly aborted request is already gone.
    completed[index] = true;
  });
  try {
    await page.getByTestId("wizard-plate").fill("12345678");
    await page.getByTestId("wizard-lookup").click();
    await expect.poll(() => started).toBe(1);
    await page.getByTestId("wizard-manual").click();
    await page.getByTestId("wizard-make").fill("נתון שהקלדתי");
    await page.getByTestId("wizard-model").fill("מקור אישי 42");
    releases[0]();
    await expect.poll(() => completed[0]).toBe(true);
    await expect(page.getByTestId("wizard-make")).toHaveValue("נתון שהקלדתי");
    await expect(page.getByTestId("wizard-model")).toHaveValue("מקור אישי 42");
    await page.getByTestId("wizard-back").click();
    await page.getByTestId("wizard-plate").fill("12345679");
    await page.getByTestId("wizard-lookup").click();
    await expect.poll(() => started).toBe(2);
    await signOut(page);
    await signIn(page, BOB);
    await expect(page.getByTestId("wizard-plate-title")).toBeVisible();
    releases[1]();
    await expect.poll(() => completed[1]).toBe(true);
    await expect(page.getByTestId("wizard-plate")).toHaveValue("");
    await expect(page.getByTestId("wizard-confirmation")).toHaveCount(0);
    expect(await listDocuments(`users/${await uidOf(ALICE)}/vehicles`)).toHaveLength(0);
    expect(await listDocuments(`users/${await uidOf(BOB)}/vehicles`)).toHaveLength(0);
  } finally { releases.forEach(release => release()); }
});

for (const clear of [false, true]) test(`late specification lookup preserves ${clear ? "explicit numeric clears" : "precise authored numbers"} and optional Skip saves the actual input`, async ({ page }) => {
  const uid = await freshAccount(page);
  let release = () => {};
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(CKAN, async route => {
    started = true;
    await gate;
    await route.fulfill(response([{ tozeret_nm: "מאזדה", tozar: "מאזדה", kinuy_mishari: "3", shnat_yitzur: 2020,
      CO2_WLTP: 155, nefah_manoa: 1998, merkav: "סדאן" }])).catch(() => undefined);
  });
  try {
    await manualWizard(page, { year: "2020" });
    await expect.poll(() => started).toBe(true);
    await page.getByTestId("wizard-tank").fill("47.1256789");
    await page.getByTestId("wizard-declared").fill("14.8123456");
    await page.getByTestId("wizard-nickname").fill("בעלות על המספרים 42");
    if (clear) {
      await page.getByTestId("wizard-tank").fill("");
      await page.getByTestId("wizard-declared").fill("");
    }
    release();
    await expect(page.locator(".wizard-specs-loading")).toHaveCount(0);
    await expect(page.getByTestId("wizard-tank")).toHaveValue(clear ? "" : "47.1256789");
    await expect(page.getByTestId("wizard-declared")).toHaveValue(clear ? "" : "14.8123456");
    await page.getByTestId("wizard-skip").click();
    await expect.poll(async () => (await listDocuments(`users/${uid}/vehicles`)).length).toBe(1);
    const [vehicle] = await listDocuments(`users/${uid}/vehicles`);
    expect(vehicle.data).toMatchObject({ nickname: "בעלות על המספרים 42", tankLiters: clear ? null : 47.1256789,
      tankLitersSource: "user", declaredKmPerLiter: clear ? null : 14.8123456,
      declaredSource: "user" });
    if (clear) expect(vehicle.data).toMatchObject({ tankSourceUrl: null, specSourceUrl: null });
    await waitForVehicleSelection({ uid, vehicleId: vehicle.id });
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
    await page.reload();
    expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(1);
    expect(await getDocument(`users/${uid}/vehicles/${vehicle.id}`)).toEqual(vehicle.data);
  } finally { release(); }
});

test("first-run unmount and a refused selection enqueue retain one exact vehicle creation for selection retry", async ({ page }) => {
  const uid = await freshAccount(page);
  await noRegistry(page);
  await manualWizard(page);
  await page.getByTestId("wizard-nickname").fill("יצירה אחת בלבד");
  await page.getByTestId("wizard-tank").fill("47.1256789");
  await page.evaluate(async uid => {
    type Hook = Window & { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> }; creationProof?: { adds: OutboxOperation[]; refused: boolean; restore: () => void } };
    const win = window as Hook, box = await win.__tankMalleTest.openOutbox(uid);
    const prototype = Object.getPrototypeOf(box) as Outbox, original = prototype.enqueueMany;
    box.close();
    const proof = { adds: [] as OutboxOperation[], refused: false, restore: () => { prototype.enqueueMany = original; } };
    win.creationProof = proof;
    prototype.enqueueMany = async function(inputs) {
      if (!proof.refused && inputs.some(input => input.kind === "settings.update" && JSON.stringify(input.payload).includes("vehicle-selection-intent"))) {
        proof.refused = true;
        throw new Error("e2e: first selection disk commit refused");
      }
      const result = await original.call(this, inputs);
      proof.adds.push(...result.filter(operation => operation.kind === "vehicle.add"));
      return result;
    };
  }, uid);
  await holdFirestoreDisk(page);
  try {
    await page.getByTestId("wizard-save").click();
    await expect(page.getByTestId("wizard-create-status")).toHaveAttribute("data-write-state", "pending");
    await expect(page.getByTestId("wizard-created-title")).toBeFocused();
    expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
    await captureJournal(page, "wizard-created-pending-light-plate");
    await releaseFirestoreDisk(page);
    await expect(page.getByTestId("vehicle-wizard")).toHaveCount(0);
    await expect(page.locator("[data-toast-title]").filter({ hasText: "בחירת הרכב עוד לא הושלמה" })).toBeVisible();
    const proof = await page.evaluate(() => {
      const proof = (window as Window & { creationProof: { adds: OutboxOperation[]; refused: boolean } }).creationProof;
      return { adds: proof.adds, refused: proof.refused };
    });
    expect(proof.refused).toBe(true);
    expect(proof.adds).toHaveLength(1);
    const creation = proof.adds[0];
    expect(creation.kind).toBe("vehicle.add");
    expect(creation.version).toBe(1);
    const rows = await listDocuments(`users/${uid}/vehicles`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(creation.docId);
    expect(rows[0].data).toMatchObject({ nickname: "יצירה אחת בלבד", tankLiters: 47.1256789, tankLitersSource: "user" });
    expect((await getDocument(`users/${uid}`))?.settings).not.toMatchObject({ activeVehicleId: creation.docId });
    await page.getByRole("button", { name: "ניסיון נוסף", exact: true }).click();
    await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: creation.docId });
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
    expect(await page.evaluate(() => (window as Window & { creationProof: { adds: unknown[] } }).creationProof.adds.length)).toBe(1);
    expect(await listDocuments(`users/${uid}/vehicles`)).toEqual(rows);
  } finally {
    await releaseFirestoreDisk(page);
    await page.evaluate(() => (window as Window & { creationProof?: { restore: () => void } }).creationProof?.restore());
  }
});

test("reload exposes the actual durably journaled first vehicle before any new attempt, and its real retry creates it once", async ({ page }) => {
  const uid = await freshAccount(page);
  await noRegistry(page);
  await manualWizard(page);
  await page.getByTestId("wizard-tank").fill("47.1256789");
  await holdJournal(page, uid, "vehicle.add", "after");
  try {
    await page.getByTestId("wizard-save").click();
    await waitForJournalHold(page, true);
    const [creation] = await journalOperations(page, uid);
    expect(creation.kind).toBe("vehicle.add");
    expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
    await page.reload();
    await expect(page.getByTestId("wizard-recovery")).toHaveAttribute("data-state", "retained");
    await expect(page.getByTestId("wizard-recovery-title")).toBeFocused();
    const retained = page.getByTestId("wizard-retained-creation");
    await expect(retained).toHaveAttribute("data-operation-id", creation.opId);
    await expect(retained).toHaveAttribute("data-vehicle-id", creation.docId);
    await expect(page.getByTestId("wizard-manual")).toHaveCount(0);
    expect((await journalOperations(page, uid)).filter(operation => operation.kind === "vehicle.add")).toHaveLength(1);
    await page.getByTestId("wizard-recover").click();
    await expect(page).toHaveURL(/\/settings\/unsynced$/);
    const recovered = (await journalOperations(page, uid)).find(operation => operation.opId === creation.opId)!;
    expect(recovered.payload).toEqual(creation.payload);
    expect(recovered.beforeImage).toEqual(creation.beforeImage);
    await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    await expect.poll(async () => (await listDocuments(`users/${uid}/vehicles`)).map(row => row.id)).toEqual([creation.docId]);
    await expect.poll(() => outboxCount(page, uid)).toBe(0);
    expect(await getDocument(creation.path)).toMatchObject({ tankLiters: 47.1256789, tankLitersSource: "user" });
    await page.reload();
    expect((await listDocuments(`users/${uid}/vehicles`)).map(row => row.id)).toEqual([creation.docId]);
  } finally { await releaseJournal(page); }
});

test("unknown first-run outbox health cannot imply that no earlier vehicle creation exists", async ({ page }) => {
  const uid = await freshAccount(page);
  const unreadable = '{"operations":invalid-preserve-first-vehicle';
  await page.evaluate(({ uid, unreadable }) => localStorage.setItem(`tm.outbox.v1.${uid}`, unreadable), { uid, unreadable });
  await page.reload();
  await expect(page.getByTestId("wizard-recovery")).toHaveAttribute("data-state", "unknown");
  await expect(page.getByTestId("wizard-manual")).toHaveCount(0);
  await expect(page.getByTestId("wizard-add-different")).toHaveCount(0);
  await page.getByTestId("wizard-recover").click();
  await expect(page).toHaveURL(/\/settings\/unsynced$/);
  expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
  expect(await page.evaluate(unreadable => Object.keys(localStorage).some(key => localStorage.getItem(key) === unreadable), unreadable)).toBe(true);
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`entry and wizard native gallery — ${theme} ${accent}`, async ({ page }) => {
    test.setTimeout(120_000);
    await resetEmulators();
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript(({ theme, accent }) => { localStorage.setItem("tm.theme", theme); localStorage.setItem("tm.accent", JSON.stringify({ id: accent })); }, { theme, accent });
    await page.goto("/");
    const suffix = `${theme}-${accent}`;
    const controls = [];
    const geometry = [];
    for (let slide = 1; slide <= 3; slide++) {
      await expect(page.getByTestId("onboarding-slide")).toHaveAttribute("data-slide", String(slide));
      await vehicleTarget(page.getByTestId("onboarding-next"));
      await captureJournal(page, `onboarding-${slide}-${suffix}`);
      if (slide === 1) {
        const rows = await page.locator(".entry-pump-art .tm-pump-line").evaluateAll(lines => lines.map(line => {
          const value = line.querySelector(".entry-pump-value")!, label = line.querySelector(".tm-pump-label")!;
          const range = document.createRange(); range.selectNodeContents(value);
          const text = range.getBoundingClientRect(), box = line.getBoundingClientRect(), labelBox = label.getBoundingClientRect();
          return { valueLeft: text.left, valueRight: text.right, rowLeft: box.left, labelLeft: labelBox.left };
        }));
        for (const row of rows) {
          expect(Math.abs(row.valueLeft - row.rowLeft)).toBeLessThanOrEqual(2);
          expect(row.valueRight).toBeLessThanOrEqual(row.labelLeft);
        }
        geometry.push({ id: "onboarding-row-values", rows });
      }
      await page.getByTestId("onboarding-next").click();
    }
    await expect(page.getByTestId("signin")).toBeVisible();
    await expect(page.getByTestId("app-atmosphere")).toHaveAttribute("data-variant", "home");
    await captureJournal(page, `signin-${suffix}`);
    await page.getByTestId("signin-google").click();
    await expect(page.getByTestId("signin-consent")).toBeFocused();
    if (theme === "light" && accent === "plate") await captureEntry320(page, "signin-consent-error", [
      page.getByTestId("signin-consent"), page.getByTestId("signin-google"),
      page.locator('a[href="/legal/terms"]'), page.locator('a[href="/legal/privacy"]'),
    ]);
    await captureJournal(page, `signin-consent-error-${suffix}`);
    for (const [name, target] of [
      ["signin-consent", page.getByTestId("signin-consent")],
      ["signin-consent-mark", page.locator(".entry-consent-control > span")],
      ["signin-consent-copy", page.locator(".entry-consent-copy label")],
      ["signin-consent-error", page.getByTestId("signin-consent-error")],
      ["signin-google", page.getByTestId("signin-google")],
    ] as const) controls.push(await entryControlEvidence(name, target));
    await signIn(page, ALICE);
    const uid = await uidOf(ALICE);
    await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toBeTruthy();
    await homeAppearance(page, uid, theme, accent);
    await page.route(CKAN, route => new URL(route.request().url()).searchParams.get("resource_id") === WLTP
      ? route.fulfill(response([])) : route.fulfill(response([registry()])));
    await expect(page.getByTestId("wizard-plate-title")).toBeFocused();
    await expect(page.getByTestId("app-atmosphere")).toHaveAttribute("data-variant", "vehicle");
    await captureJournal(page, `wizard-plate-${suffix}`);
    const keypadGap = await page.locator(".wizard-keypad").evaluate(element => element.getBoundingClientRect().top
      - document.querySelector(".wizard-plate")!.getBoundingClientRect().bottom);
    expect(keypadGap).toBeGreaterThanOrEqual(16);
    expect(keypadGap).toBeLessThanOrEqual(20);
    geometry.push({ id: "wizard-keypad-gap", gap: keypadGap });
    await page.getByTestId("wizard-plate").fill("12345678");
    if (theme === "light" && accent === "plate") {
      await expect(page.getByTestId("wizard-plate")).toHaveValue("123-45-678");
      await expect(page.getByTestId("wizard-plate")).toBeFocused();
      await captureEntry320(page, "wizard-plate-typed", [
        page.getByTestId("wizard-plate"), page.getByTestId("wizard-lookup"), page.getByTestId("wizard-manual"),
        ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "clear", "delete"].map(key => page.getByTestId(`wizard-key-${key}`)),
      ]);
    }
    await captureJournal(page, `wizard-plate-typed-${suffix}`);
    controls.push(await entryControlEvidence("wizard-plate", page.getByTestId("wizard-plate")));
    await page.getByTestId("wizard-lookup").click();
    await expect(page.getByTestId("wizard-confirmation")).toBeVisible();
    await captureJournal(page, `wizard-confirm-${suffix}`);
    geometry.push({ id: "wizard-confirm-plate", ...await vehiclePlateGeometry(page.locator(".wizard-confirm-plate"), 60) });
    const hierarchy = await page.locator(".wizard-readonly").evaluate(element => {
      const label = getComputedStyle(element.querySelector("dt")!), value = getComputedStyle(element.querySelector("dd")!);
      return { labelSize: Number.parseFloat(label.fontSize), valueSize: Number.parseFloat(value.fontSize),
        labelWeight: Number(label.fontWeight), valueWeight: Number(value.fontWeight) };
    });
    expect(hierarchy.labelSize).toBeGreaterThan(hierarchy.valueSize);
    expect(hierarchy.labelWeight).toBeGreaterThan(hierarchy.valueWeight);
    geometry.push({ id: "wizard-confirm-hierarchy", ...hierarchy });
    await page.getByTestId("wizard-correct").click();
    await expect(page.getByTestId("wizard-confirm-title")).toBeFocused();
    await captureJournal(page, `wizard-correct-${suffix}`);
    await page.getByTestId("wizard-catalog-open").click();
    await expect(page.getByTestId("wizard-catalog-title")).toBeFocused();
    await page.getByTestId("wizard-catalog-search").fill("מזדה");
    await captureJournal(page, `wizard-catalog-make-${suffix}`);
    await page.getByTestId("wizard-catalog-option").filter({ has: page.getByText("מזדה", { exact: true }) }).click();
    await expect(page.getByTestId("wizard-catalog-title")).toBeFocused();
    await captureJournal(page, `wizard-catalog-model-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wizard-catalog-open")).toBeFocused();
    await page.getByTestId("wizard-confirm-next").click();
    if (theme === "light" && accent === "plate") {
      await expect(page.getByRole("heading", { name: "עוד שני פרטים", exact: true })).toBeFocused();
      geometry.push({ id: "wizard-extras-320", pair: await captureEntry320(page, "wizard-extras", ["wizard-nickname", "wizard-tank", "wizard-declared", "wizard-save", "wizard-skip"]
        .map(id => page.getByTestId(id))) });
    }
    await captureJournal(page, `wizard-extras-${suffix}`);
    const tank = page.getByTestId("wizard-tank"), declared = page.getByTestId("wizard-declared");
    geometry.push({ id: "wizard-extras-390", ...await vehicleFieldPair(tank, declared) });
    await tank.fill("-1"); await declared.fill("-2");
    await page.getByTestId("wizard-save").click();
    await expect(tank).toBeFocused();
    await expect(declared).toHaveAttribute("aria-invalid", "true");
    await tank.fill("47.125");
    await expect(tank).toBeFocused();
    await expect(declared).toHaveAttribute("aria-invalid", "true");
    await page.getByTestId("wizard-save").click();
    await expect(declared).toBeFocused();
    if (theme === "light" && accent === "plate") await captureEntry320(page, "wizard-errors", ["wizard-tank", "wizard-declared", "wizard-save", "wizard-skip"]
      .map(id => page.getByTestId(id)));
    await captureJournal(page, `wizard-errors-${suffix}`);
    const targets = [];
    for (const id of ["wizard-tank", "wizard-declared", "wizard-save", "wizard-skip"]) targets.push({ id, ...await vehicleTarget(page.getByTestId(id)) });
    for (const id of ["wizard-tank", "wizard-declared", "wizard-save", "wizard-skip"]) controls.push(await entryControlEvidence(id, page.getByTestId(id)));
    controls.push(await entryControlEvidence("wizard-declared-error", page.locator('.wizard-extra-fields [id$="-error"]')));
    expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
    await mkdir(journalEvidence, { recursive: true });
    await writeFile(resolve(journalEvidence, `entry-controls-${suffix}.json`), JSON.stringify({ viewport: { width: 390, height: 844 }, theme, accent, targets, controls, geometry,
      reducedMotion: await page.locator(".wizard-step").evaluate(node => ({ animation: getComputedStyle(node).animationName, transition: getComputedStyle(node).transitionDuration })) }, null, 2));
    // These are actual durable interrupted attempts, not a visual-only mock.
    await declared.fill("14.8123456");
    await holdJournal(page, uid, "vehicle.add", "after");
    await page.getByTestId("wizard-save").click();
    await waitForJournalHold(page, true);
    const [creation] = await journalOperations(page, uid);
    expect(creation.kind).toBe("vehicle.add");
    await page.reload();
    await expect(page.getByTestId("wizard-recovery")).toHaveAttribute("data-state", "retained");
    await expect(page.getByTestId("wizard-recovery-title")).toBeFocused();
    await expect(page.getByTestId("wizard-retained-creation")).toHaveAttribute("data-operation-id", creation.opId);
    await captureJournal(page, `wizard-recovery-${suffix}`);
    await page.getByTestId("wizard-add-different").click();
    await expect(page.getByTestId("wizard-plate-title")).toBeFocused();
    expect((await journalOperations(page, uid)).filter(operation => operation.kind === "vehicle.add")).toHaveLength(1);
    await page.reload();
    await expect(page.getByTestId("wizard-recovery")).toHaveAttribute("data-state", "retained");
    const unreadable = '{"operations":invalid-gallery-preserve';
    await page.evaluate(({ uid, unreadable }) => localStorage.setItem(`tm.outbox.v1.${uid}`, unreadable), { uid, unreadable });
    await page.reload();
    await expect(page.getByTestId("wizard-recovery")).toHaveAttribute("data-state", "unknown");
    await expect(page.getByTestId("wizard-recovery-title")).toBeFocused();
    await captureJournal(page, `wizard-recovery-unknown-${suffix}`);
    await expect(page.getByTestId("wizard-manual")).toHaveCount(0);
    expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
  });
}
