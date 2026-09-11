import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSatang, toBaht, percentOf, formatAmount } from '../src/money.js';

test('converts THB to satang and back without floating-point drift', () => {
  assert.equal(toSatang(1234.57), 123457);
  assert.equal(toBaht(123457), 1234.57);
  assert.equal(toSatang(0.1 + 0.2), 30);
  assert.equal(toBaht(toSatang(4567) - toSatang(456.7)), 4110.3);
});

test('rounds a percentage copay half-up to the nearest satang', () => {
  const amount = toSatang(12.25);
  const copay = percentOf(amount, 10); // 122.5 satang -> 123
  assert.equal(copay, 123);
  assert.equal(toBaht(copay), 1.23);
  assert.equal(toBaht(amount - copay), 11.02);
  assert.equal(percentOf(toSatang(1234.57), 20), 24691); // 246.914 THB -> 246.91
});

test('formats amounts for reasons', () => {
  assert.equal(formatAmount(104000), '1,040');
  assert.equal(formatAmount(24691), '246.91');
  assert.equal(formatAmount(120), '1.20');
  assert.equal(formatAmount(0), '0');
});
