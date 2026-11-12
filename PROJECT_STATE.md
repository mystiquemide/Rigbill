# Rigbill Project State

## Project

- Plan file: `PROJECT_PLAN.md`
- Status: Planned
- Current phase: Not started
- Current checkpoint: CP-000
- Last updated: 2026-11-12
- Last agent: Planner
- Planning confidence: 74 / 100 (Medium)
- Hygiene: this file and `PROJECT_PLAN.md` are internal, excluded via `.git/info/exclude`, never committed

## Source of Truth Order

1. Repository or observable system state (including NEAR, Bitcoin and Base mainnet)
2. Executed verification evidence
3. Approved `PROJECT_PLAN.md`
4. `PROJECT_STATE.md`
5. Unverified notes

The repository and the chains prove what exists. The plan defines intended scope, design, phases and acceptance criteria. This file records execution history, status, decisions, deviations, blockers, evidence and handoff context.

## Execution Rules

1. Read the plan and this file before changing project assets.
2. Inspect the actual repository and mainnet state before trusting prior state.
3. Follow phase dependencies and acceptance criteria.
4. Update this file after every checkpoint.
5. Don't mark tests as passed unless they ran successfully.
6. Record deviations and decisions.
7. Never erase checkpoint history.
8. End every session with one exact next action.
9. Keep entries factual and concise.
10. Change the plan only through the amendment protocol.
11. Never push, deploy to mainnet, spend funds, sign transactions or post without MystiqueMide's explicit approval at the time.

## Current Objective

- Phase: 1, "A NEAR contract signs a real Bitcoin transaction"
- Checkpoint: CP-001 (not started)
- Goal: A confirmed Bitcoin mainnet tx spending from a payout address derived from `v1.rigbill.near`, signed by `v1.signer` through `sign_split`
- Expected files or assets: `contract/` (Rust contract, unit tests, sandbox test with mock signer), `relayer/` (watch, split, witness, verify, broadcast), `rust-toolchain.toml`, `.env.example`, `.gitignore`
- Acceptance criteria: BIP143 official P2WPKH test vector passes. Mainnet BTC tx confirmed on mempool.space. NEAR tx shows a `v1.signer` receipt. Gas for a 1-input split recorded.
- Required verification: test output, mempool.space link, nearblocks link

## Current Status

### Completed
- Idea validation, duplicate check against 613 submissions, oracle research, 1Click minimum check, naming (Rigbill), win plan, project plan

### In Progress
- None

### Blocked
- None

### Not Started
- Phases 1 to 7

## Checkpoint Log

### CP-000: Planning completed

- Status: Complete
- Date: 2026-11-12
- Agent: Planner
- Phase: Planning
- Objective: Produce the project plan and execution state.
- Files created:
  - `PROJECT_PLAN.md`
  - `PROJECT_STATE.md`
- Verification:
  - Planning gates completed
  - Required sections confirmed
  - Conditional sections checked for applicability
  - Load-bearing interfaces verified live: `v1.signer.derived_public_key` on mainnet, `get_available_foreign_chains`, 1Click dry quotes and the 8,300-sat minimum, `rigbill.near` free
- Decisions:
  - Name Rigbill, tracks `realworld` + `business`
  - Contract account `v1.rigbill.near` (ADR-001)
  - Structured tx input, contract-built BIP143 sighash (ADR-002)
  - Miner-set sats ceiling as the P0 overcharge cap. RedStone deferred to P2 (ADR-004)
  - Host-confirmed Paid in P0. MPC-verified Base Paid is P2 (DEC-003)
- Risks: RISK-001 sighash bugs, RISK-006 schedule (about 66 hours left), ASM-001 contract-as-predecessor signing
- Blockers: none
- Next exact action: Register `rigbill.near` and fund it, after MystiqueMide approves spending the NEAR.

## Decisions Made During Execution

| ID | Date | Decision | Reason | Plan impact |
|---|---|---|---|---|

## Plan Deviations

| ID | Date | Original plan | Change | Reason | Approval status |
|---|---|---|---|---|---|

## Plan Amendments

| ID | Date | Original | Proposed change | Evidence | Affected requirements, phases, tests, cost, risks | Approval |
|---|---|---|---|---|---|---|

Amendment protocol: an amendment is needed only when new evidence changes approved scope, architecture, requirements, security controls, phase order or acceptance criteria. Give it an `AMD-[n]` id, state the original and the change, explain the evidence, list what's affected, record approval, update the plan only after approval, and never rewrite checkpoint history. Minor implementation details go only in this file.

## Verification Evidence

| Checkpoint | Command or check | Result | Evidence |
|---|---|---|---|
| CP-000 | RPC `v1.signer.derived_public_key(path="miner/test", predecessor="rigbill.near", domain_id=0)` | Returned a secp256k1 key | Live call 2026-11-12 |
| CP-000 | RPC `v1.signer.get_available_foreign_chains` | Base included, Bitcoin not | Live call 2026-11-12 |
| CP-000 | 1Click dry quote BTC to Base USDC at 5,000 and 10,000 sats | 5,000 rejected ("try at least 8300"), 10,000 accepted | Live call 2026-11-12 |
| CP-000 | RPC `view_account rigbill.near` | UNKNOWN_ACCOUNT (free) | Live call 2026-11-12 |

## Known Issues

| ID | Severity | Description | Workaround | Required fix |
|---|---|---|---|---|

## Blockers

| ID | Description | Impact | Required resolution |
|---|---|---|---|

## Checkpoint Protocol

Update this file after: setup, each phase, schema changes, architecture decisions, external integrations, security-sensitive changes, failed attempts, reviews, test runs, blockers, deployment preparation, and every session.

Format:

### CP-[number]: [Name]

- Status: Complete | Partial | Blocked | Failed
- Date:
- Agent:
- Phase:
- Objective:
- Work completed:
- Files or assets changed:
- Commands or checks run:
- Test results:
- Acceptance criteria verified:
- Decisions:
- Deviations:
- Risks introduced:
- Known issues:
- Blockers:
- Next exact action:

Don't store hidden reasoning, narration, every command, token usage or unverified claims.

## Next Exact Action

Register `rigbill.near` on NEAR mainnet and create the subaccount `v1.rigbill.near`, after MystiqueMide approves the NEAR spend.
