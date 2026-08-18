import { Injectable } from '@nestjs/common';
import { ElementHandle, Page } from 'playwright';
import { AgentAction } from '../contracts';

@Injectable()
export class ActuatorService {
  // Maps a validated action onto the live handle (by index) or the page.
  // Returns a short result string that feeds the history and the evidence log.
  async perform(action: AgentAction, handles: ElementHandle[], page: Page): Promise<string> {
    switch (action.kind) {
      case 'click': {
        const el = handles[action.target];
        if (!el) return `no element at index ${action.target}`;
        await el.click({ timeout: 5000 });
        return `clicked [${action.target}]`;
      }
      case 'type': {
        const el = handles[action.target];
        if (!el) return `no element at index ${action.target}`;
        // A dropdown cannot be filled; select the matching option instead.
        const tag = await el.evaluate((n) => (n as HTMLElement).tagName).catch(() => '');
        if (tag === 'SELECT') {
          await el.selectOption(action.text, { timeout: 5000 }).catch(() => undefined);
          return `selected in [${action.target}]`;
        }
        await el.fill(action.text, { timeout: 5000 });
        return `typed into [${action.target}]`;
      }
      case 'navigate': {
        await page.goto(action.url, { waitUntil: 'domcontentloaded' });
        return `navigated to ${action.url}`;
      }
      default:
        return `no-op for ${action.kind}`;
    }
  }
}
