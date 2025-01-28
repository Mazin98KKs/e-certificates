/*************************************************************
 * sessionservice.js
 * Simple in-memory session management for user conversations.
 * For production, consider storing sessions in Redis/DB.
 *************************************************************/

const sessions = {}; // { [userId]: { step, ... } }

/** Get session by user ID */
function getSession(userId) {
  return sessions[userId];
}

/** Set (or update) session for user ID */
function setSession(userId, sessionData) {
  sessions[userId] = sessionData;
}

/** Reset session (delete from memory) */
function resetSession(userId) {
  delete sessions[userId];
}

module.exports = {
  getSession,
  setSession,
  resetSession,
};
