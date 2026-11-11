import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Loads public/push-handler.js (imported by the generated service worker) against a fake worker scope. */
function worker(clients: { url: string }[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const actions: string[] = [];
  const windows = clients.map(client => ({ ...client, focus: async () => { actions.push(`focus ${client.url}`); }, navigate: async (url: string) => { actions.push(`navigate ${url}`); } }));
  const self = {
    location: { origin: 'https://tank-malle.web.app' },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => { actions.push(`open ${url}`); } },
  };
  runInNewContext(readFileSync('public/push-handler.js', 'utf8'), { self, URL });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
  };
  return { dispatch, shown, actions };
}
const push = (body: unknown) => ({ data: { json: () => typeof body === 'string' ? JSON.parse(body) : body, text: () => String(body) } });

describe('push-handler.js', () => {
  it('shows the sent title, body and tag in Hebrew RTL, keeping the in-app path', async () => {
    const w = worker();
    await w.dispatch('push', push({ title: 'טסט שנתי · בעוד 5 ימים', body: 'תוקף עד 16/11/2026', url: '/vehicle?doc=test', tag: 'note-1' }));
    expect(w.shown).toEqual([{ title: 'טסט שנתי · בעוד 5 ימים', options: expect.objectContaining({ body: 'תוקף עד 16/11/2026', tag: 'note-1', dir: 'rtl', lang: 'he', data: { url: '/vehicle?doc=test' } }) }]);
  });
  it('falls back to the app name and the notifications list for odd payloads, never an outside URL', async () => {
    const w = worker();
    await w.dispatch('push', push({ url: 'https://evil.example/' }));
    expect(w.shown[0]).toMatchObject({ title: 'טנק מלא', options: { body: '', data: { url: '/notifications' } } });
    await w.dispatch('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'plain text' } });
    expect(w.shown[1]).toMatchObject({ title: 'טנק מלא', options: { body: 'plain text' } });
  });
  it('a tap focuses an open app window and navigates it; with none open it opens the page', async () => {
    const open = worker([{ url: 'https://tank-malle.web.app/' }]);
    const close = () => undefined;
    await open.dispatch('notificationclick', { notification: { close, data: { url: '/vehicle/reminders/p1' } } });
    expect(open.actions).toEqual(['focus https://tank-malle.web.app/', 'navigate https://tank-malle.web.app/vehicle/reminders/p1']);
    const none = worker();
    await none.dispatch('notificationclick', { notification: { close, data: { url: '/notifications' } } });
    expect(none.actions).toEqual(['open https://tank-malle.web.app/notifications']);
  });
});
