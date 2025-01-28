const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CERTIFICATE_PUBLIC_IDS } = require('./config');
const { sendTextMessage } = require('./messageService');

/**
 * Handle Stripe webhook events
 * @param {object} req - The Express request object
 * @param {object} res - The Express response object
 */
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata;

    console.log(`Payment completed! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}`);

    try {
      await sendTextMessage(recipientNumber, `شكراً للدفع! الشهادة تم إرسالها بنجاح إلى ${recipientName}.`);
    } catch (error) {
      console.error('Error sending payment confirmation:', error.message);
    }
  }

  res.sendStatus(200);
}

module.exports = { handleStripeWebhook };
