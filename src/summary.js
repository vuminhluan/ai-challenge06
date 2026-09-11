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
