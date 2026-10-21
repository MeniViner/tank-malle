import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizeLine, validateDraft, validateReading } from './segment-reader.mjs';
import { blank, drawDigits, lineFixture, rect } from './synthetic-fixtures.mjs';

for (const text of ['287.40', '40.000', '123456.789', '10.25', '888.88', '600.00']) {
  for (const options of [{}, { blue: true }, { light: true }, { scale: .6 }]) {
    test(`pixel recognition ${text} ${JSON.stringify(options)}`, () => {
      const result = recognizeLine(lineFixture(text, options), { kind: 'total' });
      assert.equal(result.status, 'candidate');
      assert.equal(result.text, text);
      assert.equal(result.requiresConfirmation, true);
    });
  }
}
for (const text of ['128450', '999999', '111111', '0', '7654321']) {
  test(`blue odometer ${text}`, () => {
    const result = recognizeLine(lineFixture(text, { blue: true }), { kind: 'odometer', mode: 'blue' });
    assert.equal(result.status, 'candidate');
    assert.equal(result.text, text);
  });
}
test('a lost decimal point cannot be inferred from plausibility', () => {
  assert.equal(recognizeLine(lineFixture('28740'), { kind: 'total' }).status, 'unreadable');
});
test('decimal trip distance is not accepted as an odometer', () => {
  assert.equal(recognizeLine(lineFixture('450.2'), { kind: 'odometer' }).status, 'unreadable');
});
test('blank and nearly uniform images do not produce a number', () => {
  assert.equal(recognizeLine(blank(300, 120)).status, 'unreadable');
  const image = blank(300, 120, [200, 200, 200]);
  rect(image, 50, 50, 80, 30, [210, 210, 210]);
  assert.equal(recognizeLine(image).status, 'unreadable');
});
test('two lines cannot be concatenated into a receipt field', () => {
  const image = blank(650, 320);
  drawDigits(image, '287.40', 20, 15);
  drawDigits(image, '40.000', 20, 200);
  assert.equal(recognizeLine(image).status, 'unreadable');
});
test('an unknown segment combination is rejected', () => {
  const image = lineFixture('888.88');
  // Remove both right-hand segments of the first eight: not a decimal digit.
  rect(image, 60, 24, 8, 40, [203, 217, 201]);
  rect(image, 60, 68, 8, 40, [203, 217, 201]);
  assert.equal(recognizeLine(image).status, 'unreadable');
});
test('manual review requires explicit odometer semantics', () => {
  const draft = { total: '287.40', liters: '40.000', odometer: '128450', confirmedOdometer: false };
  assert.equal(validateDraft(draft).errors.length, 1);
  assert.equal(validateDraft({ ...draft, confirmedOdometer: true }, 128000).errors.length, 0);
  assert.equal(validateDraft({ ...draft, confirmedOdometer: true }, 129000).errors.length, 1);
});
test('parser consumes the complete field and does not accept units or scientific notation', () => {
  for (const text of ['287.40 NIS', '2e4', '-2.00', 'Infinity', '.25', '10.', '40.00.1', '0.00']) {
    assert.equal(validateReading(text, 'total'), null);
  }
});
test('price is derived from the two reviewed measurements', () => {
  const result = validateDraft({ total: '287.40', liters: '40.000', odometer: '128450', confirmedOdometer: true });
  assert.equal(result.errors.length, 0);
  assert.ok(Math.abs(result.pricePerLiter - 7.185) < 1e-9);
});
test('invalid and oversized pixel buffers are refused', () => {
  assert.equal(recognizeLine({ width: 10000, height: 10000, data: [] }).status, 'unreadable');
  assert.equal(recognizeLine({ width: 100, height: 50, data: [0, 0, 0] }).status, 'unreadable');
});
