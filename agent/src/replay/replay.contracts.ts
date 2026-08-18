// The single result the caller pattern-matches on. Recoverable is not a status:
// it is handled mid-flight and resolves into one of these three terminal states.

import { Intervention } from '../handoff/handoff.service';

export interface ReplayStepLog {
  step: number;
  action: string;
  result: string;
  screenshot?: string;
}

export type ReplayResult =
  | {
      status: 'success';
      runId: string;
      capabilityId: string;
      steps: ReplayStepLog[];
      outputs: Record<string, string>;
      interventions?: Intervention[]; // present when a human took over mid-run
    }
  | {
      status: 'business_outcome';
      runId: string;
      capabilityId: string;
      steps: ReplayStepLog[];
      outcome: string;
      message: string;
    }
  | {
      status: 'hard_failure';
      runId: string;
      capabilityId: string;
      steps: ReplayStepLog[];
      escalate?: boolean;
      failure: { step: number | string; action: string; expected: string; observed: string };
    }
  | {
      // A risky/irreversible step needs a human to authorize it. Terminal until a
      // person acts (Phase 5 turns this into a live handoff). Not a failure.
      status: 'escalated';
      runId: string;
      capabilityId: string;
      steps: ReplayStepLog[];
      escalation: { step: number; action: string; control: string; reason: string };
    };
