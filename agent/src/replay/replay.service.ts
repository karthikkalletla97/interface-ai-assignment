import { Injectable, Inject } from '@nestjs/common';
import { Page } from 'playwright';
import { Artifact } from '../artifact/artifact.contracts';
import { BrowserService } from '../browser/browser.service';
import { EvidenceService } from '../evidence/evidence.service';
import { LocatorResolverService } from './locator-resolver.service';
import { PolicyGuard } from '../policy/policy.guard';
import { HandoffService, Intervention } from '../handoff/handoff.service';
import { classify, verifyAsserts, extractLabelAdjacent, PageSnap } from './detection';
import { ReplayResult, ReplayStepLog } from './replay.contracts';

export interface ReplayOptions {
  approveRisky?: boolean;
  handoff?: boolean;
}

@Injectable()
export class ReplayService {
  constructor(
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(LocatorResolverService) private readonly resolver: LocatorResolverService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(PolicyGuard) private readonly guard: PolicyGuard,
    @Inject(HandoffService) private readonly handoff: HandoffService,
  ) {}

  async replay(artifact: Artifact, inputs: Record<string, string>, opts: ReplayOptions = {}): Promise<ReplayResult> {
    const runId = this.evidence.newReplayRunId();
    const capabilityId = artifact.capability.id;
    const log: ReplayStepLog[] = [];

    // Resolve caller inputs against the artifact's declared inputs. A missing
    // required input is the caller's error, reported as a hard failure. A provided
    // but empty value is allowed (that is how the validation outcome is exercised).
    const effective: Record<string, string> = {};
    for (const inp of artifact.inputs) {
      const provided = Object.prototype.hasOwnProperty.call(inputs, inp.name);
      const v = provided ? inputs[inp.name] : inp.secret ? undefined : inp.example;
      if (inp.required && v === undefined) {
        return this.hardFailure(runId, capabilityId, log, 'inputs', 'validate', `input "${inp.name}"`, 'missing required input');
      }
      if (v !== undefined) effective[inp.name] = v;
    }

    // A handoff needs a visible session so the human can operate it.
    await this.browser.launch(!!opts.handoff);
    const interventions: Intervention[] = [];
    try {
      const page = this.browser.page;

      for (let i = 0; i < artifact.steps.length; i++) {
        const step = artifact.steps[i];

        // Guard: allowlist gate first (hard boundary), then risk disposition.
        const targetUrl = step.action === 'navigate' ? step.url : page.url();
        const gate = this.guard.check(targetUrl, step.action);
        if (!gate.allowed) {
          return this.hardFailure(runId, capabilityId, log, i + 1, step.action, 'permitted by policy', `POLICY_DENIED: ${gate.reason}`);
        }
        if (step.risk === 'risky') {
          const control = step.action === 'click' || step.action === 'type' ? step.target.primary.name : step.url;
          if (opts.handoff) {
            // Live handoff takes precedence: a human is present to operate the session,
            // so we always pause here rather than auto-approving.
            const shot = await this.evidence.screenshot(page, runId, `handoff-step-${i + 1}`);
            const intervention = await this.handoff.handle(page, {
              capability: capabilityId,
              step: i + 1,
              action: step.action,
              control,
              reason: 'risky/irreversible action requires human authorization',
              url: page.url(),
              screenshot: shot,
            });
            interventions.push(intervention);
            log.push({ step: i + 1, action: step.action, result: 'performed by human (handoff)', screenshot: shot });
            await this.browser.settle();
            continue; // the human performed this step; move to the next
          }
          if (!opts.approveRisky) {
            // Unattended, no approval: stop and request authorization.
            return this.escalated(runId, capabilityId, log, i + 1, step.action, control, 'risky/irreversible action requires human approval');
          }
          // approveRisky: an out-of-band approval is on file; the agent proceeds.
        }

        if (step.action === 'navigate') {
          const ok = await this.withRetry(() => page.goto(step.url, { waitUntil: 'domcontentloaded' }).then(() => true));
          if (!ok) return this.hardFailure(runId, capabilityId, log, i + 1, 'navigate', step.url, 'navigation failed');
        } else {
          const res = await this.resolver.resolveWithRetry(page, step.target);
          if (!res) {
            return this.hardFailure(runId, capabilityId, log, i + 1, step.action, this.resolver.describe(step.target), 'element not found');
          }
          if (step.action === 'type') {
            const val = step.valueFrom ? effective[step.valueFrom] ?? '' : step.value ?? '';
            // Fill, then read the value back. Only proceed once it has actually
            // landed; this removes a race where a click can fire before the field
            // registers the text, which would submit an empty value. A dropdown
            // cannot be filled, so select the matching option instead.
            const ok = await this.withRetry(async () => {
              const tag = await res.handle.evaluate((n) => (n as HTMLElement).tagName).catch(() => '');
              if (tag === 'SELECT') {
                await res.handle.selectOption(val).catch(() => undefined);
              } else {
                await res.handle.fill(val);
              }
              const got = await res.handle.inputValue().catch(() => undefined);
              return got === val;
            });
            if (!ok) return this.hardFailure(runId, capabilityId, log, i + 1, 'type', res.strategy, `field did not hold the typed value "${val}"`);
          } else {
            const ok = await this.withRetry(() => res.handle.click().then(() => true));
            if (!ok) return this.hardFailure(runId, capabilityId, log, i + 1, 'click', res.strategy, 'could not click');
          }
        }

        await this.browser.settle();
        const shot = await this.evidence.screenshot(page, runId, i + 1);
        log.push({ step: i + 1, action: step.action, result: 'ok', screenshot: shot });

        // Classify the resulting page. A business outcome stops replay (it is the
        // answer). A recoverable condition is handled, then we re-check.
        const verdict = await this.classifyAndRecover(page);
        if (verdict.kind === 'business') {
          return this.finishBusiness(runId, capabilityId, log, verdict.code, verdict.message ?? '');
        }
        if (verdict.kind === 'fail') {
          return this.hardFailure(runId, capabilityId, log, i + 1, step.action, 'a usable next page', `${verdict.code}: ${verdict.message ?? ''}`);
        }
        if (verdict.kind === 'escalate') {
          return this.hardFailure(runId, capabilityId, log, i + 1, step.action, 'live session', verdict.code, true);
        }
      }

      // All steps done: verify the checkpoint, then extract declared outputs.
      await this.browser.settle();
      const snap = await this.snap(page);
      const chk = verifyAsserts(snap.url, snap.text, artifact.checkpoint.assert);
      if (!chk.ok) {
        return this.hardFailure(runId, capabilityId, log, 'checkpoint', 'verify', chk.failed ?? 'checkpoint', `url=${snap.url}`);
      }

      const outputs: Record<string, string> = {};
      for (const o of artifact.outputs) {
        const val = extractLabelAdjacent(snap.text, o.extract.label, o.extract.pattern);
        if (val !== undefined) outputs[o.name] = val;
      }
      const result: ReplayResult = {
        status: 'success',
        runId,
        capabilityId,
        steps: log,
        outputs,
        ...(interventions.length ? { interventions } : {}),
      };
      this.evidence.writeReplay(runId, result);
      return result;
    } finally {
      await this.browser.close();
    }
  }

  private async classifyAndRecover(
    page: Page,
    depth = 0,
  ): Promise<
    | { kind: 'clear' }
    | { kind: 'business'; code: string; message?: string }
    | { kind: 'fail'; code: string; message?: string }
    | { kind: 'escalate'; code: string }
  > {
    const snap = await this.snap(page);
    const rule = classify(snap);
    if (!rule) return { kind: 'clear' };
    if (rule.kind === 'business_outcome') return { kind: 'business', code: rule.code, message: rule.message };
    if (rule.kind === 'hard_failure') return { kind: 'fail', code: rule.code, message: rule.message };
    if (rule.recover?.escalate) return { kind: 'escalate', code: rule.code };
    if (rule.recover?.dismissByText && depth < 3) {
      const btn = page.getByText(rule.recover.dismissByText).first();
      try {
        if ((await btn.count()) >= 1) {
          await btn.click();
          await this.browser.settle();
        }
      } catch {
        /* fall through to re-check */
      }
      return this.classifyAndRecover(page, depth + 1);
    }
    return { kind: 'clear' };
  }

  private async snap(page: Page): Promise<PageSnap> {
    const text = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    return { url: page.url(), text };
  }

  private async withRetry(fn: () => Promise<boolean>, attempts = 3): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        if (await fn()) return true;
      } catch {
        /* retry */
      }
      await new Promise((res) => setTimeout(res, 250 * 2 ** i));
    }
    return false;
  }

  private finishBusiness(runId: string, capabilityId: string, log: ReplayStepLog[], outcome: string, message: string): ReplayResult {
    const r: ReplayResult = { status: 'business_outcome', runId, capabilityId, steps: log, outcome, message };
    this.evidence.writeReplay(runId, r);
    return r;
  }

  private escalated(
    runId: string,
    capabilityId: string,
    log: ReplayStepLog[],
    step: number,
    action: string,
    control: string,
    reason: string,
  ): ReplayResult {
    const r: ReplayResult = { status: 'escalated', runId, capabilityId, steps: log, escalation: { step, action, control, reason } };
    this.evidence.writeReplay(runId, r);
    return r;
  }

  private hardFailure(
    runId: string,
    capabilityId: string,
    log: ReplayStepLog[],
    step: number | string,
    action: string,
    expected: string,
    observed: string,
    escalate = false,
  ): ReplayResult {
    const r: ReplayResult = { status: 'hard_failure', runId, capabilityId, steps: log, escalate, failure: { step, action, expected, observed } };
    this.evidence.writeReplay(runId, r);
    return r;
  }
}
