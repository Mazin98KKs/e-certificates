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
  1: "bestfriend_aamfqh",
  2: "malgof_egqihg",
  3: "kfoo_ncybxx",
  4: "lazy_vndi9i",
  5: "Mokaf7_vetjxx",
  6: "donothing_nvdhcx",
  7: "knoweverything_vppbsa",
  8: "friendly_e7szzo",
  9: "kingnegative_ak81hp",
  10: "lier_hyuisy",

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

  // If the user starts a new conversation, reset their session
  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(text.trim())) {
    session = { step: 'welcome', certificatesSent: 0 };
    userSessions[from] = session;
  }

  switch (session.step) {
    case 'welcome':
      // Use the "welcome" template instead of plain text
      await sendWelcomeTemplate(from);
      session.step = 'select_certificate';
      break;

    case 'select_certificate':
      const choice = parseInt(text.trim(), 10);
      if (choice >= 1 && choice <= 10) {
        session.selectedCertificate = choice;
        session.step = 'ask_recipient_name';

        // Ask for recipient's name first
        await sendWhatsAppText(from, "وش اسم الشخص اللي ودك ترسله الشهاده");
      } else {
        await sendWhatsAppText(from, "يرجى اختيار رقم صحيح من 1 إلى 10.");
      }
      break;

    case 'ask_recipient_name':
      if (text.trim()) {
        session.recipientName = text.trim();
        session.step = 'ask_recipient_number';

        // Ask for recipient's number
        await sendWhatsAppText(
          from,
          "ادخل رقم واتساب المستلم مع رمز الدولة \n" +
          "مثال: \n  عمان 96890000000 \n  966500000000 السعودية"
        );
      } else {
        await sendWhatsAppText(from, "يرجى إدخال اسم صحيح.");
      }
      break;

    case 'ask_recipient_number':
      // Validate number format (you can make this more rigorous)
      if (/^\d+$/.test(text.trim())) {
        session.recipientNumber = text.trim();
        session.step = 'confirm_send';

        await sendWhatsAppText(
          from,
          `سيتم إرسال الشهادة إلى ${session.recipientName}. هل تريد إرسالها الآن؟ (نعم/لا)`
        );
      } else {
        await sendWhatsAppText(
          from,
          "يرجى إدخال رقم صحيح يشمل رمز الدولة."
        );
      }
      break;

    case 'confirm_send':
      if (/^نعم$/i.test(text.trim())) {
        // Generate the Cloudinary image URL with the recipient’s name
        const certificateImageUrl = cloudinary.url(CERTIFICATE_PUBLIC_IDS[session.selectedCertificate], {
          transformation: [
            {
              overlay: {
                font_family: "Arial",
                font_size: 80, // Larger font size for clarity
                text: session.recipientName,
              },
              gravity: "center",
              y: 2,
            },
          ],
        });

        // Send the gift template with the Cloudinary image URL
        await sendCertificateTemplate(session.recipientNumber, session.recipientName, certificateImageUrl);
        session.certificatesSent++;

        await sendWhatsAppText(from, "تم إرسال الشهادة بنجاح.");
        session.step = 'ask_another';
        await sendWhatsAppText(from, "هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)");
      } else if (/^لا$/i.test(text.trim())) {
        await sendWhatsAppText(from, "تم إنهاء الجلسة. شكراً.");
        userSessions[from] = null;
      } else {
        await sendWhatsAppText(from, "يرجى الرد بـ (نعم/لا).");
      }
      break;

    case 'ask_another':
      if (/^نعم$/i.test(text.trim())) {
        session.step = 'welcome';
        await sendWelcomeTemplate(from);
      } else if (/^لا$/i.test(text.trim())) {
        await sendWhatsAppText(from, "تم إنهاء الجلسة. شكراً.");
        userSessions[from] = null;
      } else {
        await sendWhatsAppText(from, "يرجى الرد بـ (نعم/لا).");
      }
      break;

    default:
      await sendWhatsAppText(from, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
      userSessions[from] = { step: 'welcome', certificatesSent: 0 };
      break;
  }
}

/**
 * Send a template named "welcome" (Arabic) with 10 certificate options
 */
async function sendWelcomeTemplate(to) {
  try {
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: 'welcome',
          language: { code: 'ar' },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Template 'welcome' sent to ${to}`);
  } catch (error) {
    console.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

/**
 * Send a text message
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
 * Send the certificate template using WhatsApp's "gift" template
 */
async function sendCertificateTemplate(recipient, recipientName, certificateImageUrl) {
  try {
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: 'gift',
          language: { code: 'ar' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'image',
                  image: {
                    link: certificateImageUrl,
                  },
                },
              ],
            },
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: recipientName,
                },
              ],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Template 'gift' sent to ${recipient} with recipient name: ${recipientName}`);
  } catch (error) {
    console.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
