# Policy Benefits Calculator — Design Spec

- **Date:** 2026-09-11
- **Source problem:** `AI_Engineering_Challenges/AI_Challenge_06.md`
- **Status:** Draft for review
- **Supersedes:** `DESIGN_NOTES.md` (working notes, Vietnamese)

---

## 1. Overview

A reusable JavaScript module that takes a **policy definition** (JSON) and a **list of medical expenses**, processes the expenses in chronological order, and returns for each expense the covered amount, the member's share, a decision, and a human-readable reason. After processing, it returns a summary of remaining balances.

### Goals

- Correctly apply annual limits (4 nested tiers), per-visit caps, visit-count limits, deductibles, copay (percentage and fixed), waiting periods and exclusions.
- Earlier expenses consume limits that affect later ones.
- Every reduction or denial states the specific rule and tier responsible.
- Deterministic: same input → same output, regardless of input order.

### Non-goals

- No UI, database, HTTP API, or claim workflow.
- Single member per policy.
- No accident exemption from waiting periods, no ICD-10 coding, no multi-currency.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Per-visit cap** | Maximum amount accepted for one visit of a sub-benefit. Stateless. The excess is never covered. |
| **Visit limit** | Maximum number of visits per policy year for a sub-benefit (`max_visits`). Stateful. |
| **Annual limit** | Maximum total the insurer pays per policy year. Exists at 4 tiers: sub-benefit, benefit, limit group, policy. Stateful. |
| **Limit group** | A pool shared by several benefits (e.g. Dental & Optical combined). |
| **Deductible** | Amount the member pays per benefit per policy year before the insurer pays anything for that benefit. |
| **Copay** | Member's share of each visit after the deductible: `PERCENTAGE` of the remaining amount, or a `FIXED` amount. |
| **Waiting period** | Number of days after `effective_date` before a benefit/sub-benefit becomes claimable. |
| **Exclusion** | Diagnosis/treatment the policy never covers. |
| **Eligible amount** | `min(amount, per_visit_cap)` — the part of the bill the policy recognises. |

---

## 3. Input

### 3.1 Policy

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
      "limit_group": null,
      "annual_limit": 20000,
      "deductible": 1000,
      "copay": { "type": "PERCENTAGE", "value": 20 },
      "waiting_period_days": 30,
      "sub_benefits": [
        { "name": "Doctor Visit", "per_visit_cap": 1500, "max_visits": 30 }
      ]
    }
  ],
  "exclusions": [
    { "exclusion_id": "EXC-01", "description": "Cosmetic procedures", "keywords": ["cosmetic", "whitening"] }
  ]
}
```

**Policy fields**

| Field | Type | Required | Notes |
|---|---|---|---|
| `policy_id` | string | yes | |
| `member_name` | string | no | Informational |
| `currency` | string | yes | Informational; all amounts are in this currency |
| `effective_date`, `expiry_date` | `YYYY-MM-DD` | yes | Inclusive range; `effective_date ≤ expiry_date` |
| `annual_limit` | number > 0 | yes | Policy tier |
| `limit_groups[]` | array | no | `group_id` unique, `name`, `annual_limit` > 0 |
| `benefits[]` | array, ≥ 1 | yes | `benefit_type` unique |
| `exclusions[]` | array | no | `exclusion_id`, `description`, `keywords[]` (non-empty strings) |

**Benefit fields**

| Field | Type | Required | Default when omitted |
|---|---|---|---|
| `benefit_type` | string | yes | — |
| `limit_group` | string \| null | no | Not in any group. If set, must reference an existing `group_id` |
| `annual_limit` | number > 0 | no | No benefit-tier limit |
| `deductible` | number ≥ 0 | no | 0 |
| `copay` | `{ type: "PERCENTAGE" \| "FIXED", value }` | no | No copay. `PERCENTAGE` value in [0, 100]; `FIXED` value ≥ 0 |
| `waiting_period_days` | integer ≥ 0 | no | 0 |
| `sub_benefits[]` | array, ≥ 1 | yes | `name` unique within the benefit |

**Sub-benefit fields**

| Field | Type | Default when omitted |
|---|---|---|
| `name` | string (required) | — |
| `per_visit_cap` | number > 0 | No cap |
| `max_visits` | integer > 0 | Unlimited |
| `annual_limit` | number > 0 | No sub-benefit-tier limit |
| `copay` | same shape as benefit | Inherited from benefit |
| `waiting_period_days` | integer ≥ 0 | Inherited from benefit |

Deductible and `limit_group` exist only at benefit level.

### 3.2 Expense

```json
{
  "expense_id": "EXP-001",
  "date": "2024-03-15",
  "benefit_type": "OUTPATIENT",
  "sub_benefit": "Doctor Visit",
  "amount": 2500,
  "diagnosis": "Acute bronchitis",
  "provider": "Bangkok Hospital"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `expense_id` | string | yes | Unique within the batch |
| `date` | `YYYY-MM-DD` | yes | Service date |
| `benefit_type`, `sub_benefit` | string | yes | Matched exactly (case-sensitive) against the policy |
| `amount` | number > 0 | yes | At most 2 decimal places |
| `diagnosis` | string | yes | Used for exclusion matching |
| `provider` | string | no | Informational |

---

## 4. Processing

### 4.1 Order

1. Validate policy and expenses (section 7). Invalid input throws; nothing is processed.
2. Copy and sort expenses by `date` ascending, then `expense_id` ascending (plain string comparison). Input arrays are never mutated.
3. Create a fresh ledger (all usage = 0).
4. Process each expense through steps 1–5 below, updating the ledger after each non-denied expense.
5. Build the summary from the final ledger.

Results are returned in processing order.

### 4.2 Steps for one expense

All arithmetic is in integer satang (section 6).

**Step 1 — Eligibility.** Checks run in this fixed order. The first failure makes the expense `DENIED`, stops processing, and determines the reason. A denied expense consumes nothing.

| # | Check | Fails when |
|---|---|---|
| 1a | Policy period | `date < effective_date` or `date > expiry_date` |
| 1b | Benefit exists | `benefit_type` not in policy |
| 1c | Sub-benefit exists | `sub_benefit` not in that benefit |
| 1d | Exclusion | Lower-cased `diagnosis` contains any lower-cased keyword. Exclusions and keywords are checked in policy order; the first match is reported |
| 1e | Waiting period | `date < effective_date + waiting_period_days` (calendar days, computed in UTC). The effective waiting period is the sub-benefit's if set, otherwise the benefit's |
| 1f | Visit limit | `visits_used(sub) ≥ max_visits` |
| 1g | Limit exhausted | Any applicable tier (one that has an `annual_limit`) has 0 remaining. Tiers checked in order: sub-benefit → benefit → limit group → policy; the first exhausted tier is reported |

**Step 2 — Per-visit cap.**
`eligible = min(amount, per_visit_cap)` (no cap → `eligible = amount`)
`cap_excess = amount − eligible`

**Step 3 — Deductible.**
`deductible_applied = min(eligible, deductible_remaining(benefit))`
`after_deductible = eligible − deductible_applied`

**Step 4 — Copay** (effective copay = sub-benefit's if set, otherwise the benefit's).
- `PERCENTAGE`: `copay = roundHalfUp(after_deductible × value / 100)`
- `FIXED`: `copay = min(value, after_deductible)`
- None: `copay = 0`

`after_copay = after_deductible − copay`

**Step 5 — Limit caps.**
`available = min(remaining(tier))` over the tiers that apply (sub-benefit if it has `annual_limit`, benefit if it has `annual_limit`, limit group if set, policy).
`covered = min(after_copay, available)`
`limit_cut = after_copay − covered`

The **binding tier** (reported in the reason when `limit_cut > 0`) is the tier with the smallest remaining; ties go to the most specific tier.

**Totals.**
`not_covered_amount = cap_excess + limit_cut`
`member_pays = amount − covered`

For a `DENIED` expense: `not_covered_amount = amount`, `deductible_applied = copay_amount = covered_amount = 0`, `member_pays = amount`.

**Invariants (must hold for every result):**
- `submitted_amount = covered_amount + member_pays`
- `member_pays = not_covered_amount + deductible_applied + copay_amount`

### 4.3 Decision

| Decision | Condition |
|---|---|
| `DENIED` | Failed step 1 |
| `COVERED` | `covered = amount` |
| `NO_PAYOUT` | `covered = 0` (valid expense; deductible and/or copay absorbed the whole eligible amount) |
| `PARTIALLY_COVERED` | `0 < covered < amount` |

Step 1g guarantees `available > 0` for non-denied expenses, so `NO_PAYOUT` never comes from an exhausted limit.

### 4.4 Ledger updates (non-denied expenses only)

- Usage `+= covered` on every applicable tier: sub-benefit, benefit, limit group, policy.
- `deductible_used(benefit) += deductible_applied`
- `visits_used(sub) += 1` — including `NO_PAYOUT`.

Cap excess and limit cuts consume nothing.

---

## 5. Reasons

Amounts in reasons use `en-US` thousands separators; whole numbers show no decimals, otherwise exactly 2 decimals (`1,040`, `246.91`). Tier labels: sub-benefit → its `name`; benefit → its `benefit_type`; limit group → its `name`; policy → `Policy`.

### 5.1 Denied

| Check | Template |
|---|---|
| 1a | `Denied: service date {date} is outside the policy period ({effective_date} to {expiry_date}).` |
| 1b | `Denied: benefit type {benefit_type} is not covered under this policy.` |
| 1c | `Denied: {sub_benefit} is not covered under {benefit_type}.` |
| 1d | `Denied: excluded under {exclusion_id} ({description}); diagnosis "{diagnosis}" matches "{keyword}".` |
| 1e | `Denied: {scope} waiting period of {n} days not met; coverage starts {start_date}.` — `scope` is the sub-benefit name if the waiting period comes from the sub-benefit, otherwise the `benefit_type` |
| 1f | `Denied: {sub_benefit} visit limit reached ({max} of {max} visits used).` |
| 1g | `Denied: {tier_label} annual limit exhausted.` |

### 5.2 Not denied

Sentences are appended in this order; each appears only when its amount is > 0.

| Part | Template |
|---|---|
| Cap | `Per-visit cap of {cap} THB for {sub_benefit} applied; {cap_excess} THB not covered.` |
| Deductible | `{deductible_applied} THB applied to {benefit_type} deductible ({remaining} THB remaining).` |
| Copay, percentage | `{value}% copay applied: {copay} THB.` |
| Copay, fixed (full) | `Fixed copay applied: {copay} THB.` |
| Copay, fixed (limited) | `Fixed copay of {value} THB limited to the remaining {copay} THB.` |
| Limit cut | `{tier_label} annual limit had only {available} THB remaining; {limit_cut} THB not covered.` |
| Closing, `COVERED` | `Fully covered: {covered} THB.` |
| Closing, otherwise | `Covered: {covered} THB. Member pays: {member_pays} THB.` |

`{remaining}` in the deductible sentence is the deductible left **after** this expense.

---

## 6. Money

- Internally every amount is an integer number of satang: `toSatang(thb) = Math.round(thb × 100)`, `toBaht(satang) = satang / 100`.
- Only the percentage copay is rounded (half-up to 1 satang). `covered` and `member_pays` are derived by subtraction, so the invariants hold exactly.
- Output amounts are JSON numbers in THB (`1040`, `246.91`).

Example: 12.25 THB with 10% copay → copay = round(122.5 satang) = 123 satang = 1.23 THB; covered = 11.02 THB.

---

## 7. Validation and errors

- Structural problems throw `ValidationError` before any processing. The error carries an `errors` array of messages with paths, e.g. `expenses[3].amount must be a positive number with at most 2 decimals`.
- Checked: required fields and types; `YYYY-MM-DD` dates that exist on the calendar; `effective_date ≤ expiry_date`; numeric ranges in section 3; unique `benefit_type`, sub-benefit names per benefit, `group_id`, `expense_id`; `limit_group` references an existing group; copay `type` is `PERCENTAGE` or `FIXED`.
- Business outcomes are **not** errors: unknown benefit or sub-benefit, date outside the policy period, exclusions, and so on produce `DENIED` results.

---

## 8. Output

```json
{
  "results": [ /* one per expense, processing order */ ],
  "summary": { /* see 8.2 */ }
}
```

### 8.1 Result per expense

| Field | Notes |
|---|---|
| `expense_id` | |
| `submitted_amount` | `amount` |
| `not_covered_amount` | Cap excess + limit cut (or full amount if denied) |
| `deductible_applied` | |
| `copay_amount` | |
| `covered_amount` | |
| `member_pays` | |
| `decision` | `COVERED` \| `PARTIALLY_COVERED` \| `NO_PAYOUT` \| `DENIED` |
| `reason` | Section 5 |
| `remaining_annual_limit` | Policy-tier remaining after this expense |
| `remaining_visit_limit` | Visits left for the sub-benefit after this expense; `null` if the sub-benefit has no `max_visits` or does not exist |

### 8.2 Summary

```json
{
  "policy": { "annual_limit": 100000, "used": 100000, "remaining": 0 },
  "limit_groups": [
    { "group_id": "DENTAL_OPTICAL", "name": "Dental & Optical combined", "annual_limit": 12000, "used": 12000, "remaining": 0 }
  ],
  "benefits": [
    {
      "benefit_type": "OUTPATIENT",
      "annual_limit": 20000, "used": 3040, "remaining": 16960, "available": 0,
      "deductible": { "amount": 1000, "used": 1000, "remaining": 0 },
      "sub_benefits": [
        {
          "name": "Physiotherapy",
          "annual_limit": 2000, "used": 2000, "remaining": 0, "available": 0,
          "max_visits": 10, "visits_used": 2, "visits_remaining": 8
        }
      ]
    }
  ],
  "totals": {
    "submitted": 186150, "covered": 100000, "member_pays": 86150,
    "by_decision": { "COVERED": 1, "PARTIALLY_COVERED": 9, "NO_PAYOUT": 2, "DENIED": 8 }
  }
}
```

- `remaining` — the tier's own balance. `null` when the tier has no `annual_limit`.
- `available` — what can actually still be paid: `min(own remaining, every parent tier's remaining)`. This prevents misreading "Outpatient has 16,960 left" when the policy limit is already 0.
- `max_visits` / `visits_remaining` are `null` when unlimited.

---

## 9. Architecture

JavaScript, ES Modules (`"type": "module"`), Node ≥ 20, no runtime dependencies.

```
src/
  index.js         public API: calculate, ValidationError
  money.js         toSatang, toBaht, percentOf (half-up), formatAmount
  policy.js        validatePolicy, validateExpenses, resolveCoverage(policy, expense)
  ledger.js        createLedger(policy), remaining/available per tier, record(result)
  eligibility.js   checkEligibility(expense, coverage, ledger) → null | { code, reason }
  calculator.js    calculate(policy, expenses): orchestrates steps 1–5 and reasons
  summary.js       buildSummary(policy, ledger)
cli.js             node cli.js <policy.json> <expenses.json> [out.json]
```

| Unit | Responsibility | Depends on |
|---|---|---|
| `money` | Satang conversion, half-up percentage, reason formatting | — |
| `policy` | Structural validation; resolve one expense to its benefit, sub-benefit, and effective copay/waiting period/cap/tiers (or report which lookup failed) | — |
| `ledger` | Per-tier usage, deductible usage, visit counts; read-only queries plus one `record` mutation | `policy` shapes |
| `eligibility` | Step 1 checks in order; reads ledger, never writes | `ledger` |
| `calculator` | Sort, loop, steps 2–5, decision, reason, invariants | all above |
| `summary` | Turn the final ledger into section 8.2 | `ledger` |

`calculate` is pure from the caller's perspective: it never mutates its inputs and creates a new ledger on every call.

**CLI:** reads the two JSON files, calls `calculate`, pretty-prints the result to stdout or to `out.json` if given. On `ValidationError` it prints each error and exits with code 1.

---

## 10. Dataset

### 10.1 `data/policy.json`

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
        { "name": "Doctor Visit",  "per_visit_cap": 1500, "max_visits": 30 },
        { "name": "Physiotherapy", "per_visit_cap": 1500, "max_visits": 10, "annual_limit": 2000 },
        { "name": "Lab Test",      "per_visit_cap": 3000 }
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
        { "name": "Surgery",       "per_visit_cap": 50000 }
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
        { "name": "Cleaning",   "max_visits": 2 },
        { "name": "Filling",    "per_visit_cap": 3000 },
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
        { "name": "Glasses",  "per_visit_cap": 5000, "max_visits": 1 }
      ]
    }
  ],
  "exclusions": [
    { "exclusion_id": "EXC-01", "description": "Cosmetic procedures",    "keywords": ["cosmetic", "whitening", "botox", "aesthetic"] },
    { "exclusion_id": "EXC-02", "description": "Self-inflicted injury",  "keywords": ["self-inflicted"] },
    { "exclusion_id": "EXC-03", "description": "Experimental treatment", "keywords": ["experimental"] }
  ]
}
```

Limits deliberately overlap so every tier can bind: benefit limits sum to 128,000 > policy 100,000; Dental 10,000 + Optical 8,000 = 18,000 > group 12,000.

Coverage start dates: Outpatient/Inpatient **2024-01-31**, Optical **2024-03-01**, Dental **2024-03-31**, Root Canal **2024-06-29**.

### 10.2 `data/expenses.json` — 20 expenses (all 2024)

Each expense also has a `provider` (free-form hospital/clinic name). It is informational only and does not affect any calculation, so it is omitted from this table.

| ID | Date | Benefit / Sub-benefit | Diagnosis | Amount |
|---|---|---|---|---|
| EXP-001 | 01-10 | OUTPATIENT / Doctor Visit | Acute bronchitis | 1,200 |
| EXP-002 | 01-31 | OUTPATIENT / Doctor Visit | Common cold | 800 |
| EXP-003 | 02-12 | OUTPATIENT / Doctor Visit | Acute bronchitis | 2,500 |
| EXP-004 | 02-20 | INPATIENT / Hospital Stay | Dengue fever | 18,500 |
| EXP-005 | 03-05 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-006 | 03-19 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-007 | 04-02 | OUTPATIENT / Physiotherapy | Lower back pain | 1,500 |
| EXP-008 | 04-03 | DENTAL / Cleaning | Dental plaque | 1,200 |
| EXP-009 | 04-18 | DENTAL / Filling | Dental caries | 4,000 |
| EXP-010 | 05-06 | DENTAL / Cleaning | Routine scaling | 250 |
| EXP-011 | 05-10 | DENTAL / Root Canal | Pulpitis | 7,500 |
| EXP-012 | 06-03 | OUTPATIENT / Acupuncture | Neck pain | 1,500 |
| EXP-013 | 06-20 | INPATIENT / Surgery | Cosmetic rhinoplasty | 45,000 |
| EXP-014 | 07-08 | DENTAL / Cleaning | Dental plaque | 900 |
| EXP-015 | 07-15 | DENTAL / Root Canal | Pulpitis | 7,500 |
| EXP-016 | 08-05 | OPTICAL / Glasses | Myopia | 4,000 |
| EXP-017 | 08-05 | OPTICAL / Eye Exam | Myopia | 800 |
| EXP-018 | 09-10 | INPATIENT / Surgery | Acute appendicitis | 60,000 |
| EXP-019 | 11-20 | INPATIENT / Hospital Stay | Pneumonia | 25,000 |
| EXP-020 | 12-16 | OUTPATIENT / Doctor Visit | Influenza | 1,000 |

### 10.3 `data/expected_output.json` — computed by hand

**This file is transcribed from the tables below, never generated by running the calculator.** Otherwise the dataset test would only prove the code agrees with itself.

| ID | Not covered | Deductible | Copay | Covered | Member pays | Decision | Annual left | Visits left |
|---|---|---|---|---|---|---|---|---|
| 001 | 1,200 | 0 | 0 | 0 | 1,200 | DENIED | 100,000 | 30 |
| 002 | 0 | 800 | 0 | 0 | 800 | NO_PAYOUT | 100,000 | 29 |
| 003 | 1,000 | 200 | 260 | 1,040 | 1,460 | PARTIALLY_COVERED | 98,960 | 28 |
| 004 | 0 | 0 | 0 | 18,500 | 0 | COVERED | 80,460 | null |
| 005 | 0 | 0 | 300 | 1,200 | 300 | PARTIALLY_COVERED | 79,260 | 9 |
| 006 | 400 | 0 | 300 | 800 | 700 | PARTIALLY_COVERED | 78,460 | 8 |
| 007 | 1,500 | 0 | 0 | 0 | 1,500 | DENIED | 78,460 | 8 |
| 008 | 0 | 500 | 300 | 400 | 800 | PARTIALLY_COVERED | 78,060 | 1 |
| 009 | 1,000 | 0 | 300 | 2,700 | 1,300 | PARTIALLY_COVERED | 75,360 | null |
| 010 | 0 | 0 | 250 | 0 | 250 | NO_PAYOUT | 75,360 | 0 |
| 011 | 7,500 | 0 | 0 | 0 | 7,500 | DENIED | 75,360 | null |
| 012 | 1,500 | 0 | 0 | 0 | 1,500 | DENIED | 75,360 | null |
| 013 | 45,000 | 0 | 0 | 0 | 45,000 | DENIED | 75,360 | null |
| 014 | 900 | 0 | 0 | 0 | 900 | DENIED | 75,360 | 0 |
| 015 | 300 | 0 | 300 | 6,900 | 600 | PARTIALLY_COVERED | 68,460 | null |
| 016 | 1,600 | 0 | 400 | 2,000 | 2,000 | PARTIALLY_COVERED | 66,460 | 0 |
| 017 | 800 | 0 | 0 | 0 | 800 | DENIED | 66,460 | 1 |
| 018 | 10,000 | 0 | 0 | 50,000 | 10,000 | PARTIALLY_COVERED | 16,460 | null |
| 019 | 8,540 | 0 | 0 | 16,460 | 8,540 | PARTIALLY_COVERED | 0 | null |
| 020 | 1,000 | 0 | 0 | 0 | 1,000 | DENIED | 0 | 28 |

**Reasons**

| ID | Reason |
|---|---|
| 001 | `Denied: OUTPATIENT waiting period of 30 days not met; coverage starts 2024-01-31.` |
| 002 | `800 THB applied to OUTPATIENT deductible (200 THB remaining). Covered: 0 THB. Member pays: 800 THB.` |
| 003 | `Per-visit cap of 1,500 THB for Doctor Visit applied; 1,000 THB not covered. 200 THB applied to OUTPATIENT deductible (0 THB remaining). 20% copay applied: 260 THB. Covered: 1,040 THB. Member pays: 1,460 THB.` |
| 004 | `Fully covered: 18,500 THB.` |
| 005 | `20% copay applied: 300 THB. Covered: 1,200 THB. Member pays: 300 THB.` |
| 006 | `20% copay applied: 300 THB. Physiotherapy annual limit had only 800 THB remaining; 400 THB not covered. Covered: 800 THB. Member pays: 700 THB.` |
| 007 | `Denied: Physiotherapy annual limit exhausted.` |
| 008 | `500 THB applied to DENTAL deductible (0 THB remaining). Fixed copay applied: 300 THB. Covered: 400 THB. Member pays: 800 THB.` |
| 009 | `Per-visit cap of 3,000 THB for Filling applied; 1,000 THB not covered. Fixed copay applied: 300 THB. Covered: 2,700 THB. Member pays: 1,300 THB.` |
| 010 | `Fixed copay of 300 THB limited to the remaining 250 THB. Covered: 0 THB. Member pays: 250 THB.` |
| 011 | `Denied: Root Canal waiting period of 180 days not met; coverage starts 2024-06-29.` |
| 012 | `Denied: Acupuncture is not covered under OUTPATIENT.` |
| 013 | `Denied: excluded under EXC-01 (Cosmetic procedures); diagnosis "Cosmetic rhinoplasty" matches "cosmetic".` |
| 014 | `Denied: Cleaning visit limit reached (2 of 2 visits used).` |
| 015 | `Fixed copay applied: 300 THB. DENTAL annual limit had only 6,900 THB remaining; 300 THB not covered. Covered: 6,900 THB. Member pays: 600 THB.` |
| 016 | `10% copay applied: 400 THB. Dental & Optical combined annual limit had only 2,000 THB remaining; 1,600 THB not covered. Covered: 2,000 THB. Member pays: 2,000 THB.` |
| 017 | `Denied: Dental & Optical combined annual limit exhausted.` |
| 018 | `Per-visit cap of 50,000 THB for Surgery applied; 10,000 THB not covered. Covered: 50,000 THB. Member pays: 10,000 THB.` |
| 019 | `Policy annual limit had only 16,460 THB remaining; 8,540 THB not covered. Covered: 16,460 THB. Member pays: 8,540 THB.` |
| 020 | `Denied: Policy annual limit exhausted.` |

Notes:
- EXP-011 / EXP-015: the same root canal, denied in May (waiting period), paid in July.
- EXP-016 / EXP-017: same date; ID order decides. If the eye exam went first it would be paid 720 and the glasses only 1,280.
- EXP-003 reuses the sample expense from the problem statement. Its result differs from the problem's sample output because this policy has a per-visit cap and a deductible; the sample only illustrates the output format. The README must say so.

### 10.4 Expected summary

| Tier | Limit | Used | Remaining | Available | Other |
|---|---|---|---|---|---|
| Policy | 100,000 | 100,000 | 0 | — | |
| Group: Dental & Optical combined | 12,000 | 12,000 | 0 | — | |
| OUTPATIENT | 20,000 | 3,040 | 16,960 | 0 | Deductible 1,000 used / 0 remaining |
| · Doctor Visit | — | 1,040 | null | 0 | Visits 2 used / 28 remaining |
| · Physiotherapy | 2,000 | 2,000 | 0 | 0 | Visits 2 used / 8 remaining |
| · Lab Test | — | 0 | null | 0 | Unlimited visits |
| INPATIENT | 90,000 | 84,960 | 5,040 | 0 | Deductible 0 |
| · Hospital Stay | — | 34,960 | null | 0 | |
| · Surgery | — | 50,000 | null | 0 | |
| DENTAL | 10,000 | 10,000 | 0 | 0 | Deductible 500 used / 0 remaining |
| · Cleaning | — | 400 | null | 0 | Visits 2 used / 0 remaining |
| · Filling | — | 2,700 | null | 0 | |
| · Root Canal | — | 6,900 | null | 0 | |
| OPTICAL | 8,000 | 2,000 | 6,000 | 0 | Deductible 0 |
| · Eye Exam | — | 0 | null | 0 | Visits 0 used / 1 remaining |
| · Glasses | — | 2,000 | null | 0 | Visits 1 used / 0 remaining |

Totals: submitted 186,150 · covered 100,000 · member pays 86,150 · COVERED 1 · PARTIALLY_COVERED 9 · NO_PAYOUT 2 · DENIED 8.

### 10.5 Scenario coverage

| Scenario | Expenses |
|---|---|
| Fully covered | 004 |
| Partially covered by copay (percentage / fixed) | 005 / 008, 009 |
| Denied — waiting period (benefit / sub-benefit override) | 001 / 011 |
| Denied — exclusion | 013 |
| Denied — limit exhausted (sub-benefit / group / policy) | 007 / 017 / 020 |
| Partially covered — remaining limit < expense (sub-benefit / benefit / group / policy) | 006 / 015 / 016 / 019 |
| Per-visit cap | 003, 009, 018 |
| Deductible (fully absorbs / partially applied) | 002 / 003, 008 |
| NO_PAYOUT (deductible / fixed copay) | 002 / 010 |
| Visit limit reached · Sub-benefit not in policy | 014 · 012 |
| Waiting-period boundary day · Same-date ordering | 002 · 016–017 |
| Multiple expenses consuming one limit | 002–003 (deductible), 005–007 (Physio), 008–017 (group), all (policy) |

Covered by unit tests only: date outside policy period, unknown benefit type, satang rounding, unsorted input.

---

## 11. Testing

`node:test`, run with `node --test`. Logic tests use a small inline policy built by a `makePolicy(overrides)` helper so each test is independent of the dataset.

| # | File | Test |
|---|---|---|
| 1 | `money.test.js` | THB ↔ satang conversion round-trips |
| 2 | `money.test.js` | Half-up rounding: 12.25 THB × 10% → copay 1.23, covered 11.02 |
| 3 | `calculator.test.js` | No copay, no deductible → `COVERED` |
| 4 | `calculator.test.js` | Percentage copay → `PARTIALLY_COVERED`, reason matches template |
| 5 | `calculator.test.js` | Fixed copay larger than remaining → `NO_PAYOUT` |
| 6 | `calculator.test.js` | Deductible consumed across two expenses (`NO_PAYOUT`, then partial) |
| 7 | `calculator.test.js` | Cap before deductible: 5,000 / cap 3,000 / deductible 1,000 / 20% → covered 1,600 |
| 8 | `calculator.test.js` | Waiting boundary: day N−1 denied, day N allowed |
| 9 | `calculator.test.js` | Sub-benefit waiting-period override |
| 10 | `calculator.test.js` | Exclusion is case-insensitive and consumes nothing |
| 11 | `calculator.test.js` | Sub-benefit limit: partial, then `DENIED` exhausted |
| 12 | `calculator.test.js` | Limit group consumed by two different benefits |
| 13 | `calculator.test.js` | Policy limit binds while the benefit still has balance |
| 14 | `calculator.test.js` | Visit limit reached; denied expenses don't consume visits |
| 15 | `calculator.test.js` | Unknown benefit, unknown sub-benefit, date outside policy period → `DENIED` |
| 16 | `calculator.test.js` | Shuffled input gives identical results; same-date tie broken by ID |
| 17 | `calculator.test.js` | Inputs are not mutated |
| 18 | `calculator.test.js` | Malformed input throws `ValidationError` listing each problem |
| 19 | `dataset.test.js` | 20 expenses deep-equal `expected_output.json` (all fields including `reason`) |
| 20 | `dataset.test.js` | Both invariants hold for every result |
| 21 | `dataset.test.js` | Summary matches section 10.4 |

Mapping to the problem's minimum: normal coverage (3), copay (4, 5), limit exhaustion (11, 13, 14), waiting period (8, 9), multiple expenses consuming the same limit (6, 11, 12).

---

## 12. Deliverables and repo layout

```
package.json               scripts: test, test:report, calculate
README.md
cli.js
src/                       section 9
data/policy.json
data/expenses.json
data/expected_output.json  hand-computed (section 10.3–10.4)
output/results.json        produced by `npm run calculate`
test/                      money, calculator, dataset tests + helpers
test-results.txt           produced by `npm run test:report` (spec reporter)
docs/superpowers/specs/    this spec
```

Scripts:
- `test` → `node --test`
- `test:report` → `node --test --test-reporter=spec > test-results.txt`
- `calculate` → `node cli.js data/policy.json data/expenses.json output/results.json`

README covers: how to run, policy schema, processing order and rules, decision meanings, assumptions (section 13), the note about EXP-003 vs the problem sample, and the timeline.

---

## 13. Assumptions and limitations

1. Each expense counts as one visit.
2. Visits are consumed by every non-denied expense, including `NO_PAYOUT`.
3. Denied expenses, cap excess and limit cuts consume no limit, deductible or visit.
4. Waiting periods run from the policy `effective_date`; no accident exemption (would need an `is_accident` field).
5. Exclusions use keyword matching on `diagnosis`: can over-match ("Non-cosmetic scar revision") or miss ("Rhinoplasty"). A real system would use ICD-10 codes.
6. Copay is computed before limit caps; when a limit cuts the payout, the copay stays and the cut goes to `not_covered_amount`.
7. Deductibles are per benefit, per policy year.
8. Benefit and sub-benefit names are matched exactly (case-sensitive).

---

## 14. Timeline

| Work | Estimate |
|---|---|
| Analysis and design | Done |
| Setup, `money`, `policy`, `ledger` | 0.5 h |
| `eligibility`, `calculator`, reasons, `summary` | 1 h |
| Data files (policy, expenses, expected output) | 0.5 h |
| Unit tests and fixes | 1 h |
| README, test results, push | 0.5 h |
| **Total implementation** | **~3.5 h** |

---

## 15. Decision log

| # | Decision |
|---|---|
| D1 | Per-visit cap before deductible |
| D2 | Deductible before copay |
| D3 | `effective_date` / `expiry_date` live in the policy |
| D4 | Overlapping benefits: nested limits + shared limit groups |
| D5 | One expense = one visit |
| D6 | Deductible per benefit, per year |
| D7 | Decisions: `COVERED`, `PARTIALLY_COVERED`, `NO_PAYOUT`, `DENIED` |
| D8 | Copay `PERCENTAGE` or `FIXED`; fixed copay = `min(value, remaining)` |
| D9 | Exclusions by case-insensitive keyword match on diagnosis |
| D10 | JavaScript |
| D11 | Sort by date, then expense ID |
| D12 | Integer satang internally; THB with up to 2 decimals in output |
| D13 | Round only the percentage copay (half-up); derive the rest by subtraction |
| D14 | `node:test` |
| D15 | "Limit exhausted" is an eligibility check (step 1), not a step-5 outcome |
| D16 | Coverage starts on `effective_date + waiting_period_days` |
| D17 | Eligibility checks in fixed order; first failure is reported |
| D18 | `remaining_visit_limit` is `null` when unlimited |
| D19 | Summary reports both `remaining` and `available` |
| D20 | Denied expense: `not_covered_amount = amount` |
