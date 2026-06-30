require("dotenv").config();
// ============================================================
//  watchdog.js — Uptime Monitor for Backend, Frontend, DB
//  Temflo Systems | AWS Deployment Track | June 2026
// ============================================================
//
//  What this does (per Madhav's instruction in the meeting):
//    Checks every X minutes:
//      1. Is the backend reachable? (hits its own /health or / route)
//      2. Is the frontend reachable? (hits the AIMS frontend URL)
//      3. Is the database connected? (backend's /health route should
//         itself report DB status — see note below)
//    If anything is down, raises an AIMS incident directly.
//
//  Note on DB check:
//    As discussed in the meeting, DB connectivity is checked by the
//    backend itself (its /health route should return { db: "connected" }
//    or similar). This script just reads that field — it does NOT open
//    its own separate DB connection, to avoid duplicating logic.
//
//  Required .env variables:
//    BACKEND_HEALTH_URL=https://your-backend-domain/health
//    FRONTEND_URL=https://aims.erpica.in
//    AIMS_BASE_URL=https://aims.erpica.in/api/v1/public/incidents
//    AIMS_API_KEY=inc_xxxxxxxxxxxxxxxxxxxx
//    CHECK_INTERVAL_MINUTES=5   (optional, default 5)
//
//  How to run:
//    node watchdog.js
//  (Intended to run continuously, e.g. via PM2: pm2 start watchdog.js)
// ============================================================

const axios = require("axios");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const createAimsIncident = require("./aimsIncident");

const BACKEND_HEALTH_URL = process.env.BACKEND_HEALTH_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES) || 5;

// ── Backup heartbeat staleness check ────────────────────────────
// backup-s3.js (mongo-backup-repo) uploads a heartbeat.json to S3 after
// every run. If that heartbeat gets too old, it means the backup script
// itself has stopped firing (cron died, machine off, etc.) — not the same
// thing as "a backup attempt failed", which backup-s3.js already reports
// on its own. This catches the "didn't even run" case.
const S3_BUCKET = process.env.S3_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION || "ap-south-1";
const HEARTBEAT_S3_KEY = "heartbeats/backup-s3-heartbeat.json";
// Backup is expected to run roughly daily — flag it stale after 36h to give
// some slack (matches the example used while discussing this with Madhav).
const HEARTBEAT_STALE_AFTER_HOURS = Number(process.env.HEARTBEAT_STALE_AFTER_HOURS) || 36;
const s3 = new S3Client({ region: AWS_REGION });

if (!BACKEND_HEALTH_URL || !FRONTEND_URL) {
  console.error("[ERROR] BACKEND_HEALTH_URL and FRONTEND_URL must be set in .env");
  process.exit(1);
}

// Track state so we don't spam an incident every single check —
// only raise a new incident when status changes from "up" to "down".
let backendWasUp = true;
let frontendWasUp = true;
let dbWasUp = true;
let backupHeartbeatWasFresh = true;

async function checkBackend() {
  try {
    const res = await axios.get(BACKEND_HEALTH_URL, { timeout: 8000 });
    const isUp = res.status === 200;
    const dbStatus = res.data?.db; // expects backend's /health to report this

    if (!isUp && backendWasUp) {
      await createAimsIncident({
        title: "Backend is down",
        description: `Backend health check at ${BACKEND_HEALTH_URL} did not return 200.`,
        severity: "Critical",
        categoryName: "Backend",
        source: "watchdog",
      });
    }
    backendWasUp = isUp;

    // DB check piggybacks on backend's own reported DB status
    const dbIsUp = dbStatus !== "disconnected" && dbStatus !== false;
    if (!dbIsUp && dbWasUp) {
      await createAimsIncident({
        title: "Database connection lost",
        description: `Backend reports DB status as "${dbStatus}" via ${BACKEND_HEALTH_URL}.`,
        severity: "Critical",
        categoryName: "Database",
        source: "watchdog",
      });
    }
    dbWasUp = dbIsUp;

    console.log(`[watchdog] Backend: ${isUp ? "UP" : "DOWN"} | DB: ${dbIsUp ? "UP" : "DOWN"}`);
  } catch (err) {
    if (backendWasUp) {
      await createAimsIncident({
        title: "Backend is unreachable",
        description: `Could not reach backend at ${BACKEND_HEALTH_URL}. Error: ${err.message}`,
        severity: "Critical",
        categoryName: "Backend",
        source: "watchdog",
      });
    }
    backendWasUp = false;
    console.log("[watchdog] Backend: DOWN (unreachable)");
  }
}

async function checkFrontend() {
  try {
    const res = await axios.get(FRONTEND_URL, { timeout: 8000 });
    const isUp = res.status === 200;

    if (!isUp && frontendWasUp) {
      await createAimsIncident({
        title: "Frontend is down",
        description: `Frontend check at ${FRONTEND_URL} did not return 200.`,
        severity: "Critical",
        categoryName: "Frontend",
        source: "watchdog",
      });
    }
    frontendWasUp = isUp;
    console.log(`[watchdog] Frontend: ${isUp ? "UP" : "DOWN"}`);
  } catch (err) {
    if (frontendWasUp) {
      await createAimsIncident({
        title: "Frontend is unreachable",
        description: `Could not reach frontend at ${FRONTEND_URL}. Error: ${err.message}`,
        severity: "Critical",
        categoryName: "Frontend",
        source: "watchdog",
      });
    }
    frontendWasUp = false;
    console.log("[watchdog] Frontend: DOWN (unreachable)");
  }
}

async function checkBackupHeartbeat() {
  if (!S3_BUCKET) {
    console.log("[watchdog] S3_BUCKET_NAME not set — skipping backup heartbeat check.");
    return;
  }

  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: HEARTBEAT_S3_KEY })
    );
    const body = await res.Body.transformToString();
    const heartbeat = JSON.parse(body);

    const lastRunAt = new Date(heartbeat.lastRunAt);
    const hoursSinceLastRun = (Date.now() - lastRunAt.getTime()) / (1000 * 60 * 60);
    const isFresh = hoursSinceLastRun <= HEARTBEAT_STALE_AFTER_HOURS;

    if (!isFresh && backupHeartbeatWasFresh) {
      await createAimsIncident({
        title: "MongoDB S3 backup heartbeat is stale",
        description: `backup-s3.js last reported success at ${heartbeat.lastRunAt} (${hoursSinceLastRun.toFixed(
          1
        )}h ago), which is past the ${HEARTBEAT_STALE_AFTER_HOURS}h threshold. The backup script may have stopped running.`,
        severity: "Critical",
        categoryName: "Database",
        source: "watchdog",
      });
    }
    backupHeartbeatWasFresh = isFresh;

    console.log(
      `[watchdog] Backup heartbeat: ${isFresh ? "FRESH" : "STALE"} (last run ${hoursSinceLastRun.toFixed(1)}h ago, status: ${heartbeat.status})`
    );
  } catch (err) {
    // Heartbeat file missing entirely is itself a signal the backup has
    // never run (or the bucket/key is misconfigured) — treat as stale too.
    if (backupHeartbeatWasFresh) {
      await createAimsIncident({
        title: "MongoDB S3 backup heartbeat missing",
        description: `Could not read heartbeat from s3://${S3_BUCKET}/${HEARTBEAT_S3_KEY}. Error: ${err.message}`,
        severity: "High",
        categoryName: "Database",
        source: "watchdog",
      });
    }
    backupHeartbeatWasFresh = false;
    console.log("[watchdog] Backup heartbeat: STALE/MISSING (could not read from S3)");
  }
}

async function runChecks() {
  console.log(`\n[watchdog] Running checks at ${new Date().toISOString()}`);
  await checkBackend();
  await checkFrontend();
  await checkBackupHeartbeat();
}

// Run immediately, then on an interval
runChecks();
setInterval(runChecks, CHECK_INTERVAL_MINUTES * 60 * 1000);

console.log(`[watchdog] Started. Checking every ${CHECK_INTERVAL_MINUTES} minute(s).`);
