require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// Middleware to parse JSON
app.use(bodyParser.json());

// In-memory store for received details
// (For production, replace with a proper database)
const storedDetails = [];

// Webhook Verification Endpoint
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'mysecrettoken';

  // Extract the verification parameters from the query string
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check the mode and token sent by Meta
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Token matches, respond with the challenge
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      // Token did not match
      res.sendStatus(403); // Forbidden
    }
  } else {
    // Required parameters are missing
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
        const text = message.text?.body; // Message content

        console.log(`Received message from ${from}: ${text}`);

        // Send the recipient_details template to the user
        try {
          await sendTemplateMessage(from, 'recipient_details');
        } catch (err) {
          console.error(`Failed to send template message to ${from}`);
        }

        // For demonstration, assume user replies with "Name, PhoneNumber"
        if (text && text.includes(',')) {
          const [name, phoneNumber] = text.split(',').map((item) => item.trim());

          if (name && phoneNumber) {
            // Store the details
            storedDetails.push({ from, name, phoneNumber });
            console.log(`Stored details: ${name}, ${phoneNumber}`);
          }
        }
      }
    }
  }

  // Acknowledge the webhook event
  res.sendStatus(200);
});

// Function to send a WhatsApp template message
async function sendTemplateMessage(to, templateName) {
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
      language: { code: 'en_US' },
    },
  };

  try {
    const response = await axios.post(process.env.WHATSAPP_API_URL, payload, { headers });
    console.log(`Template message "${templateName}" sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('Error sending template message:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// Endpoint to view stored details (for testing purposes)
app.get('/stored-details', (req, res) => {
  res.json(storedDetails);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
