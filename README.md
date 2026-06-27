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

### 2. Make PM2 survive server reboots

```bash
pm2 startup
# Copy and run the exact command PM2 outputs

pm2 save
# Saves current process list — restored on every reboot
```

### 3. Verify

```bash
pm2 list              # should show status: online
pm2 logs              # real-time logs
curl http://localhost:3000   # should return { status: "ok" }
```

---

## Auto-Deploy via GitHub Actions

Every push to `main` automatically deploys to EC2.

### GitHub Secrets to set (Settings → Secrets → Actions)

| Secret | Value |
|---|---|
| `EC2_HOST` | Public IP of your EC2 instance |
| `EC2_USER` | SSH username (usually `ubuntu`) |
| `EC2_PRIVATE_KEY` | Full contents of your `.pem` key file |

Once set, every `git push origin main` triggers:
1. SSH into EC2
2. `git pull origin main`
3. `npm install --production`
4. `pm2 reload` (zero downtime)

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
