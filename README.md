# AWS Deployment Backend

Production-ready Node.js/Express backend deployed on AWS EC2 with PM2.  
Covers auto-deploy, crash recovery, error logging, and real-time incident alerts.

---

## What this covers

| Feature | File / Tool | Description |
|---|---|---|
| Auto-Deploy | `.github/workflows/deploy.yml` | GitHub push → EC2 auto-deploy via SSH |
| PM2 Crash Recovery | `ecosystem.config.js` | App survives crashes and server reboots |
| Global Error Logging | `logger.js` + `app.js` | Winston logs every error with route, stack, timestamp |
| Incident Notification | `incidentNotifier.js` + `aimsIncident.js` | Backend 500 errors raise an incident **directly in AIMS** (no longer a generic webhook) |
| Uptime Watchdog | `watchdog.js` | Pings backend `/health` + frontend, reads DB status from the backend's own response, and checks the mongo-backup repo's S3 heartbeat for staleness |

---

## Project Structure

```
aws-deployment-backend/
├── .github/
│   └── workflows/
│       └── deploy.yml         ← GitHub Actions auto-deploy
├── logs/                      ← Winston log files (gitignored)
├── app.js                     ← Main Express app + global error middleware
├── logger.js                  ← Winston logger setup
├── incidentNotifier.js        ← Calls AIMS incident API directly on backend errors
├── aimsIncident.js            ← Shared helper, raises incidents in AIMS (same copy lives in mongo repo)
├── watchdog.js                ← Uptime monitor: backend, frontend, DB, and backup heartbeat staleness
├── ecosystem.config.js        ← PM2 config (crash recovery + reboot survival)
├── .env.example               ← Copy to .env and fill in values
├── .gitignore
└── package.json
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
copy .env.example .env
```

Then open `.env` and set:

- `PORT` — port to run the server on (default: 3000)
- `NODE_ENV` — `production` on EC2
- `AIMS_BASE_URL` — AIMS incident API base URL (`https://aims.erpica.in/api/v1/public/incidents`)
- `AIMS_API_KEY` — AIMS API key (must match the value used in the mongo-backup repo)
- `BACKEND_HEALTH_URL`, `FRONTEND_URL`, `CHECK_INTERVAL_MINUTES` — used by `watchdog.js`
- `S3_BUCKET_NAME`, `AWS_REGION`, `HEARTBEAT_STALE_AFTER_HOURS` — used by `watchdog.js` to check the backup heartbeat (must match the S3 bucket/region used in the mongo-backup repo)

---

## Running locally

```bash
# Development (with nodemon)
npm run dev

# Production
npm start
```

Hit `GET /test-error` to trigger a test 500 error and verify that:
- Winston writes to `logs/error.log`
- `incidentNotifier.js` fires and creates an incident directly in AIMS

To run the watchdog (separately, ideally under PM2 too):

```bash
node watchdog.js
# or: pm2 start watchdog.js
```

---

## EC2 Deployment (One-time setup)

### 1. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
```

### 2. Register PM2 as a system service

By default, PM2 restarts the app if it **crashes**. But if the EC2 server itself **reboots** (e.g. AWS maintenance, power cycle), PM2 does not start automatically — the app stays down until someone SSH's in and starts it manually.

`pm2 startup` fixes this by registering PM2 as a system-level service (like a daemon), so the OS automatically starts PM2 — and PM2 starts your app — every time the server boots.

```bash
pm2 startup
```

PM2 will print a `sudo` command specific to your server's OS. **Copy that exact command and run it.** It looks something like:

```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Do not type this manually — always use the one PM2 prints for your machine.

### 3. Save the current process list

`pm2 startup` makes PM2 start on boot, but PM2 needs to know **which apps** to start. `pm2 save` takes a snapshot of all currently running PM2 processes and saves it to disk. On every reboot, PM2 reads this snapshot and restores exactly those processes.

```bash
pm2 save
```

> **Important:** Run `pm2 save` every time you add or remove an app from PM2. If you start a new process but forget to run `pm2 save`, it won't be restored after a reboot.

### 4. Verify

```bash
pm2 list              # should show status: online
pm2 logs              # real-time logs
curl http://localhost:3000   # should return { status: "ok" }
```

---

## Auto-Deploy via GitHub Actions

Every push to `main` automatically deploys to EC2. The workflow in `.github/workflows/deploy.yml` SSH's into the EC2 instance and runs `git pull` + `npm install` + `pm2 reload` — all without any manual work.

### Step 1 — Add GitHub Secrets

GitHub Actions needs to SSH into your EC2 instance. Instead of hardcoding credentials in the workflow file (which is public), GitHub lets you store them as encrypted **Secrets** that the workflow reads at runtime.

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret** and add these three:

| Secret | What to put | Where to find it |
|---|---|---|
| `EC2_HOST` | Public IP of your EC2 instance | AWS Console → EC2 → Instances → your instance → Public IPv4 address |
| `EC2_USER` | SSH username | Usually `ubuntu` for Ubuntu-based EC2 instances |
| `EC2_PRIVATE_KEY` | Full contents of your `.pem` key file | Open the `.pem` file in a text editor, copy everything including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` |

> **Why Secrets and not the workflow file directly?** The `deploy.yml` is committed to the repo and visible to anyone. Secrets are encrypted and only injected into the workflow at runtime — they are never exposed in logs or code.

### Step 2 — Push to main

Once secrets are set, every `git push origin main` automatically triggers:

1. GitHub spins up a runner (Ubuntu VM)
2. SSH's into your EC2 using the secrets
3. Runs `git pull origin main`
4. Runs `npm install --production`
5. Runs `pm2 reload` — zero downtime, existing connections are not dropped

---

## Global Error Middleware — How it works

The key design: `incidentNotifier` and Winston are both inside the **one global error middleware** in `app.js`.

```
Any route crash
      ↓
next(err) called automatically by Express
      ↓
Global middleware (app.js — last app.use)
      ↓
Winston logs it → logs/error.log
      ↓
If 500 → incidentNotifier fires → aimsIncident.js → AIMS (non-blocking)
      ↓
Clean JSON response sent to user
```

**Zero changes needed in any route file.**
Works for 10 routes or 10,000 routes — same single setup.

`incidentNotifier.js` keeps the same function signature as before (`notifyIncident({ title, route, method, statusCode, error, timestamp })`), so `app.js` needed no changes to switch from a generic webhook to calling AIMS directly — only `incidentNotifier.js`'s internals changed.

---

## Watchdog — `watchdog.js`

Runs continuously (intended to be started under PM2: `pm2 start watchdog.js`), checking every `CHECK_INTERVAL_MINUTES` (default 5):

1. **Backend** — pings `BACKEND_HEALTH_URL`. Down → AIMS incident.
2. **Frontend** — pings `FRONTEND_URL`. Down → AIMS incident.
3. **Database** — read from the backend's own `/health` response (`{ db: "connected" | "disconnected" }`) rather than opening a separate DB connection, per Madhav's instruction. Disconnected → AIMS incident.
4. **Backup heartbeat staleness** — reads `heartbeats/backup-s3-heartbeat.json` from the same S3 bucket `backup-s3.js` (mongo-backup repo) writes to. If the last successful backup run is older than `HEARTBEAT_STALE_AFTER_HOURS` (default 36h), or the heartbeat is missing entirely, raises an AIMS incident. This catches the case where the backup *script itself stopped running* (cron died, machine off) — different from a backup attempt that ran and failed, which `backup-s3.js` already reports on its own.

All four checks only raise a new incident on a state change (up→down, fresh→stale), not on every poll, to avoid incident spam. All four use the same shared `aimsIncident.js` helper as `incidentNotifier.js`.

---

## CloudWatch Alerts (CPU / Memory) — Pending EC2 access

Setup steps are documented in `AWS_Deployment_Research_v4.docx` (Section 2).  
Requires AWS Console access to configure SNS topic + CloudWatch alarms.

---

## Stack

- Node.js + Express
- PM2 (process manager)
- Winston (error logging)
- axios (AIMS API calls)
- `@aws-sdk/client-s3` (reading the backup heartbeat from S3)
- AWS EC2 (Ubuntu)
- GitHub Actions (CI/CD)
- `.env` for secrets

---

## Status

| Section | Status |
|---|---|
| GitHub Actions Auto-Deploy | Pending — needs EC2 + GitHub Secrets |
| CloudWatch CPU/Memory Alerts | Pending — needs AWS Console |
| PM2 Crash Recovery | ✅ Verified locally |
| Winston Error Logging | ✅ Verified locally |
| Incident Notifier → AIMS directly | ✅ Code complete; AIMS API key still needs confirmation (real vs. placeholder) |
| Watchdog (backend/frontend/DB) | ✅ Built, not yet tested against production endpoints |
| Watchdog backup-heartbeat check | ✅ Built and locally syntax-checked; not yet tested end-to-end with a real S3 bucket |

*Ayushi Sharma — SDE Intern, Temflo Systems Pvt. Ltd.*