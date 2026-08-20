import { describe, it, expect } from 'vitest';
import { checkAllowed, Policy } from './policy';
import { isRiskyControlName, isRiskyUrl } from './risk';

const permissive: Policy = {
  allowedOrigins: ['http://localhost:4000'],
  allowedRoutePrefixes: ['/login', '/search', '/member'],
  allowedActions: ['navigate', 'type', 'click'],
};

describe('checkAllowed', () => {
  it('allows actions within the permitted origin, route, and action type', () => {
    expect(checkAllowed(permissive, 'http://localhost:4000/login', 'navigate').allowed).toBe(true);
    expect(checkAllowed(permissive, 'http://localhost:4000/member?id=100001', 'click').allowed).toBe(true);
    expect(checkAllowed(permissive, 'http://localhost:4000/member/100001/subaccount', 'click').allowed).toBe(true);
  });

  it('blocks a route outside the allowlist', () => {
    const strict: Policy = { ...permissive, allowedRoutePrefixes: ['/login', '/search'] };
    const r = checkAllowed(strict, 'http://localhost:4000/member?id=100001', 'click');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('route');
  });

  it('blocks a disallowed origin', () => {
    const r = checkAllowed(permissive, 'http://evil.com/login', 'navigate');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('origin');
  });

  it('blocks a disallowed action type', () => {
    const noClick: Policy = { ...permissive, allowedActions: ['navigate', 'type'] };
    expect(checkAllowed(noClick, 'http://localhost:4000/login', 'click').allowed).toBe(false);
  });

  it('blocks an unparseable url', () => {
    expect(checkAllowed(permissive, 'not-a-url', 'click').allowed).toBe(false);
  });
});

describe('risk classifier', () => {
  it('flags controls whose name implies a commit', () => {
    expect(isRiskyControlName('Confirm and open')).toBe(true);
    expect(isRiskyControlName('Delete member')).toBe(true);
    expect(isRiskyControlName('Transfer funds')).toBe(true);
  });

  it('does not flag safe controls', () => {
    expect(isRiskyControlName('Sign in')).toBe(false);
    expect(isRiskyControlName('Look up')).toBe(false);
    expect(isRiskyControlName('Review')).toBe(false);
    expect(isRiskyControlName('Open new sub-account')).toBe(false);
  });

  it('flags a commit route but not a plain route', () => {
    expect(isRiskyUrl('http://localhost:4000/member/100001/subaccount/confirm')).toBe(true);
    expect(isRiskyUrl('http://localhost:4000/member?id=100001')).toBe(false);
  });
});
