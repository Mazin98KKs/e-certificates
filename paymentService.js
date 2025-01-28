/*************************************************************
 * paymentservice.js
 * Handles Stripe checkout session creation and webhook events.
 *************************************************************/

const stripe = require('stripe');
const axios = require('axios');
const sessionService = require('./sessionservice');

const config = require('./config');
const { logger } = require('./logger');
const { sendCertificateImage } = require('./messageservice');
 

// Initialize Stripe
const stripeClient = stripe(config.stripeSecretKey);

// Map of certificate to Stripe Price IDs
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
        senderNumber,     // must match the second argument
        recipientNumber,  // third
        certificateId,    // first
        recipientName,    // fourth
      },
      success_url: 'https://wa.me/16033040262',
      cancel_url: 'https://wa.me/16033040262',
    });

    logger.info(`Stripe session created for certificate ${certificateId}, sender ${senderNumber}`);
    return session.url;
  } catch (error) {
    logger.error('Error creating Stripe checkout session:', error.message);
    return null;
  }
}

/**
 * Handle Stripe webhook for checkout.session.completed
 * This is where we send the certificate to the recipient.
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
  } catch (err) {
    logger.error('Signature verification error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata || {};

    // If metadata is missing or partial, skip to avoid the Cloudinary error
    if (!senderNumber || !recipientNumber || !certificateId || !recipientName) {
      logger.warn('checkout.session.completed event has missing metadata. Skipping certificate sending.');
      return res.sendStatus(200);
    }

    logger.info(`Payment completed! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}`);

    // 1) Send the certificate to the recipient
    await sendCertificateImage(recipientNumber, certificateId, recipientName);

    // 2) Notify the sender
    try {
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
          },
        }
      );
      logger.info(`Payment confirmation sent to ${senderNumber}`);
    } catch (error) {
      logger.error(`Failed to send confirmation to ${senderNumber}:`, error.response?.data || error.message);
    }

    // 3) RESET the session immediately after success to end conversation
    sessionService.resetSession(senderNumber);
    logger.info(`Session reset for ${senderNumber}`);
  }

  res.sendStatus(200);
}


*************************************************************
 * Exports
 *************************************************************/
module.exports = {
  createStripeCheckoutSession,
  handleStripeWebhook,
};
