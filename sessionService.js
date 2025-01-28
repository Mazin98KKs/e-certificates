/*************************************************************
 * sessionservice.js
 * Simple in-memory session management for user conversations.
 * For production, consider storing sessions in Redis/DB.
 *************************************************************/

const sessions = {}; // { [userId]: { step, ... } }

/** Get session by user ID */
async function getSession(userId) {
  return sessions[userId];
}

/** Set (or update) session for user ID */
async function setSession(userId, sessionData) {
  sessions[userId] = sessionData;
}

/** Reset session (delete from memory) */
async function resetSession(userId) {
  delete sessions[userId];
}

module.exports = {
  getSession,
  setSession,
  resetSession,
};
