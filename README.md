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

## How this was built

Design first, then code. The order was: read the challenge → design the policy schema and the 20 expenses, computing every expected output by hand → write the spec → write a task-by-task implementation plan → build it test-first. The artifacts of each stage are in the repository:

| Document | What it holds |
|---|---|
| [`AI_Engineering_Challenges/AI_Challenge_06.md`](AI_Engineering_Challenges/AI_Challenge_06.md) | The original challenge statement |
| [`docs/superpowers/specs/2026-09-11-policy-benefits-calculator-design.md`](docs/superpowers/specs/2026-09-11-policy-benefits-calculator-design.md) | The spec: schema, the five processing steps, reason templates, output shape, dataset and expected results |
| [`docs/superpowers/plans/2026-09-11-policy-benefits-calculator.md`](docs/superpowers/plans/2026-09-11-policy-benefits-calculator.md) | The implementation plan: 8 tasks, each with its failing test, its code and its commit |
| [`docs/diagrams/engine-overview.md`](docs/diagrams/engine-overview.md) | Diagram: how the engine processes a batch of expenses |
| [`docs/diagrams/expense-walkthrough.md`](docs/diagrams/expense-walkthrough.md) | Diagram: EXP-003 traced through all five steps with real numbers |
| [`DESIGN_NOTES.md`](DESIGN_NOTES.md) | Working notes (in Vietnamese) kept while the rules were still being decided; superseded by the spec |
| [`ai-conversations/ai-conversation.txt`](ai-conversations/ai-conversation.txt) | Transcript of the AI coding session that produced all of the above |

The transcript is the terminal scrollback of the session, from the first reading of the challenge to the final push. The discussion is in Vietnamese; every produced artifact is in English. It shows the decisions being argued out — the order the rules are applied in, where `effective_date` belongs, how overlapping limits nest, whether the deductible is annual or per benefit, integer-satang money handling — then the dataset, the spec, the plan and the test-first build. User prompts are marked `❯` and replies `⏺`, with file writes shown as inline diffs. Long tool output appears collapsed (`… +N lines`, `Ran N shell commands`), so it records the reasoning trail rather than complete file contents.

## Assumptions

1. Each expense is one visit. Visits are used by every non-denied expense, including `NO_PAYOUT`.
2. Denied expenses, cap excess and limit cuts use up no limit, deductible or visit.
3. Waiting periods run from the policy `effective_date`; coverage starts on `effective_date + N days`. There is no accident exemption.
4. Exclusions match keywords in the diagnosis text (case-insensitive). This can over-match ("Non-cosmetic scar revision") or miss ("Rhinoplasty"); a production system would use ICD-10 codes.
5. Copay is computed before limit caps: when a limit cuts the payout, the copay stands and the cut is added to `not_covered_amount`.
6. Deductibles are per benefit, per policy year. Benefit and sub-benefit names match exactly (case-sensitive).

## Timeline

| Stage | Time |
|---|---|
| **Analysis and design** — reading the challenge, deciding the rules and their order, designing the policy schema, and building the 20-expense dataset with every expected result computed by hand | 2 h |
| **Implementation** — the AI-assisted build itself: modules, CLI and unit tests | 1 h |
| **End-to-end testing and documentation** — running the full dataset against the hand-computed results, then the README, spec and diagrams | 0.5 h |
| **Total** | **3.5 h** |

Most of the time went into design rather than code. Deciding the order the rules apply in, and computing all 20 expected results by hand before writing any code, is what made the implementation short and gave the tests something independent to check against.
