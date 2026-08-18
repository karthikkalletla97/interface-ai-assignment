import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryResult, StepRecord } from '../contracts';
import { BrowserService } from '../browser/browser.service';
import { PerceptionService } from '../perception/perception.service';
import { PlannerService } from '../planner/planner.service';
import { ActuatorService } from '../actuator/actuator.service';
import { EvidenceService } from '../evidence/evidence.service';
import { PolicyGuard } from '../policy/policy.guard';

export interface RunOptions {
  maxSteps?: number;
  timeoutMs?: number;
}

@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(PerceptionService) private readonly perception: PerceptionService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(ActuatorService) private readonly actuator: ActuatorService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(PolicyGuard) private readonly guard: PolicyGuard,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private secrets(): string[] {
    return (this.config.get<string>('SECRETS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async run(goal: string, target: string, opts: RunOptions = {}): Promise<DiscoveryResult> {
    const maxSteps = opts.maxSteps ?? 15;
    const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
    const runId = this.evidence.newRunId();
    const steps: StepRecord[] = [];
    const history: string[] = [];

    await this.browser.launch();
    let lastActionSig = '';
    let repeatCount = 0;
    try {
      await this.browser.goto(target);

      for (let step = 1; step <= maxSteps; step++) {
        // Stopping condition: wall-clock timeout.
        if (Date.now() > deadline) {
          return this.finish('stopped_timeout', runId, goal, target, steps);
        }

        // Observe -> decide.
        const { observation, handles } = await this.perception.observe(this.browser.page);
        const action = await this.planner.decide(goal, observation, history);
        const shot = await this.evidence.screenshot(this.browser.page, runId, step);

        // Stopping condition: goal reached.
        if (action.kind === 'finish') {
          steps.push({ step, observation, action, result: 'finished', screenshot: shot });
          return this.finish('success', runId, goal, target, steps, action.outputs, action.checkpoint);
        }

        // Stopping condition: dead end (this becomes the escalation seam in Phase 5).
        if (action.kind === 'give_up') {
          steps.push({ step, observation, action, result: `gave up: ${action.reason}`, screenshot: shot });
          return this.finish('gave_up', runId, goal, target, steps);
        }

        // Stopping condition: stuck. The same action three times in a row means no
        // progress. We stop here rather than burn the step budget; in Phase 5 this
        // same signal is what routes an intervention request to a human.
        const sig = JSON.stringify(action);
        repeatCount = sig === lastActionSig ? repeatCount + 1 : 0;
        lastActionSig = sig;
        if (repeatCount >= 2) {
          steps.push({ step, observation, action, result: 'stuck: repeated action with no progress', screenshot: shot });
          return this.finish('gave_up', runId, goal, target, steps);
        }

        // Allowlist gate: the agent must not act outside the permitted policy.
        const gateUrl = action.kind === 'navigate' ? action.url : this.browser.page.url();
        const gate = this.guard.check(gateUrl, action.kind);
        if (!gate.allowed) {
          steps.push({ step, observation, action, result: `policy denied: ${gate.reason}`, screenshot: shot });
          return this.finish('gave_up', runId, goal, target, steps);
        }

        // Act.
        const result = await this.actuator.perform(action, handles, this.browser.page);
        history.push(`step ${step}: ${action.kind}${'target' in action ? ' [' + action.target + ']' : ''} -> ${result}`);
        steps.push({ step, observation, action, result, screenshot: shot });
        await this.browser.settle();
      }

      // Stopping condition: step budget exhausted.
      return this.finish('stopped_max_steps', runId, goal, target, steps);
    } finally {
      await this.browser.close();
    }
  }

  private finish(
    status: DiscoveryResult['status'],
    runId: string,
    goal: string,
    target: string,
    steps: StepRecord[],
    outputs?: Record<string, string>,
    checkpoint?: string,
  ): DiscoveryResult {
    const result: DiscoveryResult = { status, runId, goal, target, steps, outputs, checkpoint };
    this.evidence.write(result, this.secrets());
    return result;
  }
}
