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
function nextId() { db.seq = (db.seq || 1) + 1; return db.seq; }

// Seed the first admin on first run.
if (!db.users.length) {
  const email = (process.env.ADMIN_EMAIL || 'admin@feelgoodchiro.com').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || 'changeme123';
  db.users.push({
    id: 1, name: 'Administrator', email, role: 'admin',
    passHash: bcrypt.hashSync(pass, 10), active: true, sections: ALL_SECTIONS.slice()
  });
  db.seq = 1;
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
  return { id: u.id, name: u.name, email: u.email, role: u.role,
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
  const { name, email, password, role, sections } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email & password required' });
  if (db.users.find(x => x.email === email.toLowerCase())) return res.status(400).json({ error: 'email already exists' });
  const u = {
    id: nextId(), name: name || email, email: email.toLowerCase(),
    role: role === 'admin' ? 'admin' : 'staff',
    passHash: bcrypt.hashSync(password, 10), active: true,
    sections: Array.isArray(sections) ? sections : DEFAULT_STAFF_SECTIONS.slice()
  };
  db.users.push(u); saveDB();
  res.json({ user: pub(u) });
});
app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const u = db.users.find(x => x.id == req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const { name, role, active, sections, password } = req.body || {};
  if (name != null) u.name = name;
  if (role != null) u.role = role === 'admin' ? 'admin' : 'staff';
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

app.listen(PORT, () => {
  console.log(`Feel Good Chiropractic dashboard running on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log('NOTE: GOOGLE_CLIENT_ID not set — calendar sign-in is disabled until you add it (see SETUP.md). Login & to-dos still work.');
  }
});
