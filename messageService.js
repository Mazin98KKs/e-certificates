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
    logger.warn('Webhook verification failed. Invalid token or mode.');
    return res.sendStatus(403);
  }
  logger.warn('Webhook verification failed. Missing mode or token.');
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

  let session = await sessionService.getSession(normalizedFrom);

  // Check if session is new or user typed a greeting
  if (!session || /^(hello|hi|مرحبا|ابدأ)$/i.test(choice)) {
    session = { step: 'welcome', certificatesSent: 0 };
    await sessionService.setSession(normalizedFrom, session);
    logger.debug({
      event: 'SessionInitialized',
      user: normalizedFrom,
      session,
    });
  }

  switch (session.step) {
    case 'welcome':
      await sendWelcomeTemplate(normalizedFrom);
      session.step = 'select_certificate';
      await sessionService.setSession(normalizedFrom, session);
      logger.debug({
        event: 'StepTransition',
        user: normalizedFrom,
        from: 'welcome',
        to: 'select_certificate',
      });
      break;

    case 'select_certificate':
      {
        const certNumber = parseInt(choice, 10);
        logger.debug({
          event: 'SelectCertificate',
          user: normalizedFrom,
          selectedCertificate: certNumber,
        });

        if (certNumber >= 1 && certNumber <= 10) {
          session.selectedCertificate = certNumber;
          session.step = 'ask_recipient_name';
          await sessionService.setSession(normalizedFrom, session);
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
          await sessionService.setSession(normalizedFrom, session);
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
        // Basic check for digits only
        if (/^\d+$/.test(choice)) {
          session.recipientNumber = choice;
          session.step = 'confirm_send';
          await sessionService.setSession(normalizedFrom, session);
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
            await sessionService.setSession(normalizedFrom, session);
            await sendWhatsAppText(normalizedFrom, 'هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)');
          } else {
            // Create Stripe Checkout Session
            const stripeSessionUrl = await createStripeCheckoutSession(
              session.selectedCertificate,  // 1) certificateId
              normalizedFrom,              // 2) senderNumber
              session.recipientNumber,     // 3) recipientNumber
              session.recipientName        // 4) recipientName
            );

            if (stripeSessionUrl) {
              session.paymentPending = true;
              session.step = 'await_payment';
              await sessionService.setSession(normalizedFrom, session);
              await sendWhatsAppText(normalizedFrom, `لإتمام الدفع، الرجاء زيارة الرابط التالي: ${stripeSessionUrl}`);
            } else {
              await sendWhatsAppText(normalizedFrom, 'حدث خطأ في إنشاء جلسة الدفع. حاول مرة أخرى.');
            }
          }
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(normalizedFrom, 'تم إنهاء الجلسة. شكراً.');
          await sessionService.resetSession(normalizedFrom);
          logger.info({
            event: 'SessionReset',
            user: normalizedFrom,
            reason: 'User declined to send certificate.',
          });

          // Verify session reset
          const currentSession = await sessionService.getSession(normalizedFrom);
          if (!currentSession) {
            logger.info({
              event: 'SessionConfirmedReset',
              user: normalizedFrom,
            });
          } else {
            logger.warn({
              event: 'SessionNotResetProperly',
              user: normalizedFrom,
              session: currentSession,
            });
          }
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
          await sessionService.setSession(normalizedFrom, session);
          await sendWelcomeTemplate(normalizedFrom);
          logger.debug({
            event: 'StepTransition',
            user: normalizedFrom,
            from: 'ask_another',
            to: 'welcome',
          });
        } else if (/^لا$/i.test(choice)) {
          await sendWhatsAppText(normalizedFrom, 'تم إنهاء الجلسة. شكراً.');
          await sessionService.resetSession(normalizedFrom);
          logger.info({
            event: 'SessionReset',
            user: normalizedFrom,
            reason: 'User chose not to send another certificate.',
          });

          // Verify session reset
          const currentSession = await sessionService.getSession(normalizedFrom);
          if (!currentSession) {
            logger.info({
              event: 'SessionConfirmedReset',
              user: normalizedFrom,
            });
          } else {
            logger.warn({
              event: 'SessionNotResetProperly',
              user: normalizedFrom,
              session: currentSession,
            });
          }
        } else {
          await sendWhatsAppText(normalizedFrom, 'يرجى الرد بـ (نعم/لا).');
        }
      }
      break;

    default:
      {
        await sendWhatsAppText(normalizedFrom, "حدث خطأ. أرسل 'مرحبا' أو 'ابدأ' لتجربة جديدة.");
        await sessionService.resetSession(normalizedFrom);
        logger.warn({
          event: 'UnknownStep',
          user: normalizedFrom,
          sessionStep: session.step,
        });
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
    logger.info({
      event: 'TemplateSent',
      template: 'welcome',
      to,
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingTemplate',
      template: 'welcome',
      to,
      error: error.response?.data || error.message,
    });
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
    logger.info({
      event: 'TextSent',
      to,
      message,
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingText',
      to,
      message,
      error: error.response?.data || error.message,
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
    });
  } catch (error) {
    logger.error({
      event: 'ErrorSendingCertificate',
      to: recipient,
      certificateId,
      recipientName,
      error: error.response?.data || error.message,
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
