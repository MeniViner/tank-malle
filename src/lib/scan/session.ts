import type { DisplayKind, DisplayReading, DisplayResult } from './automaticDisplay';
import { automaticOdometerPlausible, automaticPumpPlausible } from './acceptance';
import type { QualityHint } from './quality';

/**
 * Bounded temporal consensus over one capture session (a camera run, or one
 * still photo). Each attempt is one recognition path on one frame: a
 * recogniser at a scale/ROI/preprocessing. The same path agreeing with itself
 * on near-identical frames is repetition, not corroboration, so acceptance
 * needs two different paths; a live session also needs two frames. Any
 * competing reading must be clearly outvoted. When the bound is reached the
 * session abstains with its reasons, and the person can still type the values.
 */
export type Attempt = { frame: number; path: string; result: DisplayResult };
export type SessionOptions = { still?: boolean; maxFrames?: number; maxMs?: number; now?: () => number };
export type SessionDecision =
  | { status: 'scanning'; frames: number; hint: QualityHint | null }
  | { status: 'accepted'; values: DisplayReading; frames: number; elapsedMs: number; paths: string[]; evidence: string[] }
  | { status: 'abstained'; reason: 'conflict' | 'uncorroborated' | 'unreadable' | 'timeout'; reasons: Record<string, number>; frames: number; elapsedMs: number };

type Tally = { values: DisplayReading; frames: Set<number>; paths: Set<string>; votes: number; evidence: Set<string> };

export class CaptureSession {
  private readonly tallies = new Map<string, Tally>();
  private readonly reasons: Record<string, number> = {};
  private readonly frameIds = new Set<number>();
  private readonly started: number;
  private hint: QualityHint | null = null;
  private final: SessionDecision | null = null;
  private readonly kind: DisplayKind;
  private readonly options: SessionOptions;
  constructor(kind: DisplayKind, options: SessionOptions = {}) {
    this.kind = kind; this.options = options; this.started = (options.now ?? Date.now)();
  }
  private get elapsed() { return (this.options.now ?? Date.now)() - this.started; }
  private count(reason: string) { this.reasons[reason] = (this.reasons[reason] ?? 0) + 1; }

  /** A frame that was looked at, including one skipped for its quality. */
  frame(frame: number, hint: QualityHint | null = null) {
    this.frameIds.add(frame); this.hint = hint;
    if (hint) this.count(`quality:${hint}`);
  }
  attempt({ frame, path, result }: Attempt) {
    if (this.final) return;
    this.frameIds.add(frame);
    if (result.status !== 'read') { this.count(result.reason ?? 'unreadable'); return; }
    const plausible = 'total' in result.values ? automaticPumpPlausible(result.values) : automaticOdometerPlausible(result.values.odometer);
    if (!plausible || ('total' in result.values) !== (this.kind === 'pump')) { this.count('implausible'); return; }
    const key = JSON.stringify(result.values);
    const tally = this.tallies.get(key) ?? { values: result.values, frames: new Set(), paths: new Set(), votes: 0, evidence: new Set() };
    tally.frames.add(frame); tally.paths.add(path); tally.votes++;
    for (const item of result.evidence) tally.evidence.add(item);
    this.tallies.set(key, tally);
  }
  decide(): SessionDecision {
    if (this.final) return this.final;
    const frames = this.frameIds.size, ranked = [...this.tallies.values()].sort((a, b) => b.votes - a.votes);
    const [leader, ...others] = ranked, rivals = others.reduce((sum, t) => sum + t.votes, 0);
    const corroborated = leader && leader.paths.size >= 2 && (this.options.still || leader.frames.size >= 2);
    // A still photo has nothing to outvote a disagreement with.
    const outvoted = this.options.still ? rivals === 0 : leader && leader.votes >= 2 * rivals + 2;
    if (corroborated && outvoted) {
      return this.final = { status: 'accepted', values: leader.values, frames, elapsedMs: this.elapsed, paths: [...leader.paths].sort(), evidence: [...leader.evidence].sort() };
    }
    const bounded = this.options.still || frames >= (this.options.maxFrames ?? 60) || this.elapsed >= (this.options.maxMs ?? 15000);
    if (bounded) {
      if (rivals) this.count('conflict');
      return this.final = { status: 'abstained', reason: rivals ? 'conflict' : leader ? 'uncorroborated' : this.options.still ? 'unreadable' : 'timeout', reasons: { ...this.reasons }, frames, elapsedMs: this.elapsed };
    }
    return { status: 'scanning', frames, hint: this.hint };
  }
}
