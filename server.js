/*************************************************************
 * server.js
 * Handles WhatsApp Business API interactions, Stripe payments,
 * certificate generation via Cloudinary, session management,
 * and structured logging.
 *************************************************************/

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const stripeLib = require('stripe');
const winston = require('winston');
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Load environment variables from .env file
require('dotenv').config();

// Configuration
const config = {
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  whatsappApiUrl: process.env.WHATSAPP_API_URL, // e.g., 'https://graph.facebook.com/v13.0/your_phone_number_id/messages'
  whatsappApiToken: process.env.WHATSAPP_API_TOKEN, // Bearer token
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  verifyToken: process.env.VERIFY_TOKEN || 'mysecrettoken',
  successUrl: 'https://e-certificates.onrender.com/success.html', // Minimal handler
  cancelUrl: 'https://e-certificates.onrender.com/cancel.html',   // Minimal handler
  
};

// Initialize Logger
const logger = winston.createLogger({
  level: 'debug', // Adjust as needed (info, warn, error)
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Initialize Cloudinary
cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

// Initialize Stripe
const stripe = stripeLib(config.stripeSecretKey);

// Initialize Express App
const app = express();

// Middleware to parse JSON bodies for WhatsApp messages
app.use('/whatsapp-messages', bodyParser.json());

// Middleware to parse raw body for Stripe webhooks
app.use('/stripe-webhook', bodyParser.raw({ type: 'application/json' }));

// In-memory session store (for development; use Redis or DB for production)
const sessions = {};

/**
 * Certificate Mappings
 */

// Certificate Public IDs (for Cloudinary)
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

// Stripe Price IDs for Paid Certificates
const CERTIFICATE_TO_PRICE_MAP = {
  2: 'price_1Qlw3YBH45p3WHSs6t7GT3cc',
  3: 'price_1QlwCPBH45p3WHSsOJPIV4ck',
  4: 'price_1QlwBMBH45p3WHSsLhUpZIiJ',
  6: 'price_1QlwBhBH45p3WHSshaMTmMgO',
  7: 'price_1QlwCjBH45p3WHSsIkSlJpNl',
  8: 'price_1QlwB3BH45p3WHSsO1DoVyn3',
  9: 'price_1QlwAGBH45p3WHSst46YVwME',
  10: 'price_1QlwAiBH45p3WHSsmU4G4EXn',
};

// Free Certificates (No payment required)
const FREE_CERTIFICATES = [1, 5];

/**
 * Utility Functions
 */

/**
 * Normalize phone numbers by removing any leading '+' signs.
 * @param {string} phone 
 * @returns {string}
 */
function normalizePhone(phone) {
  return phone.replace(/^\+/, '');
}

/**
 * Send a text message via WhatsApp API
 * @param {string} to - Recipient phone number
 * @param {string} message - Text message to send
 */
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
    logger.error({
      event: 'SendWhatsAppTextError',
      to,
      error: error.response?.data || error.message,
    });
  }
}

/**
 * Send a WhatsApp template message
 * @param {string} to - Recipient phone number
 * @param {string} templateName - Template name to send
 * @param {Array} components - Template components (optional)
 */
async function sendWhatsAppTemplate(to, templateName, components = []) {
  logger.info({ event: 'SendWhatsAppTemplateStart', to, templateName });

  try {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'ar' },
      },
    };

    if (components.length > 0) {
      payload.template.components = components;
    }

    await axios.post(
      config.whatsappApiUrl,
      payload,
      {
        headers: {
          Authorization: `Bearer ${config.whatsappApiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info({ event: 'SendWhatsAppTemplateSuccess', to, templateName });
  } catch (error) {
    logger.error({
      event: 'SendWhatsAppTemplateError',
      to,
      templateName,
      error: error.response?.data || error.message,
    });
  }
}

/**
 * Send a certificate image via WhatsApp
 * @param {string} recipient - Recipient phone number
 * @param {number} certificateId - ID of the certificate
 * @param {string} recipientName - Name of the certificate recipient
 */
async function sendCertificateImage(recipient, certificateId, recipientName) {
  logger.info({
    event: 'SendCertificateImageStart',
    recipient,
    certificateId,
    recipientName,
  });

  // Validate inputs
  if (!certificateId || !recipientName) {
    logger.error({
      event: 'InvalidCertificateData',
      certificateId,
      recipientName,
      message: 'Invalid certificateId or recipientName. Aborting certificate send.',
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
  });

  try {
    await sendWhatsAppTemplate(recipient, 'gift', [
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
    ]);
    logger.info({
      event: 'CertificateSent',
      recipient,
      certificateId,
      recipientName,
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingCertificate',
      recipient,
      certificateId,
      recipientName,
      error: error.response?.data || error.message,
    });
  }
}

/**
 * Create Stripe Checkout Session for paid certificates
 * @param {number} certificateId 
 * @param {string} senderNumber 
 * @param {string} recipientNumber 
 * @param {string} recipientName 
 * @returns {string|null} - Stripe Checkout URL or null on failure
 */
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  logger.info({
    event: 'CreateStripeCheckoutSessionStart',
    certificateId,
    senderNumber,
    recipientNumber,
    recipientName,
  });

  const priceId = CERTIFICATE_TO_PRICE_MAP[certificateId];
  if (!priceId) {
    logger.error({
      event: 'CreateStripeCheckoutSessionNoPriceId',
      certificateId,
      message: `No Stripe price ID found for certificate ID ${certificateId}.`,
    });
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: { senderNumber, recipientNumber, certificateId, recipientName },
      success_url: config.successUrl, // Minimal handler
      cancel_url: config.cancelUrl,   // Minimal handler
    });
    logger.info({
      event: 'CreateStripeCheckoutSessionSuccess',
      sessionId: session.id,
      url: session.url,
    });
    return session.url;
  } catch (error) {
    logger.error({
      event: 'CreateStripeCheckoutSessionError',
      error: error.message,
    });
    return null;
  }
}

/**
 * Handle incoming WhatsApp messages and manage conversation flow
 * @param {string} from - Sender's phone number
 * @param {object} message - Message object from WhatsApp
 */
async function handleIncomingMessage(from, message) {
  const normalizedFrom = normalizePhone(from);
  const choice = (
    message.interactive?.button_reply?.id || // Button reply ID if present
    message.text?.body ||                  // Text body if present
    ''
  ).trim();

  logger.info({
    event: 'HandleIncomingMessageStart',
    from: normalizedFrom,
    choice,
  });

  let session = sessions[normalizedFrom];
  logger.debug({ event: 'SessionRetrieved', from: normalizedFrom, session });

  // Check if session is new or user typed a greeting
  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(choice)) {
    session = { step: 'welcome', certificatesSent: 0 };
    sessions[normalizedFrom] = session;
    logger.info({ event: 'SessionInitialized', from: normalizedFrom, session });
  }

  switch (session.step) {
    case 'welcome':
      logger.info({ event: 'StepWelcome', from: normalizedFrom });
      await sendWhatsAppTemplate(normalizedFrom, 'wel_sel');
      session.step = 'select_certificate';
      break;

    case 'select_certificate':
      {
        const certNumber = parseInt(choice, 10);
        logger.info({
          event: 'SelectCertificate',
          from: normalizedFrom,
          selectedCertificate: certNumber,
        });

        if (certNumber >= 1 && certNumber <= 10) {
          session.selectedCertificate = certNumber;
          session.step = 'ask_recipient_name';
          await sendWhatsAppText(normalizedFrom, 'وش اسم الشخص اللي ودك ترسله الشهاده');
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى اختيار رقم صحيح من 1 إلى 10.');
        }
      }
      break;

    case 'ask_recipient_name':
      {
        if (choice) {
          session.recipientName = choice;
          session.step = 'ask_recipient_number';
          await sendWhatsAppText(
            normalizedFrom,
            'ادخل رقم واتساب المستلم مع رمز الدولة \nمثال: \n  عمان 96890000000 \n  966500000000 السعودية'
          );
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى إدخال اسم صحيح.');
        }
      }
      break;

    case 'ask_recipient_number':
      {
        // Basic validation: digits only and reasonable length
        if (/^\d{10,15}$/.test(choice)) {
          session.recipientNumber = choice;
          session.step = 'confirm_send';
          await sendWhatsAppText(normalizedFrom, `سيتم إرسال الشهادة إلى ${session.recipientName}. هل تريد إرسالها الآن؟ (نعم/لا)`);
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى إدخال رقم صحيح يشمل رمز الدولة.');
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
            await sendWhatsAppText(normalizedFrom, 'تم إرسال الشهادة بنجاح.');
            session.step = 'ask_another';
            await sendWhatsAppText(normalizedFrom, 'هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)');
          } else {
            // Create Stripe Checkout Session
            const stripeSessionUrl = await createStripeCheckoutSession(
              session.selectedCertificate,
              normalizedFrom,
              session.recipientNumber,
              session.recipientName
            );

            if (stripeSessionUrl) {
              session.paymentPending = true;
              session.step = 'await_payment';
              await sendWhatsAppText(normalizedFrom, `لإتمام الدفع، الرجاء زيارة الرابط التالي: ${stripeSessionUrl}`);
            } else {
              await sendWhatsAppText(normalizedFrom, 'حدث خطأ في إنشاء جلسة الدفع. حاول مرة أخرى.');
            }
          }
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(normalizedFrom, 'تم إنهاء الجلسة. شكراً.');
          delete sessions[normalizedFrom];
          logger.info({ event: 'SessionReset', from: normalizedFrom, reason: 'User declined to send certificate.' });
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى الرد بـ (نعم/لا).');
        }
      }
      break;

    case 'await_payment':
      {
        // Remind user that payment is being processed
        await sendWhatsAppText(normalizedFrom, 'ننتظر تأكيد الدفع...');
      }
      break;

    case 'ask_another':
      {
        if (/^نعم$/i.test(choice)) {
          session.step = 'welcome';
          await sendWhatsAppTemplate(normalizedFrom, 'wel_sel');
          logger.info({ event: 'StepTransition', from: normalizedFrom, to: 'welcome' });
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(normalizedFrom, 'تم إنهاء الجلسة. شكراً.');
          delete sessions[normalizedFrom];
          logger.info({ event: 'SessionReset', from: normalizedFrom, reason: 'User chose not to send another certificate.' });
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى الرد بـ (نعم/لا).');
        }
      }
      break;

    default:
      {
        await sendWhatsAppText(normalizedFrom, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
        delete sessions[normalizedFrom];
        logger.warn({
          event: 'UnknownStep',
          from: normalizedFrom,
          step: session.step,
          message: 'Unknown conversation step encountered. Session has been reset.',
        });
      }
      break;
  }

  // Update the session
  sessions[normalizedFrom] = session;
  logger.debug({ event: 'SessionUpdated', from: normalizedFrom, session });
}

/**
 * Create Stripe Checkout Session for paid certificates
 * @param {number} certificateId 
 * @param {string} senderNumber 
 * @param {string} recipientNumber 
 * @param {string} recipientName 
 * @returns {string|null} - Stripe Checkout URL or null on failure
 */
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  logger.info({
    event: 'CreateStripeCheckoutSessionStart',
    certificateId,
    senderNumber,
    recipientNumber,
    recipientName,
  });

  const priceId = CERTIFICATE_TO_PRICE_MAP[certificateId];
  if (!priceId) {
    logger.error({
      event: 'CreateStripeCheckoutSessionNoPriceId',
      certificateId,
      message: `No Stripe price ID found for certificate ID ${certificateId}.`,
    });
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: { senderNumber, recipientNumber, certificateId, recipientName },
      success_url: config.successUrl, // Minimal handler
      cancel_url: config.cancelUrl,   // Minimal handler
    });
    logger.info({
      event: 'CreateStripeCheckoutSessionSuccess',
      sessionId: session.id,
      url: session.url,
    });
    return session.url;
  } catch (error) {
    logger.error({
      event: 'CreateStripeCheckoutSessionError',
      error: error.message,
    });
    return null;
  }
}

/**
 * Handle Stripe webhooks
 */
app.post('/stripe-webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    logger.info({ event: 'StripeWebhookReceived', type: event.type });
  } catch (err) {
    logger.error({ event: 'StripeWebhookError', message: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata || {};

    logger.info({
      event: 'StripeWebhookSessionCompleted',
      senderNumber,
      recipientNumber,
      certificateId,
      recipientName,
    });

    if (senderNumber && recipientNumber && certificateId && recipientName) {
      try {
        await sendCertificateImage(recipientNumber, certificateId, recipientName);
        await sendWhatsAppText(senderNumber, `شكراً للدفع! الشهادة تم إرسالها بنجاح إلى ${recipientName}.`);
        // Reset the user's session
        delete sessions[senderNumber];
        logger.info({ event: 'SessionReset', from: senderNumber, reason: 'Payment completed and certificate sent.' });
      } catch (error) {
        logger.error({ event: 'StripeWebhookProcessingError', message: error.message, stack: error.stack });
      }
    } else {
      logger.warn({
        event: 'StripeWebhookMissingMetadata',
        session,
        message: 'Missing required metadata fields.',
      });
    }
  } else {
    logger.info({ event: 'StripeWebhookUnhandledEvent', type: event.type });
  }

  // Return a response to acknowledge receipt of the event
  res.sendStatus(200);
});

/**
 * Handle incoming WhatsApp messages and manage conversation flow
 */
app.post('/whatsapp-messages', async (req, res) => {
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
            logger.info({ event: 'IncomingMessage', from, text });

            // Handle the conversation flow
            await handleIncomingMessage(from, message);
          }
        }
      }
    }
    // Acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error({ event: 'HandleIncomingMessagesError', message: error.message, stack: error.stack });
    res.sendStatus(500);
  }
});

/**
 * Handle webhook verification (for Facebook/WhatsApp)
 */
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = config.verifyToken;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      logger.info({ event: 'WebhookVerification', message: 'Webhook verified successfully.' });
      return res.status(200).send(challenge);
    }
    logger.warn({ event: 'WebhookVerificationFailed', message: 'Invalid token or mode.', mode, token });
    return res.sendStatus(403);
  }
  logger.warn({ event: 'WebhookVerificationFailed', message: 'Missing mode or token.' });
  res.sendStatus(400);
});

/**
 * Minimal success URL handler
 */
app.get('/payment-success', (req, res) => {
  logger.info({ event: 'PaymentSuccessRedirect', message: 'User was redirected to payment-success page.' });
  res.send('شكراً على الدفع! يمكنك العودة إلى التطبيق لإكمال العمليات.');
});

/**
 * Minimal cancel URL handler
 */
app.get('/payment-cancel', (req, res) => {
  logger.info({ event: 'PaymentCancelRedirect', message: 'User was redirected to payment-cancel page.' });
  res.send('تم إلغاء الدفع. يمكنك العودة إلى التطبيق لإعادة المحاولة.');
});

/**
 * Start the server
 */
app.listen(config.port, () => {
  logger.info({ event: 'ServerStarted', port: config.port, timestamp: new Date().toISOString() });
});
