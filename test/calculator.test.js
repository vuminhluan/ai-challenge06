import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/calculator.js';
import { makePolicy, makeBenefit, makeExpense } from './helpers.js';

const pick = (result, ...keys) => Object.fromEntries(keys.map((k) => [k, result[k]]));
const AMOUNTS = ['not_covered_amount', 'deductible_applied', 'copay_amount', 'covered_amount', 'member_pays', 'decision'];

test('normal coverage: no copay or deductible pays the full amount', () => {
  const { results } = calculate(makePolicy(), [makeExpense({ amount: 1000 })]);
  assert.deepEqual(results[0], {
    expense_id: 'EXP-1',
    submitted_amount: 1000,
    not_covered_amount: 0,
    deductible_applied: 0,
    copay_amount: 0,
    covered_amount: 1000,
    member_pays: 0,
    decision: 'COVERED',
    reason: 'Fully covered: 1,000 THB.',
    remaining_annual_limit: 99000,
    remaining_visit_limit: null,
  });
});

test('percentage copay: partially covered (the example from the problem statement)', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ copay: { type: 'PERCENTAGE', value: 20 }, sub_benefits: [{ name: 'Doctor Visit', max_visits: 30 }] })],
  });
  const { results } = calculate(policy, [makeExpense({ expense_id: 'EXP-001', amount: 2500 })]);
  assert.deepEqual(pick(results[0], ...AMOUNTS, 'reason', 'remaining_annual_limit', 'remaining_visit_limit'), {
    not_covered_amount: 0,
    deductible_applied: 0,
    copay_amount: 500,
    covered_amount: 2000,
    member_pays: 500,
    decision: 'PARTIALLY_COVERED',
    reason: '20% copay applied: 500 THB. Covered: 2,000 THB. Member pays: 500 THB.',
    remaining_annual_limit: 98000,
    remaining_visit_limit: 29,
  });
});

test('fixed copay larger than the bill leaves nothing to pay (NO_PAYOUT)', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ copay: { type: 'FIXED', value: 300 } })] });
  const { results } = calculate(policy, [makeExpense({ amount: 250 })]);
  assert.deepEqual(pick(results[0], ...AMOUNTS, 'reason'), {
    not_covered_amount: 0,
    deductible_applied: 0,
    copay_amount: 250,
    covered_amount: 0,
    member_pays: 250,
    decision: 'NO_PAYOUT',
    reason: 'Fixed copay of 300 THB limited to the remaining 250 THB. Covered: 0 THB. Member pays: 250 THB.',
  });
});

test('deductible is consumed across expenses before copay applies', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ deductible: 1000, copay: { type: 'PERCENTAGE', value: 20 } })],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-02-01', amount: 800 }),
    makeExpense({ expense_id: 'E2', date: '2024-03-01', amount: 1500 }),
  ]);
  assert.deepEqual(pick(results[0], ...AMOUNTS, 'reason'), {
    not_covered_amount: 0,
    deductible_applied: 800,
    copay_amount: 0,
    covered_amount: 0,
    member_pays: 800,
    decision: 'NO_PAYOUT',
    reason: '800 THB applied to OUTPATIENT deductible (200 THB remaining). Covered: 0 THB. Member pays: 800 THB.',
  });
  assert.deepEqual(pick(results[1], ...AMOUNTS), {
    not_covered_amount: 0,
    deductible_applied: 200,
    copay_amount: 260,
    covered_amount: 1040,
    member_pays: 460,
    decision: 'PARTIALLY_COVERED',
  });
});

test('per-visit cap applies before the deductible', () => {
  const policy = makePolicy({
    benefits: [
      makeBenefit({
        deductible: 1000,
        copay: { type: 'PERCENTAGE', value: 20 },
        sub_benefits: [{ name: 'Doctor Visit', per_visit_cap: 3000 }],
      }),
    ],
  });
  const { results } = calculate(policy, [makeExpense({ amount: 5000 })]);
  assert.deepEqual(pick(results[0], ...AMOUNTS, 'reason'), {
    not_covered_amount: 2000,
    deductible_applied: 1000,
    copay_amount: 400,
    covered_amount: 1600,
    member_pays: 3400,
    decision: 'PARTIALLY_COVERED',
    reason:
      'Per-visit cap of 3,000 THB for Doctor Visit applied; 2,000 THB not covered. ' +
      '1,000 THB applied to OUTPATIENT deductible (0 THB remaining). ' +
      '20% copay applied: 400 THB. Covered: 1,600 THB. Member pays: 3,400 THB.',
  });
});

test('waiting period denial consumes no deductible, visit or limit', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ waiting_period_days: 30, deductible: 500, sub_benefits: [{ name: 'Doctor Visit', max_visits: 5 }] })],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-01-10', amount: 1000 }),
    makeExpense({ expense_id: 'E2', date: '2024-01-31', amount: 1000 }),
  ]);
  assert.deepEqual(pick(results[0], ...AMOUNTS, 'reason', 'remaining_annual_limit', 'remaining_visit_limit'), {
    not_covered_amount: 1000,
    deductible_applied: 0,
    copay_amount: 0,
    covered_amount: 0,
    member_pays: 1000,
    decision: 'DENIED',
    reason: 'Denied: OUTPATIENT waiting period of 30 days not met; coverage starts 2024-01-31.',
    remaining_annual_limit: 100000,
    remaining_visit_limit: 5,
  });
  assert.equal(results[1].deductible_applied, 500);
  assert.equal(results[1].covered_amount, 500);
  assert.equal(results[1].remaining_visit_limit, 4);
});

test('exclusion denial consumes nothing', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ deductible: 500 })],
    exclusions: [{ exclusion_id: 'EXC-01', description: 'Cosmetic procedures', keywords: ['cosmetic'] }],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-02-01', diagnosis: 'Cosmetic botox', amount: 3000 }),
    makeExpense({ expense_id: 'E2', date: '2024-03-01', amount: 1000 }),
  ]);
  assert.equal(results[0].decision, 'DENIED');
  assert.equal(results[0].remaining_annual_limit, 100000);
  assert.equal(results[1].deductible_applied, 500);
});

test('sub-benefit limit: partially covered when short, then denied when exhausted', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ sub_benefits: [{ name: 'Doctor Visit', annual_limit: 1000 }] })],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-02-01', amount: 800 }),
    makeExpense({ expense_id: 'E2', date: '2024-03-01', amount: 500 }),
    makeExpense({ expense_id: 'E3', date: '2024-04-01', amount: 100 }),
  ]);
  assert.equal(results[0].decision, 'COVERED');
  assert.deepEqual(pick(results[1], ...AMOUNTS, 'reason'), {
    not_covered_amount: 300,
    deductible_applied: 0,
    copay_amount: 0,
    covered_amount: 200,
    member_pays: 300,
    decision: 'PARTIALLY_COVERED',
    reason: 'Doctor Visit annual limit had only 200 THB remaining; 300 THB not covered. Covered: 200 THB. Member pays: 300 THB.',
  });
  assert.deepEqual(pick(results[2], 'decision', 'reason', 'member_pays'), {
    decision: 'DENIED',
    reason: 'Denied: Doctor Visit annual limit exhausted.',
    member_pays: 100,
  });
});

test('a limit group is consumed by two different benefits', () => {
  const policy = makePolicy({
    limit_groups: [{ group_id: 'DO', name: 'Dental & Optical combined', annual_limit: 1000 }],
    benefits: [
      makeBenefit({ benefit_type: 'DENTAL', limit_group: 'DO', annual_limit: 5000, sub_benefits: [{ name: 'Cleaning' }] }),
      makeBenefit({ benefit_type: 'OPTICAL', limit_group: 'DO', annual_limit: 5000, sub_benefits: [{ name: 'Glasses' }] }),
    ],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-02-01', benefit_type: 'DENTAL', sub_benefit: 'Cleaning', amount: 700 }),
    makeExpense({ expense_id: 'E2', date: '2024-03-01', benefit_type: 'OPTICAL', sub_benefit: 'Glasses', amount: 500 }),
    makeExpense({ expense_id: 'E3', date: '2024-04-01', benefit_type: 'DENTAL', sub_benefit: 'Cleaning', amount: 100 }),
  ]);
  assert.equal(results[0].covered_amount, 700);
  assert.equal(results[1].covered_amount, 300);
  assert.equal(
    results[1].reason,
    'Dental & Optical combined annual limit had only 300 THB remaining; 200 THB not covered. Covered: 300 THB. Member pays: 200 THB.',
  );
  assert.equal(results[2].reason, 'Denied: Dental & Optical combined annual limit exhausted.');
});

test('the policy annual limit binds even when the benefit still has room', () => {
  const policy = makePolicy({ annual_limit: 1000, benefits: [makeBenefit({ annual_limit: 5000 })] });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-02-01', amount: 1200 }),
    makeExpense({ expense_id: 'E2', date: '2024-03-01', amount: 300 }),
  ]);
  assert.deepEqual(pick(results[0], 'covered_amount', 'not_covered_amount', 'reason', 'remaining_annual_limit'), {
    covered_amount: 1000,
    not_covered_amount: 200,
    reason: 'Policy annual limit had only 1,000 THB remaining; 200 THB not covered. Covered: 1,000 THB. Member pays: 200 THB.',
    remaining_annual_limit: 0,
  });
  assert.equal(results[1].reason, 'Denied: Policy annual limit exhausted.');
});

test('visit limit: denied once used up, and denied expenses do not use visits', () => {
  const policy = makePolicy({
    benefits: [makeBenefit({ waiting_period_days: 30, sub_benefits: [{ name: 'Doctor Visit', max_visits: 1 }] })],
  });
  const { results } = calculate(policy, [
    makeExpense({ expense_id: 'E1', date: '2024-01-10' }),
    makeExpense({ expense_id: 'E2', date: '2024-02-01' }),
    makeExpense({ expense_id: 'E3', date: '2024-03-01' }),
  ]);
  assert.deepEqual(
    results.map((r) => [r.decision, r.remaining_visit_limit]),
    [['DENIED', 1], ['COVERED', 0], ['DENIED', 0]],
  );
  assert.equal(results[2].reason, 'Denied: Doctor Visit visit limit reached (1 of 1 visits used).');
});

test('unknown benefit or sub-benefit and out-of-period dates are denied, not errors', () => {
  const { results } = calculate(makePolicy(), [
    makeExpense({ expense_id: 'E1', benefit_type: 'MATERNITY' }),
    makeExpense({ expense_id: 'E2', sub_benefit: 'Acupuncture' }),
    makeExpense({ expense_id: 'E3', date: '2025-01-05' }),
  ]);
  assert.deepEqual(
    results.map((r) => [r.expense_id, r.decision, r.remaining_visit_limit]),
    [['E1', 'DENIED', null], ['E2', 'DENIED', null], ['E3', 'DENIED', null]],
  );
});

test('processes chronologically regardless of input order; same-day ties go by ID', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ sub_benefits: [{ name: 'Doctor Visit', annual_limit: 1000 }] })] });
  const a = makeExpense({ expense_id: 'EXP-A', date: '2024-03-01', amount: 600 });
  const b = makeExpense({ expense_id: 'EXP-B', date: '2024-03-01', amount: 600 });
  const c = makeExpense({ expense_id: 'EXP-C', date: '2024-02-01', amount: 300 });

  const first = calculate(policy, [b, a, c]);
  const second = calculate(policy, [c, a, b]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.results.map((r) => [r.expense_id, r.covered_amount]),
    [['EXP-C', 300], ['EXP-A', 600], ['EXP-B', 100]],
  );
});

test('does not mutate its inputs and gives the same answer twice', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ deductible: 500 })] });
  const expenses = [makeExpense({ expense_id: 'E2', date: '2024-03-01' }), makeExpense({ expense_id: 'E1', date: '2024-02-01' })];
  const policyCopy = structuredClone(policy);
  const expensesCopy = structuredClone(expenses);

  const first = calculate(policy, expenses);
  assert.deepEqual(policy, policyCopy);
  assert.deepEqual(expenses, expensesCopy);
  assert.deepEqual(calculate(policy, expenses), first);
});

test('handles satang amounts without rounding drift', () => {
  const policy = makePolicy({ benefits: [makeBenefit({ copay: { type: 'PERCENTAGE', value: 20 } })] });
  const { results } = calculate(policy, [makeExpense({ amount: 1234.57 })]);
  assert.deepEqual(pick(results[0], 'copay_amount', 'covered_amount', 'member_pays', 'remaining_annual_limit'), {
    copay_amount: 246.91,
    covered_amount: 987.66,
    member_pays: 246.91,
    remaining_annual_limit: 99012.34,
  });
  assert.equal(results[0].reason, '20% copay applied: 246.91 THB. Covered: 987.66 THB. Member pays: 246.91 THB.');
});
