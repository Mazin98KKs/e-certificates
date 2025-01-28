// In-memory user sessions
const userSessions = {};

/**
 * Get a session by user ID
 * @param {string} userId - The ID of the user
 * @returns {object|null} The user's session or null if not found
 */
function getSession(userId) {
  return userSessions[userId] || null;
}

/**
 * Set a session for a user
 * @param {string} userId - The ID of the user
 * @param {object} sessionData - The session data to store
 */
function setSession(userId, sessionData) {
  userSessions[userId] = sessionData;
}

/**
 * Delete a session for a user
 * @param {string} userId - The ID of the user
 */
function deleteSession(userId) {
  delete userSessions[userId];
}

module.exports = { getSession, setSession, deleteSession };
