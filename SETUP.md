# Feel Good Chiropractic Dashboard — Setup & Launch Guide

This is the **hosted** version of the dashboard. Unlike the single-file demo, this one has a small backend so the **"Sign in with Google"** button is real — it pulls the practice's actual Google Calendar and Gmail, and the Google secret/token never touch the browser.

You do three things: (1) register a Google app, (2) drop two values into a config file, (3) run it. Below is every step.

---

## What's in this folder

```
feelgood-app/
  server.js          ← the backend (Google login + Calendar + Gmail APIs)
  package.json       ← dependencies
  .env.example       ← copy to ".env" and fill in your Google keys
  public/index.html  ← the dashboard (wired to the live backend, demo fallback if offline)
  SETUP.md           ← this file
```

## Architecture in one paragraph

The browser shows the dashboard. When the doctor clicks **Sign in with Google**, the browser goes to `/auth/google` on our server, which redirects to Google's real consent screen. After he approves, Google sends a code back to our server, the server exchanges it for tokens and keeps them in the server-side session. The dashboard then calls `/api/calendar` and `/api/gmail`, and the server uses those tokens to fetch the real data. The client secret and the user's tokens live only on the server — that's what makes it safe.

---

## Part 1 — Register the Google app (one time, ~20 minutes)

1. Go to **console.cloud.google.com** and sign in with the **practice** Google account.
2. Create a project (top bar → project dropdown → New Project). Name it `Feel Good Dashboard`.
3. **Enable the APIs:** APIs & Services → Library → enable **Google Calendar API**. (Gmail is not used in this build — email was removed for now.)
4. **OAuth consent screen:** APIs & Services → OAuth consent screen.
   - User type: **External**.
   - App name: `Feel Good Chiropractic`, support email, developer email.
   - **Scopes:** add `.../auth/calendar.readonly`.
   - **Test users:** add the practice's Google email (and any staff who'll log in). This is the key step — see Part 4.
   - Leave **Publishing status = Testing** for now.
5. **Create credentials:** APIs & Services → Credentials → Create Credentials → **OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add `http://localhost:3000/auth/google/callback` (for local testing) and later your real URL, e.g. `https://dashboard.feelgoodchiro.com/auth/google/callback`.
   - Click Create. Copy the **Client ID** and **Client secret**.

## Part 2 — Configure

1. In this folder, copy `.env.example` to a new file named `.env`.
2. Paste your **Client ID** and **Client secret** into it.
3. Set `SESSION_SECRET` to any long random string.
4. Make sure `GOOGLE_REDIRECT_URI` exactly matches the redirect URI you registered.

## Part 3 — Run it

You need **Node.js 18+** installed (nodejs.org).

```bash
cd feelgood-app
npm install
npm start
```

Open **http://localhost:3000**. Go to **Schedule** or **Inbox**, click **Sign in with Google**, approve, and you'll see the practice's real calendar and email. Compose and reply actually send.

---

## Part 3b — User accounts & roles

The dashboard has its own login (separate from the Google calendar connection). On first run the server **seeds an admin**:

- email: `admin@feelgoodchiro.com`  ·  password: `changeme123` (override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`)

Log in, then go to **Users & Access** (visible to admins only) to:

- **Add staff** — name, email, temporary password, role.
- **Set access per staff member** — toggle exactly which screens each person can open (Patients, Cash list, Med-Pay, Liens, Attorney A/R, Add Patient, Schedule, ECLIPSE Sync). Staff only see what you grant; admins see everything.
- **Reset password, disable, or delete** a user. (The primary admin can't be deleted.)

**To-Do:** admins assign tasks to any user and can filter by person; each user sees and checks off their own list.

Accounts, passwords (hashed with bcrypt), and to-dos are stored in `data/db.json`. For a bigger deployment, swap that file for Postgres/SQLite — the data access is isolated in `loadDB` / `saveDB` in `server.js`.

---

## Part 4 — The important part: Testing mode vs. full verification

Because **only the practice itself logs in** (not outside customers), you do **not** need Google's full app verification or the security audit. Here's the decision:

### Option A — Testing mode (recommended to start; free; works today)
- Keep the OAuth consent screen in **Testing** status and list the practice account(s) as **test users** (up to 100 allowed).
- The doctor can log in and use real Gmail + Calendar **immediately** — no review, no waiting, no cost.
- **One caveat:** in Testing mode, Google expires the saved login about every **7 days**, so the doctor will re-click "Sign in with Google" roughly once a week. Mildly annoying, totally workable for a single practice.

### Option B — Publish / verify (only if you outgrow testing or sell to other practices)
- Required if you want **outside users** (other clinics) to log in, or to remove the weekly re-login.
- Calendar is a **sensitive** scope, so Google does a **manual review** (demo video, justification): typically **4–6 weeks**.
- Good news: because email was removed, the app no longer uses a **restricted** scope (that was `gmail.send`), so the expensive **CASA security assessment (~$15k–$75k) no longer applies** — even at full scale. If email is added back later, CASA returns.
- **Bottom line:** you only wait for this if this becomes a product for many practices. For Feel Good's own use, stay on Option A.

---

## Part 5 — HIPAA (before real patient email)

Calendar entries and emails about patients are PHI, so:

- The practice should be on a **paid Google Workspace** plan (not a free `@gmail.com`) and **sign Google's BAA** (Admin console → Account → Legal & compliance). As of 2026 Google's BAA covers **Gmail and Google Calendar** on paid Workspace.
- Host this app somewhere reputable over **HTTPS**, keep the `.env` secret, and limit who has the login.
- Note Google's BAA covers Gmail/Calendar themselves; **this custom app is a separate "business associate"** in the chain, so for full real-patient production you'd want your own risk assessment and, ideally, a compliance/legal sign-off. (I'm not a lawyer — get the practice's compliance person to confirm the final setup.)

## Part 6 — Deploy to production (when ready)

1. Pick a host: **Render, Railway, Fly.io, or a small cloud VM** (all run Node; ~$0–20/month).
2. Set the same `.env` values as environment variables there, with `NODE_ENV=production` and the production `GOOGLE_REDIRECT_URI`.
3. Add that production redirect URI to the Google OAuth client (Part 1, step 5).
4. Put it behind HTTPS (the hosts above do this automatically) and point `dashboard.feelgoodchiro.com` at it.

---

## Cost summary

| Item | Cost |
|---|---|
| Google API usage (Calendar + Gmail) | Free within normal quotas |
| Running in Testing mode (single practice) | Free |
| App hosting | ~$0–20 / month |
| Google Workspace (for HIPAA BAA) | ~$14+/user/month (paid plan) |
| Full verification (only for outside customers) | Free — manual review, ~4–6 weeks. No CASA needed now that email is removed. |

For Feel Good's own use: essentially just **hosting + a paid Workspace plan**. The big numbers only apply if you turn this into a multi-practice product.

---

## Sources
- [Google — Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google OAuth verification: costs & timelines — Nylas](https://www.nylas.com/blog/google-oauth-app-verification/)
- [Google CASA security assessment overview — Deepstrike](https://deepstrike.io/blog/google-casa-security-assessment-2025)
- [Google Workspace HIPAA Included Functionality](https://workspace.google.com/terms/2015/1/hipaa_functionality/)
- [Is Google Workspace HIPAA compliant? — HIPAA Journal](https://www.hipaajournal.com/is-google-workspace-hipaa-compliant/)
