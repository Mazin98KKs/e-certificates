require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// Middleware to parse JSON
app.use(bodyParser.json());

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
          await sendArabicTemplate(from);
          console.log(`Sent "welcome" template to ${from}`);
        } catch (err) {
          console.error(`Failed to send template to ${from}:`, err.message);
        }

        // Log user’s response to the template
        if (message.type === 'button') {
          const userResponse = message.button?.payload;
          console.log(`User responded with button payload: ${userResponse}`);
        }
      }
    }
  }

  // Acknowledge the webhook event
  res.sendStatus(200);
});

// Function to send a ready-made Arabic template with buttons
async function sendArabicTemplate(to) {
  const headers = {
    'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'welcome', // Ensure this matches your Arabic template name
      language: { code: 'ar' }, // Arabic language code
    },
  };

  await axios.post(process.env.WHATSAPP_API_URL, payload, { headers });
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
