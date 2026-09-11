import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEligibility, addDays } from '../src/eligibility.js';
import { resolveCoverage } from '../src/policy.js';
import { createLedger } from '../src/ledger.js';
import { makePolicy, makeBenefit, makeExpense } from './helpers.js';

function check(policy, expenseOverrides, ledger = createLedger(policy)) {
  const expense = makeExpense(expenseOverrides);
  return checkEligibility(policy, expense, resolveCoverage(policy, expense), ledger);
}

test('adds calendar days across month ends and leap years', () => {
  assert.equal(addDays('2024-01-01', 30), '2024-01-31');
  assert.equal(addDays('2024-01-01', 60), '2024-03-01');
  assert.equal(addDays('2024-01-01', 180), '2024-06-29');
});

test('denies expenses outside the policy period', () => {
  const policy = makePolicy();
  assert.equal(
    check(policy, { date: '2023-12-31' }),
    'Denied: service date 2023-12-31 is outside the policy period (2024-01-01 to 2024-12-31).',
  );
  assert.equal(
    check(policy, { date: '2025-01-05' }),
    'Denied: service date 2025-01-05 is outside the policy period (2024-01-01 to 2024-12-31).',
  );
  assert.equal(check(policy, { date: '2024-12-31' }), null);
});

test('denies benefits and sub-benefits the policy does not have', () => {
  const policy = makePolicy();
  assert.equal(
    check(policy, { benefit_type: 'MATERNITY' }),
    'Denied: benefit type MATERNITY is not covered under this policy.',
  );
  assert.equal(
    check(policy, { sub_benefit: 'Acupuncture' }),
    'Denied: Acupuncture is not covered under OUTPATIENT.',
  );
});

test('matches exclusion keywords case-insensitively', () => {
  const policy = makePolicy({
    exclusions: [{ exclusion_id: 'EXC-01', description: 'Cosmetic procedures', keywords: ['cosmetic', 'whitening'] }],
  });
  assert.equal(
    check(policy, { diagnosis: 'Teeth WHITENING' }),
    'Denied: excluded under EXC-01 (Cosmetic procedures); diagnosis "Teeth WHITENING" matches "whitening".',
  );
  assert.equal(check(policy, { diagnosis: 'Acute bronchitis' }), null);
});

test('waiting period: denied the day before coverage starts, allowed on the day', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ waiting_period_days: 30 })] });
  assert.equal(
    check(policy, { date: '2024-01-30' }),
    'Denied: OUTPATIENT waiting period of 30 days not met; coverage starts 2024-01-31.',
  );
  assert.equal(check(policy, { date: '2024-01-31' }), null);
});

test('a sub-benefit waiting period overrides the benefit one', () => {
  const policy = makePolicy({
    benefits: [
      makeBenefit({
        benefit_type: 'DENTAL',
        waiting_period_days: 90,
        sub_benefits: [{ name: 'Filling' }, { name: 'Root Canal', waiting_period_days: 180 }],
      }),
    ],
  });
  const onDay = { benefit_type: 'DENTAL', date: '2024-05-10' };
  assert.equal(check(policy, { ...onDay, sub_benefit: 'Filling' }), null);
  assert.equal(
    check(policy, { ...onDay, sub_benefit: 'Root Canal' }),
    'Denied: Root Canal waiting period of 180 days not met; coverage starts 2024-06-29.',
  );
});

test('denies once the visit limit is used up', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ sub_benefits: [{ name: 'Doctor Visit', max_visits: 1 }] })] });
  const ledger = createLedger(policy);
  assert.equal(check(policy, {}, ledger), null);
  ledger.record(resolveCoverage(policy, makeExpense()), { covered: 100000, deductibleApplied: 0 });
  assert.equal(check(policy, {}, ledger), 'Denied: Doctor Visit visit limit reached (1 of 1 visits used).');
});

test('denies when a limit tier is exhausted, naming the most specific one', () => {
  const policy = makePolicy({
    annual_limit: 1000,
    benefits: [makeBenefit({ annual_limit: 1000 })],
  });
  const ledger = createLedger(policy);
  ledger.record(resolveCoverage(policy, makeExpense()), { covered: 100000, deductibleApplied: 0 });
  assert.equal(check(policy, {}, ledger), 'Denied: OUTPATIENT annual limit exhausted.');
});

test('reports the first failed check when several fail', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ waiting_period_days: 30 })],
    exclusions: [{ exclusion_id: 'EXC-01', description: 'Cosmetic procedures', keywords: ['cosmetic'] }],
  });
  // Both excluded and inside the waiting period: exclusion is checked first.
  assert.match(check(policy, { date: '2024-01-05', diagnosis: 'Cosmetic botox' }), /^Denied: excluded under EXC-01/);
});
