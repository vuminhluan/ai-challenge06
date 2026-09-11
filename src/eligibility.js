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
