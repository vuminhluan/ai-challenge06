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
