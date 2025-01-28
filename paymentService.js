// Add logs around Stripe session creation
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  logger.info({ event: 'CreateStripeCheckoutSessionStart', certificateId, senderNumber });

  const priceId = certificateToPriceMap[certificateId];
  if (!priceId) {
    logger.error({ event: 'CreateStripeCheckoutSessionNoPriceId', certificateId });
    return null;
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: { senderNumber, recipientNumber, certificateId, recipientName },
      success_url: config.successUrl,
      cancel_url: config.cancelUrl,
    });

    logger.info({ event: 'CreateStripeCheckoutSessionSuccess', sessionId: session.id });
    return session.url;
  } catch (error) {
    logger.error({ event: 'CreateStripeCheckoutSessionError', error: error.message });
    return null;
  }
}

// Add logs in the webhook handler
async function handleStripeWebhook(req, res) {
  logger.info({ event: 'StripeWebhookReceived' });

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret);
    logger.info({ event: 'StripeWebhookConstructed', stripeEvent: event.type });
  } catch (err) {
    logger.error({ event: 'StripeWebhookVerificationError', error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    logger.info({ event: 'StripeWebhookSessionCompleted' });
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata || {};

    if (senderNumber && recipientNumber && certificateId && recipientName) {
      try {
        logger.info({ event: 'StripeWebhookProcessPayment', senderNumber, recipientNumber, certificateId });
        await sendCertificateImage(recipientNumber, certificateId, recipientName);
        logger.info({ event: 'StripeWebhookCertificateSent', recipientNumber, certificateId });

        await axios.post(
          config.whatsappApiUrl,
          { messaging_product: 'whatsapp', to: senderNumber, type: 'text', text: { body: 'شكراً للدفع! الشهادة تم إرسالها بنجاح.' } },
          { headers: { Authorization: `Bearer ${config.whatsappApiToken}` } }
        );

        logger.info({ event: 'StripeWebhookPaymentConfirmationSent', senderNumber });
      } catch (error) {
        logger.error({ event: 'StripeWebhookProcessingError', error: error.message });
      }
    } else {
      logger.warn({ event: 'StripeWebhookMissingMetadata', metadata: session.metadata });
    }
  }

  res.sendStatus(200);
}
