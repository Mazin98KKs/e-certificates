/*************************************************************
 * paymentservice.js
 * Handles Stripe checkout session creation and webhook events.
 *************************************************************/

const stripe = require('stripe');
const axios = require('axios');
const crypto = require('crypto');

const config = require('./config');
const { logger } = require('./logger');
const sessionService = require('./sessionservice'); // Ensure correct import
const { sendCertificateImage } = require('./messageservice');

// Initialize Stripe with your secret key
const stripeClient = stripe(config.stripeSecretKey);

// Map of certificates to Stripe Price IDs
const certificateToPriceMap = {
  2: 'price_1Qlw3YBH45p3WHSs6t7GT3cc',
  3: 'price_1QlwCPBH45p3WHSsOJPIV4ck',
  4: 'price_1QlwBMBH45p3WHSsLhUpZIiJ',
  6: 'price_1QlwBhBH45p3WHSshaMTmMgO',
  7: 'price_1QlwCjBH45p3WHSsIkSlJpNl',
  8: 'price_1QlwB3BH45p3WHSsO1DoVyn3',
  9: 'price_1QlwAGBH45p3WHSst46YVwME',
  10: 'price_1QlwAiBH45p3WHSsmU4G4EXn',
};

// In-memory store to track processed webhook events (for idempotency)
const processedEvents = new Set();

/**
 * Normalize phone numbers to ensure consistency.
 * Remove any leading '+' signs.
 * @param {string} phone 
 * @returns {string}
 */
function normalizePhone(phone) {
  return phone.replace(/^\+/, '');
}

/**
 * Create Stripe checkout session for paid certificates
 * Returns the URL for the user to complete payment.
 */
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  const priceId = certificateToPriceMap[certificateId];
  if (!priceId) {
    logger.error(`No Stripe price found for certificate ${certificateId}.`);
    return null;
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        { price: priceId, quantity: 1 },
      ],
      mode: 'payment',
      metadata: {
        senderNumber: normalizePhone(senderNumber),
        recipientNumber: normalizePhone(recipientNumber),
        certificateId: String(certificateId), // Ensure it's a string
        recipientName,
      },
      success_url: `https://wa.me/16033040262`,
      cancel_url: `https://wa.me/16033040262`,
    });

    logger.info(`Stripe session created for certificate ${certificateId}, sender ${senderNumber}`);
    return session.url;
  } catch (error) {
    logger.error('Error creating Stripe checkout session:', error.message);
    return null;
  }
}

/**
 * Handle Stripe webhook for checkout.session.completed and checkout.session.async_payment_succeeded
 * This is where we send the certificate to the recipient and reset the user session.
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Verify the event came from Stripe
    event = stripeClient.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
  } catch (err) {
    logger.error('Signature verification error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Check if the event type is one we care about
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    logger.warn(`Unhandled event type ${event.type}`);
    return res.sendStatus(200);
  }

  // Idempotency check: prevent processing the same event multiple times
  if (processedEvents.has(event.id)) {
    logger.warn(`Duplicate event received: ${event.id}. Skipping processing.`);
    return res.sendStatus(200);
  }

  // Handle the relevant event types
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata || {};

    // Check if all required metadata exists
    if (!senderNumber || !recipientNumber || !certificateId || !recipientName) {
      logger.warn('Webhook event has missing metadata. Skipping certificate sending.');
      return res.sendStatus(200);
    }

    logger.info(`Payment completed! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}`);

    try {
      // 1) Send the certificate to the recipient
      await sendCertificateImage(recipientNumber, certificateId, recipientName);
      logger.info(`Certificate sent to ${recipientNumber}`);

      // 2) Notify the sender
      await axios.post(
        config.whatsappApiUrl,
        {
          messaging_product: 'whatsapp',
          to: senderNumber,
          type: 'text',
          text: {
            body: `شكراً للدفع! الشهادة تم إرسالها بنجاح إلى ${recipientName}.`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${config.whatsappApiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      logger.info(`Payment confirmation sent to ${senderNumber}`);

      // 3) Reset the user's session to end the conversation
      await sessionService.resetSession(senderNumber);
      logger.info(`Session reset for ${senderNumber}`);

      // 4) Mark the event as processed
      processedEvents.add(event.id);
      logger.info(`Event ${event.id} marked as processed.`);
    } catch (error) {
      logger.error(`Error during webhook processing for sender ${senderNumber}:`, error.response?.data || error.message);
      // Optionally, handle retries or notify admins
    }
  }

  // Respond to Stripe to acknowledge receipt of the event
  res.sendStatus(200);
}

module.exports = {
  createStripeCheckoutSession,
  handleStripeWebhook,
};
