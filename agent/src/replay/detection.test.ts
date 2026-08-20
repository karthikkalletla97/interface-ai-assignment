import { describe, it, expect } from 'vitest';
import { classify, extractLabelAdjacent, verifyAsserts } from './detection';

const code = (text: string) => classify({ url: '', text })?.code ?? 'CLEAR';

// Realistic innerText for each mock bank page (tabs between table cells).
const MEMBER =
  'Member record\nName\tAlice Nguyen\nMember No\t100001\nStatus\tactive\n' +
  'SSN\t512-90-1234\nEmail\talice.nguyen@example.com\n' +
  'Balances\nSavings\t$4250.75\nChecking\t$812.40';
const NOT_FOUND = 'No member found\nNo record matches member id 99999.';
const RESTRICTED = 'Access restricted\nMember 100003 is restricted and cannot be serviced here.';
const VALIDATION = 'Member lookup\nPlease enter a member id.\nMember ID';
const NOTICE = 'System notice\nScheduled maintenance notice: some balances may be delayed.\nDismiss';
const SESSION = 'Session expired\nYour session has ended. Please sign in again.';
const AUTH_FAILED = 'Teller sign in\nInvalid username or password.\nUsername\nPassword';
// The search page's hint text contains the words restricted, notice, and not found.
const SEARCH_HINT =
  'Member lookup\nMember ID\nLook up\nTry 100001 (ok), 100003 (restricted), 100004 (notice), or any unknown id (not found).';

describe('classify', () => {
  it('classifies each known page by its full phrase', () => {
    expect(code(MEMBER)).toBe('CLEAR');
    expect(code(NOT_FOUND)).toBe('MEMBER_NOT_FOUND');
    expect(code(RESTRICTED)).toBe('MEMBER_RESTRICTED');
    expect(code(VALIDATION)).toBe('VALIDATION_ERROR');
    expect(code(NOTICE)).toBe('MAINTENANCE_NOTICE');
    expect(code(SESSION)).toBe('SESSION_EXPIRED');
    expect(code(AUTH_FAILED)).toBe('AUTH_FAILED');
  });

  it('does not false-trigger on the search page hint text', () => {
    // This is the important one: the hint contains "restricted", "notice", "not found".
    expect(code(SEARCH_HINT)).toBe('CLEAR');
  });
});

describe('extractLabelAdjacent', () => {
  it('reads the value next to a label with a pattern', () => {
    expect(extractLabelAdjacent(MEMBER, 'Savings', '\\$[0-9.,]+')).toBe('$4250.75');
  });
  it('returns undefined when the label is absent', () => {
    expect(extractLabelAdjacent(MEMBER, 'Overdraft', '\\$[0-9.,]+')).toBeUndefined();
  });
});

describe('verifyAsserts', () => {
  it('passes when url and text both match', () => {
    const r = verifyAsserts('http://localhost:4000/member?id=100001', MEMBER, [
      { urlContains: '/member' },
      { textContains: 'Savings' },
    ]);
    expect(r.ok).toBe(true);
  });
  it('fails with a reason when a check does not match', () => {
    const r = verifyAsserts('http://localhost:4000/search', MEMBER, [{ urlContains: '/member' }]);
    expect(r.ok).toBe(false);
    expect(r.failed).toContain('/member');
  });
});
