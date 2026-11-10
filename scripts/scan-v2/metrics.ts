/**
 * Accuracy metrics for the scan comparison. Abstentions are counted
 * separately and are never successes.
 */
export type Row = {
  id: string;
  /** Ground-truth text, e.g. "171272" or "287.40". */
  label: string;
  /** Top-1 answer, or null when the reader produced nothing (abstained). */
  predicted: string | null;
  /** Up to three candidates (v2 only). */
  top3?: string[];
};

/** Leading zeros carry no meaning on an odometer or a price. */
export const normalise = (text: string) => text.replace(/^0+(?=\d)/, '');

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

export type Summary = {
  sessions: number;
  answered: number;
  abstained: number;
  correct: number;
  wrong: number;
  /** correct / sessions (abstentions count against). */
  fieldAccuracy: number | null;
  /** correct / answered. */
  answeredPrecision: number | null;
  /** 1 − (character edits / label characters), over ANSWERED sessions only. */
  digitAccuracyAnswered: number | null;
  /** Same, but an abstention counts as every character wrong. */
  digitAccuracyAll: number | null;
  /** Share of sessions whose label is among the top-3 candidates (v2). */
  top3Hit: number | null;
};

const ratio = (a: number, b: number) => b ? a / b : null;

export function summarise(rows: Row[]): Summary {
  let answered = 0, correct = 0, edits = 0, chars = 0, allEdits = 0, allChars = 0, top3 = 0, withTop3 = 0;
  for (const row of rows) {
    const label = normalise(row.label);
    allChars += label.length;
    if (row.top3) { withTop3++; if (row.top3.some(t => normalise(t) === label)) top3++; }
    if (row.predicted == null) { allEdits += label.length; continue; }
    answered++;
    const p = normalise(row.predicted);
    if (p === label) correct++;
    const e = Math.min(label.length, levenshtein(p, label));
    edits += e; chars += label.length; allEdits += e;
  }
  return {
    sessions: rows.length, answered, abstained: rows.length - answered, correct, wrong: answered - correct,
    fieldAccuracy: ratio(correct, rows.length), answeredPrecision: ratio(correct, answered),
    digitAccuracyAnswered: chars ? 1 - edits / chars : null,
    digitAccuracyAll: allChars ? 1 - allEdits / allChars : null,
    top3Hit: withTop3 ? ratio(top3, rows.length) : null,
  };
}
