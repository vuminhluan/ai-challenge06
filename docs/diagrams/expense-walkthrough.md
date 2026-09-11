# Expense walkthrough — EXP-003

One expense from [`data/expenses.json`](../../data/expenses.json) traced through the engine with real numbers. EXP-003 is the sample expense from the problem statement, and it exercises the per-visit cap, the deductible and the copay in a single claim. The general flow is in [engine-overview.md](engine-overview.md).

**Input**

```json
{
  "expense_id": "EXP-003",
  "date": "2024-02-12",
  "benefit_type": "OUTPATIENT",
  "sub_benefit": "Doctor Visit",
  "amount": 2500,
  "diagnosis": "Acute bronchitis",
  "provider": "Bangkok Hospital"
}
```

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TD
    EXP["EXP-003 · 2024-02-12<br/>OUTPATIENT / Doctor Visit · Acute bronchitis<br/><b>amount 2,500 THB</b>"]
    BEFORE["Ledger before this expense<br/>EXP-001 was denied: used nothing<br/>EXP-002 used 800 of the 1,000 OUTPATIENT deductible<br/>→ deductible left 200 · Doctor Visit visits left 29 of 30<br/>→ OUTPATIENT 20,000 left · Policy 100,000 left"]
    RULES["Rules that apply (from policy.json)<br/>Doctor Visit: cap 1,500 per visit, 30 visits<br/>OUTPATIENT: deductible 1,000 · copay 20% · waiting 30 days"]

    EXP --> RESOLVE["Resolve coverage"]
    RULES --> RESOLVE
    BEFORE -.-> RESOLVE

    RESOLVE --> S1["<b>Step 1 · Eligibility — all checks pass</b><br/>✓ 2024-02-12 is inside 2024-01-01 … 2024-12-31<br/>✓ OUTPATIENT / Doctor Visit exist<br/>✓ 'Acute bronchitis' matches no exclusion keyword<br/>✓ coverage started 2024-01-31 (effective date + 30 days)<br/>✓ 29 visits left<br/>✓ OUTPATIENT and Policy limits above 0"]
    S1 --> S2["<b>Step 2 · Per-visit cap</b><br/>eligible = min(2,500, 1,500) = <b>1,500</b><br/>not covered: 2,500 − 1,500 = <b>1,000</b>"]
    S2 --> S3["<b>Step 3 · Deductible</b><br/>applied = min(1,500, 200 left) = <b>200</b><br/>rest: 1,500 − 200 = 1,300"]
    S3 --> S4["<b>Step 4 · Copay 20%</b><br/>copay = 1,300 × 20% = <b>260</b><br/>rest: 1,300 − 260 = 1,040"]
    S4 --> S5["<b>Step 5 · Limit caps</b><br/>covered = min(1,040, OUTPATIENT 20,000, Policy 100,000) = <b>1,040</b><br/>no tier cuts the payout"]
    S5 --> DECIDE{"covered 1,040 is between<br/>0 and the amount 2,500"}
    DECIDE --> DECISION["<b>PARTIALLY_COVERED</b>"]

    S5 --> AFTER["Ledger after this expense<br/>OUTPATIENT deductible left 0 · Doctor Visit visits left 28<br/>OUTPATIENT used 1,040 · Policy left 98,960"]

    DECISION --> OUT["<b>Result</b><br/>covered 1,040 · member pays 1,460<br/>= not covered 1,000 + deductible 200 + copay 260<br/>remaining annual limit 98,960 · visits left 28"]
    AFTER -.->|"next expense reads this"| NEXT["EXP-004 …"]
```

**Output** (exactly as in [`output/results.json`](../../output/results.json))

```json
{
  "expense_id": "EXP-003",
  "submitted_amount": 2500,
  "not_covered_amount": 1000,
  "deductible_applied": 200,
  "copay_amount": 260,
  "covered_amount": 1040,
  "member_pays": 1460,
  "decision": "PARTIALLY_COVERED",
  "reason": "Per-visit cap of 1,500 THB for Doctor Visit applied; 1,000 THB not covered. 200 THB applied to OUTPATIENT deductible (0 THB remaining). 20% copay applied: 260 THB. Covered: 1,040 THB. Member pays: 1,460 THB.",
  "remaining_annual_limit": 98960,
  "remaining_visit_limit": 28
}
```

**Checks**

- `covered + member_pays = 1,040 + 1,460 = 2,500` = submitted ✓
- `not_covered + deductible + copay = 1,000 + 200 + 260 = 1,460` = member pays ✓

**Why it differs from the problem's sample output** (covered 2,000): the sample only shows the output format. Under this policy the Doctor Visit cap of 1,500 applies first, and 200 THB of the deductible was still unpaid, so the 20% copay is taken from 1,300 rather than 2,500.
