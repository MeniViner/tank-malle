import { describe, expect, it } from 'vitest';
import { createNotificationUndo, restoredNotification } from './notificationUndo';
import { validVehicleRecord, type NotificationState } from './model';

const base: NotificationState = { id: 'notice', schemaVersion: 1, version: 2, occurrence: 'service:1',
  read: false, archived: true, snoozeUntilDay: '2026-12-01' };

describe('notification Undo', () => {
  it('clears a deletion tombstone with a newer version and restores the exact prior state', () => {
    const written = { ...base, version: 3, deleted: true, read: true };
    const restored = restoredNotification(base, written);
    expect(restored).toEqual({ ...base, version: 4, deleted: false });
    expect(validVehicleRecord('notificationStates', restored)).toBe(true);
    expect(written.deleted).toBe(true);
  });
  it('issues one restore even when the user invokes Undo again before its promise settles', async () => {
    let writes = 0, finish!: () => void;
    const undo = createNotificationUndo(() => true, () => { writes++; return new Promise(resolve => { finish = resolve; }); }, () => 100);
    const first = undo();
    expect(await undo()).toBe(false);
    expect(writes).toBe(1);
    finish();
    expect(await first).toBe(true);
  });
  it('rejects a stale account/vehicle lifetime even if the same IDs become active again', async () => {
    const oldLifetime = {};
    let active = oldLifetime, writes = 0;
    const undo = createNotificationUndo(() => active === oldLifetime, async () => { writes++; }, () => 100);
    active = {}; active = {};
    expect(await undo()).toBe(false);
    expect(writes).toBe(0);
  });
  it('expires exactly at the advertised five-second boundary', async () => {
    let time = 10, writes = 0;
    const undo = createNotificationUndo(() => true, async () => { writes++; }, () => time);
    time = 5_010;
    expect(await undo()).toBe(false);
    expect(writes).toBe(0);
  });
  it('does not replay a failed restore from the same toast', async () => {
    let writes = 0;
    const undo = createNotificationUndo(() => true, async () => { writes++; throw new Error('offline'); });
    await expect(undo()).rejects.toThrow('offline');
    expect(await undo()).toBe(false);
    expect(writes).toBe(1);
  });
});
