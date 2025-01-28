/**
 * Log a message to the console
 * @param {string} level - The log level (info, warn, error)
 * @param {string} message - The message to log
 * @param {object} [meta] - Additional metadata to log
 */
function log(level, message, meta = {}) {
  console.log(`[${level.toUpperCase()}] ${message}`, meta);
}

module.exports = { log };
