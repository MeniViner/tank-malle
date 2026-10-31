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
    session.attempt({ frame: 5, path: 'segment@roi', result: read('128450') });
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
    live.attempt({ frame: 0, path: 'a', result: read('128450') }); live.attempt({ frame: 1, path: 'b', result: read('128458') });
    live.attempt({ frame: 2, path: 'b', result: read('128450') });
    expect(live.decide().status).toBe('scanning');
    live.attempt({ frame: 3, path: 'a', result: read('128450') }); live.attempt({ frame: 4, path: 'a', result: read('128450') });
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
  it('counts an implausible reading of the same display as a disagreement', () => {
    const still = new CaptureSession('pump', { still: true });
    still.attempt({ frame: 0, path: 'segment@960', result: pump('287.40', '40.000') }); still.attempt({ frame: 0, path: 'segment@roi', result: pump('287.40', '40.000') });
    still.attempt({ frame: 0, path: 'text@roi', result: pump('1.40', '40.000') });
    expect(still.decide()).toMatchObject({ status: 'abstained', reason: 'conflict' });
  });
  it('accepts a corroborated pump reading and keeps the decision final', () => {
    const session = new CaptureSession('pump');
    session.attempt({ frame: 0, path: 'segment@960', result: pump('202.73', '26.092') }); session.attempt({ frame: 1, path: 'segment@roi', result: pump('202.73', '26.092') });
    const decision = session.decide();
    expect(decision).toMatchObject({ status: 'accepted', values: { total: '202.73', liters: '26.092' } });
    session.attempt({ frame: 2, path: 'x', result: pump('999.99', '99.99') });
    expect(session.decide()).toBe(decision);
  });
});
