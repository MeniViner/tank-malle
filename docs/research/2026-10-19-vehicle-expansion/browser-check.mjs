// Local prototype checks only. No Firebase, accounts, or external network calls.
import { chromium, webkit } from '@playwright/test';
import { writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const checks = [];
for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const executablePath = name === 'webkit' ? process.env.TANK_RESEARCH_WEBKIT_PATH ?? browserType.executablePath() : browserType.executablePath();
  if (!existsSync(executablePath)) { checks.push({ browser: name, status: 'not-run', reason: 'browser executable unavailable' }); continue; }
  let browser;
  try { browser = await browserType.launch({ headless: true, executablePath }); }
  catch (error) { checks.push({ browser: name, status: 'not-run', reason: String(error.message).slice(0,250) }); continue; }
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== 'http://127.0.0.1:4179') externalRequests.push(request.url()); });
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Simulated permission denial', 'NotAllowedError'); };
    });
    await page.goto('http://127.0.0.1:4179/');
    // Two rapid photo selections must read the newest image, never drop it.
    await page.evaluate(() => { document.getElementById('sample').click(); document.getElementById('sample').click(); });
    await page.waitForFunction(() => document.getElementById('total').value === '287.40');
    assert.equal(await page.locator('#liters').inputValue(), '40.000');
    await page.locator('#total').fill('299.00');
    await page.locator('#scan').click();
    await page.waitForFunction(() => !document.getElementById('scan').disabled);
    assert.equal(await page.locator('#total').inputValue(), '299.00');
    await page.locator('#total').fill('');
    await page.locator('#scan').click();
    await page.waitForFunction(() => document.getElementById('total').value === '287.40');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await page.locator('#camera').click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('לא הצלחנו'));
    assert.equal(await page.locator('#total').inputValue(), '287.40');
    assert.equal(await page.locator('#native-fallback').isVisible(), true);
    if (name === 'chromium') {
      await page.evaluate(async () => {
        const { demoPhoto } = await import('./synthetic-fixtures.mjs');
        const fixture = demoPhoto('pump');
        const camera = document.createElement('canvas');
        camera.width = fixture.width; camera.height = fixture.height;
        camera.getContext('2d').putImageData(new ImageData(fixture.data, fixture.width, fixture.height), 0, 0);
        const stream = camera.captureStream(10);
        window.testCamera = camera;
        window.testTrack = stream.getVideoTracks()[0];
        navigator.mediaDevices.getUserMedia = async () => stream;
      });
      await page.locator('#camera').click();
      await page.waitForFunction(() => document.getElementById('video').videoWidth > 0 && !document.getElementById('capture').disabled);
      await page.locator('#capture').click();
      await page.waitForFunction(() => window.testTrack.readyState === 'ended' && !document.getElementById('scan').disabled);
      assert.equal(await page.locator('#total').inputValue(), '287.40');
    }
    await page.locator('#continue').click();
    await page.locator('#sample').click();
    await page.waitForFunction(() => document.getElementById('odometer').value === '128450');
    await page.locator('#continue').click();
    assert.equal(await page.locator('#review-view').isVisible(), false);
    assert.match(await page.locator('#notice').textContent(), /יש לאשר/);
    await page.locator('#confirm-odo').check();
    await page.locator('#continue').click();
    assert.match(await page.locator('#review-price').textContent(), /7.185/);
    await page.locator('#finish').click();
    assert.match(await page.locator('#done').textContent(), /לא נשמרה/);

    await page.locator('#edit').click();
    // Exercise image decoding and file input, not just the demo button.
    const png = await page.evaluate(async () => {
      const { demoPhoto } = await import('./synthetic-fixtures.mjs');
      const fixture = demoPhoto('pump');
      const image = document.createElement('canvas');
      image.width = fixture.width; image.height = fixture.height;
      image.getContext('2d').putImageData(new ImageData(fixture.data, fixture.width, fixture.height), 0, 0);
      return image.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#file').setInputFiles({ name: 'synthetic-pump.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.getElementById('sample-label').hidden && !document.getElementById('scan').disabled);
    assert.equal(await page.locator('#total').inputValue(), '287.40');
    assert.equal(await page.locator('#liters').inputValue(), '40.000');
    // The fixture is now uploaded, so label it synthetic again for the screenshot.
    await page.locator('#sample').click();
    await page.waitForFunction(() => !document.getElementById('scan').disabled);
    if (name === 'chromium') {
      await page.setViewportSize({ width: 1180, height: 1080 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: new URL('./prototype-preview.png', import.meta.url).pathname, fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    checks.push({ browser: name, version: browser.version(), executablePath, status: 'passed', viewport: '390x844 (desktop screenshot also checked in Chromium)', assertions: ['synthetic pump and blue odometer pixels', 'newest photo wins after rapid replacement', 'manual input preserved on re-scan', 'missing odometer confirmation blocks review', 'derived price 7.185', 'no application save', 'camera denial fallback', ...(name === 'chromium' ? ['synthetic camera stream capture and track shutdown'] : []), 'local PNG file decoding', 'no horizontal overflow', 'no page errors', 'no external requests'] });
    await context.close();
  } finally { await browser.close(); }
}
const result = { checkedAt: new Date().toISOString(), scope: 'Synthetic local prototype only; desktop browser engines, not physical Android or iPhone. No real camera hardware or real fuel display photos tested.', checks };
writeFileSync(new URL('./validation.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
