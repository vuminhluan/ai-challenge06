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
