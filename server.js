/*
 * Feel Good Chiropractic — Practice Command Center (hosted backend)
 *
 * Includes:
 *   - Multi-user login with hashed passwords (bcryptjs) + a file datastore (data/db.json)
 *   - Two roles: "admin" (full control + user management + assign to-dos) and "staff" (limited, admin-chosen access)
 *   - Per-user to-do lists the admin can assign and everyone can check off
 *   - "Sign in with Google" for Google Calendar (read-only)
 *
 * Tokens and password hashes live only on the server. Swap data/db.json for
 * Postgres/SQLite in production — the data layer is isolated in loadDB/saveDB.
 *
 * See SETUP.md.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECT = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;

const ALL_SECTIONS = ['overview', 'schedule', 'patients', 'cash', 'medpay', 'liens', 'ar', 'intake', 'settings'];
const DEFAULT_STAFF_SECTIONS = ['overview', 'schedule', 'patients', 'cash', 'intake'];

// ---------- Data layer (file-backed; swap for a real DB in production) ----------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return { users: [], todos: [], seq: 1 }; }
}
function saveDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
let db = loadDB();
if (!db.lienStatus) db.lienStatus = {};   // { lienId: {status, note, by, at} } — firm-reported case status
function nextId() { db.seq = (db.seq || 1) + 1; return db.seq; }

// Outstanding-lien data (transcribed from the practice ledger; draft figures).
let LIENS = [];
let FIRM_PAID = {};
try { LIENS = JSON.parse(fs.readFileSync(path.join(__dirname, 'liens.json'), 'utf8')); } catch (e) { console.log('liens.json not found'); }
try { FIRM_PAID = JSON.parse(fs.readFileSync(path.join(__dirname, 'firm_paid.json'), 'utf8')); } catch (e) {}

// Seed the first admin on first run.
if (!db.users.length) {
  const email = (process.env.ADMIN_EMAIL || 'admin@feelgoodchiro.com').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || 'changeme123';
  db.users.push({
    id: 1, name: 'Administrator', email, role: 'admin',
    passHash: bcrypt.hashSync(pass, 10), active: true, sections: ALL_SECTIONS.slice()
  });
  // Demo law-firm portal logins (each sees only their own outstanding liens).
  db.users.push({ id: 2, name: 'Paboojian & Bell — portal', email: 'paboojian@firm.test', role: 'firm', firm: 'Paboojian & Bell, Inc.', passHash: bcrypt.hashSync('firm123', 10), active: true, sections: [] });
  db.users.push({ id: 3, name: 'Davis & VanWagenen — portal', email: 'vanwagenen@firm.test', role: 'firm', firm: 'Davis & VanWagenen', passHash: bcrypt.hashSync('firm123', 10), active: true, sections: [] });
  db.seq = 3;
  saveDB();
  console.log(`\n  Seeded first admin -> email: ${email}  password: ${pass}`);
  console.log('  Log in, then change this password under Users & Access.\n');
}

// ---------- App middleware ----------
app.set('trust proxy', 1); // needed so secure session cookies work behind a host proxy (Render/Railway)
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));
app.use(express.static(__dirname));

// ---------- Auth helpers ----------
function currentUser(req) { return db.users.find(u => u.id === req.session.uid && u.active); }
function pub(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, firm: u.firm || null,
           active: u.active, sections: u.role === 'admin' ? ALL_SECTIONS.slice() : (u.sections || []) };
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'not_logged_in' });
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  const u = currentUser(req);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  req.user = u; next();
}

// ---------- Auth routes ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.users.find(x => x.email === (email || '').toLowerCase() && x.active);
  if (!u || !bcrypt.compareSync(password || '', u.passHash))
    return res.status(401).json({ error: 'Invalid email or password' });
  req.session.uid = u.id;
  res.json({ user: pub(u) });
});
app.post('/api/auth/logout', (req, res) => { delete req.session.uid; res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? pub(u) : null });
});

// ---------- User management (admin) ----------
app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ users: db.users.map(pub) });
});
app.post('/api/users', requireAdmin, (req, res) => {
  const { name, email, password, role, sections, firm } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email & password required' });
  if (db.users.find(x => x.email === email.toLowerCase())) return res.status(400).json({ error: 'email already exists' });
  const rl = ['admin', 'firm'].includes(role) ? role : 'staff';
  const u = {
    id: nextId(), name: name || email, email: email.toLowerCase(),
    role: rl, firm: rl === 'firm' ? (firm || '') : '',
    passHash: bcrypt.hashSync(password, 10), active: true,
    sections: rl === 'staff' ? (Array.isArray(sections) ? sections : DEFAULT_STAFF_SECTIONS.slice()) : []
  };
  db.users.push(u); saveDB();
  res.json({ user: pub(u) });
});
app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id == req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const { name, role, active, sections, password, firm } = req.body || {};
  if (name != null) u.name = name;
  if (role != null) u.role = ['admin', 'firm'].includes(role) ? role : 'staff';
  if (firm != null) u.firm = firm;
  if (active != null) u.active = !!active;
  if (Array.isArray(sections)) u.sections = sections;
  if (password) u.passHash = bcrypt.hashSync(password, 10);
  saveDB();
  res.json({ user: pub(u) });
});
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (req.params.id == 1) return res.status(400).json({ error: 'cannot delete the primary admin' });
  db.users = db.users.filter(x => x.id != req.params.id);
  db.todos = db.todos.filter(t => t.assignedTo != req.params.id);
  saveDB();
  res.json({ ok: true });
});

// ---------- To-dos ----------
app.get('/api/todos', requireAuth, (req, res) => {
  let list = db.todos;
  if (req.user.role === 'admin') {
    if (req.query.user) list = list.filter(t => t.assignedTo == req.query.user);
  } else {
    list = list.filter(t => t.assignedTo === req.user.id);
  }
  res.json({ todos: list });
});
app.post('/api/todos', requireAuth, (req, res) => {
  const { title, assignedTo, due, notes } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const target = (req.user.role === 'admin' && assignedTo) ? Number(assignedTo) : req.user.id;
  const t = { id: nextId(), title, assignedTo: target, createdBy: req.user.id, done: false, due: due || '', notes: notes || '' };
  db.todos.push(t); saveDB();
  res.json({ todo: t });
});
app.patch('/api/todos/:id', requireAuth, (req, res) => {
  const t = db.todos.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && t.assignedTo !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const { done, title, due, notes, assignedTo } = req.body || {};
  if (done != null) t.done = !!done;
  if (title != null) t.title = title;
  if (due != null) t.due = due;
  if (notes != null) t.notes = notes;
  if (assignedTo != null && req.user.role === 'admin') t.assignedTo = Number(assignedTo);
  saveDB();
  res.json({ todo: t });
});
app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const t = db.todos.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && t.assignedTo !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.todos = db.todos.filter(x => x.id != t.id);
  saveDB();
  res.json({ ok: true });
});

// ---------- Google Calendar (Sign in with Google) ----------
function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT);
}
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email', 'profile'];

app.get('/auth/google', (req, res) => {
  res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES }));
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(req.query.code);
    req.session.gtokens = tokens;
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    req.session.gemail = me.data.email;
    res.redirect('/?gconnected=1');
  } catch (e) {
    res.redirect('/?gerror=' + encodeURIComponent(e.message));
  }
});
app.post('/auth/google/logout', (req, res) => { delete req.session.gtokens; delete req.session.gemail; res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ connected: !!req.session.gtokens, email: req.session.gemail || null }));

app.get('/api/calendar', (req, res) => {
  if (!req.session.gtokens) return res.status(401).json({ error: 'not_connected' });
  const client = oauthClient();
  client.setCredentials(req.session.gtokens);
  const cal = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  cal.events.list({
    calendarId: 'primary', timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 7 * 86400000).toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 50
  }).then(r => {
    res.json({
      events: (r.data.items || []).map(ev => ({
        id: ev.id, title: ev.summary || '(no title)',
        start: ev.start.dateTime || ev.start.date,
        end: ev.end && (ev.end.dateTime || ev.end.date),
        location: ev.location || ''
      }))
    });
  }).catch(e => res.status(500).json({ error: e.message }));
});

// ---------- Outstanding liens ----------
function visibleLiens(u) { return u.role === 'firm' ? LIENS.filter(l => l.firm === u.firm) : LIENS; }
function withStatus(l) { const s = db.lienStatus[l.id] || {}; return Object.assign({}, l, { status: s.status || '', statusNote: s.note || '', statusAt: s.at || '' }); }
app.get('/api/liens', requireAuth, (req, res) => {
  res.json({ liens: visibleLiens(req.user).map(withStatus), role: req.user.role, firm: req.user.firm || null });
});
app.post('/api/liens/:id/status', requireAuth, (req, res) => {
  const l = LIENS.find(x => x.id == req.params.id);
  if (!l) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'firm' && l.firm !== req.user.firm) return res.status(403).json({ error: 'forbidden' });
  const { status, note } = req.body || {};
  db.lienStatus[l.id] = { status: status || '', note: note || '', by: req.user.name, at: new Date().toISOString().slice(0, 10) };
  saveDB();
  res.json({ ok: true });
});
app.get('/api/liens/summary', requireAuth, (req, res) => {
  const ls = visibleLiens(req.user);
  const byFirm = {};
  ls.forEach(l => { const f = byFirm[l.firm] = byFirm[l.firm] || { firm: l.firm, count: 0, outstanding: 0 }; f.count++; f.outstanding += l.balance; });
  res.json({
    total: ls.reduce((s, l) => s + l.balance, 0),
    count: ls.length,
    firms: Object.keys(byFirm).length,
    byFirm: Object.values(byFirm).sort((a, b) => b.outstanding - a.outstanding),
    paid: req.user.role === 'firm' ? { [req.user.firm]: FIRM_PAID[req.user.firm] } : FIRM_PAID
  });
});

app.listen(PORT, () => {
  console.log(`Feel Good Chiropractic dashboard running on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log('NOTE: GOOGLE_CLIENT_ID not set — calendar sign-in is disabled until you add it (see SETUP.md). Login & to-dos still work.');
  }
});
