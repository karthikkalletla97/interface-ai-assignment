# Computer use automation system

A system that lets an LLM work out how to complete a task inside a UI that has no API,
saves that successful run as a reusable capability, and replays it afterward with no
model in the loop. It runs against a small mock bank that stands in for legacy internal
software.

Discover once, replay many times: discovery uses the model to learn a flow, distillation
turns that run into a typed capability file, and replay runs the file deterministically
with no model involved.

## Repository layout

```
mock-bank/   the automation target: a legacy style bank back office stand in
agent/       the system: discovery loop, artifact, replay, safety, handoff
artifacts/   distilled capability files, one JSON per capability
evidence/    saved artifacts plus logs and screenshots from real runs
policy.json  the allowlist the guard enforces
REPORT.md    design write up
```

## Setup

Two projects, each with its own dependencies. Node 18 or newer.

Mock bank (the target), in one terminal:

```
cd mock-bank
npm install
npm start            # serves http://localhost:4000
```

Leave it running. Demo credentials: teller / demo1234.

Agent (the system), in another terminal:

```
cd agent
npm install
npx playwright install chromium
cp .env.example .env      # then put your Anthropic API key in .env
```

`.env` holds the API key and model, and the goal for discovery. Discovery needs a model.
Distill, replay, and the safety and handoff demos do not, they run with no key.

## A note on environment variables

Several runs take options through environment variables (ARTIFACT, POLICY, APPROVE_RISKY,
HANDOFF). Two things to know:

- On macOS or Linux, set them inline so they apply to that one command only:
  `ARTIFACT=artifacts/member.readSavingsBalance.json npm run replay -- 100001`
- On Windows PowerShell, they persist for the whole session. Set with
  `$env:NAME="value"`, and clear after with `Remove-Item Env:\NAME`. To reset all of
  them before a run: `Remove-Item Env:\ARTIFACT,Env:\POLICY,Env:\APPROVE_RISKY,Env:\HANDOFF -ErrorAction SilentlyContinue`

Every replay prints a `mode:` line and a `capability:` line at the top, so you can always
see which artifact and which flags are actually in effect.

## The target: mock bank

A small server rendered app made to look like old internal software. Sign in and search
are clean, but the member detail page is hostile on purpose: nested tables, no ids, no
test hooks, so a value is only findable by the label next to it. Each member id triggers
a fixed condition so replay can show every branch of the result taxonomy.

| Member id  | What happens                   | Result type               |
| ---------- | ------------------------------ | ------------------------- |
| 100001     | normal lookup, returns balance | success                   |
| 100003     | restricted account             | business outcome          |
| 100004     | blocking notice, must dismiss  | recoverable, then success |
| unknown id | no such member                 | business outcome          |
| a space    | empty after trim, form error   | business outcome          |

## Core demo path: discover, distill, replay

### 1. Discover (one real LLM run)

Set the goal in `.env`:

```
GOAL=Sign in with username teller and password demo1234, look up member 100001, and read their savings balance.
```

Then run it, with the mock bank running:

```
npm run discover
```

The browser signs in, searches, reads the balance off the hostile page, and finishes with
`status: success`. Evidence lands in `evidence/discovery-<timestamp>/` (discovery.json,
transcript.jsonl, one screenshot per step). Declared secrets are masked in the log.

### 2. Distill (deterministic, no LLM)

```
cp distill.config.example.json distill.config.json
npm run distill
```

The distiller picks the discovery run that matches your declared inputs, drops detours,
binds typed values to inputs by field name (so credentials become references, never
literals), builds a fallback locator per step, tags risky steps, and derives the outputs
and checkpoint. It writes `artifacts/member.readSavingsBalance.json`.

### 3. Replay (deterministic, no LLM, no key)

Because the repo ships more than one capability, name the artifact you want. macOS or
Linux:

```
ARTIFACT=artifacts/member.readSavingsBalance.json npm run replay -- 100001
```

Windows PowerShell:

```
$env:ARTIFACT="artifacts\member.readSavingsBalance.json"
npm run replay -- 100001
Remove-Item Env:\ARTIFACT
```

Replay runs the saved artifact and returns one tagged result. Pass the member id as an
argument to drive the different outcomes on the same capability, no re recording:

```
npm run replay -- 100001    # success, returns the balance
npm run replay -- 100003    # business outcome: MEMBER_RESTRICTED
npm run replay -- 100004    # recoverable notice, dismissed, then success
npm run replay -- 999999    # business outcome: MEMBER_NOT_FOUND
npm run replay -- " "       # business outcome: VALIDATION_ERROR
```

Credentials come from `replay.inputs.json` (copy it from `replay.inputs.example.json`).
Each run writes `evidence/replay-<timestamp>/`.

## Safety

The guard checks every action against the allowlist in `policy.json` (allowed origins,
routes, action types) and blocks anything outside it. Steps that commit something
irreversible are tagged risky at distill time. The second capability,
`member.openSubAccount`, ends in a risky "Confirm and open" step and is used for these
demos.

Risky action (macOS or Linux shown; on PowerShell set the vars with `$env:` and clear
them after):

```
ARTIFACT=artifacts/member.openSubAccount.json npm run replay -- 100001
```

It stops at the Confirm and open step with status `escalated` and refuses to commit on
its own. Add `APPROVE_RISKY=1` to auto approve (a stand in for a human saying yes):

```
ARTIFACT=artifacts/member.openSubAccount.json APPROVE_RISKY=1 npm run replay -- 100001
```

Allowlist block, using the stricter policy that drops /member:

```
ARTIFACT=artifacts/member.openSubAccount.json POLICY=policy.strict.json npm run replay -- 100001
# returns hard_failure: POLICY_DENIED, route not allowed: /member...
```

## Handoff (a human takes the live session)

```
ARTIFACT=artifacts/member.openSubAccount.json HANDOFF=1 npm run replay -- 100001
```

A visible browser opens and drives to the risky step, then pauses and hands you the same
live session. Click Confirm and open in that window yourself, press Enter, and it records
what changed, takes control back, and finishes as success with the handoff logged in the
result and the evidence. (On PowerShell, clear `HANDOFF` and `ARTIFACT` afterward.)

## Tests

```
cd agent
npm test
```

Vitest covers the load bearing logic: the error classification and the no false positive
on the search hint (detection), the allowlist and risk classifier (policy), and the
distiller (detour removal, secret safe binding by field name, and risk tagging).

## Notes

- Only discovery calls the model. Distill, replay, tests, and the safety and handoff
  demos run with no API key.
- Secrets stay out of the repo: `.env`, `distill.config.json`, and `replay.inputs.json`
  are gitignored. The committed `.example` files show the shape. The demo credential in
  them is the mock bank's own public login, not a real secret. The artifact never
  contains a secret value, and evidence masks declared secrets plus PII.
- If replay says there is more than one artifact and asks you to choose, that is by
  design: it refuses to guess between capabilities. Name one with ARTIFACT.
