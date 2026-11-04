import { describe, expect, it } from 'vitest';
import { CaptureSession } from './session';
import type { DisplayResult } from './automaticDisplay';

const read = (odometer: string): DisplayResult => ({ status: 'read', values: { odometer }, evidence: ['long-integer'] });
const pump = (total: string, liters: string): DisplayResult => ({ status: 'read', values: { total, liters }, evidence: ['precision'] });
const none: DisplayResult = { status: 'unreadable', reason: 'identity-ambiguous' };

describe('capture session consensus', () => {
  it('does not accept the same path repeating itself on consecutive frames', () => {
    const session = new CaptureSession('odometer');
    for (let frame = 0; frame < 5; frame++) session.attempt({ frame, path: 'segment@960', result: read('128450') });
    expect(session.decide().status).toBe('scanning');
    // Paths from different frames do not pair up: each frame must corroborate itself.
    session.attempt({ frame: 5, path: 'segment@roi', result: read('128450') });
    expect(session.decide().status).toBe('scanning');
    session.attempt({ frame: 4, path: 'segment@roi', result: read('128450') });
    expect(session.decide().status).toBe('scanning');
    session.attempt({ frame: 5, path: 'segment@960', result: read('128450') });
    expect(session.decide()).toMatchObject({ status: 'accepted', values: { odometer: '128450' }, paths: ['segment@960', 'segment@roi'] });
  });
  it('needs two frames live, but two paths suffice for one still photo', () => {
    const live = new CaptureSession('odometer');
    live.attempt({ frame: 0, path: 'segment@960', result: read('128450') }); live.attempt({ frame: 0, path: 'segment@1280', result: read('128450') });
    expect(live.decide().status).toBe('scanning');
    const still = new CaptureSession('odometer', { still: true });
    still.attempt({ frame: 0, path: 'segment@960', result: read('128450') }); still.attempt({ frame: 0, path: 'segment@1280', result: read('128450') });
    expect(still.decide().status).toBe('accepted');
  });
  it('requires a disagreement to be clearly outvoted, and abstains on any disagreement in a still', () => {
    const live = new CaptureSession('odometer');
    const pair = (frame: number, value: string) => { live.attempt({ frame, path: 'a', result: read(value) }); live.attempt({ frame, path: 'b', result: read(value) }); };
    pair(0, '128450'); pair(1, '128458'); pair(2, '128450');
    expect(live.decide().status).toBe('scanning');
    pair(3, '128450');
    expect(live.decide()).toMatchObject({ status: 'accepted', values: { odometer: '128450' } });
    const still = new CaptureSession('odometer', { still: true });
    still.attempt({ frame: 0, path: 'a', result: read('128450') }); still.attempt({ frame: 0, path: 'b', result: read('128450') }); still.attempt({ frame: 0, path: 'c', result: read('128458') });
    expect(still.decide()).toMatchObject({ status: 'abstained', reason: 'conflict' });
  });
  it('refuses implausible automatic pump pairs and reports reasons when the bound is reached', () => {
    let now = 0;
    const session = new CaptureSession('pump', { now: () => now, maxMs: 1000 });
    session.attempt({ frame: 0, path: 'a', result: pump('26.092', '202.73') }); session.attempt({ frame: 1, path: 'b', result: pump('26.092', '202.73') });
    session.attempt({ frame: 2, path: 'a', result: none }); session.frame(3, 'blurred');
    expect(session.decide().status).toBe('scanning');
    now = 1000;
    expect(session.decide()).toMatchObject({ status: 'abstained', reason: 'implausible', reasons: { implausible: 2, 'identity-ambiguous': 1, 'quality:blurred': 1 }, frames: 4 });
  });
  it('lets a slow device analyse a few frames before the time bound applies', () => {
    let now = 0;
    const slow = new CaptureSession('odometer', { now: () => now, maxMs: 1000 });
    slow.attempt({ frame: 0, path: 'a', result: none }); now = 1500;
    expect(slow.decide().status).toBe('scanning');
    slow.attempt({ frame: 1, path: 'a', result: none }); slow.attempt({ frame: 2, path: 'a', result: none });
    expect(slow.decide()).toMatchObject({ status: 'abstained', reason: 'timeout', frames: 3 });
    const stuck = new CaptureSession('odometer', { now: () => now, maxMs: 1000 }); now += 3000;
    expect(stuck.decide()).toMatchObject({ status: 'abstained', reason: 'timeout', frames: 0 });
  });
  it('counts an implausible reading of the same display as a disagreement', () => {
    const still = new CaptureSession('pump', { still: true });
    still.attempt({ frame: 0, path: 'segment@960', result: pump('287.40', '40.000') }); still.attempt({ frame: 0, path: 'segment@roi', result: pump('287.40', '40.000') });
    still.attempt({ frame: 0, path: 'text@roi', result: pump('1.40', '40.000') });
    expect(still.decide()).toMatchObject({ status: 'abstained', reason: 'conflict' });
  });
  it('accepts a corroborated pump reading and keeps the decision final', () => {
    const session = new CaptureSession('pump');
    for (const frame of [0, 1]) for (const path of ['segment@960', 'segment@roi']) session.attempt({ frame, path, result: pump('202.73', '26.092') });
    const decision = session.decide();
    expect(decision).toMatchObject({ status: 'accepted', values: { total: '202.73', liters: '26.092' } });
    session.attempt({ frame: 2, path: 'x', result: pump('999.99', '99.99') });
    expect(session.decide()).toBe(decision);
  });
  it('does not time out while the recogniser is still loading, within the loading bound', () => {
    let now = 0;
    const session = new CaptureSession('odometer', { now: () => now, maxMs: 1000, loadMs: 5000, loading: true });
    // Segment-only frames while the models download: nothing to read yet.
    for (let frame = 0; frame < 80; frame++) { now += 50; session.frame(frame); session.attempt({ frame, path: 'segment@960', result: none }); }
    expect(session.decide().status).toBe('scanning');
    now = 4000; session.recognizerSettled();
    session.attempt({ frame: 80, path: 'ppocr@960', result: read('128450') }); session.attempt({ frame: 80, path: 'ppocr@roi', result: read('128450') });
    now = 4600; session.attempt({ frame: 81, path: 'ppocr@960', result: read('128450') }); session.attempt({ frame: 81, path: 'ppocr@roi', result: read('128450') });
    // The person waited 4.6 s in all, 4 s of it for the recogniser.
    expect(session.decide()).toMatchObject({ status: 'accepted', values: { odometer: '128450' }, elapsedMs: 4600, waitedMs: 4000 });
  });
  it('bounds the loading wait itself, and says the recogniser was still loading', () => {
    let now = 0;
    const session = new CaptureSession('odometer', { now: () => now, maxMs: 1000, loadMs: 5000, loading: true });
    for (let frame = 0; frame < 3; frame++) { now += 1000; session.frame(frame); }
    expect(session.decide().status).toBe('scanning');
    // Loading took its whole bound; then the ordinary scanning bound applies.
    now = 5500; for (let frame = 3; frame < 6; frame++) session.frame(frame);
    expect(session.decide().status).toBe('scanning');
    now = 6000;
    expect(session.decide()).toMatchObject({ status: 'abstained', reason: 'timeout', reasons: { 'recognizer-loading': 1 }, elapsedMs: 6000, waitedMs: 5000 });
  });
  it('still accepts a corroborated segment reading before the recogniser has loaded', () => {
    let now = 0;
    const session = new CaptureSession('pump', { now: () => now, loading: true });
    for (const frame of [0, 1]) { now += 300; for (const path of ['segment@960', 'segment@roi']) session.attempt({ frame, path, result: pump('287.40', '40.000') }); }
    expect(session.decide()).toMatchObject({ status: 'accepted', values: { total: '287.40' }, elapsedMs: 600, waitedMs: 600 });
  });
});

