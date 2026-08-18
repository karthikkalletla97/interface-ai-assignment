import { z } from 'zod';

// How a step finds its control. Primary is role + accessible name (how perception
// already reads the page and what survives the hostile no-id surface). Fallbacks
// degrade gracefully if the name shifts: match visible text, then position.
export const Locator = z.object({
  primary: z.object({
    by: z.literal('role'),
    role: z.string(),
    name: z.string(),
  }),
  fallbacks: z
    .array(
      z.discriminatedUnion('by', [
        z.object({ by: z.literal('text'), contains: z.string() }),
        z.object({ by: z.literal('nth'), role: z.string(), index: z.number() }),
      ]),
    )
    .default([]),
  note: z.string().optional(),
});
export type Locator = z.infer<typeof Locator>;

// A type step carries valueFrom (a parameter reference) OR a literal value, never
// a raw secret. Distillation prefers valueFrom by matching the recorded keystroke
// to a declared input, which is why credentials never land in the artifact.
export const ArtifactStep = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string(), risk: z.enum(['safe', 'risky']).default('safe') }),
  z.object({
    action: z.literal('type'),
    valueFrom: z.string().optional(),
    value: z.string().optional(),
    target: Locator,
    risk: z.enum(['safe', 'risky']).default('safe'),
  }),
  z.object({ action: z.literal('click'), target: Locator, risk: z.enum(['safe', 'risky']).default('safe') }),
]);
export type ArtifactStep = z.infer<typeof ArtifactStep>;

export const InputParam = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().default(true),
  secret: z.boolean().default(false),
  example: z.string().optional(), // only populated for non-secret inputs
});
export type InputParam = z.infer<typeof InputParam>;

// An output is a rule for re-reading a value on replay, not a captured value.
// labelAdjacent reads the value sitting next to a label, so it survives layout
// change on the table-based page.
export const OutputSpec = z.object({
  name: z.string(),
  type: z.enum(['string', 'number']).default('string'),
  extract: z.object({
    by: z.literal('labelAdjacent'),
    label: z.string(),
    pattern: z.string().optional(),
  }),
});
export type OutputSpec = z.infer<typeof OutputSpec>;

export const Checkpoint = z.object({
  description: z.string(),
  assert: z.array(
    z.union([z.object({ urlContains: z.string() }), z.object({ textContains: z.string() })]),
  ),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export const Capability = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.number().default(1),
});
export type Capability = z.infer<typeof Capability>;

export const Artifact = z.object({
  schemaVersion: z.string(),
  capability: Capability,
  inputs: z.array(InputParam),
  steps: z.array(ArtifactStep),
  outputs: z.array(OutputSpec),
  checkpoint: Checkpoint,
  // Links back to the run that produced it, not the raw model transcript.
  provenance: z.object({ runId: z.string(), distilledAt: z.string() }),
});
export type Artifact = z.infer<typeof Artifact>;
