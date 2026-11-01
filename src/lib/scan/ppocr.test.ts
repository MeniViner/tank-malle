import { describe, expect, it } from 'vitest';
import { verifierAgrees } from './ppocr';

describe('second recogniser agreement', () => {
  it('reads seven-segment digits the verifier wrote as letters as the digits they are drawn like', () => {
    // Verifier readings from TRODO tuning photographs.
    for (const [reading, verifier] of [['26475', '2647Sm'], ['120449', '120YY9'], ['18022', '1B022'], ['66500', '66S00'], ['128450', 'I28450'], ['146155', '14615S'], ['235128km', '235128im']])
      expect(verifierAgrees(reading, verifier), `${reading} ~ ${verifier}`).toBe(true);
  });
  it('still disagrees when the verifier reads a different digit, or one more or fewer', () => {
    for (const [reading, verifier] of [['16157', '161571m'], ['117197', '117191'], ['119752', '19752'], ['157492', '5惠'], ['92625', '0019262s'], ['16575', '15575'], ['2101', '210!']])
      expect(verifierAgrees(reading, verifier), `${reading} ~ ${verifier}`).toBe(false);
  });
});
