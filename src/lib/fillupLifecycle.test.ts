import { describe, expect, it, vi } from 'vitest';
import { createFillupEditUndo, fillupAfterPatch, fillupLifecycleImage, fillupLifecyclePatch } from './fillupLifecycle';
import { parseFillupDocument, serializeFillup, serializeFillupPatch } from './fillupSerializer';
import { fillupBaseMatches } from './writesBase';
import type { MutationReceipt } from './writes';
import type { OutboxPayload } from './outbox';

const raw = {
  date: 1_780_000_000_000, odometer: 90_000, liters: 40.125,
  pricePerLiter: 7.185123456, totalCost: 288.303078672, isFullTank: true,
  createdAt: 1_779_000_000_000, version: 2, writeId: 'previous.1',
};

function read(data: Record<string, unknown>) {
  const parsed = parseFillupDocument('receipt', data);
  if (!parsed.ok) throw new Error('invalid fixture');
  return parsed.fillup;
}

describe('existing fill-up lifecycle images', () => {
  it.each(['', '   ', '  הערה מקורית\n '])('retains original notes %j for exact deletion and restoration', notes => {
    const stored = { ...raw, notes };
    const captured = Object.freeze(read(stored));
    const before = fillupLifecycleImage(captured);
    expect(before.notes).toBe(notes);
    expect(fillupBaseMatches(before, stored)).toBe(true);
    const restored = fillupLifecycleImage({ ...captured, version: captured.version! + 1 });
    expect(restored).toEqual({ ...before, version: 3 });
    expect(captured.notes).toBe(notes);
    expect(serializeFillup(captured).notes).toBe(notes.trim() || null);
  });

  it('still refuses a concurrent null, trimmed note, or precise numeric change', () => {
    const stored = { ...raw, notes: '' };
    const before = fillupLifecycleImage(read(stored));
    expect(fillupBaseMatches(before, { ...stored, notes: null })).toBe(false);
    expect(fillupBaseMatches(before, { ...stored, totalCost: raw.totalCost + 0.000001 })).toBe(false);
    const spaced = { ...raw, notes: '  text  ' };
    expect(fillupBaseMatches(fillupLifecycleImage(read(spaced)), { ...spaced, notes: 'text' })).toBe(false);
  });

  it('retains the existing whitelist, markers, monetary precision and creation metadata', () => {
    const captured = { ...read({ ...raw, notes: '' }), displayOnly: 'never stored' };
    const image = fillupLifecycleImage(captured);
    expect(image).not.toHaveProperty('id');
    expect(image).not.toHaveProperty('displayOnly');
    for (const key of ['date', 'liters', 'pricePerLiter', 'totalCost', 'createdAt', 'version', 'writeId'] as const) {
      expect(image[key]).toBe(raw[key]);
    }
  });

  it.each([null, undefined, 'already canonical'])('keeps ordinary captured notes %j on the existing serialization path', notes => {
    const captured = read({ ...raw, notes });
    expect(fillupLifecycleImage(captured)).toEqual(serializeFillup(captured));
  });
});

describe('existing edit bases and canonical submitted snapshots', () => {
  it.each(['', '  legacy\n '])('retains the original %j base while keeping authored next cleanup authoritative', notes => {
    const previous = read({ ...raw, notes });
    const before = fillupLifecyclePatch(previous);
    const outgoing: OutboxPayload = { ...serializeFillupPatch({ ...previous, notes: '  edited\n ', version: 3 }), writeId: 'edit.1' };
    expect(before.notes).toBe(notes);
    expect(before).not.toHaveProperty('createdAt');
    expect(outgoing.notes).toBe('edited');
    expect(outgoing).not.toHaveProperty('createdAt');
    expect(fillupBaseMatches(before, { ...raw, notes })).toBe(true);

    const written = fillupAfterPatch(previous.id, previous, outgoing);
    expect(written.notes).toBe('edited');
    expect(written.createdAt).toBe(raw.createdAt);
    expect(written.writeId).toBe('edit.1');
    expect(fillupBaseMatches(fillupLifecyclePatch(written), { ...raw, ...outgoing })).toBe(true);
  });

  it('uses canonical null in the submitted base when authored whitespace is cleaned away', () => {
    const previous = read({ ...raw, notes: '' });
    const outgoing = { ...serializeFillupPatch({ ...previous, notes: '  \n ', version: 3 }), writeId: 'edit.1' };
    const written = fillupAfterPatch(previous.id, previous, outgoing);
    expect(written.notes).toBeNull();
    expect(fillupLifecyclePatch(written).notes).toBeNull();
    expect(fillupBaseMatches(fillupLifecyclePatch(written), { ...raw, ...outgoing })).toBe(true);
  });

  it('retains omitted fields from the actual previous record and never invents creation metadata in a patch', () => {
    const previous = read({ ...raw, notes: '  legacy  ' });
    const outgoing = { ...serializeFillupPatch({ ...previous, notes: undefined, createdAt: 99, version: 3 }), writeId: 'edit.1' };
    expect(outgoing).not.toHaveProperty('notes');
    expect(outgoing).not.toHaveProperty('createdAt');
    const written = fillupAfterPatch(previous.id, previous, outgoing);
    expect(written.notes).toBe(previous.notes);
    expect(written.createdAt).toBe(raw.createdAt);
    expect(fillupLifecyclePatch(written)).not.toHaveProperty('createdAt');
    const withoutCreation = { ...previous, createdAt: undefined };
    expect(fillupAfterPatch(previous.id, withoutCreation, outgoing).createdAt).toBeUndefined();
    expect(fillupLifecyclePatch(withoutCreation)).not.toHaveProperty('createdAt');
  });
});

function acceptanceGate() {
  let resolve!: (accepted: boolean) => void;
  const receipt: MutationReceipt = { id: 'edit', settled: new Promise<boolean>(done => { resolve = done; }) };
  return { receipt, resolve };
}

function editImages() {
  const previous = read({ ...raw, notes: '' });
  const outgoing = { ...serializeFillupPatch({ ...previous, notes: '  edited  ', version: 3 }), writeId: 'edit.1' };
  const written = fillupAfterPatch(previous.id, previous, outgoing);
  return { previous, written };
}

describe('provider-issued edit Undo', () => {
  it('waits for actual acceptance, captures both note images, and submits only one Undo for repeated clicks', async () => {
    const { previous, written } = editImages();
    const gate = acceptanceGate();
    const receipt = { id: 'undo', settled: Promise.resolve(true) };
    const submitPatch = vi.fn(async (_payload: OutboxPayload, _before: OutboxPayload) => receipt);
    const undo = createFillupEditUndo({ previous, written, receipt: gate.receipt,
      replacement: false, isCurrent: () => true, submitPatch })!;
    previous.notes = 'later caller mutation';
    written.notes = 'later listener value';
    const waiting = undo();
    expect(undo()).toBe(waiting);
    await Promise.resolve();
    expect(submitPatch).not.toHaveBeenCalled();
    gate.resolve(true);
    expect(await waiting).toBe(receipt);
    const [payload, before] = submitPatch.mock.calls[0];
    expect(payload.notes).toBe('');
    expect(payload.version).toBe(4);
    expect(before.notes).toBe('edited');
    expect(before.writeId).toBe('edit.1');
    expect(payload).not.toHaveProperty('createdAt');
    expect(before).not.toHaveProperty('createdAt');
    expect(payload.pricePerLiter).toBe(raw.pricePerLiter);
    expect(await undo()).toBe(receipt);
    expect(submitPatch).toHaveBeenCalledTimes(1);
  });

  it('rejects an unacknowledged original without submitting or claiming a successful no-op', async () => {
    const submitPatch = vi.fn();
    const undo = createFillupEditUndo({ ...editImages(), receipt: { id: 'edit', settled: Promise.resolve(false) },
      replacement: false, isCurrent: () => true, submitPatch })!;
    await expect(undo()).rejects.toMatchObject({ code: 'edit-unacknowledged' });
    expect(submitPatch).not.toHaveBeenCalled();
  });

  it('checks the original provider scope before invocation and after a held receipt, including A→B→A', async () => {
    const first = {};
    let active = first;
    const gate = acceptanceGate();
    const submitPatch = vi.fn();
    const undo = createFillupEditUndo({ ...editImages(), receipt: gate.receipt,
      replacement: false, isCurrent: () => active === first, submitPatch })!;
    const waiting = undo();
    active = {}; active = {};
    gate.resolve(true);
    await expect(waiting).rejects.toMatchObject({ code: 'scope-changed' });
    expect(() => undo()).toThrow();
    expect(submitPatch).not.toHaveBeenCalled();
  });

  it('exposes neither replacement resend Undo nor Undo without a captured original', () => {
    const input = { ...editImages(), receipt: { id: 'edit', settled: Promise.resolve(true) },
      replacement: false, isCurrent: () => true, submitPatch: vi.fn() };
    expect(createFillupEditUndo({ ...input, replacement: true })).toBeUndefined();
    expect(createFillupEditUndo({ ...input, previous: null })).toBeUndefined();
  });

  it('returns the real failed Undo receipt and retains that operation instead of silently resubmitting', async () => {
    const failed = { id: 'retained-undo', settled: Promise.resolve(false) };
    const submitPatch = vi.fn(async () => failed);
    const undo = createFillupEditUndo({ ...editImages(), receipt: { id: 'edit', settled: Promise.resolve(true) },
      replacement: false, isCurrent: () => true, submitPatch })!;
    const receipt = await undo();
    expect(receipt).toBe(failed);
    expect(await receipt.settled).toBe(false);
    expect(await undo()).toBe(failed);
    expect(submitPatch).toHaveBeenCalledTimes(1);
  });

  it('allows a failed pre-journal submission to be retried without moving the captured original', async () => {
    const receipt = { id: 'undo', settled: Promise.resolve(true) };
    const submitPatch = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(receipt);
    const undo = createFillupEditUndo({ ...editImages(), receipt: { id: 'edit', settled: Promise.resolve(true) },
      replacement: false, isCurrent: () => true, submitPatch })!;
    await expect(undo()).rejects.toThrow('storage unavailable');
    expect(await undo()).toBe(receipt);
    expect(submitPatch.mock.calls[0]).toEqual(submitPatch.mock.calls[1]);
  });
});
