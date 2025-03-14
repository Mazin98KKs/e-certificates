require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto'); // For webhook signature verification (if needed)
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs'); // For Excel logging
const { parsePhoneNumberFromString } = require('libphonenumber-js'); // For phone validation
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Cloudinary configuration
cloudinary.config(process.env.CLOUDINARY_URL_UK);
console.log("Cloudinary Config Loaded:", cloudinary.config());

// Global in-memory storage
const checkoutLinks = {};  // To store checkout session URLs keyed by senderNumber
const sessionMetadata = {};  // To store session metadata keyed by Stripe session ID (or invoice)

// Middlewares
app.use('/webhook', bodyParser.json());
// For Stripe webhooks, we need the raw body for signature verification
app.use('/stripe-webhook', bodyParser.raw({ type: 'application/json' }));

// In-memory user sessions
const userSessions = {};
const initiatedConversations = new Set();
let initiatedCount = 0;

// Reset initiated count every 24 hours
setInterval(() => {
  initiatedConversations.clear();
  initiatedCount = 0;
}, 24 * 60 * 60 * 1000);

// Session timeout configuration (5 minutes)
const sessionTimeoutMs = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const userId in userSessions) {
    const session = userSessions[userId];
    if (now - session.lastActivity > sessionTimeoutMs) {
      console.log(`Session for ${userId} expired and is being removed.`);
      delete userSessions[userId];
    }
  }
}, 30 * 1000);

// Certificate configuration
const CERTIFICATE_PUBLIC_IDS = {
  1: "friendship_izeffy",
  2: "BFF_gq9uvn",
  3: "king_negative_lppdtt",
  4: "LGBTQ_ggrnfx",
  5: "goodvibes_j1pwa7",
  6: "coffeead_ot6pfn",
  7: "awsomeness_abfqao",
  8: "gossip_w3esd9",
  9: "do_nothing_rfcws5",
  10: "overthinker_m7p4tw",
};
const FREE_CERTIFICATES = [1];

/**
 * Validates and formats an international phone number.
 */
function validateAndFormatInternationalPhoneNumber(input) {
  let cleaned = input.replace(/\D/g, '');
  const phoneToParse = '+' + cleaned;
  const phoneNumber = parsePhoneNumberFromString(phoneToParse);
  if (phoneNumber && phoneNumber.isValid()) {
    return phoneNumber.format('E.164').substring(1);
  }
  return null;
}

/**
 * Logs certificate details to an Excel file.
 */
async function logCertificateDetails(senderNumber, recipientName, recipientNumber) {
  const filePath = path.join('/data', 'sent_certificates.xlsx');
  const workbook = new ExcelJS.Workbook();
  let worksheet;

  if (fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
    worksheet = workbook.getWorksheet("sent certificates");
    if (!worksheet) {
      worksheet = workbook.addWorksheet("sent certificates");
      worksheet.addRow(["Timestamp", "Sender Number", "Recipient Name", "Recipient Number"]);
    }
  } else {
    worksheet = workbook.addWorksheet("sent certificates");
    worksheet.addRow(["Timestamp", "Sender Number", "Recipient Name", "Recipient Number"]);
  }

  const timestamp = new Date().toISOString();
  worksheet.addRow([timestamp, senderNumber, recipientName, recipientNumber]);
  await workbook.xlsx.writeFile(filePath);
  console.log('Logged certificate details in Excel.');
}

/**
 * Redirects users to their unique checkout session.
 */
app.get('/checkout/:senderNumber', (req, res) => {
  const senderNumber = req.params.senderNumber;
  const sessionUrl = checkoutLinks[senderNumber];
  if (sessionUrl) {
    res.redirect(302, sessionUrl);
  } else {
    res.status(404).send('Invalid or expired checkout link.');
  }
});

/**
 * Webhook Verification Endpoint for WhatsApp (for language selection, etc.)
 */
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN_UK || 'mysecrettoken';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`Webhook verification request: mode=${mode}, token=${token}, challenge=${challenge}`);
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    console.log('WEBHOOK_VERIFICATION_FAILED: Invalid token or mode');
    return res.sendStatus(403);
  }
  console.log('WEBHOOK_VERIFICATION_FAILED: Missing mode or token');
  res.sendStatus(400);
});

/**
 * Webhook for Incoming WhatsApp Messages.
 */
app.post('/webhook', async (req, res) => {
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
            console.log(`Incoming message from ${from}: ${text}`);

            // Rate limit new sessions
            if (!initiatedConversations.has(from)) {
              if (initiatedCount >= 990) {
                await sendWhatsAppText(from, "Sorry, we're busy right now. Please try again later.");
                continue;
              }
              initiatedConversations.add(from);
              initiatedCount++;
            }

            await handleUserMessage(from, message);
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing incoming WhatsApp message:', error.message);
    res.sendStatus(500);
  }
});

/**
 * Main Conversation Logic (English).
 * Flow: 
 *   welcome → select_certificate → ask_recipient_name 
 *   → ask_recipient_number → ask_custom_message 
 *   → confirm_send → (await_payment or send immediately) 
 *   → ask_another.
 */
async function handleUserMessage(from, message) {
  const choiceRaw = message.interactive?.button_reply?.id || message.text?.body;
  const choice = choiceRaw ? choiceRaw.trim() : '';

  // Global commands
  if (choice === "Hello") {
    userSessions[from] = { step: 'welcome', certificatesSent: 0, lastActivity: Date.now() };
    await sendWelcomeTemplate(from);
    userSessions[from].step = 'select_certificate';
    return;
  }
  if (choice === "Stop") {
    if (userSessions[from]) delete userSessions[from];
    await sendWhatsAppText(from, "Session ended. Thank you.");
    return;
  }
  if (!userSessions[from]) {
    await sendWhatsAppText(from, "Please type 'Hello' to start or 'Stop' to exit.");
    return;
  }

  const session = userSessions[from];
  session.lastActivity = Date.now();

  switch (session.step) {
    case 'welcome':
      await sendWelcomeTemplate(from);
      session.step = 'select_certificate';
      break;

    case 'select_certificate': {
      const certificateChoice = parseInt(choice, 10);
      if (certificateChoice && certificateChoice >= 1 && certificateChoice <= 10) {
        session.selectedCertificate = certificateChoice;
        session.step = 'ask_recipient_name';
        await sendWhatsAppText(from, "What is the recipient's name?");
      } else {
        await sendWhatsAppText(from, "Please choose a valid certificate number from 1 to 10.");
      }
      break;
    }

    case 'ask_recipient_name': {
      if (choice) {
        session.recipientName = choice;
        session.step = 'ask_recipient_number';
        await sendWhatsAppText(from, "Enter the recipient's WhatsApp number with country code. Example: +447700900000");
      } else {
        await sendWhatsAppText(from, "Please enter a valid recipient name.");
      }
      break;
    }

    case 'ask_recipient_number': {
      const formattedNumber = validateAndFormatInternationalPhoneNumber(choice);
      if (formattedNumber) {
        session.recipientNumber = formattedNumber;
        session.step = 'ask_custom_message';
        await sendWhatsAppText(from, "Enter your custom message (single line, max 50 characters):");
      } else {
        await sendWhatsAppText(from, "Please enter a valid phone number including the country code. Example: 447700900000");
      }
      break;
    }

    case 'ask_custom_message': {
      if (choice) {
        // Check for single line and max 50 characters
        if (choice.length > 50 || choice.includes('\n') || choice.includes('\r')) {
          await sendWhatsAppText(from, "Please enter a single-line custom message of up to 50 characters. Try again:");
          // Remain in this state
        } else {
          session.customMessage = choice;
          session.step = 'confirm_send';
          await sendWhatsAppText(
            from,
            `Certificate will be sent to ${session.recipientName} (${session.recipientNumber}) with the message: "${session.customMessage}". Do you want to send it now? (Yes/No)`
          );
        }
      } else {
        await sendWhatsAppText(from, "Please enter a valid custom message.");
      }
      break;
    }

    case 'confirm_send': {
      if (/^Yes$/i.test(choice)) {
        if (FREE_CERTIFICATES.includes(session.selectedCertificate)) {
          // Free certificate
          await sendCertificateImage(
            from, 
            session.recipientNumber, 
            session.selectedCertificate, 
            session.recipientName, 
            session.customMessage
          );
          session.certificatesSent++;
          await sendWhatsAppText(from, "Certificate sent successfully.");
          session.step = 'ask_another';
          await sendWhatsAppText(from, "Would you like to send another certificate? (Yes/No)");
        } else {
          // Paid certificate
          const stripeSessionUrl = await createStripeCheckoutSession(
            session.selectedCertificate,
            from,
            session.recipientNumber,
            session.recipientName
          );
          if (stripeSessionUrl) {
            session.paymentPending = true;
            await sendWhatsAppText(from, `To complete the process, please pay via the following link:\n${stripeSessionUrl}`);
            session.step = 'await_payment';
          } else {
            await sendWhatsAppText(from, "An error occurred while creating the payment session. Please try again.");
          }
        }
      } else if (/^No$/i.test(choice)) {
        await sendWhatsAppText(from, "Session ended. Thank you.");
        delete userSessions[from];
        return;
      } else {
        await sendWhatsAppText(from, "Please respond with Yes or No.");
      }
      break;
    }

    case 'await_payment':
      await sendWhatsAppText(from, "Waiting for payment confirmation...");
      break;

    case 'ask_another': {
      if (/^Yes$/i.test(choice)) {
        session.step = 'welcome';
        await sendWelcomeTemplate(from);
        session.step = 'select_certificate';
      } else if (/^No$/i.test(choice)) {
        await sendWhatsAppText(from, "Session ended. Thank you.");
        delete userSessions[from];
      } else {
        await sendWhatsAppText(from, "Please respond with Yes or No.");
      }
      break;
    }

    default:
      await sendWhatsAppText(from, "An error occurred. Please type 'Hello' to start a new session or 'Stop' to exit.");
      userSessions[from] = { step: 'welcome', certificatesSent: 0, lastActivity: Date.now() };
      break;
  }

  userSessions[from] = session;
}

/**
 * Sends a welcome template via WhatsApp.
 */
async function sendWelcomeTemplate(to) {
  try {
    // NOTE: The only line changed is the URL below
    await axios.post(
      "https://graph.facebook.com/v22.0/511694895370910/messages", // Hard-coded new WhatsApp API URL
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: 'wel_en',  // Ensure you have an English welcome template
          language: { code: 'en' }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Template 'welcome' sent to ${to}`);
  } catch (error) {
    console.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

/**
 * Sends the certificate image via WhatsApp and logs certificate details.
 * Accepts an optional customMessage parameter.
 */
async function sendCertificateImage(sender, recipient, certificateId, recipientName, customMessage = "") {
  console.log(`Generating certificate image for Certificate ID: ${certificateId}, Recipient Name: ${recipientName}`);
  await logCertificateDetails(sender, recipientName, recipient);

  if (!certificateId || !CERTIFICATE_PUBLIC_IDS[certificateId]) {
    console.error(`Invalid certificate ID: ${certificateId}`);
    return;
  }
  const certificatePublicId = CERTIFICATE_PUBLIC_IDS[certificateId];
  const certificateImageUrl = cloudinary.url(certificatePublicId, {
    transformation: [
      {
        overlay: {
          font_family: "Arial",
          font_size: 80,
          text: recipientName
        },
        gravity: "center",
        y: -30
      }
    ]
  });

  try {
    // NOTE: The only line changed is the URL below
    await axios.post(
      "https://graph.facebook.com/v22.0/511694895370910/messages", // Hard-coded new WhatsApp API URL
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: 'gift1',  // Ensure you have an English gift template
          language: { code: 'en' },
          components: [
            {
              type: 'header',
              parameters: [
                { type: 'image', image: { link: certificateImageUrl } }
              ]
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: recipientName },
                { type: 'text', text: customMessage }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Template 'gift' sent to ${recipient} with recipient name: ${recipientName} and message: ${customMessage}`);
  } catch (error) {
    console.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

/**
 * Creates a Stripe checkout session for paid certificates.
 * Stores session metadata keyed by Stripe session ID.
 */
async function createStripeCheckoutSession(certificateId, senderNumber, recipientNumber, recipientName) {
  // This is only for demonstration – replace with real Price IDs
  const certificateToPriceMap = {
    2: "price_1R2AsnBH45p3WHSsiRKGkSR3",
    3: "price_1R2LIYBH45p3WHSsaLS2zDvR",
    4: "price_1R2LJ7BH45p3WHSsCGmpENqT",
    5: "price_1R2LJuBH45p3WHSs0J12FKNS",
    6: "price_1R2LKPBH45p3WHSsEkbP0zNE",
    7: "price_1R2LKtBH45p3WHSsqtyuMm1t",
    8: "price_1R2LLIBH45p3WHSssBVBri6r",
    9: "price_1R2LLsBH45p3WHSsKBlo6kSL",
    10: "price_1R2LMIBH45p3WHSsaLdB2QXQ"
  };

  const priceId = certificateToPriceMap[certificateId];
  if (!priceId) {
    console.error(`No Stripe price ID found for certificate ${certificateId}`);
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: {
        senderNumber,
        recipientNumber,
        certificateId,
        recipientName
      },
      success_url: "https://e-certificates.onrender.com/success.html",
      cancel_url: "https://e-certificates.onrender.com/cancel.html",
      billing_address_collection: 'auto'
    });
    console.log(`Stripe checkout session created: ${session.id}`);

    sessionMetadata[session.id] = {
      senderNumber,
      recipientNumber,
      certificateId,
      recipientName,
      customMessage: userSessions[senderNumber]?.customMessage || ""
    };
    checkoutLinks[senderNumber] = session.url;
    return `https://e-certificates.onrender.com/checkout/${senderNumber}`;
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error.message);
    return null;
  }
}

/**
 * Stripe Webhook for Payment Confirmation.
 */
app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = require('stripe')(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata;
    const customMessage = sessionMetadata[session.id]?.customMessage || "";
    if (senderNumber && recipientNumber && certificateId && recipientName) {
      console.log(`Payment completed via Stripe! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}, Message: ${customMessage}`);
      await sendCertificateImage(senderNumber, recipientNumber, certificateId, recipientName, customMessage);
      await sendWhatsAppText(senderNumber, `Thank you for your payment! The certificate has been sent to ${recipientName} with the message: "${customMessage}".`);
      console.log(`Terminating session for ${senderNumber}`);
      if (userSessions[senderNumber]) {
        delete userSessions[senderNumber];
      }
      delete sessionMetadata[session.id];
    } else {
      console.error("Incomplete metadata in Stripe session.");
    }
  }
  res.sendStatus(200);
});

/**
 * Sends a simple WhatsApp text message.
 */
async function sendWhatsAppText(to, message) {
  try {
    // NOTE: The only line changed is the URL below
    await axios.post(
      "https://graph.facebook.com/v22.0/511694895370910/messages", // Hard-coded new WhatsApp API URL
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Sent text to ${to}: ${message}`);
  } catch (error) {
    console.error('Error sending WhatsApp text:', error.response?.data || error.message);
  }
}

// Endpoint for monitoring initiated conversations
app.get('/status', (req, res) => {
  res.json({ initiatedConversations: initiatedCount });
});

// Route to download the sent certificates Excel file
app.get('/download-certificates', (req, res) => {
  const filePath = '/data/sent_certificates.xlsx';
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'sent_certificates.xlsx', (err) => {
      if (err) {
        console.error('Error downloading the file:', err);
        res.status(500).send('Error downloading the file');
      }
    });
  } else {
    res.status(404).send('File not found');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
