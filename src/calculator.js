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
