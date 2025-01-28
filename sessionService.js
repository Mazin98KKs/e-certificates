// Add logs before and after retrieving a session
async function getSession(userId) {
  logger.info({ event: 'GetSessionStart', userId });
  const session = sessions[userId];
  logger.info({ event: 'GetSessionEnd', userId, session });
  return session;
}

// Add logs before and after setting a session
async function setSession(userId, sessionData) {
  logger.info({ event: 'SetSessionStart', userId, sessionData });
  sessions[userId] = sessionData;
  logger.info({ event: 'SetSessionEnd', userId, sessionData });
}

// Add logs before and after resetting a session
async function resetSession(userId) {
  logger.info({ event: 'ResetSessionStart', userId });
  delete sessions[userId];
  logger.info({ event: 'ResetSessionEnd', userId });
}
