# Policy Benefits Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable JavaScript module that takes a policy (JSON) and a list of medical expenses, processes them chronologically, and returns per-expense covered amounts with human-readable reasons plus an end-of-period balance summary.

**Architecture:** Small ES modules with one responsibility each: `money` (satang arithmetic), `policy` (validation + rule resolution), `ledger` (running usage per limit tier), `eligibility` (deny checks), `calculator` (orchestrates the 5-step pipeline), `summary` (final balances). `calculate(policy, expenses)` is pure from the caller's view. A thin `cli.js` reads JSON files and writes the output.

**Tech Stack:** Node.js ≥ 20, ES Modules, built-in `node:test` + `node:assert/strict`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-policy-benefits-calculator-design.md` — read it before starting any task. Section numbers below (§) refer to it.

## Global Constraints

- Node.js ≥ 20, `"type": "module"`, **no runtime or dev dependencies**.
- All money arithmetic uses **integer satang** internally (`toSatang` / `toBaht` from `src/money.js`); output amounts are JSON numbers in THB.
- Only the percentage copay is rounded (half-up to 1 satang); `covered` and `member_pays` are derived by subtraction (§6).
- Processing order: `date` ascending, then `expense_id` ascending (§4.1).
- Eligibility checks run in the fixed order of §4.2 step 1; the first failure is reported; denied expenses consume nothing.
- Decisions are exactly `COVERED`, `PARTIALLY_COVERED`, `NO_PAYOUT`, `DENIED` (§4.3).
- Reason strings follow the templates in §5 **character for character**. Amounts use en-US grouping, no decimals for whole amounts, exactly 2 otherwise, followed by a space and `policy.currency`.
- `calculate` never mutates its inputs.
- `data/expected_output.json` is transcribed by hand from §10.3–10.4. **Never generate it by running the calculator**, and never "fix" a failing dataset test by copying actual output into it.
- Every result satisfies `submitted = covered + member_pays` and `member_pays = not_covered + deductible + copay`.
- Commit messages: conventional style (`feat:`, `test:`, `docs:`), no co-author or attribution trailers.
- Do not commit `DESIGN_NOTES.md` or `AI_Engineering_Challenges/` unless the user asks.

## Deviations from the spec (intentional, small)

1. `checkEligibility` returns the reason string or `null` (spec §9 said `null | { code, reason }`); nothing consumes a code.
2. Reason amounts are suffixed with `policy.currency` rather than a hard-coded `THB` — identical output for the dataset, more reusable.
3. Tests are split across more files than §11 lists (`policy`, `ledger`, `eligibility`, `summary` get their own), giving 37 tests instead of 21. Every test in §11 is still present.
4. The ledger exposes read accessors `group()`, `benefit()`, `sub()` and a `policyTier` field so `summary.js` can read final state.
5. `cli.js` also reports non-validation errors (e.g. unreadable JSON) as a one-line message with exit code 1.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | ESM flag, Node engine, `test` / `test:report` / `calculate` scripts |
| `src/money.js` | `toSatang`, `toBaht`, `percentOf`, `formatAmount` |
| `src/policy.js` | `ValidationError`, `isValidDate`, `validatePolicy`, `validateExpenses`, `resolveCoverage` |
| `src/ledger.js` | `createLedger(policy)` → usage per tier, deductible, visits |
| `src/eligibility.js` | `addDays`, `checkEligibility` (step 1) |
| `src/calculator.js` | `compareExpenses`, `calculate` (steps 2–5, decisions, reasons) |
| `src/summary.js` | `buildSummary(policy, ledger, results)` |
| `src/index.js` | Public API: `calculate`, `ValidationError` |
| `cli.js` | `node cli.js <policy.json> <expenses.json> [out.json]` |
| `test/helpers.js` | `makePolicy`, `makeBenefit`, `makeExpense` builders |
| `test/*.test.js` | One test file per module + `dataset.test.js` |
| `data/policy.json`, `data/expenses.json` | The 20-expense dataset (§10.1–10.2) |
| `data/expected_output.json` | Hand-computed expected output (§10.3–10.4) |
| `output/results.json`, `test-results.txt` | Generated deliverables |
| `README.md` | How to run, rules, dataset, assumptions, timeline |

---

### Task 1: Project setup and money helpers

**Files:**
- Create: `package.json`
- Create: `src/money.js`
- Test: `test/money.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `toSatang(thb: number): number` — integer satang
  - `toBaht(satang: number): number`
  - `percentOf(satang: number, percent: number): number` — half-up to integer satang
  - `formatAmount(satang: number): string` — `"1,040"`, `"246.91"`, `"1.20"`, `"0"`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "policy-benefits-calculator",
  "version": "1.0.0",
  "description": "Calculates how much of each medical expense an insurance policy covers, with explanations",
  "type": "module",
  "main": "src/index.js",
  "exports": "./src/index.js",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test test/*.test.js",
    "test:report": "node --test --test-reporter=spec test/*.test.js > test-results.txt",
    "calculate": "node cli.js data/policy.json data/expenses.json output/results.json"
  },
  "license": "MIT"
}
```

The test glob is explicit so `test/helpers.js` is not run as a test file.

- [ ] **Step 2: Write the failing test** — `test/money.test.js`

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/money.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/money.js`.

- [ ] **Step 4: Write the implementation** — `src/money.js`

```js
// All money is handled internally as integer satang (1 THB = 100 satang)
// to avoid floating-point drift. Convert only at the input/output boundary.

export function toSatang(thb) {
  return Math.round(thb * 100);
}

export function toBaht(satang) {
  return satang / 100;
}

// Percentage of an amount, rounded half-up to the nearest satang.
export function percentOf(satang, percent) {
  return Math.round((satang * percent) / 100);
}

// "1,040" for whole amounts, "246.91" otherwise.
export function formatAmount(satang) {
  const digits = satang % 100 === 0 ? 0 : 2;
  return toBaht(satang).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/money.test.js`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 6: Commit** (includes the spec and this plan)

```bash
git add package.json src/money.js test/money.test.js docs/superpowers
git commit -m "feat: add project setup and satang money helpers"
```

---

### Task 2: Policy validation and coverage resolution

**Files:**
- Create: `src/policy.js`
- Create: `test/helpers.js`
- Test: `test/policy.test.js`

**Interfaces:**
- Consumes: `toSatang` from `src/money.js`
- Produces:
  - `class ValidationError extends Error { errors: string[] }`
  - `isValidDate(value): boolean` — real calendar date in `YYYY-MM-DD`
  - `validatePolicy(policy): void` — throws `ValidationError` listing every problem
  - `validateExpenses(expenses): void` — throws `ValidationError` listing every problem
  - `resolveCoverage(policy, expense)` → either `{ found: false, code: 'BENEFIT_NOT_COVERED' | 'SUB_BENEFIT_NOT_COVERED' }` or
    `{ found: true, benefitType, subBenefit, groupId: string|null, perVisitCap: satang|null, maxVisits: number|null, copay: {type,value}|null, waitingPeriodDays: number, waitingPeriodScope: string }`
  - Test builders: `makePolicy(overrides)`, `makeBenefit(overrides)`, `makeExpense(overrides)`

- [ ] **Step 1: Create the test builders** — `test/helpers.js`

```js
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
```

- [ ] **Step 2: Write the failing test** — `test/policy.test.js`

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/policy.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/policy.js`.

- [ ] **Step 4: Write the implementation** — `src/policy.js`

```js
import { toSatang } from './money.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(`Invalid input:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COPAY_TYPES = ['PERCENTAGE', 'FIXED'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isNonNegativeInteger = (v) => Number.isInteger(v) && v >= 0;
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isMoney(value, allowZero) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (allowZero ? value < 0 : value <= 0) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

function checkMoney(errors, path, value, { allowZero = false } = {}) {
  if (!isMoney(value, allowZero)) {
    errors.push(`${path} must be a ${allowZero ? 'non-negative' : 'positive'} number with at most 2 decimals`);
  }
}

function checkCopay(errors, path, copay) {
  if (!isObject(copay)) {
    errors.push(`${path} must be an object`);
  } else if (!COPAY_TYPES.includes(copay.type)) {
    errors.push(`${path}.type must be one of ${COPAY_TYPES.join(', ')}`);
  } else if (copay.type === 'PERCENTAGE') {
    if (typeof copay.value !== 'number' || !(copay.value >= 0 && copay.value <= 100)) {
      errors.push(`${path}.value must be a number between 0 and 100`);
    }
  } else {
    checkMoney(errors, `${path}.value`, copay.value, { allowZero: true });
  }
}

function checkWaitingPeriod(errors, path, value) {
  if (value != null && !isNonNegativeInteger(value)) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function checkUniqueName(errors, path, value, seen) {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
  } else if (seen.has(value)) {
    errors.push(`${path} "${value}" is duplicated`);
  } else {
    seen.add(value);
  }
}

function checkSubBenefit(errors, path, sub, names) {
  if (!isObject(sub)) {
    errors.push(`${path} must be an object`);
    return;
  }
  checkUniqueName(errors, `${path}.name`, sub.name, names);
  if (sub.per_visit_cap != null) checkMoney(errors, `${path}.per_visit_cap`, sub.per_visit_cap);
  if (sub.max_visits != null && !isPositiveInteger(sub.max_visits)) {
    errors.push(`${path}.max_visits must be a positive integer`);
  }
  if (sub.annual_limit != null) checkMoney(errors, `${path}.annual_limit`, sub.annual_limit);
  if (sub.copay != null) checkCopay(errors, `${path}.copay`, sub.copay);
  checkWaitingPeriod(errors, `${path}.waiting_period_days`, sub.waiting_period_days);
}

function checkBenefit(errors, path, benefit, types, groupIds) {
  if (!isObject(benefit)) {
    errors.push(`${path} must be an object`);
    return;
  }
  checkUniqueName(errors, `${path}.benefit_type`, benefit.benefit_type, types);
  if (benefit.limit_group != null && !groupIds.has(benefit.limit_group)) {
    errors.push(`${path}.limit_group "${benefit.limit_group}" does not match any limit group`);
  }
  if (benefit.annual_limit != null) checkMoney(errors, `${path}.annual_limit`, benefit.annual_limit);
  if (benefit.deductible != null) {
    checkMoney(errors, `${path}.deductible`, benefit.deductible, { allowZero: true });
  }
  if (benefit.copay != null) checkCopay(errors, `${path}.copay`, benefit.copay);
  checkWaitingPeriod(errors, `${path}.waiting_period_days`, benefit.waiting_period_days);
  if (!Array.isArray(benefit.sub_benefits) || benefit.sub_benefits.length === 0) {
    errors.push(`${path}.sub_benefits must be a non-empty array`);
    return;
  }
  const names = new Set();
  benefit.sub_benefits.forEach((sub, i) => checkSubBenefit(errors, `${path}.sub_benefits[${i}]`, sub, names));
}

function checkExclusion(errors, path, exclusion) {
  if (!isObject(exclusion)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(exclusion.exclusion_id)) errors.push(`${path}.exclusion_id must be a non-empty string`);
  if (!isNonEmptyString(exclusion.description)) errors.push(`${path}.description must be a non-empty string`);
  const { keywords } = exclusion;
  if (!Array.isArray(keywords) || keywords.length === 0 || !keywords.every(isNonEmptyString)) {
    errors.push(`${path}.keywords must be a non-empty array of non-empty strings`);
  }
}

export function validatePolicy(policy) {
  if (!isObject(policy)) throw new ValidationError(['policy must be an object']);
  const errors = [];

  if (!isNonEmptyString(policy.policy_id)) errors.push('policy.policy_id must be a non-empty string');
  if (!isNonEmptyString(policy.currency)) errors.push('policy.currency must be a non-empty string');
  const datesValid = ['effective_date', 'expiry_date'].every((field) => {
    const valid = isValidDate(policy[field]);
    if (!valid) errors.push(`policy.${field} must be a valid YYYY-MM-DD date`);
    return valid;
  });
  if (datesValid && policy.effective_date > policy.expiry_date) {
    errors.push('policy.effective_date must not be after policy.expiry_date');
  }
  checkMoney(errors, 'policy.annual_limit', policy.annual_limit);

  const groupIds = new Set();
  if (policy.limit_groups != null) {
    if (!Array.isArray(policy.limit_groups)) {
      errors.push('policy.limit_groups must be an array');
    } else {
      policy.limit_groups.forEach((group, i) => {
        const path = `policy.limit_groups[${i}]`;
        if (!isObject(group)) {
          errors.push(`${path} must be an object`);
          return;
        }
        checkUniqueName(errors, `${path}.group_id`, group.group_id, groupIds);
        if (!isNonEmptyString(group.name)) errors.push(`${path}.name must be a non-empty string`);
        checkMoney(errors, `${path}.annual_limit`, group.annual_limit);
      });
    }
  }

  if (!Array.isArray(policy.benefits) || policy.benefits.length === 0) {
    errors.push('policy.benefits must be a non-empty array');
  } else {
    const types = new Set();
    policy.benefits.forEach((benefit, i) => checkBenefit(errors, `policy.benefits[${i}]`, benefit, types, groupIds));
  }

  if (policy.exclusions != null) {
    if (!Array.isArray(policy.exclusions)) {
      errors.push('policy.exclusions must be an array');
    } else {
      policy.exclusions.forEach((exclusion, i) => checkExclusion(errors, `policy.exclusions[${i}]`, exclusion));
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}

export function validateExpenses(expenses) {
  if (!Array.isArray(expenses)) throw new ValidationError(['expenses must be an array']);
  const errors = [];
  const ids = new Set();

  expenses.forEach((expense, i) => {
    const path = `expenses[${i}]`;
    if (!isObject(expense)) {
      errors.push(`${path} must be an object`);
      return;
    }
    checkUniqueName(errors, `${path}.expense_id`, expense.expense_id, ids);
    if (!isValidDate(expense.date)) errors.push(`${path}.date must be a valid YYYY-MM-DD date`);
    if (!isNonEmptyString(expense.benefit_type)) errors.push(`${path}.benefit_type must be a non-empty string`);
    if (!isNonEmptyString(expense.sub_benefit)) errors.push(`${path}.sub_benefit must be a non-empty string`);
    checkMoney(errors, `${path}.amount`, expense.amount);
    if (typeof expense.diagnosis !== 'string') errors.push(`${path}.diagnosis must be a string`);
    if (expense.provider != null && typeof expense.provider !== 'string') {
      errors.push(`${path}.provider must be a string`);
    }
  });

  if (errors.length > 0) throw new ValidationError(errors);
}

// Looks up the benefit and sub-benefit an expense claims against and resolves
// inherited rules (copay, waiting period). Amounts are returned in satang.
export function resolveCoverage(policy, expense) {
  const benefit = policy.benefits.find((b) => b.benefit_type === expense.benefit_type);
  if (!benefit) return { found: false, code: 'BENEFIT_NOT_COVERED' };
  const sub = benefit.sub_benefits.find((s) => s.name === expense.sub_benefit);
  if (!sub) return { found: false, code: 'SUB_BENEFIT_NOT_COVERED' };

  const subOverridesWaiting = sub.waiting_period_days != null;
  return {
    found: true,
    benefitType: benefit.benefit_type,
    subBenefit: sub.name,
    groupId: benefit.limit_group ?? null,
    perVisitCap: sub.per_visit_cap != null ? toSatang(sub.per_visit_cap) : null,
    maxVisits: sub.max_visits ?? null,
    copay: sub.copay ?? benefit.copay ?? null,
    waitingPeriodDays: subOverridesWaiting ? sub.waiting_period_days : (benefit.waiting_period_days ?? 0),
    waitingPeriodScope: subOverridesWaiting ? sub.name : benefit.benefit_type,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/policy.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/policy.js test/helpers.js test/policy.test.js
git commit -m "feat: validate policy and expenses, resolve coverage rules"
```

---

### Task 3: Ledger

**Files:**
- Create: `src/ledger.js`
- Test: `test/ledger.test.js`

**Interfaces:**
- Consumes: `toSatang` from `src/money.js`; coverage objects from `resolveCoverage` (Task 2)
- Produces: `createLedger(policy)` returning an object with:
  - `limitTiers(coverage) → Array<{ label: string, remaining: satang }>` — only tiers that have a limit, order sub-benefit → benefit → limit group → policy
  - `deductibleRemaining(benefitType) → satang`
  - `visitsRemaining(benefitType, subName) → number | null` (`null` = unlimited)
  - `policyRemaining() → satang`
  - `record(coverage, { covered: satang, deductibleApplied: satang }) → void` — adds `covered` to every tier, the deductible, and one visit
  - Read accessors for the summary: `policyTier`, `group(groupId)`, `benefit(benefitType)`, `sub(benefitType, subName)`. Records have `{ label, limit: satang|null, used }`; benefits add `{ deductible, deductibleUsed }`; subs add `{ maxVisits, visitsUsed }`.

- [ ] **Step 1: Write the failing test** — `test/ledger.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ledger.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/ledger.js`.

- [ ] **Step 3: Write the implementation** — `src/ledger.js`

```js
import { toSatang } from './money.js';

const optionalSatang = (thb) => (thb != null ? toSatang(thb) : null);
const subKey = (benefitType, subName) => JSON.stringify([benefitType, subName]);

// Running totals for one calculation: usage per limit tier, deductible used
// per benefit and visits per sub-benefit. All amounts in satang.
class Ledger {
  constructor(policy) {
    this.policyTier = { label: 'Policy', limit: toSatang(policy.annual_limit), used: 0 };
    this.groups = new Map();
    this.benefits = new Map();
    this.subs = new Map();

    for (const group of policy.limit_groups ?? []) {
      this.groups.set(group.group_id, { label: group.name, limit: toSatang(group.annual_limit), used: 0 });
    }
    for (const benefit of policy.benefits) {
      this.benefits.set(benefit.benefit_type, {
        label: benefit.benefit_type,
        limit: optionalSatang(benefit.annual_limit),
        used: 0,
        deductible: toSatang(benefit.deductible ?? 0),
        deductibleUsed: 0,
      });
      for (const sub of benefit.sub_benefits) {
        this.subs.set(subKey(benefit.benefit_type, sub.name), {
          label: sub.name,
          limit: optionalSatang(sub.annual_limit),
          used: 0,
          maxVisits: sub.max_visits ?? null,
          visitsUsed: 0,
        });
      }
    }
  }

  group(groupId) {
    return this.groups.get(groupId);
  }

  benefit(benefitType) {
    return this.benefits.get(benefitType);
  }

  sub(benefitType, subName) {
    return this.subs.get(subKey(benefitType, subName));
  }

  // Tiers that carry an annual limit for this coverage, most specific first.
  limitTiers(coverage) {
    const tiers = [this.sub(coverage.benefitType, coverage.subBenefit), this.benefit(coverage.benefitType)];
    if (coverage.groupId !== null) tiers.push(this.group(coverage.groupId));
    tiers.push(this.policyTier);
    return tiers
      .filter((tier) => tier.limit !== null)
      .map((tier) => ({ label: tier.label, remaining: tier.limit - tier.used }));
  }

  deductibleRemaining(benefitType) {
    const benefit = this.benefit(benefitType);
    return benefit.deductible - benefit.deductibleUsed;
  }

  visitsRemaining(benefitType, subName) {
    const sub = this.sub(benefitType, subName);
    return sub.maxVisits === null ? null : sub.maxVisits - sub.visitsUsed;
  }

  policyRemaining() {
    return this.policyTier.limit - this.policyTier.used;
  }

  // Called once for every expense that is not denied.
  record(coverage, { covered, deductibleApplied }) {
    const sub = this.sub(coverage.benefitType, coverage.subBenefit);
    const benefit = this.benefit(coverage.benefitType);
    sub.used += covered;
    sub.visitsUsed += 1;
    benefit.used += covered;
    benefit.deductibleUsed += deductibleApplied;
    if (coverage.groupId !== null) this.group(coverage.groupId).used += covered;
    this.policyTier.used += covered;
  }
}

export function createLedger(policy) {
  return new Ledger(policy);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ledger.test.js`
Expected: PASS — 2 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/ledger.js test/ledger.test.js
git commit -m "feat: add ledger tracking usage per limit tier, deductible and visits"
```

---

### Task 4: Eligibility checks (step 1)

**Files:**
- Create: `src/eligibility.js`
- Test: `test/eligibility.test.js`

**Interfaces:**
- Consumes: `resolveCoverage` (Task 2), `createLedger` and its `visitsRemaining`, `limitTiers` (Task 3)
- Produces:
  - `addDays(isoDate: string, days: number): string` — UTC calendar arithmetic
  - `checkEligibility(policy, expense, coverage, ledger): string | null` — the §5.1 denial reason for the first failed check, or `null`

- [ ] **Step 1: Write the failing test** — `test/eligibility.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/eligibility.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/eligibility.js`.

- [ ] **Step 3: Write the implementation** — `src/eligibility.js`

```js
// Step 1: checks that deny an expense outright. Runs in a fixed order and
// returns the reason for the first failed check, or null if eligible.
// Reads the ledger but never writes to it.

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function findExclusion(exclusions, diagnosis) {
  const text = diagnosis.toLowerCase();
  for (const exclusion of exclusions) {
    const keyword = exclusion.keywords.find((k) => text.includes(k.toLowerCase()));
    if (keyword) return { ...exclusion, keyword };
  }
  return null;
}

export function checkEligibility(policy, expense, coverage, ledger) {
  if (expense.date < policy.effective_date || expense.date > policy.expiry_date) {
    return `Denied: service date ${expense.date} is outside the policy period (${policy.effective_date} to ${policy.expiry_date}).`;
  }
  if (coverage.code === 'BENEFIT_NOT_COVERED') {
    return `Denied: benefit type ${expense.benefit_type} is not covered under this policy.`;
  }
  if (coverage.code === 'SUB_BENEFIT_NOT_COVERED') {
    return `Denied: ${expense.sub_benefit} is not covered under ${expense.benefit_type}.`;
  }

  const exclusion = findExclusion(policy.exclusions ?? [], expense.diagnosis);
  if (exclusion) {
    return `Denied: excluded under ${exclusion.exclusion_id} (${exclusion.description}); diagnosis "${expense.diagnosis}" matches "${exclusion.keyword}".`;
  }

  const coverageStart = addDays(policy.effective_date, coverage.waitingPeriodDays);
  if (expense.date < coverageStart) {
    return `Denied: ${coverage.waitingPeriodScope} waiting period of ${coverage.waitingPeriodDays} days not met; coverage starts ${coverageStart}.`;
  }

  if (ledger.visitsRemaining(coverage.benefitType, coverage.subBenefit) === 0) {
    return `Denied: ${coverage.subBenefit} visit limit reached (${coverage.maxVisits} of ${coverage.maxVisits} visits used).`;
  }

  const exhausted = ledger.limitTiers(coverage).find((tier) => tier.remaining <= 0);
  if (exhausted) return `Denied: ${exhausted.label} annual limit exhausted.`;

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/eligibility.test.js`
Expected: PASS — 9 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/eligibility.js test/eligibility.test.js
git commit -m "feat: add eligibility checks for period, coverage, exclusions, waiting and limits"
```

---

### Task 5: Calculator pipeline (steps 2–5, decisions, reasons)

**Files:**
- Create: `src/calculator.js`
- Test: `test/calculator.test.js`

**Interfaces:**
- Consumes: `toSatang`, `toBaht`, `percentOf`, `formatAmount` (Task 1); `validatePolicy`, `validateExpenses`, `resolveCoverage` (Task 2); `createLedger` (Task 3); `checkEligibility` (Task 4)
- Produces:
  - `compareExpenses(a, b): number` — date, then expense ID
  - `calculate(policy, expenses): { results: Result[] }` — `Result` has exactly the §8.1 fields in this order: `expense_id, submitted_amount, not_covered_amount, deductible_applied, copay_amount, covered_amount, member_pays, decision, reason, remaining_annual_limit, remaining_visit_limit`. (Task 6 adds `summary`.)

- [ ] **Step 1: Write the failing test** — `test/calculator.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/calculator.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/calculator.js`.

- [ ] **Step 3: Write the implementation** — `src/calculator.js`

```js
import { toSatang, toBaht, percentOf, formatAmount } from './money.js';
import { validatePolicy, validateExpenses, resolveCoverage } from './policy.js';
import { createLedger } from './ledger.js';
import { checkEligibility } from './eligibility.js';

// Chronological order; same-day expenses by ID so results never depend on input order.
export function compareExpenses(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.expense_id === b.expense_id) return 0;
  return a.expense_id < b.expense_id ? -1 : 1;
}

function computeCopay(rule, base) {
  if (!rule) return 0;
  if (rule.type === 'PERCENTAGE') return percentOf(base, rule.value);
  return Math.min(toSatang(rule.value), base);
}

// The tier with the least room left; ties go to the most specific tier.
function bindingTier(tiers) {
  return tiers.reduce((min, tier) => (tier.remaining < min.remaining ? tier : min));
}

function describeCopay(rule, copay, money) {
  if (rule.type === 'PERCENTAGE') return `${rule.value}% copay applied: ${money(copay)}.`;
  const fixed = toSatang(rule.value);
  return copay === fixed
    ? `Fixed copay applied: ${money(copay)}.`
    : `Fixed copay of ${money(fixed)} limited to the remaining ${money(copay)}.`;
}

function explain(c, money) {
  if (c.decision === 'COVERED') return `Fully covered: ${money(c.covered)}.`;
  const parts = [];
  if (c.capExcess > 0) {
    parts.push(`Per-visit cap of ${money(c.coverage.perVisitCap)} for ${c.coverage.subBenefit} applied; ${money(c.capExcess)} not covered.`);
  }
  if (c.deductibleApplied > 0) {
    parts.push(`${money(c.deductibleApplied)} applied to ${c.coverage.benefitType} deductible (${money(c.deductibleLeft)} remaining).`);
  }
  if (c.copay > 0) parts.push(describeCopay(c.coverage.copay, c.copay, money));
  if (c.limitCut > 0) {
    parts.push(`${c.binding.label} annual limit had only ${money(c.binding.remaining)} remaining; ${money(c.limitCut)} not covered.`);
  }
  parts.push(`Covered: ${money(c.covered)}. Member pays: ${money(c.amount - c.covered)}.`);
  return parts.join(' ');
}

function buildResult(expense, coverage, ledger, { amount, notCovered, deductibleApplied, copay, covered, decision, reason }) {
  return {
    expense_id: expense.expense_id,
    submitted_amount: toBaht(amount),
    not_covered_amount: toBaht(notCovered),
    deductible_applied: toBaht(deductibleApplied),
    copay_amount: toBaht(copay),
    covered_amount: toBaht(covered),
    member_pays: toBaht(amount - covered),
    decision,
    reason,
    remaining_annual_limit: toBaht(ledger.policyRemaining()),
    remaining_visit_limit: coverage.found ? ledger.visitsRemaining(coverage.benefitType, coverage.subBenefit) : null,
  };
}

function processExpense(policy, expense, ledger) {
  const money = (satang) => `${formatAmount(satang)} ${policy.currency}`;
  const amount = toSatang(expense.amount);
  const coverage = resolveCoverage(policy, expense);

  // Step 1 — eligibility. A denied expense consumes nothing.
  const denial = checkEligibility(policy, expense, coverage, ledger);
  if (denial) {
    return buildResult(expense, coverage, ledger, {
      amount, notCovered: amount, deductibleApplied: 0, copay: 0, covered: 0, decision: 'DENIED', reason: denial,
    });
  }

  // Step 2 — per-visit cap.
  const eligible = coverage.perVisitCap === null ? amount : Math.min(amount, coverage.perVisitCap);
  const capExcess = amount - eligible;

  // Step 3 — deductible.
  const deductibleBefore = ledger.deductibleRemaining(coverage.benefitType);
  const deductibleApplied = Math.min(eligible, deductibleBefore);
  const afterDeductible = eligible - deductibleApplied;

  // Step 4 — copay.
  const copay = computeCopay(coverage.copay, afterDeductible);
  const afterCopay = afterDeductible - copay;

  // Step 5 — limit caps across every tier.
  const binding = bindingTier(ledger.limitTiers(coverage));
  const covered = Math.min(afterCopay, binding.remaining);
  const limitCut = afterCopay - covered;

  ledger.record(coverage, { covered, deductibleApplied });

  const decision = covered === amount ? 'COVERED' : covered === 0 ? 'NO_PAYOUT' : 'PARTIALLY_COVERED';
  const reason = explain(
    { coverage, decision, amount, capExcess, deductibleApplied, deductibleLeft: deductibleBefore - deductibleApplied, copay, binding, limitCut, covered },
    money,
  );
  return buildResult(expense, coverage, ledger, {
    amount, notCovered: capExcess + limitCut, deductibleApplied, copay, covered, decision, reason,
  });
}

export function calculate(policy, expenses) {
  validatePolicy(policy);
  validateExpenses(expenses);
  const ledger = createLedger(policy);
  const results = [...expenses].sort(compareExpenses).map((expense) => processExpense(policy, expense, ledger));
  return { results };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/calculator.test.js`
Expected: PASS — 15 tests, 0 failures.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 33 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/calculator.js test/calculator.test.js
git commit -m "feat: add calculator pipeline with cap, deductible, copay, limits and reasons"
```

---

### Task 6: Summary and public API

**Files:**
- Create: `src/summary.js`
- Create: `src/index.js`
- Modify: `src/calculator.js` (import line and the `return` in `calculate`)
- Test: `test/summary.test.js`

**Interfaces:**
- Consumes: `toSatang`, `toBaht` (Task 1); ledger accessors `policyTier`, `group()`, `benefit()`, `sub()`, `policyRemaining()` (Task 3); results from Task 5
- Produces:
  - `buildSummary(policy, ledger, results)` → §8.2 shape: `{ policy, limit_groups, benefits, totals }`
  - `calculate(policy, expenses): { results, summary }`
  - `src/index.js` exports `calculate`, `ValidationError`

- [ ] **Step 1: Write the failing test** — `test/summary.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/summary.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/index.js`.

- [ ] **Step 3: Write `src/summary.js`**

```js
import { toSatang, toBaht } from './money.js';

const DECISIONS = ['COVERED', 'PARTIALLY_COVERED', 'NO_PAYOUT', 'DENIED'];

const remainingOf = (tier) => (tier.limit === null ? null : tier.limit - tier.used);
const bahtOrNull = (satang) => (satang === null ? null : toBaht(satang));
// What can still be paid: the tier's own balance, capped by every parent tier.
const availableOf = (own, parentAvailable) => (own === null ? parentAvailable : Math.min(own, parentAvailable));

function sumSatang(results, field) {
  return results.reduce((total, r) => total + toSatang(r[field]), 0);
}

export function buildSummary(policy, ledger, results) {
  const policyRemaining = ledger.policyRemaining();

  const benefits = policy.benefits.map((b) => {
    const state = ledger.benefit(b.benefit_type);
    const groupRemaining = b.limit_group != null ? remainingOf(ledger.group(b.limit_group)) : null;
    const parentAvailable = availableOf(groupRemaining, policyRemaining);
    const benefitRemaining = remainingOf(state);
    const benefitAvailable = availableOf(benefitRemaining, parentAvailable);

    return {
      benefit_type: b.benefit_type,
      annual_limit: b.annual_limit ?? null,
      used: toBaht(state.used),
      remaining: bahtOrNull(benefitRemaining),
      available: toBaht(benefitAvailable),
      deductible: {
        amount: toBaht(state.deductible),
        used: toBaht(state.deductibleUsed),
        remaining: toBaht(state.deductible - state.deductibleUsed),
      },
      sub_benefits: b.sub_benefits.map((s) => {
        const sub = ledger.sub(b.benefit_type, s.name);
        const subRemaining = remainingOf(sub);
        return {
          name: s.name,
          annual_limit: s.annual_limit ?? null,
          used: toBaht(sub.used),
          remaining: bahtOrNull(subRemaining),
          available: toBaht(availableOf(subRemaining, benefitAvailable)),
          max_visits: sub.maxVisits,
          visits_used: sub.visitsUsed,
          visits_remaining: sub.maxVisits === null ? null : sub.maxVisits - sub.visitsUsed,
        };
      }),
    };
  });

  const byDecision = Object.fromEntries(DECISIONS.map((d) => [d, results.filter((r) => r.decision === d).length]));

  return {
    policy: {
      annual_limit: policy.annual_limit,
      used: toBaht(ledger.policyTier.used),
      remaining: toBaht(policyRemaining),
    },
    limit_groups: (policy.limit_groups ?? []).map((g) => {
      const group = ledger.group(g.group_id);
      return {
        group_id: g.group_id,
        name: g.name,
        annual_limit: g.annual_limit,
        used: toBaht(group.used),
        remaining: toBaht(remainingOf(group)),
      };
    }),
    benefits,
    totals: {
      submitted: toBaht(sumSatang(results, 'submitted_amount')),
      covered: toBaht(sumSatang(results, 'covered_amount')),
      member_pays: toBaht(sumSatang(results, 'member_pays')),
      by_decision: byDecision,
    },
  };
}
```

- [ ] **Step 4: Write `src/index.js`**

```js
export { calculate } from './calculator.js';
export { ValidationError } from './policy.js';
```

- [ ] **Step 5: Wire the summary into `calculate`** — two edits in `src/calculator.js`

Add the import after the `checkEligibility` import:

```js
import { checkEligibility } from './eligibility.js';
import { buildSummary } from './summary.js';
```

Replace the last line of `calculate`:

```js
  return { results };
```

with:

```js
  return { results, summary: buildSummary(policy, ledger, results) };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 34 tests, 0 failures (calculator tests still pass; they only read `results`).

- [ ] **Step 7: Commit**

```bash
git add src/summary.js src/index.js src/calculator.js test/summary.test.js
git commit -m "feat: add end-of-period summary and public API"
```

---

### Task 7: Dataset and hand-computed expected output

**Files:**
- Create: `data/policy.json`
- Create: `data/expenses.json`
- Create: `data/expected_output.json`
- Test: `test/dataset.test.js`

**Interfaces:**
- Consumes: `calculate` from `src/index.js`, `toSatang` from `src/money.js`
- Produces: the dataset files used by the CLI and README (Task 8)

`expected_output.json` below was transcribed from spec §10.3–10.4 **by hand**. Copy it exactly. If the dataset test fails, compare the failing field against the spec tables: either the code has a bug (fix the code) or this file has a transcription error (fix it to match the **spec**, never the program output).

- [ ] **Step 1: Write the test** — `test/dataset.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculate } from '../src/index.js';
import { toSatang } from '../src/money.js';

const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const policy = load('policy.json');
const expenses = load('expenses.json');
// Written by hand from the spec (section 10.3–10.4), never generated by the calculator.
const expected = load('expected_output.json');

const actual = calculate(policy, expenses);

test('the 20 dataset expenses match the hand-computed expected output', () => {
  assert.equal(actual.results.length, 20);
  for (const [i, result] of actual.results.entries()) {
    assert.deepEqual(result, expected.results[i], `mismatch for ${expected.results[i].expense_id}`);
  }
});

test('every result satisfies the money invariants', () => {
  for (const r of actual.results) {
    const [submitted, covered, member, notCovered, deductible, copay] = [
      r.submitted_amount, r.covered_amount, r.member_pays, r.not_covered_amount, r.deductible_applied, r.copay_amount,
    ].map(toSatang);
    assert.equal(submitted, covered + member, `${r.expense_id}: submitted != covered + member_pays`);
    assert.equal(member, notCovered + deductible + copay, `${r.expense_id}: member_pays breakdown`);
  }
});

test('the end-of-year summary matches the hand-computed summary', () => {
  assert.deepEqual(actual.summary, expected.summary);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dataset.test.js`
Expected: FAIL with `ENOENT` for `data/policy.json`.

- [ ] **Step 3: Create `data/policy.json`**

```json
{
  "policy_id": "POL-2024-001",
  "member_name": "Somchai Jaidee",
  "currency": "THB",
  "effective_date": "2024-01-01",
  "expiry_date": "2024-12-31",
  "annual_limit": 100000,
  "limit_groups": [
    { "group_id": "DENTAL_OPTICAL", "name": "Dental & Optical combined", "annual_limit": 12000 }
  ],
  "benefits": [
    {
      "benefit_type": "OUTPATIENT",
      "annual_limit": 20000,
      "deductible": 1000,
      "copay": { "type": "PERCENTAGE", "value": 20 },
      "waiting_period_days": 30,
      "sub_benefits": [
        { "name": "Doctor Visit", "per_visit_cap": 1500, "max_visits": 30 },
        { "name": "Physiotherapy", "per_visit_cap": 1500, "max_visits": 10, "annual_limit": 2000 },
        { "name": "Lab Test", "per_visit_cap": 3000 }
      ]
    },
    {
      "benefit_type": "INPATIENT",
      "annual_limit": 90000,
      "deductible": 0,
      "copay": { "type": "PERCENTAGE", "value": 0 },
      "waiting_period_days": 30,
      "sub_benefits": [
        { "name": "Hospital Stay", "per_visit_cap": 30000 },
        { "name": "Surgery", "per_visit_cap": 50000 }
      ]
    },
    {
      "benefit_type": "DENTAL",
      "limit_group": "DENTAL_OPTICAL",
      "annual_limit": 10000,
      "deductible": 500,
      "copay": { "type": "FIXED", "value": 300 },
      "waiting_period_days": 90,
      "sub_benefits": [
        { "name": "Cleaning", "max_visits": 2 },
        { "name": "Filling", "per_visit_cap": 3000 },
        { "name": "Root Canal", "per_visit_cap": 8000, "waiting_period_days": 180 }
      ]
    },
    {
      "benefit_type": "OPTICAL",
      "limit_group": "DENTAL_OPTICAL",
      "annual_limit": 8000,
      "deductible": 0,
      "copay": { "type": "PERCENTAGE", "value": 10 },
      "waiting_period_days": 60,
      "sub_benefits": [
        { "name": "Eye Exam", "max_visits": 1 },
        { "name": "Glasses", "per_visit_cap": 5000, "max_visits": 1 }
      ]
    }
  ],
  "exclusions": [
    { "exclusion_id": "EXC-01", "description": "Cosmetic procedures", "keywords": ["cosmetic", "whitening", "botox", "aesthetic"] },
    { "exclusion_id": "EXC-02", "description": "Self-inflicted injury", "keywords": ["self-inflicted"] },
    { "exclusion_id": "EXC-03", "description": "Experimental treatment", "keywords": ["experimental"] }
  ]
}
```

- [ ] **Step 4: Create `data/expenses.json`**

```json
[
  { "expense_id": "EXP-001", "date": "2024-01-10", "benefit_type": "OUTPATIENT", "sub_benefit": "Doctor Visit", "amount": 1200, "diagnosis": "Acute bronchitis", "provider": "Bangkok Hospital" },
  { "expense_id": "EXP-002", "date": "2024-01-31", "benefit_type": "OUTPATIENT", "sub_benefit": "Doctor Visit", "amount": 800, "diagnosis": "Common cold", "provider": "Sukhumvit Family Clinic" },
  { "expense_id": "EXP-003", "date": "2024-02-12", "benefit_type": "OUTPATIENT", "sub_benefit": "Doctor Visit", "amount": 2500, "diagnosis": "Acute bronchitis", "provider": "Bangkok Hospital" },
  { "expense_id": "EXP-004", "date": "2024-02-20", "benefit_type": "INPATIENT", "sub_benefit": "Hospital Stay", "amount": 18500, "diagnosis": "Dengue fever", "provider": "Samitivej Hospital" },
  { "expense_id": "EXP-005", "date": "2024-03-05", "benefit_type": "OUTPATIENT", "sub_benefit": "Physiotherapy", "amount": 1500, "diagnosis": "Lower back pain", "provider": "Bangkok Physio Center" },
  { "expense_id": "EXP-006", "date": "2024-03-19", "benefit_type": "OUTPATIENT", "sub_benefit": "Physiotherapy", "amount": 1500, "diagnosis": "Lower back pain", "provider": "Bangkok Physio Center" },
  { "expense_id": "EXP-007", "date": "2024-04-02", "benefit_type": "OUTPATIENT", "sub_benefit": "Physiotherapy", "amount": 1500, "diagnosis": "Lower back pain", "provider": "Bangkok Physio Center" },
  { "expense_id": "EXP-008", "date": "2024-04-03", "benefit_type": "DENTAL", "sub_benefit": "Cleaning", "amount": 1200, "diagnosis": "Dental plaque", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-009", "date": "2024-04-18", "benefit_type": "DENTAL", "sub_benefit": "Filling", "amount": 4000, "diagnosis": "Dental caries", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-010", "date": "2024-05-06", "benefit_type": "DENTAL", "sub_benefit": "Cleaning", "amount": 250, "diagnosis": "Routine scaling", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-011", "date": "2024-05-10", "benefit_type": "DENTAL", "sub_benefit": "Root Canal", "amount": 7500, "diagnosis": "Pulpitis", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-012", "date": "2024-06-03", "benefit_type": "OUTPATIENT", "sub_benefit": "Acupuncture", "amount": 1500, "diagnosis": "Neck pain", "provider": "Chinese Medicine Clinic" },
  { "expense_id": "EXP-013", "date": "2024-06-20", "benefit_type": "INPATIENT", "sub_benefit": "Surgery", "amount": 45000, "diagnosis": "Cosmetic rhinoplasty", "provider": "Bumrungrad International Hospital" },
  { "expense_id": "EXP-014", "date": "2024-07-08", "benefit_type": "DENTAL", "sub_benefit": "Cleaning", "amount": 900, "diagnosis": "Dental plaque", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-015", "date": "2024-07-15", "benefit_type": "DENTAL", "sub_benefit": "Root Canal", "amount": 7500, "diagnosis": "Pulpitis", "provider": "Smile Dental Clinic" },
  { "expense_id": "EXP-016", "date": "2024-08-05", "benefit_type": "OPTICAL", "sub_benefit": "Glasses", "amount": 4000, "diagnosis": "Myopia", "provider": "Siam Optical" },
  { "expense_id": "EXP-017", "date": "2024-08-05", "benefit_type": "OPTICAL", "sub_benefit": "Eye Exam", "amount": 800, "diagnosis": "Myopia", "provider": "Siam Optical" },
  { "expense_id": "EXP-018", "date": "2024-09-10", "benefit_type": "INPATIENT", "sub_benefit": "Surgery", "amount": 60000, "diagnosis": "Acute appendicitis", "provider": "Bangkok Hospital" },
  { "expense_id": "EXP-019", "date": "2024-11-20", "benefit_type": "INPATIENT", "sub_benefit": "Hospital Stay", "amount": 25000, "diagnosis": "Pneumonia", "provider": "Samitivej Hospital" },
  { "expense_id": "EXP-020", "date": "2024-12-16", "benefit_type": "OUTPATIENT", "sub_benefit": "Doctor Visit", "amount": 1000, "diagnosis": "Influenza", "provider": "Sukhumvit Family Clinic" }
]
```

- [ ] **Step 5: Create `data/expected_output.json`** (hand-computed; copy exactly)

```json
{
  "results": [
    {
      "expense_id": "EXP-001", "submitted_amount": 1200, "not_covered_amount": 1200, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 1200, "decision": "DENIED",
      "reason": "Denied: OUTPATIENT waiting period of 30 days not met; coverage starts 2024-01-31.",
      "remaining_annual_limit": 100000, "remaining_visit_limit": 30
    },
    {
      "expense_id": "EXP-002", "submitted_amount": 800, "not_covered_amount": 0, "deductible_applied": 800, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 800, "decision": "NO_PAYOUT",
      "reason": "800 THB applied to OUTPATIENT deductible (200 THB remaining). Covered: 0 THB. Member pays: 800 THB.",
      "remaining_annual_limit": 100000, "remaining_visit_limit": 29
    },
    {
      "expense_id": "EXP-003", "submitted_amount": 2500, "not_covered_amount": 1000, "deductible_applied": 200, "copay_amount": 260,
      "covered_amount": 1040, "member_pays": 1460, "decision": "PARTIALLY_COVERED",
      "reason": "Per-visit cap of 1,500 THB for Doctor Visit applied; 1,000 THB not covered. 200 THB applied to OUTPATIENT deductible (0 THB remaining). 20% copay applied: 260 THB. Covered: 1,040 THB. Member pays: 1,460 THB.",
      "remaining_annual_limit": 98960, "remaining_visit_limit": 28
    },
    {
      "expense_id": "EXP-004", "submitted_amount": 18500, "not_covered_amount": 0, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 18500, "member_pays": 0, "decision": "COVERED",
      "reason": "Fully covered: 18,500 THB.",
      "remaining_annual_limit": 80460, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-005", "submitted_amount": 1500, "not_covered_amount": 0, "deductible_applied": 0, "copay_amount": 300,
      "covered_amount": 1200, "member_pays": 300, "decision": "PARTIALLY_COVERED",
      "reason": "20% copay applied: 300 THB. Covered: 1,200 THB. Member pays: 300 THB.",
      "remaining_annual_limit": 79260, "remaining_visit_limit": 9
    },
    {
      "expense_id": "EXP-006", "submitted_amount": 1500, "not_covered_amount": 400, "deductible_applied": 0, "copay_amount": 300,
      "covered_amount": 800, "member_pays": 700, "decision": "PARTIALLY_COVERED",
      "reason": "20% copay applied: 300 THB. Physiotherapy annual limit had only 800 THB remaining; 400 THB not covered. Covered: 800 THB. Member pays: 700 THB.",
      "remaining_annual_limit": 78460, "remaining_visit_limit": 8
    },
    {
      "expense_id": "EXP-007", "submitted_amount": 1500, "not_covered_amount": 1500, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 1500, "decision": "DENIED",
      "reason": "Denied: Physiotherapy annual limit exhausted.",
      "remaining_annual_limit": 78460, "remaining_visit_limit": 8
    },
    {
      "expense_id": "EXP-008", "submitted_amount": 1200, "not_covered_amount": 0, "deductible_applied": 500, "copay_amount": 300,
      "covered_amount": 400, "member_pays": 800, "decision": "PARTIALLY_COVERED",
      "reason": "500 THB applied to DENTAL deductible (0 THB remaining). Fixed copay applied: 300 THB. Covered: 400 THB. Member pays: 800 THB.",
      "remaining_annual_limit": 78060, "remaining_visit_limit": 1
    },
    {
      "expense_id": "EXP-009", "submitted_amount": 4000, "not_covered_amount": 1000, "deductible_applied": 0, "copay_amount": 300,
      "covered_amount": 2700, "member_pays": 1300, "decision": "PARTIALLY_COVERED",
      "reason": "Per-visit cap of 3,000 THB for Filling applied; 1,000 THB not covered. Fixed copay applied: 300 THB. Covered: 2,700 THB. Member pays: 1,300 THB.",
      "remaining_annual_limit": 75360, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-010", "submitted_amount": 250, "not_covered_amount": 0, "deductible_applied": 0, "copay_amount": 250,
      "covered_amount": 0, "member_pays": 250, "decision": "NO_PAYOUT",
      "reason": "Fixed copay of 300 THB limited to the remaining 250 THB. Covered: 0 THB. Member pays: 250 THB.",
      "remaining_annual_limit": 75360, "remaining_visit_limit": 0
    },
    {
      "expense_id": "EXP-011", "submitted_amount": 7500, "not_covered_amount": 7500, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 7500, "decision": "DENIED",
      "reason": "Denied: Root Canal waiting period of 180 days not met; coverage starts 2024-06-29.",
      "remaining_annual_limit": 75360, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-012", "submitted_amount": 1500, "not_covered_amount": 1500, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 1500, "decision": "DENIED",
      "reason": "Denied: Acupuncture is not covered under OUTPATIENT.",
      "remaining_annual_limit": 75360, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-013", "submitted_amount": 45000, "not_covered_amount": 45000, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 45000, "decision": "DENIED",
      "reason": "Denied: excluded under EXC-01 (Cosmetic procedures); diagnosis \"Cosmetic rhinoplasty\" matches \"cosmetic\".",
      "remaining_annual_limit": 75360, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-014", "submitted_amount": 900, "not_covered_amount": 900, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 900, "decision": "DENIED",
      "reason": "Denied: Cleaning visit limit reached (2 of 2 visits used).",
      "remaining_annual_limit": 75360, "remaining_visit_limit": 0
    },
    {
      "expense_id": "EXP-015", "submitted_amount": 7500, "not_covered_amount": 300, "deductible_applied": 0, "copay_amount": 300,
      "covered_amount": 6900, "member_pays": 600, "decision": "PARTIALLY_COVERED",
      "reason": "Fixed copay applied: 300 THB. DENTAL annual limit had only 6,900 THB remaining; 300 THB not covered. Covered: 6,900 THB. Member pays: 600 THB.",
      "remaining_annual_limit": 68460, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-016", "submitted_amount": 4000, "not_covered_amount": 1600, "deductible_applied": 0, "copay_amount": 400,
      "covered_amount": 2000, "member_pays": 2000, "decision": "PARTIALLY_COVERED",
      "reason": "10% copay applied: 400 THB. Dental & Optical combined annual limit had only 2,000 THB remaining; 1,600 THB not covered. Covered: 2,000 THB. Member pays: 2,000 THB.",
      "remaining_annual_limit": 66460, "remaining_visit_limit": 0
    },
    {
      "expense_id": "EXP-017", "submitted_amount": 800, "not_covered_amount": 800, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 800, "decision": "DENIED",
      "reason": "Denied: Dental & Optical combined annual limit exhausted.",
      "remaining_annual_limit": 66460, "remaining_visit_limit": 1
    },
    {
      "expense_id": "EXP-018", "submitted_amount": 60000, "not_covered_amount": 10000, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 50000, "member_pays": 10000, "decision": "PARTIALLY_COVERED",
      "reason": "Per-visit cap of 50,000 THB for Surgery applied; 10,000 THB not covered. Covered: 50,000 THB. Member pays: 10,000 THB.",
      "remaining_annual_limit": 16460, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-019", "submitted_amount": 25000, "not_covered_amount": 8540, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 16460, "member_pays": 8540, "decision": "PARTIALLY_COVERED",
      "reason": "Policy annual limit had only 16,460 THB remaining; 8,540 THB not covered. Covered: 16,460 THB. Member pays: 8,540 THB.",
      "remaining_annual_limit": 0, "remaining_visit_limit": null
    },
    {
      "expense_id": "EXP-020", "submitted_amount": 1000, "not_covered_amount": 1000, "deductible_applied": 0, "copay_amount": 0,
      "covered_amount": 0, "member_pays": 1000, "decision": "DENIED",
      "reason": "Denied: Policy annual limit exhausted.",
      "remaining_annual_limit": 0, "remaining_visit_limit": 28
    }
  ],
  "summary": {
    "policy": { "annual_limit": 100000, "used": 100000, "remaining": 0 },
    "limit_groups": [
      { "group_id": "DENTAL_OPTICAL", "name": "Dental & Optical combined", "annual_limit": 12000, "used": 12000, "remaining": 0 }
    ],
    "benefits": [
      {
        "benefit_type": "OUTPATIENT", "annual_limit": 20000, "used": 3040, "remaining": 16960, "available": 0,
        "deductible": { "amount": 1000, "used": 1000, "remaining": 0 },
        "sub_benefits": [
          { "name": "Doctor Visit", "annual_limit": null, "used": 1040, "remaining": null, "available": 0, "max_visits": 30, "visits_used": 2, "visits_remaining": 28 },
          { "name": "Physiotherapy", "annual_limit": 2000, "used": 2000, "remaining": 0, "available": 0, "max_visits": 10, "visits_used": 2, "visits_remaining": 8 },
          { "name": "Lab Test", "annual_limit": null, "used": 0, "remaining": null, "available": 0, "max_visits": null, "visits_used": 0, "visits_remaining": null }
        ]
      },
      {
        "benefit_type": "INPATIENT", "annual_limit": 90000, "used": 84960, "remaining": 5040, "available": 0,
        "deductible": { "amount": 0, "used": 0, "remaining": 0 },
        "sub_benefits": [
          { "name": "Hospital Stay", "annual_limit": null, "used": 34960, "remaining": null, "available": 0, "max_visits": null, "visits_used": 2, "visits_remaining": null },
          { "name": "Surgery", "annual_limit": null, "used": 50000, "remaining": null, "available": 0, "max_visits": null, "visits_used": 1, "visits_remaining": null }
        ]
      },
      {
        "benefit_type": "DENTAL", "annual_limit": 10000, "used": 10000, "remaining": 0, "available": 0,
        "deductible": { "amount": 500, "used": 500, "remaining": 0 },
        "sub_benefits": [
          { "name": "Cleaning", "annual_limit": null, "used": 400, "remaining": null, "available": 0, "max_visits": 2, "visits_used": 2, "visits_remaining": 0 },
          { "name": "Filling", "annual_limit": null, "used": 2700, "remaining": null, "available": 0, "max_visits": null, "visits_used": 1, "visits_remaining": null },
          { "name": "Root Canal", "annual_limit": null, "used": 6900, "remaining": null, "available": 0, "max_visits": null, "visits_used": 1, "visits_remaining": null }
        ]
      },
      {
        "benefit_type": "OPTICAL", "annual_limit": 8000, "used": 2000, "remaining": 6000, "available": 0,
        "deductible": { "amount": 0, "used": 0, "remaining": 0 },
        "sub_benefits": [
          { "name": "Eye Exam", "annual_limit": null, "used": 0, "remaining": null, "available": 0, "max_visits": 1, "visits_used": 0, "visits_remaining": 1 },
          { "name": "Glasses", "annual_limit": null, "used": 2000, "remaining": null, "available": 0, "max_visits": 1, "visits_used": 1, "visits_remaining": 0 }
        ]
      }
    ],
    "totals": {
      "submitted": 186150,
      "covered": 100000,
      "member_pays": 86150,
      "by_decision": { "COVERED": 1, "PARTIALLY_COVERED": 9, "NO_PAYOUT": 2, "DENIED": 8 }
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/dataset.test.js`
Expected: PASS — 3 tests, 0 failures. On failure, follow the rule at the top of this task.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS — 37 tests, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add data/policy.json data/expenses.json data/expected_output.json test/dataset.test.js
git commit -m "test: add 20-expense dataset with hand-computed expected output"
```

---

### Task 8: CLI, README and generated deliverables

**Files:**
- Create: `cli.js`
- Create: `README.md`
- Generate: `output/results.json`, `test-results.txt`

**Interfaces:**
- Consumes: `calculate`, `ValidationError` from `src/index.js`; `data/*.json` (Task 7)
- Produces: the submission artifacts

- [ ] **Step 1: Write `cli.js`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { calculate, ValidationError } from './src/index.js';

const [policyPath, expensesPath, outPath] = process.argv.slice(2);
if (!policyPath || !expensesPath) {
  console.error('Usage: node cli.js <policy.json> <expenses.json> [out.json]');
  process.exit(2);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

try {
  const output = `${JSON.stringify(calculate(readJson(policyPath), readJson(expensesPath)), null, 2)}\n`;
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output);
    console.log(`Wrote ${outPath}`);
  } else {
    process.stdout.write(output);
  }
} catch (err) {
  if (err instanceof ValidationError) {
    console.error('Invalid input:');
    for (const message of err.errors) console.error(`  - ${message}`);
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
}
```

- [ ] **Step 2: Generate the output and check it against the expected file**

Run: `npm run calculate`
Expected: prints `Wrote output/results.json`.

Run: `node -e "require('assert').deepStrictEqual(require('./output/results.json'), require('./data/expected_output.json')); console.log('output matches expected')"`
Expected: prints `output matches expected`.

- [ ] **Step 3: Check the CLI error paths**

Run: `node cli.js data/policy.json package.json; echo "exit=$?"`
Expected: `Invalid input:` followed by `  - expenses must be an array`, then `exit=1`.

Run: `node cli.js; echo "exit=$?"`
Expected: `Usage: node cli.js <policy.json> <expenses.json> [out.json]`, then `exit=2`.

- [ ] **Step 4: Write `README.md`**

````markdown
# Policy Benefits Calculator

Calculates how much of each medical expense an insurance policy covers — applying annual limits, per-visit caps, visit limits, deductibles, copays, waiting periods and exclusions — and explains every decision in plain language.

Built for AI Challenge 06. Full design: [`docs/superpowers/specs/2026-09-11-policy-benefits-calculator-design.md`](docs/superpowers/specs/2026-09-11-policy-benefits-calculator-design.md).

## Quick start

Requires Node.js 20 or later. No dependencies to install.

```bash
npm test               # run the 37 tests
npm run calculate      # data/policy.json + data/expenses.json -> output/results.json
npm run test:report    # save the test run to test-results.txt
```

## Use as a module

```js
import { calculate, ValidationError } from './src/index.js';

const { results, summary } = calculate(policy, expenses);
```

- `calculate` never mutates its inputs and returns the same output for the same input, whatever order the expenses are in.
- Malformed input (missing fields, negative amounts, invalid dates, …) throws `ValidationError`; its `errors` array lists every problem.
- Business outcomes — unknown sub-benefit, date outside the policy period, excluded diagnosis — are **not** errors; they come back as `DENIED` results with a reason.

## How an expense is processed

Expenses are sorted by date, then by expense ID. Each one then goes through five steps:

1. **Eligibility.** Denied — and nothing is consumed — if, checked in this order: the date is outside the policy period · the benefit or sub-benefit is not in the policy · the diagnosis matches an exclusion · the waiting period is not over · the visit limit is used up · a limit tier is already exhausted. The first failure is reported.
2. **Per-visit cap.** `eligible = min(amount, cap)`. The excess is never covered.
3. **Deductible.** Per benefit, per policy year, taken from the eligible amount.
4. **Copay.** A percentage of what is left (rounded half-up to 0.01), or a fixed amount (never more than what is left).
5. **Limit caps.** `covered = min(what is left, remaining at sub-benefit, benefit, limit group and policy tiers)`. The reason names the tier that cut the payout.

| Decision | Meaning |
|---|---|
| `COVERED` | The whole amount is paid |
| `PARTIALLY_COVERED` | Part is paid |
| `NO_PAYOUT` | Valid claim, but the deductible and/or copay absorbed it all (it still counts as a visit and uses up deductible) |
| `DENIED` | An eligibility rule failed |

Every result satisfies `submitted = covered + member_pays` and `member_pays = not_covered + deductible + copay`. Money is computed in integer satang, so there is no floating-point drift.

## Policy format

See [`data/policy.json`](data/policy.json) and spec §3. In short:

- **Policy:** `effective_date`, `expiry_date`, `annual_limit`, optional `limit_groups` (pools shared by several benefits) and `exclusions` (keywords matched against the diagnosis).
- **Benefit:** optional `annual_limit`, `deductible`, `copay` (`{ "type": "PERCENTAGE" | "FIXED", "value" }`), `waiting_period_days`, `limit_group`.
- **Sub-benefit:** optional `per_visit_cap`, `max_visits`, `annual_limit`, and its own `copay` / `waiting_period_days` overriding the benefit's.

Limits nest in four tiers — sub-benefit → benefit → limit group → policy — and every tier a claim touches is consumed.

## Dataset

[`data/expenses.json`](data/expenses.json) holds 20 expenses for one member in 2024, designed so every rule and every limit tier is exercised. [`data/expected_output.json`](data/expected_output.json) was **computed by hand** from the spec before the code existed; the test suite checks the calculator against it field by field.

| ID | Scenario | Submitted | Covered | Decision |
|---|---|---:|---:|---|
| EXP-001 | Outpatient waiting period (30 days) not over | 1,200 | 0 | DENIED |
| EXP-002 | Deductible absorbs everything; first day after waiting period | 800 | 0 | NO_PAYOUT |
| EXP-003 | Per-visit cap + rest of deductible + 20% copay | 2,500 | 1,040 | PARTIALLY_COVERED |
| EXP-004 | Inpatient, no copay or deductible | 18,500 | 18,500 | COVERED |
| EXP-005 | 20% copay | 1,500 | 1,200 | PARTIALLY_COVERED |
| EXP-006 | Physiotherapy limit has only 800 left | 1,500 | 800 | PARTIALLY_COVERED |
| EXP-007 | Physiotherapy limit exhausted | 1,500 | 0 | DENIED |
| EXP-008 | Dental deductible + fixed copay | 1,200 | 400 | PARTIALLY_COVERED |
| EXP-009 | Per-visit cap + fixed copay | 4,000 | 2,700 | PARTIALLY_COVERED |
| EXP-010 | Bill below the fixed copay | 250 | 0 | NO_PAYOUT |
| EXP-011 | Root Canal's own 180-day waiting period | 7,500 | 0 | DENIED |
| EXP-012 | Sub-benefit not in the policy | 1,500 | 0 | DENIED |
| EXP-013 | Excluded diagnosis (cosmetic) | 45,000 | 0 | DENIED |
| EXP-014 | Cleaning visit limit (2) used up | 900 | 0 | DENIED |
| EXP-015 | Dental benefit limit has only 6,900 left | 7,500 | 6,900 | PARTIALLY_COVERED |
| EXP-016 | Shared Dental & Optical pool has only 2,000 left | 4,000 | 2,000 | PARTIALLY_COVERED |
| EXP-017 | Shared pool exhausted (same day as EXP-016) | 800 | 0 | DENIED |
| EXP-018 | Surgery per-visit cap | 60,000 | 50,000 | PARTIALLY_COVERED |
| EXP-019 | Policy annual limit has only 16,460 left | 25,000 | 16,460 | PARTIALLY_COVERED |
| EXP-020 | Policy annual limit exhausted | 1,000 | 0 | DENIED |
| | **Total** | **186,150** | **100,000** | |

Full results with reasons: [`output/results.json`](output/results.json).

> **Note on EXP-003.** It reuses the sample expense from the problem statement (2,500 THB, acute bronchitis). The problem's sample output (covered 2,000) only illustrates the output format; under this policy the visit is capped at 1,500 and the remaining 200 THB of deductible applies first, so 1,040 is covered.

## Project layout

```
src/money.js        satang arithmetic and amount formatting
src/policy.js       input validation and rule resolution (inheritance)
src/ledger.js       running usage per limit tier, deductible and visits
src/eligibility.js  step 1: deny checks
src/calculator.js   steps 2–5, decisions and reasons
src/summary.js      end-of-period balances
src/index.js        public API
cli.js              command-line entry point
data/               policy, 20 expenses, hand-computed expected output
test/               37 tests (node:test)
```

## Tests

37 tests across 7 files; results in [`test-results.txt`](test-results.txt).

| Required by the challenge | Where |
|---|---|
| Normal coverage | `calculator.test.js` — "normal coverage" |
| Copay (percentage and fixed) | `calculator.test.js` — "percentage copay", "fixed copay larger than the bill" |
| Limit exhaustion | `calculator.test.js` — sub-benefit, limit group, policy and visit-limit tests |
| Waiting period denial | `eligibility.test.js` — boundary day and sub-benefit override; `calculator.test.js` — denial consumes nothing |
| Multiple expenses consuming the same limit | `calculator.test.js` — deductible across expenses, sub-benefit limit, shared limit group |
| All 20 dataset expenses | `dataset.test.js` — exact match with the hand-computed output, invariants, summary |

## Assumptions

1. Each expense is one visit. Visits are used by every non-denied expense, including `NO_PAYOUT`.
2. Denied expenses, cap excess and limit cuts use up no limit, deductible or visit.
3. Waiting periods run from the policy `effective_date`; coverage starts on `effective_date + N days`. There is no accident exemption.
4. Exclusions match keywords in the diagnosis text (case-insensitive). This can over-match ("Non-cosmetic scar revision") or miss ("Rhinoplasty"); a production system would use ICD-10 codes.
5. Copay is computed before limit caps: when a limit cuts the payout, the copay stands and the cut is added to `not_covered_amount`.
6. Deductibles are per benefit, per policy year. Benefit and sub-benefit names match exactly (case-sensitive).

## Timeline

| Work | Estimate |
|---|---|
| Analysis and design (spec, policy, 20 expenses computed by hand) | Done before coding |
| Setup, money, policy validation, ledger | 0.5 h |
| Eligibility, calculator, reasons, summary | 1 h |
| Dataset files and expected output | 0.5 h |
| Tests and fixes | 1 h |
| CLI, README, test results | 0.5 h |
| **Implementation total** | **~3.5 h** |
````

- [ ] **Step 5: Generate the test report**

Run: `npm run test:report && tail -8 test-results.txt`
Expected: the tail shows `ℹ tests 37`, `ℹ pass 37`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add cli.js README.md output/results.json test-results.txt
git commit -m "docs: add CLI, README, generated results and test report"
```

- [ ] **Step 7: Push (only with the user's go-ahead)**

The repository has no remote configured yet. Ask the user for the GitHub repository URL and confirmation before running:

```bash
git remote add origin <url-from-user>
git push -u origin ai-challenge-06
```

---

## Self-review notes

- **Spec coverage:** §3 validation → Task 2 · §4.1 ordering → Task 5 (`compareExpenses`, shuffle test) · §4.2 step 1 → Task 4 · steps 2–5, §4.3 decisions, §4.4 ledger updates → Tasks 3 and 5 · §5 reasons → Tasks 4 and 5, verified character-for-character by Task 7 · §6 money → Task 1 and the satang test in Task 5 · §7 errors → Task 2 and CLI in Task 8 · §8 output and summary → Tasks 5 and 6 · §9 architecture → file structure above · §10 dataset → Task 7 · §11 tests → Tasks 1–7 · §12 deliverables → Task 8 · §14 timeline → README.
- **Verified:** every code block in this plan was run in a scratch copy before the plan was written — 37/37 tests pass, and the calculator output matches the hand-written `expected_output.json` exactly.
