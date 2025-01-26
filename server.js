require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// Cloudinary configuration (reads CLOUDINARY_URL from environment variables)
cloudinary.config(true);

const app = express();
app.use(bodyParser.json());

// In-memory user sessions
const userSessions = {};

// Map of certificates to Cloudinary public IDs
const CERTIFICATE_PUBLIC_IDS = {
  1: "malgof_egqihg",
  2: "kfoo_ncybxx",
  3: "donothing_nvdhcx",
};

/**
 * Webhook Verification Endpoint
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
 * Webhook for Incoming WhatsApp Messages
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
      await sendWhatsAppText(
        from,
        "اختر الشهادة المراد إرسالها:\n1. شهادة الملقوف\n2. شهادة الكفو\n3. شهادة اللي مايسوي شي"
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

          // Send the certificate image using Cloudinary and WhatsApp API
          await sendCertificateImage(session.selectedCertificate, from, number, name);

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
 * Send the certificate image via WhatsApp using Cloudinary
 */
async function sendCertificateImage(selectedCertificate, sender, recipient, recipientName) {
  try {
    const publicId = CERTIFICATE_PUBLIC_IDS[selectedCertificate];
    if (!publicId) {
      throw new Error(`No Cloudinary public ID found for certificate ${selectedCertificate}`);
    }

    const imageUrl = cloudinary.url(publicId, {
      transformation: [
        {
          overlay: {
            font_family: "Arial",
            font_size: 40,
            text: recipientName,
          },
          gravity: "north",
          y: 80,
        },
      ],
    });

    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'image',
        image: { link: imageUrl },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`Sent certificate image to ${recipient}`);
  } catch (error) {
    console.error('Error sending certificate image:', error.response?.data || error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
