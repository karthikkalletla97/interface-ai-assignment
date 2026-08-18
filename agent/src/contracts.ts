import { z } from 'zod';

// One actionable control the model can refer to by its index.
export const InteractiveElement = z.object({
  index: z.number(),
  role: z.string(),     // button | link | textbox | combobox | checkbox
  name: z.string(),     // accessible name: aria-label, <label>, placeholder, or text
  editable: z.boolean(),
  value: z.string().optional(), // current value of an editable field, so the model sees its own progress
});
export type InteractiveElement = z.infer<typeof InteractiveElement>;

// The compressed, model-facing view of the page. Interactive elements are keyed
// off role and accessible name, never off ids or css, so the same perception
// works on the hostile legacy page. textDigest lets the model read values.
export const Observation = z.object({
  url: z.string(),
  title: z.string(),
  elements: z.array(InteractiveElement),
  textDigest: z.string(),
});
export type Observation = z.infer<typeof Observation>;

// Exactly one of these per step. give_up is the seam to escalation in Phase 5.
export const AgentAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), target: z.number(), why: z.string() }),
  z.object({ kind: z.literal('type'), target: z.number(), text: z.string(), why: z.string() }),
  z.object({ kind: z.literal('navigate'), url: z.string(), why: z.string() }),
  z.object({ kind: z.literal('finish'), outputs: z.record(z.string()), checkpoint: z.string(), why: z.string() }),
  z.object({ kind: z.literal('give_up'), reason: z.string() }),
]);
export type AgentAction = z.infer<typeof AgentAction>;

export const StepRecord = z.object({
  step: z.number(),
  observation: Observation,
  action: AgentAction,
  result: z.string(),
  screenshot: z.string().optional(),
});
export type StepRecord = z.infer<typeof StepRecord>;

export const DiscoveryResult = z.object({
  status: z.enum(['success', 'stopped_max_steps', 'stopped_timeout', 'gave_up']),
  runId: z.string(),
  goal: z.string(),
  target: z.string(),
  steps: z.array(StepRecord),
  outputs: z.record(z.string()).optional(),
  checkpoint: z.string().optional(),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;
