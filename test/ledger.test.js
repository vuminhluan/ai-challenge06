import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../src/ledger.js';
import { resolveCoverage } from '../src/policy.js';
import { makePolicy, makeBenefit, makeExpense } from './helpers.js';

const policy = makePolicy({
  annual_limit: 10000,
  limit_groups: [{ group_id: 'G', name: 'Dental & Optical combined', annual_limit: 3000 }],
  benefits: [
    makeBenefit({
      benefit_type: 'DENTAL',
      limit_group: 'G',
      annual_limit: 2000,
      deductible: 500,
      sub_benefits: [
        { name: 'Cleaning', annual_limit: 1000, max_visits: 2 },
        { name: 'Filling' },
      ],
    }),
    makeBenefit({ benefit_type: 'OPTICAL', limit_group: 'G', sub_benefits: [{ name: 'Glasses' }] }),
  ],
});
const cleaning = resolveCoverage(policy, makeExpense({ benefit_type: 'DENTAL', sub_benefit: 'Cleaning' }));
const filling = resolveCoverage(policy, makeExpense({ benefit_type: 'DENTAL', sub_benefit: 'Filling' }));
const glasses = resolveCoverage(policy, makeExpense({ benefit_type: 'OPTICAL', sub_benefit: 'Glasses' }));

test('lists only tiers that have a limit, most specific first', () => {
  const ledger = createLedger(policy);
  assert.deepEqual(ledger.limitTiers(cleaning), [
    { label: 'Cleaning', remaining: 100000 },
    { label: 'DENTAL', remaining: 200000 },
    { label: 'Dental & Optical combined', remaining: 300000 },
    { label: 'Policy', remaining: 1000000 },
  ]);
  assert.deepEqual(ledger.limitTiers(glasses), [
    { label: 'Dental & Optical combined', remaining: 300000 },
    { label: 'Policy', remaining: 1000000 },
  ]);
});

test('record consumes every tier, the deductible and one visit', () => {
  const ledger = createLedger(policy);
  ledger.record(cleaning, { covered: 40000, deductibleApplied: 50000 });

  assert.deepEqual(ledger.limitTiers(filling), [
    { label: 'DENTAL', remaining: 160000 },
    { label: 'Dental & Optical combined', remaining: 260000 },
    { label: 'Policy', remaining: 960000 },
  ]);
  assert.equal(ledger.limitTiers(cleaning)[0].remaining, 60000);
  assert.equal(ledger.deductibleRemaining('DENTAL'), 0);
  assert.equal(ledger.visitsRemaining('DENTAL', 'Cleaning'), 1);
  assert.equal(ledger.visitsRemaining('DENTAL', 'Filling'), null);
  assert.equal(ledger.policyRemaining(), 960000);
});
