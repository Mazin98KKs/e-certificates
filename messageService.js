const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { CERTIFICATE_PUBLIC_IDS } = require('./config');
const { getSession, setSession } = require('./sessionService');

/**
 * Handle incoming messages from WhatsApp
 * @param {string} from - The sender's WhatsApp number
 * @param {string} text - The message text
 */
async function handleIncomingMessage(from, text) {
  let session = getSession(from);

  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(text.trim())) {
    session = { step: 'welcome', certificatesSent: 0 };
    setSession(from, session);
  }

  switch (session.step) {
    case 'welcome':
      await sendWelcomeTemplate(from);
      session.step = 'select_certificate';
      break;

    // Other case logic here...

    default:
      await sendTextMessage(from, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
      setSession(from, { step: 'welcome', certificatesSent: 0 });
      break;
  }
}

/**
 * Send a WhatsApp text message
 * @param {string} to - The recipient's WhatsApp number
 * @param {string} message - The text message to send
 */
async function sendTextMessage(to, message) {
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
 * Send a welcome template
 * @param {string} to - The recipient's WhatsApp number
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

module.exports = { handleIncomingMessage, sendTextMessage, sendWelcomeTemplate };
