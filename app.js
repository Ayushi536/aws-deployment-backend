// app.js
// Main Express application
// Global error middleware handles ALL routes — Winston logs + incidentNotifier fires on 500

require("dotenv").config();

const express = require("express");
const logger = require("./logger");
const notifyIncident = require("./incidentNotifier");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─────────────────────────────────────────────
// Sample Routes (replace with your actual routes)
// ─────────────────────────────────────────────

// Health check route
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
    timestamp: new Date().toISOString(),
  });
});

// Test route — intentionally throws a 500 error to verify logging + notification
app.get("/test-error", (req, res, next) => {
  const err = new Error("Test error: something broke intentionally");
  err.status = 500;
  next(err); // passes to global error middleware below
});

// ─────────────────────────────────────────────
// Global Error Middleware
// Must be LAST — after all route definitions
// Handles errors from ALL routes automatically
// ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  const statusCode = err.status || 500;

  // Step 1: Log via Winston (always)
  logger.error({
    message:   err.message,
    route:     req.originalUrl,
    method:    req.method,
    stack:     err.stack,
    status:    statusCode,
    timestamp: new Date().toISOString(),
  });

  // Step 2: Fire incident notification (only on 500, non-blocking)
  if (statusCode === 500) {
    notifyIncident({
      title:      err.name || "Internal Server Error",
      route:      req.originalUrl,
      method:     req.method,
      statusCode: 500,
      error:      err.message,
      timestamp:  new Date().toISOString(),
    });
    // fire-and-forget — does NOT delay the response to the user
  }

  // Step 3: Send clean JSON response (no raw stack traces exposed)
  res.status(statusCode).json({
    error: "Something went wrong",
    ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
  });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} | ENV: ${process.env.NODE_ENV || "development"}`);
});

module.exports = app;
