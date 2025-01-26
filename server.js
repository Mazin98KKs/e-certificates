require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// In-memory user sessions
const userSessions = {};
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * 1) Webhook Verification Endpoint
 */
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mysecrettoken';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  return res.sendStatus(400);
});

/**
 * 2) Webhook for Incoming WhatsApp Messages
 */
app.post('/webhook', async (req, res) => {
  if (req.body.object === 'whatsapp_business_account') {
    const entry = req.body.entry && req.body.entry[0];
    if (entry && entry.changes) {
      const changes = entry.changes;
      for (const change of changes) {
        const value = change.value;
        if (!value.messages) continue;

        const messages = value.messages;
        for (const message of messages) {
          const from = message.from;
          console.log(`Incoming message from ${from}`);

          // Handle user message and update session timestamp
          await handleUserMessage(from);
        }
      }
    }
  }

  // Acknowledge receipt of the webhook
  return res.sendStatus(200);
});

/**
 * Handle the conversation logic
 */
async function handleUserMessage(from) {
  let session = userSessions[from];
  const now = Date.now();

  if (!session) {
    // Create a new session
    session = { createdAt: now };
    userSessions[from] = session;
  } else {
    // Update the session timestamp
    session.createdAt = now;
  }

  // Send the initial welcome template
  await sendTemplateMessage(from, "welcome");

  // After user selects a button, send the next template
  // This logic is a placeholder and can be adjusted based on actual incoming messages or user choices
  await sendTemplateMessage(from, "recipient_details");
}

/**
 * Send a template message
 */
async function sendTemplateMessage(to, templateName) {
  try {
    const url = process.env.WHATSAPP_API_URL;

    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'ar' },
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Sent template "${templateName}" to ${to}`);
  } catch (error) {
    console.error(`Error sending template "${templateName}":`, error.response?.data || error.message);
  }
}

/**
 * Cleanup function to remove expired sessions
 */
function cleanupSessions() {
  const now = Date.now();
  for (const [user, session] of Object.entries(userSessions)) {
    if (now - session.createdAt > SESSION_TIMEOUT) {
      delete userSessions[user];
      console.log(`Session for user ${user} expired and was removed.`);
    }
  }
}

// Run the cleanup function every minute
setInterval(cleanupSessions, 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
