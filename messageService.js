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
      logger.info({
        event: 'WebhookVerification',
        message: 'Webhook verified successfully.',
        timestamp: new Date().toISOString(),
      });
      return res.status(200).send(challenge);
    }
    logger.warn({
      event: 'WebhookVerificationFailed',
      message: 'Webhook verification failed. Invalid token or mode.',
      mode,
      token,
      timestamp: new Date().toISOString(),
    });
    return res.sendStatus(403);
  }
  logger.warn({
    event: 'WebhookVerificationFailed',
    message: 'Webhook verification failed. Missing mode or token.',
    timestamp: new Date().toISOString(),
  });
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
            logger.info({
              event: 'IncomingMessage',
              from,
              text,
              timestamp: new Date().toISOString(),
            });

            // Handle the conversation flow
            await handleUserMessage(from, message);
          }
        }
      }
    }
    // Acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error({
      event: 'HandleIncomingMessagesError',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
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

/**
 * Normalize phone numbers to ensure consistency.
 * Remove any leading '+' signs.
 * @param {string} phone 
 * @returns {string}
 */
function normalizePhone(phone) {
  return phone.replace(/^\+/, '');
}

// Process user message based on their conversation step
async function handleUserMessage(from, message) {
  // Normalize the phone number to ensure consistency
  const normalizedFrom = normalizePhone(from);

  // Ensure 'choice' is always a string
  const choice = (
    message.interactive?.button_reply?.id ||  // Button reply ID if present
    message.text?.body ||                    // Text body if present
    ''
  ).trim();

  logger.info({ event: 'HandleUserMessageStart', from: normalizedFrom, choice });

  let session = await sessionService.getSession(normalizedFrom);
  logger.info({ event: 'SessionRetrieved', from: normalizedFrom, session });

  // Check if session is new or user typed a greeting
  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(choice)) {
    session = { step: 'welcome', certificatesSent: 0 };
    await sessionService.setSession(normalizedFrom, session);
    logger.debug({
      event: 'SessionInitialized',
      user: normalizedFrom,
      session,
      timestamp: new Date().toISOString(),
    });
  }

  switch (session.step) {
    case 'welcome':
      logger.info({ event: 'StepWelcome', from: normalizedFrom });
      await sendWelcomeTemplate(normalizedFrom);
      session.step = 'select_certificate';
      await sessionService.setSession(normalizedFrom, session);
      break;

    // Add similar logging before and after every case
  }

  logger.info({ event: 'HandleUserMessageEnd', from: normalizedFrom });
}

// Add logs before sending a WhatsApp text
async function sendWhatsAppText(to, message) {
  logger.info({ event: 'SendWhatsAppTextStart', to, message });

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
    logger.info({ event: 'SendWhatsAppTextSuccess', to });
  } catch (error) {
    logger.error({ event: 'SendWhatsAppTextError', to, error: error.message });
  }
}

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
    logger.info({
      event: 'TemplateSent',
      template: 'welcome',
      to,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingTemplate',
      template: 'welcome',
      to,
      error: error.response?.data || error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/** Send a certificate image (overlay recipient name on Cloudinary) */
async function sendCertificateImage(recipient, certificateId, recipientName) {
  // Validate inputs
  if (!certificateId || !recipientName) {
    logger.error({
      event: 'InvalidCertificateData',
      certificateId,
      recipientName,
      message: 'Invalid certificateId or recipientName. Aborting certificate send.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const certificatePublicId = CERTIFICATE_PUBLIC_IDS[certificateId];

  // Validate certificatePublicId
  if (!certificatePublicId) {
    logger.error({
      event: 'MissingCertificatePublicId',
      certificateId,
      message: `No Cloudinary public ID found for certificate ID ${certificateId}. Aborting.`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Generate the certificate image URL with recipient's name
  const certificateImageUrl = cloudinary.url(certificatePublicId, {
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

  logger.debug({
    event: 'CertificateImageGenerated',
    recipient,
    certificateId,
    recipientName,
    certificateImageUrl,
    timestamp: new Date().toISOString(),
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
    logger.info({
      event: 'CertificateSent',
      to: recipient,
      certificateId,
      recipientName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingCertificate',
      to: recipient,
      certificateId,
      recipientName,
      error: error.response?.data || error.message,
      timestamp: new Date().toISOString(),
    });
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
