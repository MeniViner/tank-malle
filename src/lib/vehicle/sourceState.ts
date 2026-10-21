import { EMPTY_EXTRA, type ExtraData, type EXTRA_COLLECTIONS } from './model';

export interface ExtraSourceState {
  scope: string;
  data: ExtraData;
  loaded: string[];
  cached: string[];
  errors: string[];
  malformed: number;
}

export function emptyExtraSources(scope = ''): ExtraSourceState {
  return { scope, data: EMPTY_EXTRA, loaded: [], cached: [], errors: [], malformed: 0 };
}

/** An error can arrive before the new scope's first snapshot. Never relabel old data. */
export function recordExtraSourceError(previous: ExtraSourceState, scope: string, name: typeof EXTRA_COLLECTIONS[number]): ExtraSourceState {
  const current = previous.scope === scope ? previous : emptyExtraSources(scope);
  return { ...current, errors: [...new Set([...current.errors, name])] };
}
