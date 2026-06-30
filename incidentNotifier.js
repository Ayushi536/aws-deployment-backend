// incidentNotifier.js
// Fires a direct AIMS incident (via aimsIncident.js) whenever a 500 error
// occurs in the backend. Replaces the old generic-webhook version.
//
// Required .env variables:
//   AIMS_BASE_URL=https://aims.erpica.in/api/v1/public/incidents
//   AIMS_API_KEY=inc_xxxxxxxxxxxxxxxxxxxx

const createAimsIncident = require("./aimsIncident");

/**
 * Called from app.js's global error middleware on every 500 error.
 * Keeps the same call signature as before so app.js doesn't need to change.
 */
async function notifyIncident({ title, route, method, statusCode, error, timestamp }) {
  await createAimsIncident({
    title: title || "Internal Server Error",
    description: `${method} ${route} failed with status ${statusCode}. Error: ${error}`,
    severity: statusCode >= 500 ? "High" : "Medium",
    occurredAt: timestamp,
    categoryName: "Backend",
    source: "backend-error-middleware",
    externalId: `${method}-${route}-${timestamp}`,
  });
  // createAimsIncident already catches its own errors and never throws,
  // so this stays fire-and-forget safe, same as before.
}

module.exports = notifyIncident;
