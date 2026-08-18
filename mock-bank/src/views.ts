import { Member } from "./data";

// Minimal page shell. The CSS is only for legibility; it never adds ids or
// test hooks, so it does not make the hostile page any easier to target.
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 2rem; color: #1a1a1a; }
  .wrap { max-width: 720px; }
  h1 { font-size: 1.3rem; }
  label { display: block; margin: 0.8rem 0 0.2rem; }
  input[type=text], input[type=password], input[type=number], select {
    padding: 0.4rem; width: 260px; font-size: 1rem;
  }
  button, .btn { margin-top: 1rem; padding: 0.5rem 0.9rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin: 0.6rem 0; }
  .notice { background: #fff6d6; border: 1px solid #e0c86a; padding: 1rem; margin-bottom: 1rem; }
  table { border-collapse: collapse; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

// CLEAN screen. Semantic form, real label/for bindings, ids and a stable
// button. This is the "modern app" surface.
export function renderLogin(error?: string): string {
  return layout(
    "Sign in",
    `
    <h1>Teller sign in</h1>
    ${error ? `<p class="error" role="alert">${error}</p>` : ""}
    <form method="post" action="/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="off">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="off">
      <button type="submit" id="signin">Sign in</button>
    </form>
    <p style="margin-top:1.5rem;color:#666">Demo credentials: teller / demo1234</p>
  `,
  );
}

// CLEAN screen. Proper label, input id, submit button.
export function renderSearch(error?: string): string {
  return layout(
    "Member search",
    `
    <h1>Member lookup</h1>
    ${error ? `<p class="error" role="alert">${error}</p>` : ""}
    <form method="get" action="/member">
      <label for="memberId">Member ID</label>
      <input type="text" id="memberId" name="id" placeholder="e.g. 100001">
      <button type="submit" id="lookup">Look up</button>
    </form>
    <p style="margin-top:1.5rem;color:#666">Try 100001 (ok), 100003 (restricted),
      100004 (notice), or any unknown id (not found).</p>
  `,
  );
}

// HOSTILE screen. Legacy back-office style on purpose:
//  - layout driven by nested <table> elements
//  - no id or data-testid anywhere
//  - values are only identifiable by the adjacent label cell text
//  - action is a plain link with no stable hook
// A naive selector strategy dies here. The agent must locate by role and by
// nearby text, which is exactly the robustness story we want to demonstrate.
export function renderMemberDetail(m: Member): string {
  // Blocking interstitial: while the notice is up, the record is not shown. The
  // Dismiss link is an ABSOLUTE url that preserves the member id, so dismissing
  // returns to this same member rather than losing the id.
  if (m.interstitial) {
    return layout(
      "Member record",
      `
      <div class="notice" role="dialog" aria-label="System notice">
        <b>System notice</b><br>${m.interstitial}
        <div><a href="/member?id=${m.id}&dismiss=1" class="btn">Dismiss</a></div>
      </div>
    `,
    );
  }
  return layout(
    "Member record",
    `
    <table cellpadding="6">
      <tr><td colspan="2"><font size="4"><b>Member record</b></font></td></tr>
      <tr>
        <td valign="top">
          <table cellpadding="4" border="1">
            <tr><td>Name</td><td>${m.name}</td></tr>
            <tr><td>Member No</td><td>${m.id}</td></tr>
            <tr><td>Status</td><td>${m.status}</td></tr>
            <tr><td>Date of birth</td><td>${m.dob}</td></tr>
            <tr><td>SSN</td><td>${m.ssn}</td></tr>
            <tr><td>Email</td><td>${m.email}</td></tr>
            <tr><td>Phone</td><td>${m.phone}</td></tr>
          </table>
        </td>
        <td valign="top">
          <table cellpadding="4" border="1">
            <tr><td colspan="2"><b>Balances</b></td></tr>
            <tr><td>Savings</td><td align="right">$${m.savings.toFixed(2)}</td></tr>
            <tr><td>Checking</td><td align="right">$${m.checking.toFixed(2)}</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td colspan="2">
          <a href="/member/${m.id}/subaccount">Open new sub-account</a>
          &nbsp; | &nbsp;
          <a href="/search">Back to search</a>
        </td>
      </tr>
    </table>
  `,
  );
}

// Business outcome, not a crash. The caller needs to know "no such member".
export function renderNotFound(id: string): string {
  return layout(
    "Not found",
    `
    <h1>No member found</h1>
    <p>No record matches member id <b>${id}</b>.</p>
    <p><a href="/search">Back to search</a></p>
  `,
  );
}

// Business outcome: the account exists but access is restricted.
export function renderRestricted(m: Member): string {
  return layout(
    "Access restricted",
    `
    <h1>Access restricted</h1>
    <p>Member <b>${m.id}</b> is restricted and cannot be serviced here.</p>
    <p><a href="/search">Back to search</a></p>
  `,
  );
}

// Recoverable / hard depending on where it hits: the session ended mid-flow.
export function renderSessionExpired(): string {
  return layout(
    "Session expired",
    `
    <h1>Session expired</h1>
    <p>Your session has ended. Please sign in again.</p>
    <p><a href="/login">Sign in</a></p>
  `,
  );
}

// CLEAN form with a confirmation step. This is the risky/irreversible action
// that the safety guardrails (Phase 4) and escalation (Phase 5) will care about.
export function renderSubAccountForm(m: Member, error?: string): string {
  return layout(
    "Open sub-account",
    `
    <h1>Open sub-account for ${m.name}</h1>
    ${error ? `<p class="error" role="alert">${error}</p>` : ""}
    <form method="post" action="/member/${m.id}/subaccount">
      <label for="type">Account type</label>
      <select id="type" name="type">
        <option value="savings">Savings</option>
        <option value="checking">Checking</option>
      </select>
      <label for="deposit">Opening deposit (USD)</label>
      <input type="number" id="deposit" name="deposit" min="0" step="0.01" value="0">
      <button type="submit" id="review">Review</button>
    </form>
  `,
  );
}

export function renderSubAccountConfirm(
  m: Member,
  type: string,
  deposit: string,
): string {
  return layout(
    "Confirm sub-account",
    `
    <h1>Confirm new sub-account</h1>
    <p>You are about to open a <b>${type}</b> sub-account for
      <b>${m.name}</b> (${m.id}) with an opening deposit of <b>$${deposit}</b>.</p>
    <form method="post" action="/member/${m.id}/subaccount/confirm">
      <input type="hidden" name="type" value="${type}">
      <input type="hidden" name="deposit" value="${deposit}">
      <button type="submit" id="confirm">Confirm and open</button>
    </form>
    <p><a href="/member/${m.id}">Cancel</a></p>
  `,
  );
}

export function renderSubAccountDone(m: Member, ref: string): string {
  return layout(
    "Sub-account opened",
    `
    <h1>Sub-account opened</h1>
    <p>Reference <b>${ref}</b> created for member <b>${m.id}</b>.</p>
    <p><a href="/member/${m.id}">Back to member</a></p>
  `,
  );
}
