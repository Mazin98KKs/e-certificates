require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs'); // For Excel logging
const { parsePhoneNumberFromString } = require('libphonenumber-js'); // For phone validation

const app = express();

// Cloudinary configuration
cloudinary.config(process.env.CLOUDINARY_URL);
console.log("Cloudinary Config Loaded:", cloudinary.config());

// Store short checkout URLs in memory
const checkoutLinks = {};

/**
 * Redirects users to their unique Stripe checkout session.
 */
app.get('/checkout/:shortId', (req, res) => {
  const shortId = req.params.shortId;
  const fullStripeUrl = checkoutLinks[shortId];

  if (fullStripeUrl) {
    res.redirect(302, fullStripeUrl);
  } else {
    res.status(404).send('Invalid or expired checkout link.');
  }
});

// Middleware for parsing JSON bodies for WhatsApp messages
app.use('/webhook', bodyParser.json());
// Middleware for parsing raw body for Stripe webhooks
app.use('/stripe-webhook', bodyParser.raw({ type: 'application/json' }));

// In-memory user sessions
const userSessions = {};

// Conversation counter (for rate limiting new sessions)
const initiatedConversations = new Set();
let initiatedCount = 0;

// Reset initiated count every 24 hours
setInterval(() => {
  initiatedConversations.clear();
  initiatedCount = 0;
}, 24 * 60 * 60 * 1000);

// Session timeout configuration (5 minutes)
const sessionTimeoutMs = 5 * 60 * 1000;

// Periodically clean up expired sessions (every 30 seconds)
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

// Map of certificates to Cloudinary public IDs
const CERTIFICATE_PUBLIC_IDS = {
  1: "bestfriend_aamfqh",
  2: "malgof_egqihg",
  3: "kfoo_ncybxx",
  4: "lazy_vndi9i",
  5: "Mokaf7_wdocgh",
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
 * Validates and formats an international phone number.
 * It accepts a number with country code (digits only) or extra characters,
 * and returns the number in E.164 format without the leading plus sign.
 *
 * @param {string} input - The phone number input.
 * @returns {string|null} - Formatted phone number (e.g., "96890000000") or null.
 */
function validateAndFormatInternationalPhoneNumber(input) {
  let cleaned = input.replace(/\D/g, '');
  const phoneToParse = '+' + cleaned;
  const phoneNumber = parsePhoneNumberFromString(phoneToParse);
  if (phoneNumber && phoneNumber.isValid()) {
    const formatted = phoneNumber.format('E.164');
    return formatted.substring(1);
  }
  return null;
}

/**
 * Logs certificate details to an Excel file.
 * Appends a new row with [Timestamp, Sender Number, Recipient Name, Recipient Number]
 * to "sent_certificates.xlsx" in the same directory.
 *
 * @param {string} senderNumber
 * @param {string} recipientName
 * @param {string} recipientNumber
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
 * Webhook Verification Endpoint.
 */
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mysecrettoken';
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

            // Rate limit new sessions by counting initiated conversations
            if (!initiatedConversations.has(from)) {
              if (initiatedCount >= 990) {
                await sendWhatsAppText(from, "Sorry, we're busy now. Please try again later.");
                continue; // Skip processing for new conversations
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
 * Handles conversation logic based on user session state.
 */
async function handleUserMessage(from, message) {
  const choiceRaw = message.interactive?.button_reply?.id || message.text?.body;
  const choice = choiceRaw ? choiceRaw.trim() : '';

  // Global command: start/restart conversation
  if (choice === "مرحبا") {
    userSessions[from] = { step: 'welcome', certificatesSent: 0, lastActivity: Date.now() };
    await sendWelcomeTemplate(from);
    userSessions[from].step = 'select_certificate';
    return;
  }

  // Global command: stop conversation
  if (choice === "وقف") {
    if (userSessions[from]) delete userSessions[from];
    await sendWhatsAppText(from, "تم إنهاء الخدمة. شكراً.");
    return;
  }

  // If no active session exists, prompt the user
  if (!userSessions[from]) {
    await sendWhatsAppText(from, "يرجى اختيار إما 'مرحبا' لبدء الخدمة أو 'وقف' لإنهائها.");
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
        await sendWhatsAppText(from, "وش اسم الشخص اللي ودك ترسله الشهاده");
      } else {
        await sendWhatsAppText(from, "يرجى اختيار رقم صحيح من 1 إلى 10.");
      }
      break;
    }

    case 'ask_recipient_name': {
      if (choice) {
        session.recipientName = choice;
        session.step = 'ask_recipient_number';
        await sendWhatsAppText(from, "ادخل رقم واتساب المستلم مع رمز الدولة. مثال: \nللسعودية: 966500000000\nلعمان: 96890000000");
      } else {
        await sendWhatsAppText(from, "يرجى إدخال اسم صحيح.");
      }
      break;
    }

    case 'ask_recipient_number': {
      const formattedNumber = validateAndFormatInternationalPhoneNumber(choice);
      if (formattedNumber) {
        session.recipientNumber = formattedNumber;
        session.step = 'confirm_send';
        await sendWhatsAppText(from, `سيتم إرسال الشهادة إلى ${session.recipientName} على الرقم: ${formattedNumber}. هل تريد إرسالها الآن؟ (نعم/لا)`);
      } else {
        await sendWhatsAppText(from, "يرجى إدخال رقم صحيح يشمل رمز الدولة. مثال: 966500000000");
      }
      break;
    }

    case 'confirm_send': {
      if (/^نعم$/i.test(choice)) {
        if (FREE_CERTIFICATES.includes(session.selectedCertificate)) {
          // For free certificates, send certificate image immediately
          await sendCertificateImage(from, session.recipientNumber, session.selectedCertificate, session.recipientName);
          session.certificatesSent++;
          await sendWhatsAppText(from, "تم إرسال الشهادة بنجاح.");
          session.step = 'ask_another';
          await sendWhatsAppText(from, "هل ترغب في إرسال شهادة أخرى؟ (نعم/لا)");
        } else {
          const stripeSessionUrl = await createStripeCheckoutSession(
            session.selectedCertificate,
            from,
            session.recipientNumber,
            session.recipientName
          );
          if (stripeSessionUrl) {
            session.paymentPending = true;
            await sendWhatsAppText(from, `لإتمام العمليه يمكنك الدفع عن طريق نظام آبل من خلال الرابط الاتي:\n${stripeSessionUrl}`);
            session.step = 'await_payment';
          } else {
            await sendWhatsAppText(from, "حدث خطأ في إنشاء جلسة الدفع. حاول مرة أخرى.");
          }
        }
      } else if (/^لا$/i.test(choice)) {
        await sendWhatsAppText(from, "تم إنهاء المحادثة. شكراً.");
        delete userSessions[from];
        return;
      } else {
        await sendWhatsAppText(from, "يرجى الرد بـ (نعم/لا).");
      }
      break;
    }

    case 'await_payment':
      await sendWhatsAppText(from, "ننتظر تأكيد الدفع...");
      break;

    case 'ask_another': {
      if (/^نعم$/i.test(choice)) {
        session.step = 'welcome';
        await sendWelcomeTemplate(from);
        session.step = 'select_certificate';
      } else if (/^لا$/i.test(choice)) {
        await sendWhatsAppText(from, "تم إنهاء المحادثة. شكراً.");
        delete userSessions[from];
      } else {
        await sendWhatsAppText(from, "يرجى الرد بـ (نعم/لا).");
      }
      break;
    }

    default:
      await sendWhatsAppText(from, "حدث خطأ. أرسل 'مرحبا' أو 'وقف' لإنهائها.");
      userSessions[from] = { step: 'welcome', certificatesSent: 0, lastActivity: Date.now() };
      break;
  }

  // Update session if it still exists
  if (userSessions[from]) {
    userSessions[from] = session;
  }
}

/**
 * Sends a welcome template via WhatsApp.
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
          name: 'wel_sel',
          language: { code: 'ar' }
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
 * Sends the certificate image via WhatsApp and logs the certificate details.
 * Accepts the sender's number for logging purposes.
 */
async function sendCertificateImage(sender, recipient, certificateId, recipientName) {
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
    await axios.post(
      process.env.WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: 'gift5',
          language: { code: 'ar' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'image',
                  image: { link: certificateImageUrl }
                }
              ]
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: recipientName }
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
    console.log(`Template 'gift' sent to ${recipient} with recipient name: ${recipientName}`);
  } catch (error) {
    console.error('Error sending WhatsApp template:', error.response?.data || error.message);
  }
}

/**
 * Creates a Stripe checkout session for paid certificates.
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
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      metadata: {
        senderNumber,
        recipientNumber,
        certificateId,
        recipientName
      },
      success_url: `https://e-certificates.onrender.com/success.html`,
      cancel_url: `https://e-certificates.onrender.com/cancel.html`,
      billing_address_collection: 'auto'
    });


    console.log(`Stripe checkout session created: ${session.id}`);


    const shortId = senderNumber; // Uses sender's phone number as the unique ID
    checkoutLinks[shortId] = session.url;

    return `https://e-certificates.onrender.com/checkout/${shortId}`;
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error.message);
    return null;
  }
}

/**
 * Stripe Webhook Endpoint.
 */
app.post('/stripe-webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  console.log(`Received signature: ${sig}`);
  console.log(`Using webhook secret: ${process.env.STRIPE_WEBHOOK_SECRET}`);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Signature verification error: ${err.message}`);
    console.error(`Raw request body: ${req.body.toString('utf8')}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { senderNumber, recipientNumber, certificateId, recipientName } = session.metadata;
    if (!senderNumber || !recipientNumber || !certificateId || !recipientName) {
      console.error("Missing metadata fields in checkout.session.completed event.");
      return res.sendStatus(400);
    }
    console.log(`Payment completed! Sender: ${senderNumber}, Recipient: ${recipientNumber}, Certificate ID: ${certificateId}, Name: ${recipientName}`);

    const certificateImageUrl = cloudinary.url(
      CERTIFICATE_PUBLIC_IDS[certificateId],
      {
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
      }
    );

    try {
      await axios.post(
        process.env.WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: recipientNumber,
          type: 'template',
          template: {
            name: 'gift5',
            language: { code: 'ar' },
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
                  { type: 'text', text: recipientName }
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
      console.log(`Certificate sent to ${recipientNumber}`);
    } catch (error) {
      console.error(`Failed to send certificate to ${recipientNumber}:`, error.response?.data || error.message);
    }

    try {
      await axios.post(
        process.env.WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: senderNumber,
          type: 'text',
          text: { body: `شكراً للدفع! الشهادة تم إرسالها بنجاح إلى ${recipientName}.` }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`Payment confirmation sent to ${senderNumber}`);
    } catch (error) {
      console.error(`Failed to send confirmation to ${senderNumber}:`, error.response?.data || error.message);
    }

    console.log(`Terminating session for ${senderNumber}`);
    if (senderNumber) {
      delete userSessions[senderNumber];
    }
  } else {
    console.log(`Unhandled event type ${event.type}`);
  }

  res.sendStatus(200);
});

/**
 * Sends a simple WhatsApp text message.
 */
async function sendWhatsAppText(to, message) {
  try {
    await axios.post(
      process.env.WHATSAPP_API_URL,
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


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
