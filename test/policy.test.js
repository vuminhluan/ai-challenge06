import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy, validateExpenses, resolveCoverage, ValidationError } from '../src/policy.js';
import { makePolicy, makeBenefit, makeExpense } from './helpers.js';

test('accepts a well-formed policy and expenses', () => {
  assert.doesNotThrow(() => validatePolicy(makePolicy()));
  assert.doesNotThrow(() => validateExpenses([makeExpense()]));
});

test('rejects a malformed policy, listing every problem', () => {
  const policy = makePolicy({
    effective_date: '2024-02-30',
    annual_limit: -1,
    benefits: [
      makeBenefit({ limit_group: 'NOPE', copay: { type: 'SOMETIMES', value: 1 } }),
      makeBenefit({ sub_benefits: [{ name: 'Doctor Visit', max_visits: 0 }] }),
    ],
  });
  assert.throws(
    () => validatePolicy(policy),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.deepEqual(err.errors, [
        'policy.effective_date must be a valid YYYY-MM-DD date',
        'policy.annual_limit must be a positive number with at most 2 decimals',
        'policy.benefits[0].limit_group "NOPE" does not match any limit group',
        'policy.benefits[0].copay.type must be one of PERCENTAGE, FIXED',
        'policy.benefits[1].benefit_type "OUTPATIENT" is duplicated',
        'policy.benefits[1].sub_benefits[0].max_visits must be a positive integer',
      ]);
      return true;
    },
  );
});

test('rejects malformed expenses, listing every problem', () => {
  const expenses = [
    makeExpense({ expense_id: 'E1', amount: -5 }),
    makeExpense({ expense_id: 'E2', date: '2024-02-30' }),
    makeExpense({ expense_id: 'E1', amount: 10.005 }),
  ];
  assert.throws(
    () => validateExpenses(expenses),
    (err) => {
      assert.ok(err instanceof ValidationError);
      assert.deepEqual(err.errors, [
        'expenses[0].amount must be a positive number with at most 2 decimals',
        'expenses[1].date must be a valid YYYY-MM-DD date',
        'expenses[2].expense_id "E1" is duplicated',
        'expenses[2].amount must be a positive number with at most 2 decimals',
      ]);
      return true;
    },
  );
});

test('resolves coverage with inherited and overridden rules', () => {
  const policy = makePolicy({
    limit_groups: [{ group_id: 'G', name: 'Group', annual_limit: 5000 }],
    benefits: [
      makeBenefit({
        benefit_type: 'DENTAL',
        limit_group: 'G',
        copay: { type: 'FIXED', value: 300 },
        waiting_period_days: 90,
        sub_benefits: [
          { name: 'Filling', per_visit_cap: 3000 },
          { name: 'Root Canal', waiting_period_days: 180, copay: { type: 'PERCENTAGE', value: 10 }, max_visits: 2 },
        ],
      }),
    ],
  });

  assert.deepEqual(resolveCoverage(policy, makeExpense({ benefit_type: 'DENTAL', sub_benefit: 'Filling' })), {
    found: true,
    benefitType: 'DENTAL',
    subBenefit: 'Filling',
    groupId: 'G',
    perVisitCap: 300000,
    maxVisits: null,
    copay: { type: 'FIXED', value: 300 },
    waitingPeriodDays: 90,
    waitingPeriodScope: 'DENTAL',
  });

  const rootCanal = resolveCoverage(policy, makeExpense({ benefit_type: 'DENTAL', sub_benefit: 'Root Canal' }));
  assert.equal(rootCanal.waitingPeriodDays, 180);
  assert.equal(rootCanal.waitingPeriodScope, 'Root Canal');
  assert.deepEqual(rootCanal.copay, { type: 'PERCENTAGE', value: 10 });
  assert.equal(rootCanal.perVisitCap, null);
  assert.equal(rootCanal.maxVisits, 2);

  assert.deepEqual(resolveCoverage(policy, makeExpense({ benefit_type: 'MATERNITY' })), {
    found: false,
    code: 'BENEFIT_NOT_COVERED',
  });
  assert.deepEqual(resolveCoverage(policy, makeExpense({ benefit_type: 'DENTAL', sub_benefit: 'Implant' })), {
    found: false,
    code: 'SUB_BENEFIT_NOT_COVERED',
  });
});
