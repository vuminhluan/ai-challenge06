import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/index.js';
import { makePolicy, makeBenefit, makeExpense } from './helpers.js';

test('summary reports own remaining balance and what is actually still available', () => {
  const policy = makePolicy({
    annual_limit: 1000,
    limit_groups: [{ group_id: 'DO', name: 'Dental & Optical combined', annual_limit: 5000 }],
    benefits: [
      makeBenefit({
        annual_limit: 5000,
        deductible: 200,
        sub_benefits: [{ name: 'Doctor Visit', max_visits: 10 }, { name: 'Physiotherapy', annual_limit: 3000 }],
      }),
      makeBenefit({ benefit_type: 'OPTICAL', limit_group: 'DO', sub_benefits: [{ name: 'Glasses' }] }),
    ],
  });
  const { summary } = calculate(policy, [makeExpense({ amount: 1500 })]);

  assert.deepEqual(summary.policy, { annual_limit: 1000, used: 1000, remaining: 0 });
  assert.deepEqual(summary.limit_groups, [
    { group_id: 'DO', name: 'Dental & Optical combined', annual_limit: 5000, used: 0, remaining: 5000 },
  ]);
  assert.deepEqual(summary.benefits[0], {
    benefit_type: 'OUTPATIENT',
    annual_limit: 5000,
    used: 1000,
    remaining: 4000,
    available: 0,
    deductible: { amount: 200, used: 200, remaining: 0 },
    sub_benefits: [
      { name: 'Doctor Visit', annual_limit: null, used: 1000, remaining: null, available: 0, max_visits: 10, visits_used: 1, visits_remaining: 9 },
      { name: 'Physiotherapy', annual_limit: 3000, used: 0, remaining: 3000, available: 0, max_visits: null, visits_used: 0, visits_remaining: null },
    ],
  });
  assert.deepEqual(summary.benefits[1].available, 0);
  assert.deepEqual(summary.benefits[1].remaining, null);
  assert.deepEqual(summary.totals, {
    submitted: 1500,
    covered: 1000,
    member_pays: 500,
    by_decision: { COVERED: 0, PARTIALLY_COVERED: 1, NO_PAYOUT: 0, DENIED: 0 },
  });
});
