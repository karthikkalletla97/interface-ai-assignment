import { Injectable } from '@nestjs/common';
import { Page } from 'playwright';
import * as readline from 'readline';

export interface InterventionContext {
  capability: string;
  step: number;
  action: string;
  control: string;
  reason: string;
  url: string;
  screenshot: string;
}

export interface Intervention {
  step: number;
  control: string;
  reason: string;
  controllerDuring: 'human';
  before: { url: string };
  after: { url: string };
  changed: boolean;
  at: string;
}

// Manages the control transfer between the automation and a human operator on the
// SAME live session. The operator surface is a CLI prompt (a deliberately mocked
// but real handoff); the pause/cede/resume mechanism and the control-transfer model
// are real.
@Injectable()
export class HandoffService {
  private controller: 'agent' | 'human' = 'agent';

  who(): 'agent' | 'human' {
    return this.controller;
  }

  private async text(page: Page): Promise<string> {
    return page
      .locator('body')
      .innerText()
      .catch(() => '');
  }

  // Pause automation, hand the live session to the human, wait for them to act,
  // then take control back and report what changed.
  async handle(page: Page, ctx: InterventionContext): Promise<Intervention> {
    // Cede control.
    this.controller = 'human';
    console.log('\n[control] agent -> human');
    console.log('=== INTERVENTION REQUIRED ===');
    console.log(`capability:  ${ctx.capability}`);
    console.log(`step:        ${ctx.step} (${ctx.action} "${ctx.control}")`);
    console.log(`reason:      ${ctx.reason}`);
    console.log(`current url: ${ctx.url}`);
    console.log(`screenshot:  ${ctx.screenshot}`);
    console.log('The live browser session is now yours. Perform the step in that window.');

    const before = { url: page.url(), text: await this.text(page) };
    await this.waitForResume();
    const after = { url: page.url(), text: await this.text(page) };

    // Take control back.
    this.controller = 'agent';
    console.log('[control] human -> agent (resuming)\n');

    return {
      step: ctx.step,
      control: ctx.control,
      reason: ctx.reason,
      controllerDuring: 'human',
      before: { url: before.url },
      after: { url: after.url },
      changed: before.url !== after.url || before.text !== after.text,
      at: new Date().toISOString(),
    };
  }

  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('[handoff] Press Enter when you have finished the step to hand control back... ', () => {
        rl.close();
        resolve();
      });
    });
  }
}
