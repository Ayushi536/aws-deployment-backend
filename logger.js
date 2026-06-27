// logger.js
// Winston logger — logs errors to console + file (logs/error.log + logs/combined.log)
// Used in the global error middleware in app.js

const { createLogger, format, transports } = require("winston");
const path = require("path");

const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    // Print all logs to console (visible in PM2 logs too)
    new transports.Console(),

    // Write only error-level logs to error.log
    new transports.File({
      filename: path.join(__dirname, "logs/error.log"),
      level: "error",
    }),

    // Write all levels to combined.log
    new transports.File({
      filename: path.join(__dirname, "logs/combined.log"),
    }),
  ],
});

module.exports = logger;
