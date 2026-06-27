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
| Incident Notification | `incidentNotifier.js` + `app.js` | Fires webhook on every 500 error (Slack/PagerDuty/OpsGenie) |

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
├── incidentNotifier.js        ← Fires HTTP POST to incident webhook on 500
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
- `INCIDENT_WEBHOOK_URL` — Slack / PagerDuty / OpsGenie / custom webhook URL

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
- `incidentNotifier.js` fires to your webhook

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
If 500 → incidentNotifier fires (non-blocking)
      ↓
Clean JSON response sent to user
```

**Zero changes needed in any route file.**  
Works for 10 routes or 10,000 routes — same single setup.

---

## CloudWatch Alerts (CPU / Memory) — Pending EC2 access

Setup steps are documented in `AWS_Deployment_Research_v4.docx` (Section 2).  
Requires AWS Console access to configure SNS topic + CloudWatch alarms.

---

## Stack

- Node.js + Express
- PM2 (process manager)
- Winston (error logging)
- axios (incident webhook HTTP calls)
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
| Incident Notifier (500 errors) | ✅ Code complete — needs live webhook URL |

*Ayushi Sharma — SDE Intern, Temflo Systems Pvt. Ltd.*
