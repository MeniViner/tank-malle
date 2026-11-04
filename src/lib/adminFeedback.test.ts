import { describe, expect, it } from 'vitest';
import { adminFeedbackStorageKey, readHandledFeedback, updateHandledFeedback } from './adminFeedback';

describe('personal admin feedback markers', () => {
  it('isolates storage for separate admin accounts, including encoded identifiers', () => {
    expect(adminFeedbackStorageKey('admin-a')).not.toBe(adminFeedbackStorageKey('admin-b'));
    expect(adminFeedbackStorageKey('admin/a')).not.toBe(adminFeedbackStorageKey('admin%2Fa'));
  });

  it('round-trips handled and reopened items without changing the previous state', () => {
    const original = new Set(['older']);
    const marked = updateHandledFeedback(original, 'new', true);
    expect([...original]).toEqual(['older']);
    expect([...readHandledFeedback(JSON.stringify([...marked]))]).toEqual(['older', 'new']);
    expect([...updateHandledFeedback(marked, 'new', false)]).toEqual(['older']);
  });

  it.each([null, '', 'broken json', '{}', '[null, {}, 1, "", "bad/path"]'])('recovers from malformed local storage: %s', raw => {
    expect(readHandledFeedback(raw).size).toBe(0);
  });

  it('keeps only valid document ids, treating __proto__ as a plain id', () => {
    expect([...readHandledFeedback('["ok", "__proto__", "ok", "bad/path", 5]')]).toEqual(['ok', '__proto__']);
  });

  it('bounds long-lived triage history while preserving a freshly handled item', () => {
    const current = new Set(Array.from({ length: 500 }, (_, index) => `entry-${index}`));
    const next = updateHandledFeedback(current, 'fresh', true);
    expect(next.size).toBe(500);
    expect(next.has('entry-0')).toBe(false);
    expect(next.has('entry-499')).toBe(true);
    expect(next.has('fresh')).toBe(true);
    expect(readHandledFeedback(JSON.stringify(Array.from({ length: 700 }, (_, i) => `entry-${i}`))).size).toBe(500);
  });
});
