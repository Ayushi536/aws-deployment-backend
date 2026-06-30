// aimsIncident.js
// Shared helper for raising incidents directly in AIMS.
// Same payload contract as Madhav's send_incident.py (create_incident()).
// This exact file should exist in BOTH repos (mongo-backup-repo AND
// aws-deployment-backend) so both speak the same format to AIMS.
//
// Required .env variables:
//   AIMS_BASE_URL=https://aims.erpica.in/api/v1/public/incidents
//   AIMS_API_KEY=inc_xxxxxxxxxxxxxxxxxxxx

const axios = require("axios");

/**
 * Raise an incident directly inside AIMS.
 * Mirrors send_incident.py's create_incident() field-for-field.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} [params.severity]      "Critical" | "High" | "Medium" | "Low"
 * @param {string} [params.occurredAt]    ISO 8601, defaults to now
 * @param {string} [params.categoryName]  e.g. "Database", "Backend"
 * @param {string} [params.source]        e.g. "backend-error-middleware", "backup-pipeline", "watchdog"
 * @param {string} [params.externalId]    your own reference id, for traceability
 * @param {boolean} [params.autoCreateCategory]
 */
async function createAimsIncident({
  title,
  description,
  severity = "Medium",
  occurredAt = new Date().toISOString(),
  categoryName,
  source,
  externalId,
  autoCreateCategory = true,
}) {
  const baseUrl = process.env.AIMS_BASE_URL;
  const apiKey = process.env.AIMS_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error("[aimsIncident] AIMS_BASE_URL or AIMS_API_KEY missing in .env — skipping incident creation.");
    return null;
  }

  const payload = { title, description, severity, occurredAt };
  if (categoryName) payload.categoryName = categoryName;
  if (source) payload.source = source;
  if (externalId) payload.externalId = externalId;
  if (autoCreateCategory) payload.autoCreateCategory = true;

  try {
    const res = await axios.post(baseUrl, payload, {
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });
    console.log(`[aimsIncident] Created: ${res.data?.incidentNumber || "(no number returned)"}`);
    return res.data;
  } catch (err) {
    // Never let a failed AIMS call crash the caller (backup script / error middleware / watchdog)
    console.error("[aimsIncident] Failed to create incident:", err.response?.data || err.message);
    return null;
  }
}

module.exports = createAimsIncident;
