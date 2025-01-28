require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Cloudinary configuration
cloudinary.config(true);

const app = express();

app.use('/webhook', bodyParser.json());
app.use('/stripe-webhook', bodyParser.raw({ type: 'application/json' }));


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

// Certificates 1 and 5 are free
const FREE_CERTIFICATES = [1, 5];

// Map of certificates to Stripe Price IDs
const certificateToPriceMap = {
  2: "price_1Qlw3YBH45p3WHSs6t7GT3cc",
  3: "price_1QlwCPBH45p3WHSsOJPIV4ck",
  4: "price_1QlwBMBH45p3WHSsLhUpZIiJ",
  6: "price_1QlwBhBH45p3WHSshaMTmMgO",
  7: "price_1QlwCjBH45p3WHSsIkSlJpNl",
  8: "price_1QlwB3BH45p3WHSsO1DoVyn3",
  9: "price_1QlwAGBH45p3WHSst46YVwME",
  10: "price_1QlwAiBH45p3WHSsmU4G4EXn",
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
        if (FREE_CERTIFICATES.includes(session.selectedCertificate)) {
          // Send certificate directly for free certificates
          await sendCertificateImage(session.recipientNumber, session.selectedCertificate, session.recipientName);
          session.certificatesSent++;

          await sendWhatsAppText(from, "تم إرسال الشهادة بنجاح.");
          session.step = 'ask_another';
          await sendWhatsAppText(from, "هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)");
        } else {
          // Create Stripe checkout session for paid certificates
          const stripeSessionUrl = await createStripeCheckoutSession(session.selectedCertificate, from, session.recipientNumber, session.recipientName);
          if (stripeSessionUrl) {
            session.paymentPending = true;
            await sendWhatsAppText(from, `لإتمام الدفع، الرجاء زيارة الرابط التالي: ${stripeSessionUrl}`);
            session.step = 'await_payment';
          }
        }
      } else if (/^لا$/i.test(text.trim())) {
        await sendWhatsAppText(from, "تم إنهاء الجلسة. شكراً.");
        userSessions[from] = null;
      } else {
        await sendWhatsAppText(from, "يرجى الرد بـ (نعم/لا).");
      }
      break;

    case 'await_payment':
      // Wait for payment confirmation via Stripe webhook (handled separately)
      await sendWhatsAppText(from, "ننتظر تأكيد الدفع...");
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
 * Send a welcome template
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
 * Send the certificate image
 */
async function sendCertificateImage(recipient, certificateId, recipientName) {
  const certificateImageUrl = cloudinary.url(CERTIFICATE_PUBLIC_IDS[certificateId], {
    transformation: [
      {
        overlay: {
          font_family: "Arial",
          font_size: 80,
          text: recipientName,
        },
        gravity: "center",
        y: -10,
      },
    ],
  });

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

/**
 * Create a Stripe checkout session for paid certificates
 */
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  const priceId = certificateToPriceMap[certificateId];
  if (!priceId) {
    console.error(`No Stripe price ID found for certificate ${certificateId}`);
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        { price: priceId, quantity: 1 },
      ],
      mode: 'payment',
      success_url: `https://wa.me/16033040262`,
      cancel_url: `https://wa.me/16033040262`,
    });

    return session.url;
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error.message);
    return null;
  }
}

/**
 * Stripe Webhook Endpoint
 * Listens for checkout.session.completed events and triggers the certificate sending
 */
app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  console.log("Received signature:", sig);
  console.log("Using webhook secret:", process.env.STRIPE_WEBHOOK_SECRET);

  let event;

  try {
    // Pass the raw body, the signature header, and the endpoint secret to constructEvent
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // Log detailed debugging information
    console.error("Signature verification error:", err.message);
    console.error("Raw request body:", req.body.toString('utf8'));
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Check the event type and handle it accordingly
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata;

    console.log(`Payment completed! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}`);
    

    // Send the certificate image
    const certificateImageUrl = cloudinary.url(
      CERTIFICATE_PUBLIC_IDS[certificateId],
      {
        transformation: [
          {
            overlay: {
              font_family: "Arial",
              font_size: 80,
              text: recipientName,
            },
            gravity: "center",
            y: -20,
          },
        ],
      }
    );

    try {
      // Send certificate to recipient
      await axios.post(
        process.env.WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: recipientNumber,
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

      console.log(`Certificate sent to ${recipientNumber}`);
    } catch (error) {
      console.error(
        `Failed to send certificate to ${recipientNumber}:`,
        error.response?.data || error.message
      );
    }

    // Send confirmation message to the sender
    try {
      await axios.post(
        process.env.WHATSAPP_API_URL,
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
            Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          },
        }
      );

      console.log(`Payment confirmation sent to ${senderNumber}`);
    } catch (error) {
      console.error(
        `Failed to send confirmation to ${senderNumber}:`,
        error.response?.data || error.message
      );
    }
  }

  res.sendStatus(200);
});

/**
 * Send a simple WhatsApp text message
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
