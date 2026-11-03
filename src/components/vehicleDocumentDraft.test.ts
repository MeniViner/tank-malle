import { describe, expect, it } from 'vitest';
import { vehicleDocumentDraftChanges, type VehicleDocumentDraft } from './vehicleDocumentDraft';

const empty: VehicleDocumentDraft = { insurer: '', dueText: '', costText: '', coverage: '' };

describe('licensing form intent', () => {
  it('does not create defaults on an empty untouched form', () => {
    expect(vehicleDocumentDraftChanges('coverage', {}, empty, new Set())).toEqual({ ok: true, changes: {} });
  });

  it('keeps missing/null coverage type and missing/null/zero costs untouched during an insurer edit', () => {
    for (const values of [{}, { type: null, cost: null }, { cost: 0 }]) {
      expect(vehicleDocumentDraftChanges('coverage', values, { ...empty, insurer: 'הראל' }, new Set(['insurer'])))
        .toEqual({ ok: true, changes: { insurer: 'הראל' } });
    }
  });

  it('validates the visible date instead of reusing the stored valid day', () => {
    const result = vehicleDocumentDraftChanges('mandatory', { due: '2026-09-05' }, { ...empty, dueText: '31/02/2026', insurer: 'הראל' }, new Set(['insurer', 'due']));
    expect(result).toMatchObject({ ok: false, field: 'due' });
  });

  it('clears a date only after an explicit clear and stores a strict parsed civil day', () => {
    expect(vehicleDocumentDraftChanges('test', { due: '2026-09-05' }, empty, new Set(['due'])))
      .toEqual({ ok: true, changes: { due: null } });
    expect(vehicleDocumentDraftChanges('test', {}, { ...empty, dueText: '05/09/26' }, new Set(['due'])))
      .toEqual({ ok: true, changes: { due: '2026-09-05' } });
  });

  it('keeps exact metadata cost precision and authored zero', () => {
    for (const text of ['0', '1234.56789', '1000000']) {
      expect(vehicleDocumentDraftChanges('mandatory', {}, { ...empty, costText: text }, new Set(['cost'])))
        .toEqual({ ok: true, changes: { cost: Number(text) } });
    }
    expect(vehicleDocumentDraftChanges('mandatory', { cost: 0 }, empty, new Set(['cost'])))
      .toEqual({ ok: true, changes: { cost: null } });
  });

  it('blocks invalid or unbounded typed costs instead of truncating them', () => {
    for (const text of ['-1', '1000000.01', '12₪', 'Infinity', '12..3', '1e1000']) {
      expect(vehicleDocumentDraftChanges('mandatory', {}, { ...empty, costText: text }, new Set(['cost'])))
        .toMatchObject({ ok: false, field: 'cost' });
    }
  });

  it('explicit none clears only owned known metadata, retaining omission/null distinctions', () => {
    expect(vehicleDocumentDraftChanges('coverage', {}, { ...empty, coverage: 'none' }, new Set(['type'])))
      .toEqual({ ok: true, changes: { type: 'none' } });
    expect(vehicleDocumentDraftChanges('coverage', { insurer: null, cost: 0, due: '2026-09-05' }, { ...empty, coverage: 'none' }, new Set(['type'])))
      .toEqual({ ok: true, changes: { type: 'none', cost: null, due: null } });
    expect(vehicleDocumentDraftChanges('coverage', { type: 'none', due: '2026-09-05' }, { ...empty, coverage: 'none' }, new Set()))
      .toEqual({ ok: true, changes: {} });
  });

  it('uses the retained unsaved drafts when toggling back to insurance', () => {
    expect(vehicleDocumentDraftChanges('coverage', { type: 'comprehensive' }, { insurer: 'ליברה', dueText: '05/09/2026', costText: '1250.125', coverage: 'third' }, new Set(['type', 'insurer', 'due', 'cost'])))
      .toEqual({ ok: true, changes: { type: 'third', insurer: 'ליברה', due: '2026-09-05', cost: 1250.125 } });
  });

  it('does not promote fields belonging to another document or copy unknown keys', () => {
    const stored = { due: '2026-09-05', future: { retained: true } };
    expect(vehicleDocumentDraftChanges('test', stored, { ...empty, insurer: 'הראל', costText: '3', coverage: 'third' }, new Set(['type', 'insurer', 'cost'])))
      .toEqual({ ok: true, changes: {} });
    expect(stored.future).toEqual({ retained: true });
  });
});
