import { Injectable } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';

@Injectable()
export class BrowserService {
  private browser?: Browser;
  private _page?: Page;

  get page(): Page {
    if (!this._page) throw new Error('Browser not launched');
    return this._page;
  }

  async launch(headed = false): Promise<void> {
    // Headless by default. A handoff (or HEADFUL=1) needs a visible window so a
    // human can operate the same live session.
    this.browser = await chromium.launch({ headless: !headed && process.env.HEADFUL !== '1' });
    const ctx = await this.browser.newContext();
    this._page = await ctx.newPage();
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  // Give navigations and XHR a moment to settle before the next observation.
  async settle(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
