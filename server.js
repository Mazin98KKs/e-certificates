require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// Middleware to parse JSON
app.use(bodyParser.json());

// Webhook Verification Endpoint
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mysecrettoken';

  // Extract the verification parameters from the query string
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check the mode and token sent by Meta
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403); // Forbidden
    }
  } else {
    res.sendStatus(400); // Bad Request
  }
});

// Webhook to handle inbound WhatsApp messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  // Check if the webhook event is from WhatsApp
  if (body.object === 'whatsapp_business_account' && body.entry) {
    const changes = body.entry[0]?.changes || [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];

      for (const message of messages) {
        const from = message.from; // Sender's phone number
        console.log(`Received message from ${from}:`, message.text?.body || 'No text content');

        // Send the Arabic "welcome" template with buttons
        try {
          await sendTemplateMessage(from, 'welcome', 'ar');
          console.log(`Sent "welcome" template to ${from}`);
        } catch (err) {
          console.error(`Failed to send template to ${from}:`, err.message);
        }
      }
    }
  }

  // Acknowledge the webhook event
  res.sendStatus(200);
});

// Function to send a WhatsApp template message
async function sendTemplateMessage(to, templateName, languageCode = 'en_US') {
  const headers = {
    'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  try {
    const response = await axios.post(process.env.WHATSAPP_API_URL, payload, { headers });
    console.log(`Template message "${templateName}" sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('Error sending template message:', error.response?.data || error.message);
    throw error;
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
