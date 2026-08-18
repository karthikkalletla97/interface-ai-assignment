// In-memory data for the mock bank target surface.
// This is a stand-in for a real bank back-office app. Everything here is fake.
//
// The member map is designed so each id triggers a specific, deterministic
// condition. That determinism is what lets replay reliably demonstrate each
// branch of the error taxonomy (business outcome vs recoverable vs hard failure).

export interface Member {
  id: string;
  name: string;
  status: 'active' | 'restricted';
  // Fake PII. Present so the redaction guardrail (Phase 4) has something to bite on.
  ssn: string;
  dob: string;
  email: string;
  phone: string;
  savings: number;
  checking: number;
  // If set, viewing this member shows a blocking interstitial that must be
  // dismissed before the page is usable. Models a recoverable condition.
  interstitial?: string;
}

// Valid teller credentials for the login form. Not real auth, just a gate.
export const CREDENTIALS = { username: 'teller', password: 'demo1234' };

const MEMBERS: Record<string, Member> = {
  // Happy path. A clean lookup that returns a balance.
  '100001': {
    id: '100001',
    name: 'Alice Nguyen',
    status: 'active',
    ssn: '512-90-1234',
    dob: '1988-03-14',
    email: 'alice.nguyen@example.com',
    phone: '313-555-0101',
    savings: 4250.75,
    checking: 812.4,
  },
  // A second normal member, useful for parameterized replay.
  '100002': {
    id: '100002',
    name: 'Marcus Bell',
    status: 'active',
    ssn: '441-22-8765',
    dob: '1979-11-02',
    email: 'marcus.bell@example.com',
    phone: '313-555-0102',
    savings: 19980.0,
    checking: 3204.19,
  },
  // Restricted account. Viewing returns an access-denied screen.
  // This is an expected business outcome (the caller needs to know), not a crash.
  '100003': {
    id: '100003',
    name: 'Dana Powell',
    status: 'restricted',
    ssn: '203-55-9090',
    dob: '1991-07-21',
    email: 'dana.powell@example.com',
    phone: '313-555-0103',
    savings: 0,
    checking: 0,
  },
  // Active, but the detail page ships with a blocking maintenance notice that
  // must be dismissed first. Models a recoverable condition on replay.
  '100004': {
    id: '100004',
    name: 'Priya Raman',
    status: 'active',
    ssn: '778-31-4567',
    dob: '1985-01-09',
    email: 'priya.raman@example.com',
    phone: '313-555-0104',
    savings: 6120.5,
    checking: 145.0,
    interstitial: 'Scheduled maintenance notice: some balances may be delayed.',
  },
};

export function findMember(id: string): Member | undefined {
  return MEMBERS[id.trim()];
}

export function allMembers(): Member[] {
  return Object.values(MEMBERS);
}
