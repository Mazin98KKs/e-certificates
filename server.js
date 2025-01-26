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
  let session = userSessions[from];
  if (!session) {
    session = { step: 'welcome' };
    userSessions[from] = session;
  }

  switch (session.step) {
    case 'welcome':
      // Send message in Arabic with the three certificate options
      await sendWhatsAppText(
        from,
        "اختر الشهادة المراد إرسالها:\n1. شهادة الملقوف\n2. شهادة الكفو\n3. شهادة اللي المكافح"
      );
      session.step = 'select_certificate';
      break;

    case 'select_certificate':
      const choice = parseInt(text.trim(), 10);
      if (choice >= 1 && choice <= 3) {
        session.selectedCertificate = choice;
        session.step = 'ask_details';
        await sendWhatsAppText(
          from,
          "الرجاء إدخال اسم ورقم المستلم بصيغة: الاسم, الرقم\nمثال: أحمد, 123456789"
        );
      } else {
        await sendWhatsAppText(from, "يرجى اختيار رقم صحيح من 1 إلى 3.");
      }
      break;

    case 'ask_details':
      if (text.includes(',')) {
        const [name, number] = text.split(',').map((s) => s.trim());
        if (name && number) {
          session.recipientName = name;
          session.recipientNumber = number;
          session.step = 'done';

          // Send the certificate as a template message
          await sendCertificateTemplate(from, number, name);

          // Confirm to the sender
          await sendWhatsAppText(from, "تم إرسال الشهادة بنجاح.");
        } else {
          await sendWhatsAppText(from, "يرجى إرسال التفاصيل بالصيغ المرفقة.");
        }
      } else {
        await sendWhatsAppText(from, "يرجى إرسال التفاصيل بالصيغ المرفقة.");
      }
      break;

    case 'done':
      break;

    default:
      await sendWhatsAppText(from, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
      userSessions[from] = { step: 'welcome' };
      break;
  }
}

/**
 * Send a simple WhatsApp text message
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
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Sent text to ${to}: ${message}`);
  } catch (error) {
    console.error('Error sending WhatsApp text:', error.response?.data || error.message);
  }
}

/**
 * Send the certificate template
 */
async function sendCertificateTemplate(sender, recipient, recipientName) {
  try {
    const templateData = {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: {
        name: 'gift',
        language: { code: 'ar' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: recipientName }],
          },
        ],
      },
    };

    await axios.post(
      process.env.WHATSAPP_API_URL,
      templateData,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`Sent certificate template 'gift' to ${recipient} with recipient name: ${recipientName}`);
  } catch (error) {
    console.error('Error sending certificate template:', error.response?.data || error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
