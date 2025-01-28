/*************************************************************
 * sessionservice.js
 * Simple in-memory session management for user conversations.
 * For production, consider storing sessions in Redis/DB.
 *************************************************************/

const sessions = {}; // { [userId]: { step, ... } }
const { logger } = require('./logger');

/** Get session by user ID */
async function getSession(userId) {
  const session = sessions[userId];
  logger.debug({
    event: 'GetSession',
    userId,
    session: session || null,
  });
  return session;
}

/** Set (or update) session for user ID */
async function setSession(userId, sessionData) {
  sessions[userId] = sessionData;
  logger.debug({
    event: 'SetSession',
    userId,
    sessionData,
  });
}

/** Reset session (delete from memory) */
async function resetSession(userId) {
  delete sessions[userId];
  logger.info({
    event: 'ResetSession',
    userId,
    message: 'Session has been reset.',
  });

  // Verify session reset
  const currentSession = await getSession(userId);
  if (!currentSession) {
    logger.info({
      event: 'SessionConfirmedReset',
      userId,
      message: 'Confirmed session reset.',
    });
  } else {
    logger.warn({
      event: 'SessionNotResetProperly',
      userId,
      session: currentSession,
      message: 'Session was not reset properly.',
    });
  }
}

module.exports = {
  getSession,
  setSession,
  resetSession,
};
