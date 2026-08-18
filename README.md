# Computer-use automation system

A system that lets an LLM figure out how to complete a task inside a UI that has no API,
records that successful run as a reusable capability, and replays it deterministically
afterward with no model in the loop.

## Repository layout

```
mock-bank/   the automation target: a legacy-style bank back-office stand-in
agent/       the deliverable: discovery loop, artifact, replay, safety, escalation
evidence/    saved artifact plus logs from a discovery run and a replay run
REPORT.md    design write-up
```

## The target surface (mock bank)

A small server-rendered app that stands in for real bank software. It is built to
exercise the interesting problems rather than to look good:

- The sign-in and search screens use clean, semantic markup with stable ids.
- The member detail screen is deliberately hostile: nested table layout, no ids,
  no test hooks. Values are identifiable only by their neighbouring label text. This
  is where a naive selector strategy fails and a text-and-role strategy has to work.
- Each member id triggers a specific, deterministic condition so that replay can
  demonstrate every branch of the error taxonomy.

### Member and error map

| Member id      | Condition                     | Taxonomy bucket              |
|----------------|-------------------------------|------------------------------|
| 100001, 100002 | normal lookup, returns balance| success                      |
| 100003         | restricted account (403)      | expected business outcome    |
| any unknown id | no such member (404)          | expected business outcome    |
| empty id       | validation error (400)        | expected business outcome    |
| 100004         | blocking maintenance notice   | recoverable condition        |
| POST /dev/expire | session ends (440 thereafter)| recoverable / hard failure  |

`/dev/expire` and `/dev/restore` are dev-only controls that let replay trigger a
session timeout on demand. They stand in for conditions that occur unpredictably in a
real system.

### Run the mock bank

```
cd mock-bank
npm install
npm start           # serves http://localhost:4000
```

Demo credentials: `teller` / `demo1234`.

## The agent

### Phase 1: discovery (the real LLM run)

The agent runs as a NestJS standalone application driven by a CLI command. It runs an
observe, decide, act loop against the live mock bank until the goal is met or a stopping
condition is hit (finish, give up, max steps, timeout).

One-time setup:

```
cd agent
npm install
npx playwright install chromium
```

Run a discovery, with the mock bank already running in another terminal:

```
export ANTHROPIC_API_KEY=sk-...
export ANTHROPIC_MODEL=claude-sonnet-5    # or whichever model you have access to
GOAL="Sign in with username teller and password demo1234, look up member 100001, and read their savings balance." npm run discover
```

Expected result: the browser signs in, searches member 100001, reads the balance off
the hostile detail page, and the model calls finish with the extracted value. Evidence
lands in `evidence/discovery-<timestamp>/`:

- `discovery.json`  the full run: every step's observation, action, reasoning, result
- `transcript.jsonl`  one line per step
- `step-NN.png`  a screenshot per step

Note: the demo credentials are passed inside the goal only because they are throwaway.
Real credentials must never flow through the model. That is enforced by the Phase 4
safety guardrails.

### Replay, safety, and escalation

Built in later phases. The replay demo path is documented once the artifact and replay
engine exist.

### Phase 2: distilling the capability artifact

A successful discovery run is distilled into a typed, versioned capability artifact.
The distiller runs deterministically (no LLM): it drops discovery detours, binds each
typed value to the input it matches (so credentials become references, never literals),
builds a fallback locator chain per step, and derives the output extraction and
checkpoint from where the value actually appeared.

Curation lives in a small config that names the capability and declares the inputs:

```
cd agent
cp distill.config.example.json distill.config.json    # edit values for your run
npm run distill                                        # uses the latest run in evidence/
```

The artifact is written to `artifacts/<capability-id>.json`. To distill a specific run,
set `RUN=evidence/discovery-<timestamp>/discovery.json`.

Note: `distill.config.json` is gitignored because it holds the concrete input values
(including the demo credential). The committed `distill.config.example.json` shows the
shape. The artifact itself never contains secret values.

### Phase 3: deterministic replay

Replay executes the saved artifact with no LLM in the loop and returns one tagged
result: `success`, `business_outcome`, or `hard_failure`. A recoverable condition (a
maintenance notice, a transient load) is handled mid-flight and resolves into one of
those three. Locators walk their fallback chain (role+name, then text, then position)
with retry and backoff; the checkpoint is verified before any output is returned.

```
cd agent
cp replay.inputs.example.json replay.inputs.json     # holds username/password/memberId
npm run replay                                        # replays the artifact in artifacts/
```

Drive the different outcomes by changing the member id (the value flows into the same
capability, no re-recording):

```
$env:MEMBER_ID="100001"; npm run replay     # success, returns the savings balance
$env:MEMBER_ID="100003"; npm run replay     # business_outcome: MEMBER_RESTRICTED
$env:MEMBER_ID="100004"; npm run replay     # recoverable notice -> dismissed -> success
$env:MEMBER_ID="999999"; npm run replay     # business_outcome: MEMBER_NOT_FOUND
```

Each run writes `evidence/replay-<timestamp>/replay.json` plus a screenshot per step.
`replay.inputs.json` is gitignored (it holds the demo credential); the artifact and the
result never contain secret values.
