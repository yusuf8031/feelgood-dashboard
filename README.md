# Feel Good Chiropractic — Dashboard (hosted)

Practice command center with a real **Sign in with Google** for Gmail + Calendar.

## Quickstart
```bash
cd feelgood-app
cp .env.example .env      # then paste your Google Client ID + Secret
npm install
npm start                 # open http://localhost:3000
```

You need Node 18+ and a Google OAuth client. Full step-by-step (including the Google Cloud setup, test-user mode, HIPAA, and deployment) is in **SETUP.md**.

## What works
- **Login** for multiple users, hashed passwords, file datastore (`data/db.json`)
- **Roles** — **Admin** (full control + user management) and **Staff** (limited to the screens the admin grants)
- **Users & Access** (admin) — add staff, set role, toggle which screens each can see, reset password, disable/delete
- **To-Do** — admin assigns tasks to any user; everyone checks off their own
- **Sign in with Google** (real OAuth; secret + tokens stay server-side)
- **Schedule** — your real Google Calendar, next 7 days
- **Voice typing** (🎤), **Add Patient**, lien/med-pay/cash tracking, attorney A/R

First run seeds an admin: **admin@feelgoodchiro.com / changeme123** — log in and change it under Users & Access.

> Email/Inbox is removed for now. It can be added back later by restoring the Gmail scope + endpoints.

## Files
- `server.js` — backend (OAuth + Calendar + Gmail endpoints)
- `public/index.html` — the dashboard UI (live data, demo fallback when not signed in)
- `.env.example` — config template
- `SETUP.md` — the full guide
