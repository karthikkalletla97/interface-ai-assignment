// Pure replay logic: no browser, no LLM. Kept side-effect free so it is unit
// testable on its own. The registry is where per-app knowledge lives; in a
// multi-tenant world it would be configured per app or tenant.

export interface PageSnap {
  url: string;
  text: string;
}

export type ConditionKind = 'business_outcome' | 'recoverable' | 'hard_failure';

export interface ConditionRule {
  code: string;
  kind: ConditionKind;
  test: (p: PageSnap) => boolean;
  message?: string;
  recover?: { dismissByText?: string; escalate?: boolean };
}

// Matched against full rendered phrases, not loose keywords, so the search page's
// hint text ("... 100003 (restricted), 100004 (notice), or any unknown id (not
// found)") never triggers a false positive.
export const CONDITIONS: ConditionRule[] = [
  {
    code: 'AUTH_FAILED',
    kind: 'hard_failure',
    test: (p) => /invalid username or password/i.test(p.text),
    message: 'Authentication failed at sign in; cannot proceed.',
  },
  {
    code: 'VALIDATION_ERROR',
    kind: 'business_outcome',
    test: (p) => /please enter a member id/i.test(p.text),
    message: 'Required input missing or invalid.',
  },
  {
    code: 'MEMBER_NOT_FOUND',
    kind: 'business_outcome',
    test: (p) => /no member found/i.test(p.text),
    message: 'No member found for the given id.',
  },
  {
    code: 'MEMBER_RESTRICTED',
    kind: 'business_outcome',
    test: (p) => /access restricted/i.test(p.text),
    message: 'Member is restricted and cannot be serviced here.',
  },
  {
    code: 'SESSION_EXPIRED',
    kind: 'recoverable',
    test: (p) => /session expired/i.test(p.text),
    recover: { escalate: true },
    message: 'Session expired mid-flow.',
  },
  {
    code: 'MAINTENANCE_NOTICE',
    kind: 'recoverable',
    test: (p) => /system notice/i.test(p.text),
    recover: { dismissByText: 'Dismiss' },
  },
];

export function classify(p: PageSnap): ConditionRule | undefined {
  return CONDITIONS.find((r) => r.test(p));
}

export type Assertion = { urlContains: string } | { textContains: string };

export function verifyAsserts(
  url: string,
  text: string,
  asserts: Assertion[],
): { ok: boolean; failed?: string } {
  for (const a of asserts) {
    if ('urlContains' in a) {
      if (!url.includes(a.urlContains)) return { ok: false, failed: `url should contain "${a.urlContains}"` };
    } else if (!text.includes(a.textContains)) {
      return { ok: false, failed: `page should contain "${a.textContains}"` };
    }
  }
  return { ok: true };
}

// Read the value sitting after a label. Survives table layout change because it
// anchors on the label text, not a cell position.
export function extractLabelAdjacent(text: string, label: string, pattern?: string): string | undefined {
  const idx = text.indexOf(label);
  if (idx < 0) return undefined;
  const after = text.slice(idx + label.length);
  if (pattern) {
    const m = after.match(new RegExp(pattern));
    return m ? m[0] : undefined;
  }
  const m = after.match(/\S+/);
  return m ? m[0] : undefined;
}
