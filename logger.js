/*************************************************************
 * logger.js
 * A simple logger utility. Feel free to replace with 
 * Winston, Pino, or any other logging library as needed.
 *************************************************************/

const logger = {
  info: (...args) => {
    console.log('[INFO]', ...args);
  },
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },
};

module.exports = { logger };
