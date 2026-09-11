# Engine overview

How `calculate(policy, expenses)` turns a policy and a list of expenses into per-expense results and a summary. Rules and templates are defined in the [design spec](../superpowers/specs/2026-09-11-policy-benefits-calculator-design.md); a worked example with real numbers is in [expense-walkthrough.md](expense-walkthrough.md).

```mermaid
---
config:
  flowchart:
    wrappingWidth: 400
---
flowchart TD
    IN["policy.json + expenses.json"] --> VAL{"Valid structure?"}
    VAL -->|no| ERR["Throw ValidationError<br/>listing every problem"]
    VAL -->|yes| SORT["Sort expenses<br/>by date, then expense_id"]
    SORT --> LEDGER["Create an empty ledger<br/>limit used per tier · deductible used · visits used"]
    LEDGER --> NEXT{"Next expense?"}
    NEXT -->|yes| RESOLVE["Resolve coverage<br/>find benefit + sub-benefit,<br/>inherit copay and waiting period"]

    RESOLVE --> S1["<b>Step 1 · Eligibility</b> — checked in this order, first failure wins<br/>1. date inside the policy period<br/>2. benefit and sub-benefit exist in the policy<br/>3. diagnosis matches no exclusion keyword<br/>4. waiting period is over<br/>5. visits left for the sub-benefit<br/>6. every limit tier still above 0"]
    S1 --> PASS{"All pass?"}
    PASS -->|no| DENIED["DENIED<br/>reason names the failed check<br/>consumes nothing"]

    subgraph PAYOUT["Steps 2–5 · Compute the payout (integer satang)"]
        S2["<b>Step 2 · Per-visit cap</b><br/>eligible = min(amount, cap)<br/>excess is never covered"]
        S3["<b>Step 3 · Deductible</b> (per benefit, per year)<br/>applied = min(eligible, deductible left)"]
        S4["<b>Step 4 · Copay</b><br/>PERCENTAGE: % of the rest, rounded half-up<br/>FIXED: min(value, rest)"]
        S5["<b>Step 5 · Limit caps</b><br/>covered = min(rest, remaining at<br/>sub-benefit · benefit · limit group · policy)"]
        S2 --> S3 --> S4 --> S5
    end

    PASS -->|yes| S2
    S5 --> RECORD["Record in ledger<br/>+covered on every tier · +deductible applied · +1 visit"]
    RECORD --> DECIDE{"covered is…"}
    DECIDE -->|"= amount"| COVERED["COVERED"]
    DECIDE -->|"between 0 and amount"| PARTIAL["PARTIALLY_COVERED"]
    DECIDE -->|"= 0"| NOPAY["NO_PAYOUT<br/>deductible / copay took it all"]

    DENIED & COVERED & PARTIAL & NOPAY --> RESULT["Result for this expense<br/>amounts · decision · reason<br/>remaining annual limit · visits left"]
    RESULT --> NEXT
    NEXT -->|"no more"| SUMMARY["Build summary<br/>used · remaining · available per tier, totals"]
    SUMMARY --> OUT["results + summary"]
```

## Reading the diagram

- **The ledger is the only state.** Every non-denied expense writes to it, and every later expense reads from it. That is how earlier claims reduce what later claims can get.
- **Denied expenses never touch the ledger.** This is why "limit exhausted" is checked in step 1 rather than step 5: by step 5 the deductible would already have been taken.
- **Limit tiers are nested.** One claim consumes all the tiers it belongs to, and the smallest remaining balance decides the payout:

  | Tier | Example in `data/policy.json` |
  |---|---|
  | Sub-benefit | Physiotherapy 2,000 / year |
  | Benefit | DENTAL 10,000 / year |
  | Limit group | Dental & Optical combined 12,000 / year |
  | Policy | 100,000 / year |

- **Every result balances:** `submitted = covered + member_pays` and `member_pays = not_covered + deductible + copay`. All arithmetic is in integer satang.
