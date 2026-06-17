# Deploy the Feel Good Dashboard to a public link

Goal: turn this into a URL anyone can open (e.g. `https://feelgood-dashboard.onrender.com`) — no install for the doctor or staff.

This app is already deploy-ready: it includes `render.yaml` (Render blueprint), a `Dockerfile`, and a `Procfile`, and it reads its port and secrets from the host.

---

## Easiest path — Render (free tier), ~10 minutes

You need two free accounts: **GitHub** (to hold the code) and **Render** (to run it).

### 1. Put the code on GitHub
- Create a free account at github.com.
- New repository → name it `feelgood-dashboard` → Create.
- Upload the project: on the repo page click **"uploading an existing file"**, drag in everything from this `feelgood-app` folder **except** the `node_modules` and `data` folders, then Commit.
  *(Or, if you use GitHub Desktop, drop the folder in and Push.)*

### 2. Deploy on Render
- Create a free account at render.com and connect your GitHub.
- Click **New → Blueprint**, pick the `feelgood-dashboard` repo. Render reads `render.yaml` automatically and sets the app up.
- Set the two secrets it asks you to fill in:
  - `ADMIN_EMAIL` — the email you want for the first admin login.
  - `ADMIN_PASSWORD` — a strong password for that admin.
  - (Leave the `GOOGLE_*` ones blank for now unless you're wiring the calendar — see step 4.)
- Click **Apply / Create**. Render builds and starts it (a couple of minutes), then gives you a public URL.

### 3. Open it
Go to your new URL and log in with the admin email/password you set. Add staff under **Users & Access**. That's your live dashboard — share the URL with the team.

### 4. (Optional) Turn on the Google Calendar sign-in
- In Google Cloud Console → your OAuth client → **Authorized redirect URIs**, add:
  `https://YOUR-APP.onrender.com/auth/google/callback`
- In Render → your service → **Environment**, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` (that same callback URL). Save → it redeploys.

---

## Alternative — Railway
- railway.app → New Project → Deploy from GitHub repo → pick the repo.
- It auto-detects Node (uses the `Procfile`). Add the same environment variables under Variables.
- It gives you a public URL under Settings → Networking → Generate Domain.

---

## Two things to know about the free tier

1. **It sleeps when idle.** Free Render/Railway apps spin down after inactivity, so the first visit after a quiet period takes ~30 seconds to wake. Fine for a small practice; upgrade to a paid plan (~$7/mo) to keep it always-on.
2. **Data is not permanent on the free tier.** Accounts and to-dos live in `data/db.json`, and free hosts use a temporary disk that resets on each redeploy/restart. For permanent data, either add a **Render Disk** (paid) mounted at `/app/data`, or move to a managed **Postgres** database — I can wire the app to Postgres when you're ready. For a pilot/demo this is usually fine; just know a restart can clear users.

---

## Want me to drive it?
If you connect the Claude-in-Chrome extension and you're signed into GitHub + Render, I can click through the Render setup with you on your screen. You stay in control of the accounts and passwords; I just handle the steps.
