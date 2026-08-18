import * as fs from 'fs';
import * as path from 'path';

export interface Policy {
  allowedOrigins: string[];
  allowedRoutePrefixes: string[];
  allowedActions: string[];
}

const DEFAULT_POLICY: Policy = {
  allowedOrigins: ['http://localhost:4000'],
  allowedRoutePrefixes: ['/login', '/search', '/member'],
  allowedActions: ['navigate', 'type', 'click'],
};

// Loads policy.json from the repo root, or the path in the POLICY env var. Falls
// back to a permissive default that covers the mock bank flows.
export function loadPolicy(): Policy {
  const repoRoot = path.resolve(__dirname, '../../..');
  const raw = process.env.POLICY;
  const p = raw
    ? path.isAbsolute(raw)
      ? raw
      : path.join(repoRoot, raw)
    : path.join(repoRoot, 'policy.json');
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    return DEFAULT_POLICY;
  }
}

// The allowlist gate: an action is permitted only if its origin, route, and type
// are all on the list. This is the hard outer boundary; the agent must not act
// outside it.
export function checkAllowed(
  policy: Policy,
  url: string,
  action: string,
): { allowed: boolean; reason?: string } {
  let origin = '';
  let pathname = '';
  try {
    const u = new URL(url);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    return { allowed: false, reason: `invalid url: ${url}` };
  }
  if (!policy.allowedOrigins.includes(origin)) return { allowed: false, reason: `origin not allowed: ${origin}` };
  if (!policy.allowedRoutePrefixes.some((pre) => pathname.startsWith(pre)))
    return { allowed: false, reason: `route not allowed: ${pathname}` };
  if (!policy.allowedActions.includes(action)) return { allowed: false, reason: `action not allowed: ${action}` };
  return { allowed: true };
}
