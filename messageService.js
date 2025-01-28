/*************************************************************
 * messageservice.js
 * Handles WhatsApp conversation logic, messaging, and 
 * sending certificates via WhatsApp.
 *************************************************************/

const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const config = require('./config');
const { logger } = require('./logger');
const sessionService = require('./sessionservice');
const { createStripeCheckoutSession } = require('./paymentservice');

// Configure Cloudinary with your environment variables
cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

/** In-case you want to verify your webhook from Facebook side */
function handleWebhookVerification(req, res) {
  const VERIFY_TOKEN = config.verifyToken;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  return res.sendStatus(400);
}

/** Primary handler for incoming WhatsApp messages */
async function handleIncomingMessages(req, res) {
  try {
    if (req.body.object === 'whatsapp_business_account') {
      const entry = req.body.entry && req.body.entry[0];
      if (entry && entry.changes) {
        for (const change of entry.changes) {
          const value = change.value;
          if (!value.messages) continue;

          for (const message of value.messages) {
            const from = message.from;
            const text = message.text?.body || '';
            logger.info(`Incoming message from ${from}: ${text}`);

            // Handle the conversation flow
            await handleUserMessage(from, message);
          }
        }
      }
    }
    // Acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error('Error handling incoming message:', error);
    res.sendStatus(500);
  }
}

/*************************************************************
 * Conversation Flow + WhatsApp Send Logic
 *************************************************************/

// Certificate Public IDs (Cloudinary)
const CERTIFICATE_PUBLIC_IDS = {
  1: 'bestfriend_aamfqh',
  2: 'malgof_egqihg',
  3: 'kfoo_ncybxx',
  4: 'lazy_vndi9i',
  5: 'Mokaf7_vetjxx',
  6: 'donothing_nvdhcx',
  7: 'knoweverything_vppbsa',
  8: 'friendly_e7szzo',
  9: 'kingnegative_ak81hp',
  10: 'lier_hyuisy',
};

// Certificates 1 & 5 are free
const FREE_CERTIFICATES = [1, 5];

// Process user message based on their conversation step
async function handleUserMessage(from, message) {
  // Ensure 'choice' is always a string
  const choice = (
    message.interactive?.button_reply?.id ||  // Button reply ID if present
    message.text?.body ||                    // Text body if present
    ''
  ).trim();

  let session = sessionService.getSession(from);

  // Check if session is new or user typed a greeting
  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(choice)) {
    session = { step: 'welcome', certificatesSent: 0 };
    sessionService.setSession(from, session);
  }

  switch (session.step) {
    case 'welcome':
      await sendWelcomeTemplate(from);
      session.step = 'select_certificate';
      sessionService.setSession(from, session);
      break;

    case 'select_certificate':
      {
        const certNumber = parseInt(choice, 10);
        if (certNumber >= 1 && certNumber <= 10) {
          session.selectedCertificate = certNumber;
          session.step = 'ask_recipient_name';
          sessionService.setSession(from, session);
          await sendWhatsAppText(from, 'وش اسم الشخص اللي ودك ترسله الشهاده');
        } else {
          await sendWhatsAppText(from, 'يرجى اختيار رقم صحيح من 1 إلى 10.');
        }
      }
      break;

    case 'ask_recipient_name':
      {
        if (choice) {
          session.recipientName = choice;
          session.step = 'ask_recipient_number';
          sessionService.setSession(from, session);
          await sendWhatsAppText(
            from,
            'ادخل رقم واتساب المستلم مع رمز الدولة \nمثال: \n  عمان 96890000000 \n  966500000000 السعودية'
          );
        } else {
          await sendWhatsAppText(from, 'يرجى إدخال اسم صحيح.');
        }
      }
      break;

    case 'ask_recipient_number':
      {
        // Basic check for digits only
        if (/^\d+$/.test(choice)) {
          session.recipientNumber = choice;
          session.step = 'confirm_send';
          sessionService.setSession(from, session);
          await sendWhatsAppText(from, `سيتم إرسال الشهادة إلى ${session.recipientName}. هل تريد إرسالها الآن؟ (نعم/لا)`);
        } else {
          await sendWhatsAppText(from, 'يرجى إدخال رقم صحيح يشمل رمز الدولة.');
        }
      }
      break;

    case 'confirm_send':
      {
        if (/^نعم$/i.test(choice)) {
          // If it's a free certificate, send immediately
          if (FREE_CERTIFICATES.includes(session.selectedCertificate)) {
            await sendCertificateImage(
              session.recipientNumber,
              session.selectedCertificate,
              session.recipientName
            );
            session.certificatesSent += 1;
            await sendWhatsAppText(from, 'تم إرسال الشهادة بنجاح.');
            session.step = 'ask_another';
            sessionService.setSession(from, session);
            await sendWhatsAppText(from, 'هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)');
          } else {
            // Create Stripe Checkout Session
            const stripeSessionUrl = await createStripeCheckoutSession(
              session.selectedCertificate,  // 1) certificateId
              from,                        // 2) senderNumber
              session.recipientNumber,     // 3) recipientNumber
              session.recipientName        // 4) recipientName
            );

            if (stripeSessionUrl) {
              session.paymentPending = true;
              session.step = 'await_payment';
              sessionService.setSession(from, session);
              await sendWhatsAppText(from, `لإتمام الدفع، الرجاء زيارة الرابط التالي: ${stripeSessionUrl}`);
            } else {
              await sendWhatsAppText(from, 'حدث خطأ في إنشاء جلسة الدفع. حاول مرة أخرى.');
            }
          }
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(from, 'تم إنهاء الجلسة. شكراً.');
          sessionService.resetSession(from);
        } else {
          await sendWhatsAppText(from, 'يرجى الرد بـ (نعم/لا).');
        }
      }
      break;

    case 'await_payment':
      {
        // Just remind user we are waiting
        await sendWhatsAppText(from, 'ننتظر تأكيد الدفع...');
      }
      break;

    case 'ask_another':
      {
        if (/^نعم$/i.test(choice)) {
          session.step = 'welcome';
          sessionService.setSession(from, session);
          await sendWelcomeTemplate(from);
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(from, 'تم إنهاء الجلسة. شكراً.');
          sessionService.resetSession(from);
        } else {
          await sendWhatsAppText(from, 'يرجى الرد بـ (نعم/لا).');
        }
      }
      break;

    default:
      {
        await sendWhatsAppText(from, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
        sessionService.resetSession(from);
      }
      break;
  }
}

/*************************************************************
 * Sending WhatsApp Templates & Text
 *************************************************************/

/** Send a pre-defined "welcome" template */
async function sendWelcomeTemplate(to) {
  try {
    await axios.post(
      config.whatsappApiUrl,
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
          Authorization: `Bearer ${config.whatsappApiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`Template 'welcome' sent to ${to}`);
  } catch (error) {
    logger.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

/** Send a text message via WhatsApp */
async function sendWhatsAppText(to, message) {
  try {
    await axios.post(
      config.whatsappApiUrl,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${config.whatsappApiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`Sent text to ${to}: ${message}`);
  } catch (error) {
    logger.error('Error sending WhatsApp text:', error.response?.data || error.message);
  }
}

/** Send a certificate image (overlay recipient name on Cloudinary) */
async function sendCertificateImage(recipient, certificateId, recipientName) {
  const certificateImageUrl = cloudinary.url(CERTIFICATE_PUBLIC_IDS[certificateId], {
    transformation: [
      {
        overlay: {
          font_family: 'Arial',
          font_size: 80,
          text: recipientName,
        },
        gravity: 'center',
        y: -10,
      },
    ],
  });

  try {
    await axios.post(
      config.whatsappApiUrl,
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
          Authorization: `Bearer ${config.whatsappApiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`Certificate (ID: ${certificateId}) sent to ${recipient}`);
  } catch (error) {
    logger.error(
      `Error sending certificate image to ${recipient}:`,
      error.response?.data || error.message
    );
  }
}

/*************************************************************
 * Exports
 *************************************************************/
module.exports = {
  handleWebhookVerification,
  handleIncomingMessages,
  sendCertificateImage, // Exported for use in paymentservice.js
};
