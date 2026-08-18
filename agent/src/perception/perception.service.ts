import { Injectable } from '@nestjs/common';
import { ElementHandle, Page } from 'playwright';
import { InteractiveElement, Observation } from '../contracts';

@Injectable()
export class PerceptionService {
  // We enumerate a role-bearing set, then compute an accessible name for each
  // in-page. We deliberately never key off id or css: on the hostile member page
  // there are none. The model targets an element by its index; index maps 1:1 to
  // the live handle we keep, so acting is exact even though naming is fuzzy.
  private readonly SELECTOR = 'a, button, input, select, textarea, [role]';

  async observe(page: Page): Promise<{ observation: Observation; handles: ElementHandle[] }> {
    const handles = await page.$$(this.SELECTOR);
    const elements: InteractiveElement[] = [];

    for (let i = 0; i < handles.length; i++) {
      const info = await handles[i].evaluate((node) => {
        const e = node as HTMLElement;
        const tag = e.tagName;
        const type = (e as HTMLInputElement).type;
        let role = e.getAttribute('role') || '';
        if (!role) {
          if (tag === 'A') role = 'link';
          else if (tag === 'BUTTON') role = 'button';
          else if (tag === 'SELECT') role = 'combobox';
          else if (tag === 'TEXTAREA') role = 'textbox';
          else if (tag === 'INPUT') {
            role = type === 'submit' || type === 'button' ? 'button'
              : type === 'checkbox' ? 'checkbox'
              : type === 'radio' ? 'radio'
              : type === 'number' ? 'spinbutton'
              : 'textbox';
          } else role = 'generic';
        }
        const labelEl = e.id ? document.querySelector('label[for="' + e.id + '"]') : null;
        const name = (
          e.getAttribute('aria-label') ||
          (labelEl && labelEl.textContent) ||
          (e as HTMLInputElement).placeholder ||
          e.textContent ||
          (e as HTMLInputElement).value ||
          ''
        ).replace(/\s+/g, ' ').trim();
        const visible = !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
        const editable = role === 'textbox' || role === 'combobox';
        const value = ((e as HTMLInputElement).value || '').trim();
        return { role, name: name.slice(0, 80), visible, editable, value };
      });

      // Keep the index aligned to the handle array; skip invisible or nameless noise.
      if (!info.visible || !info.name) continue;
      elements.push({
        index: i,
        role: info.role,
        name: info.name,
        editable: info.editable,
        // Surface the current field value so the model can tell its type already took.
        value: info.editable && info.value ? info.value.slice(0, 80) : undefined,
      });
    }

    // Compressed visible text so the model can read values (e.g. a balance) off a
    // page with no semantic structure. Capped to protect the context budget.
    const textDigest = (await page.locator('body').innerText())
      .replace(/\n{2,}/g, '\n')
      .trim()
      .slice(0, 2000);

    return {
      observation: { url: page.url(), title: await page.title(), elements, textDigest },
      handles,
    };
  }
}
