require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// In-memory user sessions
const userSessions = {};

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
  // Basic structure checks
  if (req.body.object === 'whatsapp_business_account') {
    const entry = req.body.entry && req.body.entry[0];
    if (entry && entry.changes) {
      const changes = entry.changes;
      for (const change of changes) {
        const value = change.value;
        if (!value.messages) continue;

        const messages = value.messages;
        for (const message of messages) {
          const from = message.from; // The sender's WhatsApp number
          const text = message.text?.body || '';
          console.log(`Incoming message from ${from}: ${text}`);

          await handleUserMessage(from, text);
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
async function handleUserMessage(from, text) {
  // Get or create user session
  let session = userSessions[from];
  if (!session) {
    session = { step: 'welcome' };
    userSessions[from] = session;
  }

  switch (session.step) {
    case 'welcome':
      // 1. Send welcome/select message
      await sendWhatsAppText(from, "Welcome! Please select a certificate:\n1. Free\n2. Paid");
      session.step = 'select_certificate';
      break;

    case 'select_certificate':
      if (/free/i.test(text) || text === '1') {
        session.certificateType = 'free';
        session.step = 'ask_details';
        await sendWhatsAppText(from, "Please provide the recipient's name and number, e.g.: John, 123456789");
      } else if (/paid/i.test(text) || text === '2') {
        session.certificateType = 'paid';
        session.step = 'ask_details';
        await sendWhatsAppText(from, "Please provide the recipient's name and number, e.g.: John, 123456789");
      } else {
        await sendWhatsAppText(from, "Invalid choice. Type '1' for Free or '2' for Paid.");
      }
      break;

    case 'ask_details':
      // Expecting user to provide "Name, Number"
      if (text.includes(',')) {
        const [name, number] = text.split(',').map(s => s.trim());
        if (name && number) {
          session.recipientName = name;
          session.recipientNumber = number;
          session.step = 'done';
          await sendWhatsAppText(from, `Got it. Certificate will be sent to ${name} at ${number}.`);
        } else {
          await sendWhatsAppText(from, "Please send in the format: Name, Number");
        }
      } else {
        await sendWhatsAppText(from, "Please send in the format: Name, Number");
      }
      break;

    case 'done':
      // Conversation is done. Optionally reset the session
      // userSessions[from] = null; // or some cleanup
      break;

    default:
      await sendWhatsAppText(from, "Something went wrong. Type 'Hello' or 'Hi' to restart.");
      // Reset session if stuck
      userSessions[from] = { step: 'welcome' };
      break;
  }
}

/**
 * 3) Send a simple WhatsApp text message
 */
async function sendWhatsAppText(to, message) {
  try {
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Sent text to ${to}: ${message}`);
  } catch (error) {
    console.error('Error sending WhatsApp text:', error.response?.data || error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
