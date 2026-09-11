// Small builders so each test declares only the policy rules it exercises.

export function makeBenefit(overrides = {}) {
  return {
    benefit_type: 'OUTPATIENT',
    waiting_period_days: 0,
    sub_benefits: [{ name: 'Doctor Visit' }],
    ...overrides,
  };
}

export function makePolicy(overrides = {}) {
  return {
    policy_id: 'POL-TEST',
    currency: 'THB',
    effective_date: '2024-01-01',
    expiry_date: '2024-12-31',
    annual_limit: 100000,
    limit_groups: [],
    exclusions: [],
    benefits: [makeBenefit()],
    ...overrides,
  };
}

export function makeExpense(overrides = {}) {
  return {
    expense_id: 'EXP-1',
    date: '2024-06-01',
    benefit_type: 'OUTPATIENT',
    sub_benefit: 'Doctor Visit',
    amount: 1000,
    diagnosis: 'Influenza',
    ...overrides,
  };
}
