import { Injectable } from '@nestjs/common';
import { Page, Locator as PWLocator } from 'playwright';
import { Locator } from '../artifact/artifact.contracts';

@Injectable()
export class LocatorResolverService {
  describe(loc: Locator): string {
    return `role=${loc.primary.role} name="${loc.primary.name}"`;
  }

  // Ordered candidates: primary role+name, then by label (role-agnostic, catches
  // fields whose real ARIA role differs from perception, e.g. a number input is a
  // spinbutton not a textbox), then each fallback (text, then position).
  private candidates(page: Page, loc: Locator): { handle: PWLocator; strategy: string }[] {
    const list: { handle: PWLocator; strategy: string }[] = [
      {
        handle: page.getByRole(loc.primary.role as never, { name: loc.primary.name }),
        strategy: `role=${loc.primary.role} name="${loc.primary.name}"`,
      },
      {
        handle: page.getByLabel(loc.primary.name),
        strategy: `label="${loc.primary.name}"`,
      },
    ];
    for (const fb of loc.fallbacks) {
      if (fb.by === 'text') {
        list.push({ handle: page.getByText(fb.contains), strategy: `text~="${fb.contains}"` });
      } else {
        list.push({ handle: page.getByRole(fb.role as never).nth(fb.index), strategy: `nth ${fb.role}[${fb.index}]` });
      }
    }
    return list;
  }

  async resolve(page: Page, loc: Locator): Promise<{ handle: PWLocator; strategy: string } | null> {
    for (const c of this.candidates(page, loc)) {
      try {
        if ((await c.handle.count()) >= 1) return { handle: c.handle.first(), strategy: c.strategy };
      } catch {
        /* try the next strategy */
      }
    }
    return null;
  }

  // Retry with exponential backoff: an unresolved element is often just timing on
  // a slow load, not a genuine miss. Only after the retries do we call it missing.
  async resolveWithRetry(
    page: Page,
    loc: Locator,
    attempts = 3,
  ): Promise<{ handle: PWLocator; strategy: string } | null> {
    for (let i = 0; i < attempts; i++) {
      const r = await this.resolve(page, loc);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 250 * 2 ** i));
    }
    return null;
  }
}
