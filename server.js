require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const stripeLib = require('stripe');
const cloudinaryLib = require('cloudinary').v2;

const app = express();
app.use(bodyParser.json());

// Configure Cloudinary
cloudinaryLib.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Stripe instance
const stripe = stripeLib(process.env.STRIPE_SECRET_KEY);

// In-memory user sessions
const userSessions = {};

/**
 * 1) Webhook Verification Endpoint
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
 * 2) Webhook for Incoming WhatsApp Messages
 */
app.post('/webhook', async (req, res) => {
  // Basic structure checks
  if (req.body.object === 'whatsapp_business_account') {
    const entry = req.body.entry && req.body.entry[0];
    if (entry && entry.changes) {
      const changes = entry.changes;
      for (const change of changes) {
        const value = change.value;
        if (!value.messages) continue;

        const messages = value.messages;
        for (const message of messages) {
          const from = message.from; // The sender's WhatsApp number
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
  // Get or create user session
  let session = userSessions[from];
  if (!session) {
    session = { step: 'welcome', paid: false };
    userSessions[from] = session;
  }

  switch (session.step) {
    case 'welcome':
      // 1. Send welcome/select message
      await sendWhatsAppText(from, "Welcome! Please select a certificate:\n1. Free\n2. Paid");
      session.step = 'select_certificate';
      break;

    case 'select_certificate':
      if (/free/i.test(text) || text === '1') {
        session.certificateType = 'free';
        session.step = 'ask_details';
        await sendWhatsAppText(from, "Please provide the recipient's name and number, e.g.: John, 123456789");
      } else if (/paid/i.test(text) || text === '2') {
        session.certificateType = 'paid';
        session.step = 'ask_payment';
        // 2. Create a Stripe payment link or session
        const paymentUrl = await createStripeCheckoutLink();
        session.paymentLink = paymentUrl;
        await sendWhatsAppText(from, `Please complete your payment: ${paymentUrl}`);
      } else {
        await sendWhatsAppText(from, "Invalid choice. Type '1' for Free or '2' for Paid.");
      }
      break;

    case 'ask_payment':
      // If user just responds, we can check if they mention "done" or "paid"
      // In real usage, you'd use a Stripe webhook to confirm payment asynchronously
      if (/paid|done|ok|yes/i.test(text)) {
        // Mark as paid
        session.paid = true;
        session.step = 'ask_details';
        await sendWhatsAppText(from, "Payment confirmed! Now please provide the recipient's name and number.");
      } else {
        await sendWhatsAppText(from, "Once you've paid, type 'done' or 'paid'.");
      }
      break;

    case 'ask_details':
      // Expecting user to provide "Name, Number"
      if (text.includes(',')) {
        const [name, number] = text.split(',').map(s => s.trim());
        if (name && number) {
          session.recipientName = name;
          session.recipientNumber = number;
          session.step = 'send_certificate';
          await sendWhatsAppText(from, `Got it. Sending certificate to ${name} at ${number}...`);
          await sendCertificateImageToRecipient(from);
          session.step = 'done';
          await sendWhatsAppText(from, "All done! Thank you.");
        } else {
          await sendWhatsAppText(from, "Please send in the format: Name, Number");
        }
      } else {
        await sendWhatsAppText(from, "Please send in the format: Name, Number");
      }
      break;

    case 'done':
      // Conversation is done. Optionally reset the session
      // userSessions[from] = null; // or some cleanup
      break;

    default:
      await sendWhatsAppText(from, "Something went wrong. Type 'Hello' or 'Hi' to restart.");
      // Reset session if stuck
      userSessions[from] = { step: 'welcome', paid: false };
      break;
  }
}

/**
 * 3) Send a simple WhatsApp text message
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
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
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
 * 4) Create Stripe Payment Link or Session
 */
async function createStripeCheckoutLink() {
  // Example: create a payment link for a single product
  const productPriceId = 'price_12345'; // Replace with your Stripe price ID
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: productPriceId, quantity: 1 }],
      mode: 'payment',
      success_url: 'https://yourdomain.com/checkout-success', // or a dynamic link
      cancel_url: 'https://yourdomain.com/checkout-cancel',
    });
    return session.url;
  } catch (err) {
    console.error('Error creating Stripe link:', err.message);
    return 'Error generating payment link';
  }
}

/**
 * 5) Send Certificate Image to Recipient
 */
async function sendCertificateImageToRecipient(senderNumber) {
  const session = userSessions[senderNumber];
  if (!session) return;
  
  // The template is hosted on Cloudinary, or you can generate a dynamic overlay if needed
  // For now, assume a direct Cloudinary link or dynamic transformation
  const certificateUrl = cloudinaryLib.url(process.env.CERTIFICATE_TEMPLATE_PUBLIC_ID, {
    transformation: [
      // Optionally add overlays / text with recipient name
      // { overlay: { font_family: "Arial", font_size: 30, text: session.recipientName }, gravity: "north", y: 80 },
    ],
  });

  // Send the image to the recipient
  try {
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: session.recipientNumber,
        type: 'image',
        image: {
          link: certificateUrl,
          caption: `Congratulations, ${session.recipientName}!`,
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Certificate sent to ${session.recipientNumber}: ${certificateUrl}`);
  } catch (error) {
    console.error('Error sending certificate image:', error.response?.data || error.message);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
