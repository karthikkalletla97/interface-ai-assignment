import { Injectable } from '@nestjs/common';
import { Artifact, InputParam, Locator, OutputSpec } from '../artifact/artifact.contracts';
import { DiscoveryResult, Observation } from '../contracts';
import { isRiskyControlName, isRiskyUrl } from '../policy/risk';

// Human-authored curation: names the capability and declares which concrete values
// were the parameters. The distiller binds them provably by matching keystrokes.
export interface DistillInput {
  name: string;
  value: string;
  type?: 'string' | 'number' | 'boolean';
  secret?: boolean;
  required?: boolean;
}
export interface DistillConfig {
  capability: { id: string; name: string; description: string; version?: number };
  inputs: DistillInput[];
}

@Injectable()
export class DistillerService {
  distill(run: DiscoveryResult, config: DistillConfig): Artifact {
    const steps: unknown[] = [];

    // 1. Entry navigation. Discovery's initial goto is implicit in the run, so the
    // artifact makes it an explicit first step.
    steps.push({ action: 'navigate', url: run.target });

    let finishStep: DiscoveryResult['steps'][number] | undefined;

    for (const s of run.steps) {
      const a = s.action;
      if (a.kind === 'finish') {
        finishStep = s;
        continue;
      }
      if (a.kind === 'give_up') continue;

      if (a.kind === 'navigate') {
        // Drop a navigation to the page we are already on: a discovery detour.
        if (a.url === s.observation.url) continue;
        steps.push({ action: 'navigate', url: a.url, risk: isRiskyUrl(a.url) ? 'risky' : 'safe' });
        continue;
      }

      if (a.kind === 'type') {
        const target = this.locator(s.observation, a.target);
        // Bind by field name first (redaction-safe: works even when the typed secret
        // is masked in evidence), then fall back to matching the typed value.
        const byName = config.inputs.find((i) => this.norm(i.name) === this.norm(target.primary.name));
        const byValue = config.inputs.find((i) => i.value === a.text);
        const match = byName ?? byValue;
        // Prefer a parameter reference; a raw secret is never written here.
        if (match) steps.push({ action: 'type', valueFrom: match.name, target, risk: 'safe' });
        else steps.push({ action: 'type', value: a.text, target, risk: 'safe' });
        continue;
      }

      if (a.kind === 'click') {
        const target = this.locator(s.observation, a.target);
        // A click that commits (its control name implies confirm/delete/transfer) is risky.
        const risk = isRiskyControlName(target.primary.name) ? 'risky' : 'safe';
        steps.push({ action: 'click', target, risk });
        continue;
      }
    }

    const inputs: InputParam[] = config.inputs.map((i) => ({
      name: i.name,
      type: i.type ?? 'string',
      required: i.required ?? true,
      secret: i.secret ?? false,
      example: i.secret ? undefined : i.value,
    }));

    const { outputs, checkpoint } = this.deriveOutputsAndCheckpoint(finishStep, run);

    const artifact = {
      schemaVersion: '1.0',
      capability: {
        id: config.capability.id,
        name: config.capability.name,
        description: config.capability.description,
        version: config.capability.version ?? 1,
      },
      inputs,
      steps,
      outputs,
      checkpoint,
      provenance: { runId: run.runId, distilledAt: new Date().toISOString() },
    };

    // Validate on the way out: a malformed artifact never leaves the distiller.
    return Artifact.parse(artifact);
  }

  // Build a locator from the element the step acted on in that step's observation.
  private locator(obs: Observation, index: number): Locator {
    const el = obs.elements.find((e) => e.index === index);
    const role = el?.role ?? 'generic';
    const name = el?.name ?? '';
    const fallbacks: Locator['fallbacks'] = [];
    if (role === 'button' || role === 'link') fallbacks.push({ by: 'text', contains: name });
    const sameRole = obs.elements.filter((e) => e.role === role);
    const ordinal = Math.max(0, sameRole.findIndex((e) => e.index === index));
    fallbacks.push({ by: 'nth', role, index: ordinal });
    return {
      primary: { by: 'role', role, name },
      fallbacks,
      note: 'role + accessible name; falls back to visible text, then position',
    };
  }

  // Derive each output's re-read rule from where its value actually appeared, and
  // build a checkpoint from the final url and the first output's label.
  private deriveOutputsAndCheckpoint(
    finishStep: DiscoveryResult['steps'][number] | undefined,
    run: DiscoveryResult,
  ): { outputs: OutputSpec[]; checkpoint: Artifact['checkpoint'] } {
    const outputs: OutputSpec[] = [];
    let firstLabel = '';

    if (finishStep && run.outputs) {
      const digest = finishStep.observation.textDigest;
      for (const [key, value] of Object.entries(run.outputs)) {
        const ex = this.deriveExtract(digest, String(value));
        if (!firstLabel && ex) firstLabel = ex.label;
        outputs.push({
          name: this.camel(key),
          type: 'string',
          extract: { by: 'labelAdjacent', label: ex?.label ?? key, pattern: ex?.pattern },
        });
      }
    }

    const url = finishStep?.observation.url ?? run.target;
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* keep raw */
    }

    const asserts: Artifact['checkpoint']['assert'] = [{ urlContains: pathname }];
    if (firstLabel) asserts.push({ textContains: firstLabel });

    const description =
      finishStep && finishStep.action.kind === 'finish'
        ? finishStep.action.checkpoint
        : 'Reached the expected result page.';

    return { outputs, checkpoint: { description, assert: asserts } };
  }

  private deriveExtract(digest: string, value: string): { label: string; pattern?: string } | undefined {
    const idx = digest.indexOf(value);
    if (idx < 0) return undefined;
    const before = digest.slice(0, idx);
    const parts = before
      .split(/[\t\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const label = parts[parts.length - 1] ?? '';
    const pattern = value.startsWith('$') ? '\\$[0-9.,]+' : undefined;
    return { label, pattern };
  }

  private camel(s: string): string {
    return s.replace(/[_-](\w)/g, (_m, c: string) => c.toUpperCase());
  }

  private norm(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}
