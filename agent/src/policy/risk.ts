// Shared, pure risk classifier used by the distiller (to tag artifact steps) and
// later by the policy guard (to decide disposition). Risk is an intrinsic property
// of what a control does, kept separate from the allowlist (which is runtime policy).

// A control is risky if its accessible name implies an irreversible state change:
// confirming, committing, deleting, transferring, paying, withdrawing.
const RISKY_CONTROL = /\b(confirm|delete|remove|transfer|authori[sz]e|pay|withdraw|submit\s+payment)\b/i;

export function isRiskyControlName(name: string): boolean {
  return RISKY_CONTROL.test(name);
}

// A route is risky if it commits (e.g. a confirm endpoint).
const RISKY_ROUTE = /\/(confirm|commit|authorize|transfer|pay)\b/i;

export function isRiskyUrl(url: string): boolean {
  return RISKY_ROUTE.test(url);
}
