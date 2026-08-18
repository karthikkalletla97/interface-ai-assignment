import express from 'express';
import session from 'express-session';
import { CREDENTIALS, findMember } from './data';
import {
  renderLogin,
  renderSearch,
  renderMemberDetail,
  renderNotFound,
  renderRestricted,
  renderSessionExpired,
  renderSubAccountForm,
  renderSubAccountConfirm,
  renderSubAccountDone,
} from './views';

declare module 'express-session' {
  interface SessionData {
    user?: string;
    expired?: boolean;
  }
}

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: 'mock-bank-demo-not-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 30 },
  }),
);

// Auth guard. Distinguishes three states deliberately:
//  - session was explicitly expired  -> session-expired screen (recoverable/hard)
//  - never signed in                 -> login screen
//  - signed in                       -> continue
function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (req.session.expired) {
    return res.status(440).send(renderSessionExpired());
  }
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

app.get('/', (_req, res) => res.redirect('/search'));

app.get('/login', (_req, res) => res.send(renderLogin()));

app.post('/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
    req.session.user = username;
    req.session.expired = false;
    return res.redirect('/search');
  }
  res.status(401).send(renderLogin('Invalid username or password.'));
});

app.get('/search', requireAuth, (_req, res) => res.send(renderSearch()));

// Member lookup. This one route fans out into several outcomes on purpose.
app.get('/member', requireAuth, (req, res) => {
  const raw = (req.query.id as string | undefined) ?? '';
  const id = raw.trim();

  // Validation error: empty input is a business outcome the caller must handle,
  // not an exception. Re-render the search screen with an inline message.
  if (!id) {
    return res.status(400).send(renderSearch('Please enter a member id.'));
  }

  const member = findMember(id);
  if (!member) {
    return res.status(404).send(renderNotFound(id));
  }
  if (member.status === 'restricted') {
    return res.status(403).send(renderRestricted(member));
  }

  // Interstitial: member 100004 ships a blocking notice until ?dismiss=1.
  if (member.interstitial && req.query.dismiss !== '1') {
    return res.send(renderMemberDetail(member));
  }
  return res.send(renderMemberDetail({ ...member, interstitial: undefined }));
});

app.get('/member/:id', requireAuth, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) return res.status(404).send(renderNotFound(req.params.id));
  if (member.status === 'restricted') return res.status(403).send(renderRestricted(member));
  const showNotice = member.interstitial && req.query.dismiss !== '1';
  return res.send(renderMemberDetail(showNotice ? member : { ...member, interstitial: undefined }));
});

// Risky action flow: form -> confirm -> commit.
app.get('/member/:id/subaccount', requireAuth, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) return res.status(404).send(renderNotFound(req.params.id));
  res.send(renderSubAccountForm(member));
});

app.post('/member/:id/subaccount', requireAuth, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) return res.status(404).send(renderNotFound(req.params.id));
  const { type, deposit } = req.body as { type?: string; deposit?: string };
  const amount = Number(deposit);
  if (!type || Number.isNaN(amount) || amount < 0) {
    return res.status(400).send(renderSubAccountForm(member, 'Enter a valid deposit amount.'));
  }
  res.send(renderSubAccountConfirm(member, type, amount.toFixed(2)));
});

app.post('/member/:id/subaccount/confirm', requireAuth, (req, res) => {
  const member = findMember(req.params.id);
  if (!member) return res.status(404).send(renderNotFound(req.params.id));
  const ref = 'SUB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  res.send(renderSubAccountDone(member, ref));
});

// Dev-only controls so replay can trigger conditions deterministically.
// These stand in for things that happen unpredictably in a real system.
app.post('/dev/expire', (req, res) => {
  req.session.expired = true;
  req.session.user = undefined;
  res.json({ ok: true, expired: true });
});

app.post('/dev/restore', (req, res) => {
  req.session.expired = false;
  req.session.user = CREDENTIALS.username;
  res.json({ ok: true, restored: true });
});

app.listen(PORT, () => {
  console.log(`Mock bank running at http://localhost:${PORT}`);
});
