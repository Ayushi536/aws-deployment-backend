// incidentNotifier.js
// Fires an HTTP POST to your incident webhook (Slack / PagerDuty / OpsGenie / custom)
// whenever a 500 error occurs. Set INCIDENT_WEBHOOK_URL in your .env file.

const axios = require("axios");

async function notifyIncident({ title, route, method, statusCode, error, timestamp }) {
  try {
    await axios.post(process.env.INCIDENT_WEBHOOK_URL, {
      title,        // e.g. "Internal Server Error"
      route,        // e.g. "/api/users/profile"
      method,       // e.g. "POST"
      statusCode,   // e.g. 500
      error,        // e.g. "Cannot read property of undefined"
      timestamp,    // ISO string
    });

    console.log(`[incidentNotifier] Alert sent for ${method} ${route} at ${timestamp}`);
  } catch (notifyErr) {
    // Never crash the main app if the webhook call fails
    console.error("[incidentNotifier] Notification failed:", notifyErr.message);
  }
}

module.exports = notifyIncident;
